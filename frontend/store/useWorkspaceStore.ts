import { create } from 'zustand'
import { apiFetch } from '@/lib/api'

export interface Workspace {
  workspace_id: string
  workspace_name: string
  workspace_type: 'personal' | 'company'
  role: 'owner' | 'admin' | 'member'
  joined_at: string
}

export interface WorkspaceMember {
  workspace_id: string
  user_id: string
  role: string
  invited_by: string | null
  joined_at: string
  user_name: string | null
  user_email: string | null
}

export interface WorkspaceInvite {
  id: string
  workspace_id: string
  email: string
  role: string
  token: string
  expires_at: string
  accepted: boolean
  created_at: string
}

export interface WorkspaceApiKeys {
  openai_configured: boolean
  claude_configured: boolean
  gemini_configured: boolean
  elevenlabs_configured: boolean
  mercadopago_configured: boolean
  stripe_configured: boolean
}

interface WorkspaceState {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  members: WorkspaceMember[]
  apiKeys: WorkspaceApiKeys | null
  isLoading: boolean

  fetchWorkspaces: () => Promise<void>
  switchWorkspace: (workspaceId: string) => Promise<void>
  createWorkspace: (name: string) => Promise<void>
  updateWorkspace: (workspaceId: string, name: string) => Promise<void>
  inviteMember: (workspaceId: string, email: string, role?: string) => Promise<void>
  deleteWorkspace: (workspaceId: string) => Promise<void>
  removeMember: (workspaceId: string, userId: string) => Promise<void>
  updateMemberRole: (workspaceId: string, userId: string, role: string) => Promise<void>
  fetchMembers: (workspaceId: string) => Promise<void>
  fetchApiKeys: (workspaceId: string) => Promise<void>
  updateApiKeys: (workspaceId: string, keys: Record<string, string>) => Promise<void>
}

function loadActiveWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('active-workspace-id')
}

// Routes that are hidden from the sidebar when in a personal workspace
// (mirrors the filter in components/sidebar.tsx).
const WORKSPACE_ONLY_PATHS = [
  '/dashboard/planning',
  '/dashboard/strategy-map',
  '/dashboard/swot',
  '/dashboard/teams',
  '/dashboard/chat',
]

function isWorkspaceOnlyPath(pathname: string): boolean {
  return WORKSPACE_ONLY_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'))
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  workspaces: [],
  activeWorkspace: null,
  members: [],
  apiKeys: null,
  isLoading: false,

  fetchWorkspaces: async () => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<{ workspaces: Workspace[]; active_workspace_id?: string }>('/api/workspaces')
      const workspaces = data.workspaces

      // The backend returns the workspace_id from the JWT — this is the authoritative source
      const jwtWorkspaceId = data.active_workspace_id
      const savedId = loadActiveWorkspaceId()

      // Prefer JWT workspace_id over localStorage
      const effectiveId = jwtWorkspaceId || savedId
      const active = workspaces.find(w => w.workspace_id === effectiveId) || workspaces[0] || null

      if (active) {
        localStorage.setItem('active-workspace-id', active.workspace_id)
      }

      // If localStorage pointed to a different workspace than JWT, sync localStorage
      if (jwtWorkspaceId && savedId && jwtWorkspaceId !== savedId) {
        localStorage.setItem('active-workspace-id', jwtWorkspaceId)
      }

      set({ workspaces, activeWorkspace: active, isLoading: false })
    } catch {
      set({ isLoading: false })
    }
  },

  switchWorkspace: async (workspaceId: string) => {
    try {
      await apiFetch<{ token: string; workspace_id: string }>(
        `/api/workspaces/${workspaceId}/switch`,
        { method: 'POST' }
      )

      localStorage.setItem('active-workspace-id', workspaceId)

      // Clear workspace-specific caches so the new workspace loads fresh data
      localStorage.removeItem('assistant-storage')
      localStorage.removeItem('api-keys-storage')

      const { workspaces } = get()
      const active = workspaces.find(w => w.workspace_id === workspaceId) || null
      set({ activeWorkspace: active })

      // Navigate away from workspace-only routes when switching into a personal workspace
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
      if (active?.workspace_type === 'personal' && isWorkspaceOnlyPath(currentPath)) {
        window.location.assign('/dashboard')
      } else {
        window.location.reload()
      }
    } catch (err) {
      console.error('Failed to switch workspace:', err)
    }
  },

  createWorkspace: async (name: string) => {
    const data = await apiFetch<{ workspace: { id: string } }>('/api/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    })
    await get().fetchWorkspaces()
    // Switch to new workspace
    await get().switchWorkspace(data.workspace.id)
  },

  updateWorkspace: async (workspaceId: string, name: string) => {
    await apiFetch(`/api/workspaces/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
    await get().fetchWorkspaces()
  },

  deleteWorkspace: async (workspaceId: string) => {
    const data = await apiFetch<{ success: boolean; workspace_id: string }>(
      `/api/workspaces/${workspaceId}`,
      { method: 'DELETE' }
    )

    // The proxy route handler updates the auth-token cookie automatically.
    // Update localStorage to point to the personal workspace returned by the backend.
    if (data.workspace_id) {
      localStorage.setItem('active-workspace-id', data.workspace_id)
    }

    localStorage.removeItem('assistant-storage')
    localStorage.removeItem('api-keys-storage')

    window.location.reload()
  },

  inviteMember: async (workspaceId: string, email: string, role = 'member') => {
    await apiFetch(`/api/workspaces/${workspaceId}/invite`, {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    })
    await get().fetchMembers(workspaceId)
  },

  removeMember: async (workspaceId: string, userId: string) => {
    await apiFetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'DELETE',
    })
    await get().fetchMembers(workspaceId)
  },

  updateMemberRole: async (workspaceId: string, userId: string, role: string) => {
    await apiFetch(`/api/workspaces/${workspaceId}/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    })
    await get().fetchMembers(workspaceId)
  },

  fetchMembers: async (workspaceId: string) => {
    const data = await apiFetch<{ members: WorkspaceMember[] }>(
      `/api/workspaces/${workspaceId}/members`
    )
    set({ members: data.members })
  },

  fetchApiKeys: async (workspaceId: string) => {
    const data = await apiFetch<WorkspaceApiKeys>(
      `/api/workspaces/${workspaceId}/api-keys`
    )
    set({ apiKeys: data })
  },

  updateApiKeys: async (workspaceId: string, keys: Record<string, string>) => {
    const data = await apiFetch<WorkspaceApiKeys>(
      `/api/workspaces/${workspaceId}/api-keys`,
      { method: 'PUT', body: JSON.stringify(keys) }
    )
    set({ apiKeys: data })
  },
}))
