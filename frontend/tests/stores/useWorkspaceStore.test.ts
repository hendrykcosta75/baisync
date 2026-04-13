import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'

// Mock window.location.reload since deleteWorkspace and switchWorkspace call it
const reloadMock = vi.fn()
Object.defineProperty(window, 'location', {
  value: { ...window.location, reload: reloadMock },
  writable: true,
})

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: [],
      activeWorkspace: null,
      members: [],
      apiKeys: null,
      isLoading: false,
    })
    localStorage.clear()
    reloadMock.mockClear()
  })

  it('fetchWorkspaces populates workspaces and sets active', async () => {
    await useWorkspaceStore.getState().fetchWorkspaces()
    const state = useWorkspaceStore.getState()
    expect(state.workspaces).toHaveLength(2)
    expect(state.activeWorkspace).toBeTruthy()
    expect(state.activeWorkspace?.workspace_name).toBe('Perfil de Test User')
    expect(state.activeWorkspace?.workspace_type).toBe('personal')
  })

  it('fetchWorkspaces respects active_workspace_id from backend', async () => {
    await useWorkspaceStore.getState().fetchWorkspaces()
    const saved = localStorage.getItem('active-workspace-id')
    expect(saved).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('fetchMembers populates members list', async () => {
    await useWorkspaceStore.getState().fetchMembers('880e8400-e29b-41d4-a716-446655440002')
    const state = useWorkspaceStore.getState()
    expect(state.members).toHaveLength(1)
    expect(state.members[0].role).toBe('owner')
  })

  it('deleteWorkspace calls DELETE, updates localStorage, and reloads', async () => {
    // Seed the store with workspaces
    await useWorkspaceStore.getState().fetchWorkspaces()

    await useWorkspaceStore.getState().deleteWorkspace('880e8400-e29b-41d4-a716-446655440002')

    // Should have updated workspace_id in localStorage (token is handled via cookie by proxy)
    expect(localStorage.getItem('active-workspace-id')).toBe('550e8400-e29b-41d4-a716-446655440000')

    // Should have cleared workspace-specific caches
    expect(localStorage.getItem('assistant-storage')).toBeNull()
    expect(localStorage.getItem('api-keys-storage')).toBeNull()

    // Should have triggered page reload
    expect(reloadMock).toHaveBeenCalledOnce()
  })

  it('deleteWorkspace on personal workspace throws error', async () => {
    await useWorkspaceStore.getState().fetchWorkspaces()

    await expect(
      useWorkspaceStore.getState().deleteWorkspace('550e8400-e29b-41d4-a716-446655440000')
    ).rejects.toThrow()
  })
})
