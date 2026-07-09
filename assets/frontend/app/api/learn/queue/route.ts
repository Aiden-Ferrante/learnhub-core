import { proxyLearnPost } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  return proxyLearnPost('/api/queue', req)
}
