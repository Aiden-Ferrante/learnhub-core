import { NextRequest, NextResponse } from 'next/server';
import { getUserDbName } from '@/gateways/server/user-db';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

type NamedBlob = Blob & { name?: string };

function uploadFilename(blob: Blob): string {
  const name = (blob as NamedBlob).name;
  return typeof name === 'string' && name.length > 0 ? name : 'document.pdf';
}

/** What the learn service will convert: a rendered book, or an authored one. */
const ACCEPTED_SUFFIXES = ['.pdf', '.md', '.markdown'];

/**
 * Proxy a document upload to the learn service for conversion.
 * POST /api/convert-pdf  (multipart field: file)
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string' || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'Missing file upload' }, { status: 400 });
    }

    const name = uploadFilename(file);
    if (!ACCEPTED_SUFFIXES.some((ext) => name.toLowerCase().endsWith(ext))) {
      return NextResponse.json(
        { error: `Only ${ACCEPTED_SUFFIXES.join(', ')} files are accepted` },
        { status: 400 },
      );
    }

    const learnBase =
      process.env.LEARN_SERVICE_URL?.replace(/\/$/, '') || 'http://learn:8000';
    const forward = new FormData();
    forward.append('file', file, name);

    const upstream = await fetch(`${learnBase}/api/convert-pdf`, {
      method: 'POST',
      headers: { 'X-User-Db': await getUserDbName() },
      body: forward,
    });

    const body = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      const detail =
        typeof body.detail === 'string'
          ? body.detail
          : body.error || 'PDF conversion failed';
      return NextResponse.json({ error: detail }, { status: upstream.status });
    }

    return NextResponse.json(body);
  } catch (error) {
    console.error('convert-pdf proxy error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `PDF conversion service unavailable: ${message}` },
      { status: 503 },
    );
  }
}
