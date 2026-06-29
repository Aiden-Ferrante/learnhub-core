import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const doc = req.nextUrl.searchParams.get('doc')
  const search = new URLSearchParams()
  if (doc) search.set('doc', doc)
  return proxyLearnGet('/api/concept-mastery', search)
}
