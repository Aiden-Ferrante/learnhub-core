import { NextRequest } from 'next/server'
import { proxyLearnPost } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  return proxyLearnPost('/api/chat', req)
}
