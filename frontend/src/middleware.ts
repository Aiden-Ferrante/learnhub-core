import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/gateways/server/auth.config'

// The login gate (re-enabled 2026-07-17 — accounts are back; single-user
// pass-through mode retired with the learnhub-core promotion). Unauthenticated
// page loads redirect to /login; unauthenticated API calls get a 401.

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const { nextUrl } = req
  const path = nextUrl.pathname
  const isLoggedIn = !!req.auth?.user

  const isPublic = path === '/login' || path.startsWith('/api/auth')

  if (isLoggedIn && path === '/login') {
    return NextResponse.redirect(new URL('/', nextUrl))
  }
  if (isPublic || isLoggedIn) {
    return NextResponse.next()
  }

  if (path.startsWith('/api')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', nextUrl)
  if (path !== '/') loginUrl.searchParams.set('from', path)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  // Gate everything except Next internals and static assets.
  //
  // The static-asset lookahead below is anchored on the WHOLE pathname, not just the
  // asset directories — so it also exempted any API path that happened to end in one of
  // those extensions (`/api/learn/concept/x.map` ran with no auth at all). Section and
  // concept keys are user- and LLM-derived strings that reach `{key:path}` routes, so that
  // was reachable. `/api/:path*` is listed first and unconditionally: an API route is
  // never a static asset, and no handler does its own auth check.
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map|woff2?)$).*)',
  ],
}
