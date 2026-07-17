import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/gateways/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { key: string[] } },
) {
  const { key } = params
  const doc = req.nextUrl.searchParams.get('doc')
  const search = new URLSearchParams()
  if (doc) search.set('doc', doc)
  const upstream = `/api/section/${key.map(encodeURIComponent).join('/')}/content`
  return proxyLearnGet(upstream, search)
}
