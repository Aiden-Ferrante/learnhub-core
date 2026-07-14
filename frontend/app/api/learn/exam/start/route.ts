import { NextRequest } from 'next/server'
import { proxyLearnPost } from '@/lib/learn-proxy'
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  const qs = req.nextUrl.searchParams.toString()
  return proxyLearnPost(`/api/exam/start${qs ? `?${qs}` : ''}`, req)
}
