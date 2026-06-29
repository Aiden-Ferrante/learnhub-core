import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const search = new URLSearchParams()
  for (const k of ['doc', 'scope', 'limit']) {
    const v = sp.get(k)
    if (v) search.set(k, v)
  }
  return proxyLearnGet('/api/review/queue', search)
}
