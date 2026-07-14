import { NextRequest } from 'next/server'
import { proxyLearnGet, proxyLearnPost } from '@/lib/learn-proxy'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/build', req.nextUrl.searchParams)
}
export async function POST(req: NextRequest) {
  return proxyLearnPost('/api/build', req)
}
