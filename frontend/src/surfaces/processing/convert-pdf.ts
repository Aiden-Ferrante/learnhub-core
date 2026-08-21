export type PdfConvertResponse = {
  markdown: string;
  sourceFilename: string;
  outputFilename: string;
  pageCount: number;
  savedPath?: string | null;
  docId?: string;
};

export type ConvertResult = {
  markdown: string;
  outputFilename: string;
  pageCount: number;
  learnDocId?: string;
  /** This exact PDF was already ingested — linked to the existing content, nothing re-converted. */
  duplicateOf?: string;
};

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 25 * 60 * 1000; // big books take minutes; allow plenty
const MAX_POLL_MISSES = 5; // ~15s of consecutive transient failures before giving up

/**
 * We stopped watching, but the job itself is very likely still running server-side
 * (connection blip, or we hit the poll deadline). Distinct from a real conversion
 * failure: the caller must leave the card `Converting` and try again later rather
 * than burn it as `Error` — the learn service finishes regardless of this tab.
 */
export class ConversionUnavailable extends Error {}

function resultFrom(r: PdfConvertResponse): ConvertResult {
  if (!r.markdown || !r.outputFilename) {
    throw new Error('Invalid response from PDF conversion service');
  }
  return {
    markdown: r.markdown,
    outputFilename: r.outputFilename,
    pageCount: r.pageCount ?? 0,
    learnDocId: r.docId,
  };
}

/** What `startPdfConversion` found: a job to wait on, an already-ingested book, or
 *  (back-compat) a synchronous server that converted inline. */
export type ConversionStart =
  | { kind: 'job'; docId: string }
  | { kind: 'duplicate'; docId: string; existingTitle?: string }
  | { kind: 'sync'; result: ConvertResult };

/**
 * Upload the PDF and enqueue its conversion. Fast — it returns as soon as the learn
 * service has stashed the bytes and minted the document id, NOT when the book is
 * converted. The returned `docId` is the learn-service document id (the service uses
 * it as the job id too), so the caller can persist a card for this book immediately,
 * before the minutes-long conversion it must not depend on surviving.
 */
export async function startPdfConversion(file: File): Promise<ConversionStart> {
  const form = new FormData();
  form.append('file', file, file.name);

  const startRes = await fetch('/api/convert-pdf', { method: 'POST', body: form });
  const startData = (await startRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!startRes.ok) {
    throw new Error((startData.error as string) || `PDF conversion failed (${startRes.status})`);
  }

  // Identical content already ingested (matched by hash): reuse the stored conversion
  // instead of building a third copy of the same book.
  if (startData.status === 'duplicate' && startData.docId) {
    return {
      kind: 'duplicate',
      docId: startData.docId as string,
      existingTitle: startData.existingTitle as string | undefined,
    };
  }

  // Back-compat: an older synchronous server returns the full result directly.
  if (!startData.jobId && startData.markdown) {
    return { kind: 'sync', result: resultFrom(startData as PdfConvertResponse) };
  }
  const jobId = startData.jobId as string | undefined;
  if (!jobId) throw new Error('Conversion did not start (no job id)');
  return { kind: 'job', docId: jobId };
}

/** Read an already-converted book's stored content, in the shape a fresh conversion
 *  produces. Used for the duplicate-hash path. */
export async function loadConvertedDocument(
  docId: string,
  pdfName: string,
  existingTitle?: string,
): Promise<ConvertResult> {
  const docRes = await fetch(`/api/learn/document?id=${encodeURIComponent(docId)}`, {
    cache: 'no-store',
  });
  const docData = (await docRes.json().catch(() => ({}))) as {
    document?: { markdown?: string; pageCount?: number; sourceFilename?: string } | null;
  };
  const doc = docData.document;
  if (!doc?.markdown) {
    throw new Error(
      'This PDF is already in your library, but its stored content could not be loaded — delete the existing course first if you want to re-ingest it.',
    );
  }
  return {
    markdown: doc.markdown,
    outputFilename: markdownNameFor(pdfName),
    pageCount: doc.pageCount ?? 0,
    learnDocId: docId,
    duplicateOf: existingTitle || doc.sourceFilename || docId,
  };
}

/**
 * Wait for a conversion job to finish, polling from the browser (the app->learn fetch
 * has a ~5-min limit; a big book takes longer). Throws `ConversionUnavailable` when we
 * merely lost sight of the job — the caller keeps waiting — and a plain Error only when
 * the conversion itself failed.
 */
export async function awaitPdfConversion(jobId: string): Promise<ConvertResult> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let consecutiveMisses = 0; // transient poll failures (blip/auth refresh) — tolerate a few
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    let s: Record<string, unknown>;
    try {
      const sRes = await fetch(`/api/convert-pdf/status?jobId=${encodeURIComponent(jobId)}`, {
        cache: 'no-store',
      });
      s = (await sRes.json().catch(() => ({}))) as Record<string, unknown>;
      // A non-OK response is transient UNLESS learn itself reports the job is gone
      // (HTTP 404 + status:"unknown"). Anything else (503 "unreachable", 401, 5xx) → retry.
      if (!sRes.ok && s.status !== 'unknown') {
        if (++consecutiveMisses > MAX_POLL_MISSES) {
          throw new ConversionUnavailable('Lost sight of the conversion — still running.');
        }
        continue;
      }
    } catch (err) {
      if (err instanceof ConversionUnavailable) throw err;
      if (++consecutiveMisses > MAX_POLL_MISSES) {
        throw new ConversionUnavailable('Lost sight of the conversion — still running.');
      }
      continue;
    }
    consecutiveMisses = 0;

    if (s.status === 'done') return resultFrom(s.result as PdfConvertResponse);
    if (s.status === 'error') throw new Error((s.error as string) || 'PDF conversion failed');
    if (s.status === 'unknown') {
      throw new Error('Conversion job was lost (the service may have restarted) — please retry.');
    }
    // status === 'running' (or transient 'unreachable' that slipped an OK) → keep polling
  }
  // Not a failure — we simply stopped watching. The job outlives this poll.
  throw new ConversionUnavailable('Still converting after 25 minutes — stopped watching.');
}

export function markdownToFile(markdown: string, outputFilename: string): File {
  return new File([markdown], outputFilename, { type: 'text/markdown' });
}

/** The name the converted book takes: the source's, with a .md extension. Matches what the
 *  learn service reports as `outputFilename`, so a card can be named before it converts.
 *  Idempotent — an authored `.md` is already its own output name. */
export function markdownNameFor(sourceName: string): string {
  if (MARKDOWN_EXTENSIONS.some((ext) => sourceName.toLowerCase().endsWith(ext))) {
    return sourceName;
  }
  return `${sourceName.replace(/\.pdf$/i, '')}.md`;
}

export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf');
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown'];

/** Every extension the learn service will actually ingest.
 *
 *  This list used to read `['.md', '.csv', '.txt', '.json', '.pdf']`, which was text2knowledge
 *  residue: the three data formats had no ingestion path on either side, and a `.md` drop fell
 *  through to a client-only card with no `learnDocId` — a row attached to no document. Both
 *  formats here now go through the same upload → convert → persist pipeline. */
const SUPPORTED_EXTENSIONS = [...MARKDOWN_EXTENSIONS, '.pdf'];

export function isSupportedIngestFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type PreparedIngestFile = {
  file: File;
  /** Card display name. Defaults to the file's — set it when the card is minted before
   *  its content exists, so the name never changes under the user mid-conversion. */
  name?: string;
  /** The conversion job is still running: this card is a placeholder that persists the
   *  book's `learnDocId` NOW, and is settled when the job reports done. */
  converting?: boolean;
  convertedFromPdf?: boolean;
  originalPdfName?: string;
  pageCount?: number;
  learnDocId?: string;
  /** Set when the PDF matched an existing ingest by content hash (title of the original). */
  duplicateOf?: string;
};
