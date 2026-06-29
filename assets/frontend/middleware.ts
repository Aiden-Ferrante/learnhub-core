import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'
import { authConfig } from '@/lib/auth.config'

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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map|woff2?)$).*)',
  ],
}
