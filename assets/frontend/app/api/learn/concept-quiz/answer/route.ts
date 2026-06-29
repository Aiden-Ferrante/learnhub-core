import { NextRequest } from 'next/server'
import { proxyLearnPost } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  return proxyLearnPost('/api/concept-quiz/answer', req)
}
