import { NextRequest } from 'next/server'
import { proxyLearnPost } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // proxyLearnPost forwards the request's query string (?doc=) and body.
  return proxyLearnPost('/api/ask', req)
}
