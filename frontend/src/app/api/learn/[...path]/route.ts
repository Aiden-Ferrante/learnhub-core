import { NextRequest } from 'next/server'
import {
  proxyLearnDelete,
  proxyLearnGet,
  proxyLearnPatch,
  proxyLearnPost,
} from '@/gateways/server/learn-proxy'

export const dynamic = 'force-dynamic'

/**
 * Catch-all proxy for the learn backend. Almost every `/api/learn/<x>` maps 1:1 to the
 * backend's `/api/<x>` (query + body forwarded verbatim), so one handler
 * replaces ~46 identical files (GET/POST/PATCH/DELETE). Routes with real logic stay dedicated and win by Next's
 * specificity rule: the binary streamers (pdf, figure, audiobook/file), the dynamic
 * concept/[key] DELETE, and the section/content + section/concepts [...key] GETs that
 * reorder the section key before forwarding.
 */

// The few frontend paths whose upstream shape isn't a literal `/api/<path>`.
const REMAP: Record<string, string> = {
  'study-sessions': 'study/sessions',
}

function upstreamPath(path: string[]): string {
  const joined = path.map(encodeURIComponent).join('/')
  return `/api/${REMAP[joined] ?? joined}`
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  const { path } = await params
  return proxyLearnGet(upstreamPath(path), req.nextUrl.searchParams)
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { path } = await params
  return proxyLearnPost(upstreamPath(path), req)
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { path } = await params
  return proxyLearnDelete(upstreamPath(path), req.nextUrl.searchParams)
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { path } = await params
  return proxyLearnPatch(upstreamPath(path), req.nextUrl.searchParams, req)
}
