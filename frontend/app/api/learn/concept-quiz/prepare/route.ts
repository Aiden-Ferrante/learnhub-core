import { NextRequest } from 'next/server'
import { proxyLearnGet, proxyLearnPost } from '@/lib/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return proxyLearnGet('/api/concept-quiz/prepare', req.nextUrl.searchParams)
}

export async function POST(req: NextRequest) {
  return proxyLearnPost('/api/concept-quiz/prepare', req)
}
