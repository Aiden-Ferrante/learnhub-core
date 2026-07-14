import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

// GET /api/learn/concepts?doc=... — document-level canonical (deduped) concept list.
export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/concepts', req.nextUrl.searchParams)
}
