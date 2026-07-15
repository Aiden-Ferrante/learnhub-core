import { NextRequest } from 'next/server'
import { proxyLearnGet, proxyLearnPost } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/search/index', req.nextUrl.searchParams)
}

export async function POST(req: NextRequest) {
  return proxyLearnPost('/api/search/index', req)
}
