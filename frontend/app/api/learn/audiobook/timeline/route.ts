import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/audiobook/timeline', req.nextUrl.searchParams)
}
