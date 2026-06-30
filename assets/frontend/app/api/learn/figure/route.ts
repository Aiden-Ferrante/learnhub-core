import { NextRequest, NextResponse } from 'next/server'
import { getLearnServiceBaseUrl } from '@/lib/learn-service'
import { getUserDbName } from '@/lib/user-db'

export const dynamic = 'force-dynamic'

// Binary proxy for a figure PNG. The JSON proxy (proxyLearnGet) would try to JSON.parse the
// image and corrupt it — stream the body through instead.
export async function GET(req: NextRequest) {
  try {
    const base = getLearnServiceBaseUrl()
    const qs = req.nextUrl.searchParams.toString()
    const url = `${base}/api/figure${qs ? `?${qs}` : ''}`
    const upstream = await fetch(url, {
      headers: { 'X-User-Db': await getUserDbName() },
      cache: 'no-store',
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'figure not found' }, { status: upstream.status })
    }
    const out = new Headers()
    for (const h of ['content-type', 'content-length']) {
      const v = upstream.headers.get(h)
      if (v) out.set(h, v)
    }
    out.set('Cache-Control', 'public, max-age=86400')
    return new NextResponse(upstream.body, { status: upstream.status, headers: out })
  } catch (error) {
    console.error('figure proxy:', error)
    return NextResponse.json({ error: 'Learn service unavailable' }, { status: 503 })
  }
}
