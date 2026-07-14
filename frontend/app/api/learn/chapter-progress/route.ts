import { NextRequest } from 'next/server'
import { proxyLearnGet, proxyLearnPost } from '@/lib/learn-proxy'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/chapter-progress', req.nextUrl.searchParams)
}
export async function POST(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString()
  return proxyLearnPost(`/api/chapter-progress${qs ? `?${qs}` : ''}`, req)
}
