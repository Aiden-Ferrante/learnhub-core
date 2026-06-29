import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  const params = new URLSearchParams()
  if (id) params.set('id', id)
  return proxyLearnGet('/api/document', params)
}
