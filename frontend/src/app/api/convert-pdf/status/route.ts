import { NextRequest, NextResponse } from 'next/server';
import { getUserDbName } from '@/gateways/server/user-db';

export const dynamic = 'force-dynamic';

/** GET /api/convert-pdf/status?jobId=... — poll a background PDF conversion. */
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
  }
  const learnBase =
    process.env.LEARN_SERVICE_URL?.replace(/\/$/, '') || 'http://learn:8000';
  const noStore = { 'Cache-Control': 'no-store, max-age=0' };
  try {
    const upstream = await fetch(
      `${learnBase}/api/convert-pdf/status?jobId=${encodeURIComponent(jobId)}`,
      { headers: { 'X-User-Db': await getUserDbName() }, cache: 'no-store' },
    );
    const body = await upstream.json().catch(() => ({}));
    // Pass learn's status through verbatim (running | done | error | unknown).
    // Learn's `unknown` (HTTP 404) means the job is genuinely gone, which the client
    // treats as terminal — so we must NOT reuse `unknown` for our own transient errors.
    return NextResponse.json(body, { status: upstream.status, headers: noStore });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Learn unreachable from the app (transient): distinct status so the client retries
    // instead of giving up as if the job were lost.
    return NextResponse.json(
      { status: 'unreachable', error: `Conversion status unavailable: ${message}` },
      { status: 503, headers: noStore },
    );
  }
}
