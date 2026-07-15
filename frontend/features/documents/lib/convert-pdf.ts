export type PdfConvertResponse = {
  markdown: string;
  sourceFilename: string;
  outputFilename: string;
  pageCount: number;
  savedPath?: string | null;
  docId?: string;
};

type ConvertResult = {
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

/**
 * Convert a PDF to markdown. Conversion runs as a background job on the learn service
 * (it can take minutes for a large book, longer than the ~5-min app->learn fetch limit),
 * so we start the job and poll for completion from the browser (which has no such limit).
 */
export async function convertPdfToMarkdown(file: File): Promise<ConvertResult> {
  const form = new FormData();
  form.append('file', file, file.name);

  const startRes = await fetch('/api/convert-pdf', { method: 'POST', body: form });
  const startData = (await startRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (!startRes.ok) {
    throw new Error((startData.error as string) || `PDF conversion failed (${startRes.status})`);
  }

  // Identical content already ingested (matched by hash): reuse the stored conversion
  // instead of building a third copy of the same book. Fetch its markdown so the caller
  // gets the same shape a fresh conversion would produce.
  if (startData.status === 'duplicate' && startData.docId) {
    const docId = startData.docId as string;
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
    const base = file.name.replace(/\.pdf$/i, '');
    return {
      markdown: doc.markdown,
      outputFilename: `${base}.md`,
      pageCount: doc.pageCount ?? 0,
      learnDocId: docId,
      duplicateOf: (startData.existingTitle as string) || doc.sourceFilename || docId,
    };
  }

  // Back-compat: an older synchronous server returns the full result directly.
  if (!startData.jobId && startData.markdown) {
    return resultFrom(startData as PdfConvertResponse);
  }
  const jobId = startData.jobId as string | undefined;
  if (!jobId) throw new Error('Conversion did not start (no job id)');

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
          throw new Error('Lost connection to the conversion service — please retry.');
        }
        continue;
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Lost connection')) throw err;
      if (++consecutiveMisses > MAX_POLL_MISSES) {
        throw new Error('Lost connection to the conversion service — please retry.');
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
  throw new Error('PDF conversion timed out (over 25 minutes).');
}

export function markdownToFile(markdown: string, outputFilename: string): File {
  return new File([markdown], outputFilename, { type: 'text/markdown' });
}

export function isPdfFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.pdf');
}

const SUPPORTED_EXTENSIONS = ['.md', '.csv', '.txt', '.json', '.pdf'];

export function isSupportedIngestFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export type PreparedIngestFile = {
  file: File;
  convertedFromPdf?: boolean;
  originalPdfName?: string;
  pageCount?: number;
  learnDocId?: string;
  /** Set when the PDF matched an existing ingest by content hash (title of the original). */
  duplicateOf?: string;
};

/** Convert PDFs to .md Files; pass through other supported types unchanged. */
export async function prepareFilesForIngestion(
  files: File[],
): Promise<PreparedIngestFile[]> {
  const results: PreparedIngestFile[] = [];
  for (const file of files) {
    if (isPdfFile(file)) {
      const { markdown, outputFilename, pageCount, learnDocId, duplicateOf } =
        await convertPdfToMarkdown(file);
      results.push({
        file: markdownToFile(markdown, outputFilename),
        convertedFromPdf: true,
        originalPdfName: file.name,
        pageCount,
        learnDocId,
        duplicateOf,
      });
    } else {
      results.push({ file });
    }
  }
  return results;
}
