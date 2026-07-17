import { NextRequest } from 'next/server'
import { proxyLearnDelete } from '@/gateways/server/learn-proxy'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  return proxyLearnDelete(`/api/concept/${encodeURIComponent(key)}`)
}
