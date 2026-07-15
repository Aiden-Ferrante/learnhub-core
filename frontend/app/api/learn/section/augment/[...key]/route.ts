import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'
export const maxDuration = 200

export async function GET(
  req: NextRequest,
  { params }: { params: { key: string[] } },
) {
  const { key } = params
  const sp = req.nextUrl.searchParams
  const search = new URLSearchParams()
  for (const k of ['doc', 'refresh']) {
    const v = sp.get(k)
    if (v) search.set(k, v)
  }
  const upstream = `/api/section/${key.map(encodeURIComponent).join('/')}/augment`
  return proxyLearnGet(upstream, search)
}
