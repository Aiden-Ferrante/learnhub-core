import { NextRequest, NextResponse } from 'next/server'
import { getLearnServiceBaseUrl } from '@/gateways/server/learn-upstream'
import { getUserDbName } from '@/gateways/server/user-db'

export const dynamic = 'force-dynamic'

// Binary/range-streaming proxy for the generated MP3. The JSON proxy (proxyLearnGet)
// would try to JSON.parse the audio and corrupt it — stream the body through instead,
// forwarding Range so the <audio> element can seek.
export async function GET(req: NextRequest) {
  try {
    const base = getLearnServiceBaseUrl()
    const qs = req.nextUrl.searchParams.toString()
    const url = `${base}/api/audiobook/file${qs ? `?${qs}` : ''}`

    const headers: Record<string, string> = { 'X-User-Db': await getUserDbName() }
    const range = req.headers.get('range')
    if (range) headers['Range'] = range

    const upstream = await fetch(url, { headers, cache: 'no-store' })
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: 'audio not available yet' }, { status: upstream.status })
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
    console.error('audiobook file proxy:', error)
    return NextResponse.json({ error: 'Learn service unavailable' }, { status: 503 })
  }
}
