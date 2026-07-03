import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const doc = req.nextUrl.searchParams.get('doc')
  const params = new URLSearchParams()
  if (doc) params.set('doc', doc)
  return proxyLearnGet('/api/course-status', params)
}
