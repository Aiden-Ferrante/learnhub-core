import { NextRequest } from 'next/server'
import { proxyLearnDelete } from '@/lib/learn-proxy'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { key: string } },
) {
  const { key } = params
  return proxyLearnDelete(`/api/concept/${encodeURIComponent(key)}`)
}
