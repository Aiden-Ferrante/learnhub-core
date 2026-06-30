import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // forwards doc / scope / type to the learn service
  return proxyLearnGet('/api/elements', req.nextUrl.searchParams)
}
