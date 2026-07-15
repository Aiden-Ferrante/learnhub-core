import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const doc = req.nextUrl.searchParams.get('doc')
  const scope = req.nextUrl.searchParams.get('scope')
  const params = new URLSearchParams()
  if (doc) params.set('doc', doc)
  if (scope) params.set('scope', scope)
  return proxyLearnGet('/api/extract/status', params)
}
