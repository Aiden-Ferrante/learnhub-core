import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const search = new URLSearchParams()
  for (const key of ['days', 'doc']) {
    const v = sp.get(key)
    if (v) search.set(key, v)
  }
  return proxyLearnGet('/api/study/sessions', search)
}
