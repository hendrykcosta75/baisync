import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password', '/blog', '/pricing', '/admin/login', '/pay', '/meet']

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const isPublic =
    pathname === '/' ||
    publicPaths.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/api/')

  // Admin routes use a separate admin-token cookie
  if (pathname.startsWith('/admin') && pathname !== '/admin/login') {
    const adminToken = request.cookies.get('admin-token')
    if (!adminToken) {
      return NextResponse.redirect(new URL('/admin/login', request.url))
    }
    return NextResponse.next()
  }

  const token = request.cookies.get('auth-token')

  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
}
