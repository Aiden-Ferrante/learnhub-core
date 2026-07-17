import 'server-only'
import { NextResponse } from 'next/server'
import { getLearnServiceBaseUrl } from '@/gateways/server/learn-upstream'
import { getUserDbName } from '@/gateways/server/user-db'

export async function proxyLearnGet(
  upstreamPath: string,
  searchParams?: URLSearchParams,
): Promise<NextResponse> {
  try {
    const base = getLearnServiceBaseUrl()
    const qs = searchParams?.toString()
    const url = `${base}${upstreamPath}${qs ? `?${qs}` : ''}`
    const upstream = await fetch(url, {
      cache: 'no-store',
      headers: { 'X-User-Db': await getUserDbName() },
    })
    const body = await upstream.json().catch(() => ({}))
    return NextResponse.json(body, { status: upstream.status })
  } catch (error) {
    console.error(`learn proxy GET ${upstreamPath}:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json(
      { error: `Learn service unavailable: ${message}`, tree: [], cards: [] },
      { status: 503 },
    )
  }
}

export async function proxyLearnDelete(
  upstreamPath: string,
  searchParams?: URLSearchParams,
): Promise<NextResponse> {
  try {
    const base = getLearnServiceBaseUrl()
    const qs = searchParams?.toString()
    const upstream = await fetch(`${base}${upstreamPath}${qs ? `?${qs}` : ''}`, {
      method: 'DELETE',
      headers: { 'X-User-Db': await getUserDbName() },
    })
    const body = await upstream.json().catch(() => ({}))
    return NextResponse.json(body, { status: upstream.status })
  } catch (error) {
    console.error(`learn proxy DELETE ${upstreamPath}:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Learn service unavailable: ${message}` }, { status: 503 })
  }
}

export async function proxyLearnPost(
  upstreamPath: string,
  req: Request,
): Promise<NextResponse> {
  try {
    const base = getLearnServiceBaseUrl()
    // Forward the request's query string — some POST endpoints (e.g. exam/start) read
    // doc/scope from the query, not the body. Dropping it broke them. But only append it when
    // the caller hasn't already put a query on upstreamPath — otherwise the URL gets a doubled
    // query string ("?doc=X&scope=Y?doc=X&scope=Y") and params arrive corrupted (e.g. audiobook
    // scope = "toc:1~2?scope=toc:1~2", which silently fails the job).
    const qs = upstreamPath.includes('?') ? '' : new URL(req.url).search
    const body = await req.text()
    const upstream = await fetch(`${base}${upstreamPath}${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-User-Db': await getUserDbName(),
      },
      body: body || '{}',
    })
    const data = await upstream.json().catch(() => ({}))
    return NextResponse.json(data, { status: upstream.status })
  } catch (error) {
    console.error(`learn proxy POST ${upstreamPath}:`, error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: `Learn service unavailable: ${message}` }, { status: 503 })
  }
}
