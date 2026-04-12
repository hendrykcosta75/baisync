import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore } from '@/store/useAuthStore'

describe('useAuthStore', () => {
  beforeEach(() => {
    // Reset store state without calling the real logout (which does window.location.href)
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null })
    localStorage.clear()
  })

  it('login stores user and sets isAuthenticated', async () => {
    await useAuthStore.getState().login('test@example.com', 'Password123!')
    const state = useAuthStore.getState()
    expect(state.user).toBeTruthy()
    expect(state.user?.email).toBe('test@example.com')
    expect(state.isAuthenticated).toBe(true)
  })

  it('login with bad credentials sets error', async () => {
    await expect(
      useAuthStore.getState().login('wrong@test.com', 'bad')
    ).rejects.toThrow()
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.error).toBeTruthy()
  })

  it('fetchMe updates user', async () => {
    // The store uses cookie-based auth (credentials: same-origin), so we just call fetchMe
    await useAuthStore.getState().fetchMe()
    const state = useAuthStore.getState()
    expect(state.user?.email).toBe('test@example.com')
    expect(state.isAuthenticated).toBe(true)
  })

  it('clearError resets error state', () => {
    useAuthStore.setState({ error: 'some error' })
    useAuthStore.getState().clearError()
    expect(useAuthStore.getState().error).toBeNull()
  })
})
