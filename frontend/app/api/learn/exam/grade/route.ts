import { NextRequest } from 'next/server'
import { proxyLearnPost } from '@/lib/server/learn-proxy'
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  return proxyLearnPost('/api/exam/grade', req)
}
