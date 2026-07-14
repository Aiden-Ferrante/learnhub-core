import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/audiobook/list', req.nextUrl.searchParams)
}
