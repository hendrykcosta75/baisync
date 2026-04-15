import { describe, it, expect, beforeEach } from 'vitest'
import { useAdminStore } from '@/store/useAdminStore'

describe('useAdminStore', () => {
  beforeEach(() => {
    useAdminStore.setState({
      isAuthenticated: false, stats: null, users: [],
      selectedUser: null, selectedUserEnriched: null,
      integrationsData: null, usageData: null,
      isLoading: false, error: null,
    })
    localStorage.clear()
  })

  it('starts unauthenticated with no data', () => {
    const state = useAdminStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.stats).toBeNull()
    expect(state.users).toEqual([])
  })

  it('adminLogin sets authenticated on success', async () => {
    await useAdminStore.getState().adminLogin('admin', 'admin123')
    const state = useAdminStore.getState()
    expect(state.isAuthenticated).toBe(true)
    expect(localStorage.getItem('admin-auth')).toBe('true')
  })

  it('adminLogin sets error on failure', async () => {
    await expect(
      useAdminStore.getState().adminLogin('wrong', 'bad')
    ).rejects.toThrow()
    const state = useAdminStore.getState()
    expect(state.isAuthenticated).toBe(false)
    expect(state.error).toBeTruthy()
  })

  it('fetchStats loads dashboard stats', async () => {
    await useAdminStore.getState().fetchStats()
    const state = useAdminStore.getState()
    expect(state.stats).toBeTruthy()
    expect(state.stats?.total_users).toBe(100)
    expect(state.stats?.total_assistants).toBe(50)
  })

  it('fetchUsers loads user list', async () => {
    await useAdminStore.getState().fetchUsers()
    const state = useAdminStore.getState()
    expect(state.users).toHaveLength(1)
    expect(state.users[0].email).toBe('user1@test.com')
  })

  it('fetchUserDetail loads user detail', async () => {
    await useAdminStore.getState().fetchUserDetail('u-1')
    const state = useAdminStore.getState()
    expect(state.selectedUser).toBeTruthy()
    expect(state.selectedUser?.email).toBe('user1@test.com')
  })

  it('fetchUserDetailEnriched loads enriched detail', async () => {
    await useAdminStore.getState().fetchUserDetailEnriched('u-1')
    const state = useAdminStore.getState()
    expect(state.selectedUserEnriched).toBeTruthy()
    expect(state.selectedUserEnriched?.has_openai_key).toBe(true)
    expect(state.selectedUserEnriched?.total_revenue).toBe(500)
  })

  it('fetchIntegrations loads integration data', async () => {
    await useAdminStore.getState().fetchIntegrations()
    const state = useAdminStore.getState()
    expect(state.integrationsData).toBeTruthy()
    expect(state.integrationsData?.total).toBe(5)
    expect(state.integrationsData?.connected).toBe(3)
  })

  it('fetchUsage loads usage data', async () => {
    await useAdminStore.getState().fetchUsage()
    const state = useAdminStore.getState()
    expect(state.usageData).toBeTruthy()
    expect(state.usageData?.total_tokens_current_month).toBe(50000)
  })

  it('createUser calls API without error', async () => {
    await useAdminStore.getState().createUser('new@test.com', 'Pass123!', 'New User')
    expect(useAdminStore.getState().isLoading).toBe(false)
    expect(useAdminStore.getState().error).toBeNull()
  })

  it('clearError resets error', () => {
    useAdminStore.setState({ error: 'some error' })
    useAdminStore.getState().clearError()
    expect(useAdminStore.getState().error).toBeNull()
  })

  it('adminLogout clears all state', async () => {
    // adminLogout uses raw fetch() with a relative URL which can't be intercepted by MSW in Node.
    // Mock global fetch for this test so the logout POST succeeds.
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Response('{}', { status: 200 })
    try {
      useAdminStore.setState({ isAuthenticated: true, stats: { total_users: 1 } as never })
      localStorage.setItem('admin-auth', 'true')
      await useAdminStore.getState().adminLogout()
      const state = useAdminStore.getState()
      expect(state.isAuthenticated).toBe(false)
      expect(state.stats).toBeNull()
      expect(state.users).toEqual([])
      expect(localStorage.getItem('admin-auth')).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
