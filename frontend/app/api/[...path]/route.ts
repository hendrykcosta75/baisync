import { cookies } from 'next/headers'
import { type NextRequest } from 'next/server'

const API_URL = process.env.API_URL || 'http://localhost:3001'

async function proxyRequest(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  const backendPath = '/api/' + path.join('/')

  const url = new URL(backendPath, API_URL)
  url.search = request.nextUrl.search

  const cookieStore = await cookies()
  const joinedPath = path.join('/')
  const isAdminRoute = joinedPath.startsWith('admin/') && joinedPath !== 'admin/login'
  const token = isAdminRoute
    ? cookieStore.get('admin-token')?.value
    : cookieStore.get('auth-token')?.value

  const headers = new Headers()
  const contentType = request.headers.get('content-type')
  if (contentType) {
    headers.set('content-type', contentType)
  }
  const accept = request.headers.get('accept')
  if (accept) {
    headers.set('accept', accept)
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  // Buffer request body to avoid stream truncation with large payloads (e.g. base64 images)
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  let body: ArrayBuffer | undefined
  if (hasBody) {
    body = await request.arrayBuffer()
    headers.set('content-length', body.byteLength.toString())
  }

  const backendRes = await fetch(url, {
    method: request.method,
    headers,
    body: body ?? null,
  })

  const isAuthRoute = joinedPath === 'auth/login' || joinedPath === 'auth/register'
  const isAdminLogin = joinedPath === 'admin/login'

  if (isAdminLogin && backendRes.ok) {
    const body = await backendRes.json()
    const response = Response.json(body, { status: backendRes.status })

    if (body.token) {
      response.headers.append(
        'Set-Cookie',
        `admin-token=${body.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`
      )
    }

    return response
  }

  if (isAuthRoute && backendRes.ok) {
    const body = await backendRes.json()
    const response = Response.json(body, { status: backendRes.status })

    // Copy relevant headers from backend
    const backendContentType = backendRes.headers.get('content-type')
    if (backendContentType) {
      response.headers.set('content-type', backendContentType)
    }

    if (body.token) {
      response.headers.append(
        'Set-Cookie',
        `auth-token=${body.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
      )
    }

    return response
  }

  // Workspace switch or invite accept — update auth cookie with new JWT
  const isWorkspaceSwitch = /^workspaces\/[^/]+\/switch$/.test(joinedPath)
  const isInviteAccept = /^workspace-invites\/[^/]+\/accept$/.test(joinedPath)
  if ((isWorkspaceSwitch || isInviteAccept) && backendRes.ok) {
    const body = await backendRes.json()
    const response = Response.json(body, { status: backendRes.status })
    if (body.token) {
      response.headers.append(
        'Set-Cookie',
        `auth-token=${body.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`
      )
    }
    return response
  }

  // Stream backend response back to client
  const responseHeaders = new Headers()
  const backendContentType = backendRes.headers.get('content-type')
  if (backendContentType) {
    responseHeaders.set('content-type', backendContentType)
  }

  return new Response(backendRes.body, {
    status: backendRes.status,
    statusText: backendRes.statusText,
    headers: responseHeaders,
  })
}

export const GET = proxyRequest
export const POST = proxyRequest
export const PUT = proxyRequest
export const PATCH = proxyRequest
export const DELETE = proxyRequest
