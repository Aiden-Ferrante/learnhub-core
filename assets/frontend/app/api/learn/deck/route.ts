import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  return proxyLearnGet('/api/deck', params)
}
