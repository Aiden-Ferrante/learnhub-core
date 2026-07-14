import { NextRequest } from 'next/server'
import { proxyLearnDelete, proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const params = new URLSearchParams()
  if (id) params.set('id', id)
  return proxyLearnGet('/api/document', params)
}

export async function DELETE(req: NextRequest) {
  const doc = req.nextUrl.searchParams.get('doc')
  const params = new URLSearchParams()
  if (doc) params.set('doc', doc)
  return proxyLearnDelete('/api/document', params)
}
