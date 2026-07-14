import { NextResponse } from 'next/server'

// ---------------------------------------------------------------------------
// AUTH DISABLED (2026-07-01) — single-user mode. The login gate is kept below,
// commented out; to re-enable accounts, delete the pass-through middleware and
// uncomment everything under "ORIGINAL AUTH GATE" (including its imports).
//
// While disabled: pages and APIs are open, getUserDbName() falls back to the
// env default database (ARANGODB_DB, 'learnhub'), and the header UserMenu
// renders nothing (it returns null without a session). /login still exists
// but nothing redirects to it.
// ---------------------------------------------------------------------------

export default function middleware() {
  return NextResponse.next()
}

// --- ORIGINAL AUTH GATE ------------------------------------------------------
// import NextAuth from 'next-auth'
// import { NextResponse } from 'next/server'
// import { authConfig } from '@/lib/auth.config'
//
// const { auth } = NextAuth(authConfig)
//
// export default auth((req) => {
//   const { nextUrl } = req
//   const path = nextUrl.pathname
//   const isLoggedIn = !!req.auth?.user
//
//   const isPublic = path === '/login' || path.startsWith('/api/auth')
//
//   if (isLoggedIn && path === '/login') {
//     return NextResponse.redirect(new URL('/', nextUrl))
//   }
//   if (isPublic || isLoggedIn) {
//     return NextResponse.next()
//   }
//
//   if (path.startsWith('/api')) {
//     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
//   }
//
//   const loginUrl = new URL('/login', nextUrl)
//   if (path !== '/') loginUrl.searchParams.set('from', path)
//   return NextResponse.redirect(loginUrl)
// })
// -----------------------------------------------------------------------------

export const config = {
  // Gate everything except Next internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map|woff2?)$).*)',
  ],
}
