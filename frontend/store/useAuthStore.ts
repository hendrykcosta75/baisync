import { create } from 'zustand'
import { apiFetch, ApiError } from '@/lib/api'

interface User {
  id: string
  email: string
  name: string
  has_avatar?: boolean
  notify_email?: boolean
  notify_system?: boolean
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null

  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
  forgotPassword: (email: string) => Promise<string>
  resetPassword: (token: string, newPassword: string) => Promise<string>
  fetchMe: () => Promise<void>
  enable2FA: () => Promise<string>
  verify2FA: (code: string) => Promise<string>
  updateProfile: (name: string) => Promise<void>
  updateNotificationPrefs: (prefs: { notify_email?: boolean; notify_system?: boolean }) => Promise<void>
  uploadAvatar: (file: File) => Promise<void>
  deleteAvatar: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<string>
  deleteAccount: (password: string) => Promise<void>
  clearError: () => void
}

function loadUser(): User | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('auth-user')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: loadUser(),
  isAuthenticated: !!loadUser(),
  isLoading: false,
  error: null,

  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      localStorage.setItem('auth-user', JSON.stringify(data.user))
      set({ user: data.user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha no login'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  register: async (email, password, name) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      })
      localStorage.setItem('auth-user', JSON.stringify(data.user))
      set({ user: data.user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha no cadastro'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // ignore - cookie may already be expired
    }
    localStorage.removeItem('auth-user')
    localStorage.removeItem('active-workspace-id')
    localStorage.removeItem('assistant-storage')
    localStorage.removeItem('api-keys-storage')
    set({ user: null, isAuthenticated: false, error: null })
    window.location.href = '/login'
  },

  forgotPassword: async (email) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<{ message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      set({ isLoading: false })
      return data.message
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha na requisição'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  resetPassword: async (token, newPassword) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<{ message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, new_password: newPassword }),
      })
      set({ isLoading: false })
      return data.message
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha na redefinição'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  fetchMe: async () => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<User & { workspace_id?: string; has_avatar?: boolean }>('/api/auth/me')
      const freshUser = {
        id: data.id,
        email: data.email,
        name: data.name,
        has_avatar: data.has_avatar,
        notify_email: data.notify_email ?? true,
        notify_system: data.notify_system ?? true,
      }
      localStorage.setItem('auth-user', JSON.stringify(freshUser))
      // Sync active workspace ID from JWT so frontend matches backend context
      if (data.workspace_id) {
        const currentWsId = localStorage.getItem('active-workspace-id')
        if (currentWsId !== data.workspace_id) {
          localStorage.setItem('active-workspace-id', data.workspace_id)
        }
      }
      set({ user: freshUser, isAuthenticated: true, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  enable2FA: async () => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<{ message: string }>('/api/auth/enable-2fa', {
        method: 'POST',
      })
      set({ isLoading: false })
      return data.message
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha ao ativar 2FA'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  verify2FA: async (code) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<{ message: string }>('/api/auth/verify-2fa', {
        method: 'POST',
        body: JSON.stringify({ code }),
      })
      set({ isLoading: false })
      return data.message
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha na verificação 2FA'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  updateProfile: async (name) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<User>('/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ name }),
      })
      const currentUser = get().user
      const updatedUser = {
        id: data.id,
        email: data.email,
        name: data.name,
        has_avatar: currentUser?.has_avatar,
        notify_email: data.notify_email ?? currentUser?.notify_email ?? true,
        notify_system: data.notify_system ?? currentUser?.notify_system ?? true,
      }
      localStorage.setItem('auth-user', JSON.stringify(updatedUser))
      set({ user: updatedUser, isLoading: false })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha ao atualizar perfil'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  updateNotificationPrefs: async (prefs) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<User>('/api/user/notifications', {
        method: 'PUT',
        body: JSON.stringify(prefs),
      })
      const currentUser = get().user
      if (!currentUser) {
        set({ isLoading: false })
        return
      }
      const updatedUser = {
        ...currentUser,
        notify_email: data.notify_email ?? currentUser.notify_email,
        notify_system: data.notify_system ?? currentUser.notify_system,
      }
      localStorage.setItem('auth-user', JSON.stringify(updatedUser))
      set({ user: updatedUser, isLoading: false })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha ao atualizar notificações'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  uploadAvatar: async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    await apiFetch('/api/user/avatar', { method: 'POST', body: formData })
    const user = get().user
    if (user) {
      const updated = { ...user, has_avatar: true }
      localStorage.setItem('auth-user', JSON.stringify(updated))
      set({ user: updated })
    }
  },

  deleteAvatar: async () => {
    await apiFetch('/api/user/avatar', { method: 'DELETE' })
    const user = get().user
    if (user) {
      const updated = { ...user, has_avatar: false }
      localStorage.setItem('auth-user', JSON.stringify(updated))
      set({ user: updated })
    }
  },

  changePassword: async (currentPassword, newPassword) => {
    set({ isLoading: true, error: null })
    try {
      const data = await apiFetch<{ message: string }>('/api/user/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      })
      set({ isLoading: false })
      return data.message
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha ao alterar senha'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  deleteAccount: async (password) => {
    set({ isLoading: true, error: null })
    try {
      await apiFetch<{ message: string }>('/api/user/account', {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      })
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
      } catch {
        // ignore
      }
      localStorage.removeItem('auth-user')
      set({ user: null, isAuthenticated: false, isLoading: false })
      window.location.href = '/login'
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Falha ao remover conta'
      set({ isLoading: false, error: message })
      throw err
    }
  },

  clearError: () => set({ error: null }),
}))
