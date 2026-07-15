import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const search = new URLSearchParams()
  const days = sp.get('days')
  if (days) search.set('days', days)
  return proxyLearnGet('/api/study-debt', search)
}
