export class ApiError extends Error {
  status: number
  data: unknown

  constructor(status: number, message: string, data?: unknown) {
    super(message)
    this.status = status
    this.data = data
  }
}

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
      !path.includes('/auth/login') &&
      !path.includes('/auth/register') &&
      !path.includes('/api/public/')
    ) {
      localStorage.removeItem('auth-user')
      window.location.href = '/login'
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
