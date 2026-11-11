import { NextRequest, NextResponse } from 'next/server'
import { getLearnServiceBaseUrl } from '@/gateways/server/learn-upstream'
import { getUserDbName } from '@/gateways/server/user-db'

export const dynamic = 'force-dynamic'

// Binary proxy for a book's cover JPEG (page 1 of its original PDF). The JSON proxy would
// corrupt it, so the body streams through.
export async function GET(req: NextRequest) {
  try {
    const base = getLearnServiceBaseUrl()
    const qs = req.nextUrl.searchParams.toString()
    const url = `${base}/api/document/cover${qs ? `?${qs}` : ''}`
    const upstream = await fetch(url, {
      headers: { 'X-User-Db': await getUserDbName() },
      cache: 'no-store',
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'no cover' }, { status: upstream.status })
    }
    const out = new Headers()
    for (const h of ['content-type', 'content-length']) {
      const v = upstream.headers.get(h)
      if (v) out.set(h, v)
    }
    out.set('Cache-Control', 'public, max-age=604800')
    return new NextResponse(upstream.body, { status: upstream.status, headers: out })
  } catch (error) {
    console.error('cover proxy:', error)
    return NextResponse.json({ error: 'Learn service unavailable' }, { status: 503 })
  }
}
