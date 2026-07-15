import { NextRequest } from 'next/server'
import { proxyLearnGet } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'

// GET /api/learn/outline?doc=... — the document's outline only (chapter list, no markdown).
export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/outline', req.nextUrl.searchParams)
}
