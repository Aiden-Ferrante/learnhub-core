import { NextRequest } from 'next/server'
import { proxyLearnPost } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const doc = req.nextUrl.searchParams.get('doc')
  const scope = req.nextUrl.searchParams.get('scope')
  const params = new URLSearchParams()
  if (doc) params.set('doc', doc)
  if (scope) params.set('scope', scope)
  const qs = params.toString()
  return proxyLearnPost(`/api/extract${qs ? `?${qs}` : ''}`, req)
}
