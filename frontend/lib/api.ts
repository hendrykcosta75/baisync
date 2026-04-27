export class ApiError extends Error {
  status: number
  data: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

// Public-facing routes where a 401 should NOT trigger a redirect — either
// the user is already on auth, or the page renders unauthenticated content.
const NO_REDIRECT_PATHS = ['/login', '/register', '/forgot-password', '/reset-password', '/']

let redirectingFromUnauth = false

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  })

  if (res.status === 401) {
    if (
      typeof window !== 'undefined' &&
      !redirectingFromUnauth &&
      !NO_REDIRECT_PATHS.includes(window.location.pathname) &&
      !path.includes('/auth/login') &&
      !path.includes('/auth/register') &&
      !path.includes('/api/public/')
    ) {
      redirectingFromUnauth = true
      localStorage.removeItem('auth-user')
      window.location.replace('/login')
    }
  }

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.message || data?.error || `Request failed with status ${res.status}`,
      data
    )
  }

  return data as T
}
