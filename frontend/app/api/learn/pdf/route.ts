import { NextRequest, NextResponse } from 'next/server'
import { getLearnServiceBaseUrl } from '@/lib/server/learn-upstream'
import { getUserDbName } from '@/lib/server/user-db'

export const dynamic = 'force-dynamic'

// Binary streaming proxy for the ORIGINAL PDF (the JSON proxy would corrupt it).
// Forwards Range so the browser's PDF viewer can seek inside large files.
export async function GET(req: NextRequest) {
  try {
    const base = getLearnServiceBaseUrl()
    const qs = req.nextUrl.searchParams.toString()
    const url = `${base}/api/document/pdf${qs ? `?${qs}` : ''}`

    const headers: Record<string, string> = { 'X-User-Db': await getUserDbName() }
    const range = req.headers.get('range')
    if (range) headers['Range'] = range

    const upstream = await fetch(url, { headers, cache: 'no-store' })
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: 'no original PDF' }, { status: upstream.status })
    }

    const out = new Headers()
    for (const h of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges',
      'content-disposition',
    ]) {
      const v = upstream.headers.get(h)
      if (v) out.set(h, v)
    }
    return new NextResponse(upstream.body, { status: upstream.status, headers: out })
  } catch (error) {
    console.error('pdf proxy:', error)
    return NextResponse.json({ error: 'Learn service unavailable' }, { status: 503 })
  }
}
