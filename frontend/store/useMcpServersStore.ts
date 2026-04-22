import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiFetch } from '@/lib/api'
import type {
  CreateMcpServerInput,
  McpServerSummary,
  McpTestResult,
  UpdateMcpServerInput,
} from '@/types/mcp-server'

interface McpServersState {
  items: McpServerSummary[]
  isLoading: boolean
  hasFetched: boolean
  fetchServers: () => Promise<void>
  createServer: (input: CreateMcpServerInput) => Promise<McpServerSummary>
  updateServer: (id: string, patch: UpdateMcpServerInput) => Promise<McpServerSummary>
  deleteServer: (id: string) => Promise<void>
  testConnection: (id: string) => Promise<McpTestResult>
  refreshTools: (id: string) => Promise<number>

  linkedByAssistant: Record<string, McpServerSummary[]>
  fetchLinkedForAssistant: (assistantId: string) => Promise<void>
  linkToAssistant: (assistantId: string, serverId: string) => Promise<void>
  unlinkFromAssistant: (assistantId: string, serverId: string) => Promise<void>
}

export const useMcpServersStore = create<McpServersState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      hasFetched: false,
      linkedByAssistant: {},

      fetchServers: async () => {
        set({ isLoading: true })
        try {
          const data = await apiFetch<McpServerSummary[]>('/api/mcp-servers')
          set({ items: data, hasFetched: true, isLoading: false })
        } catch (err) {
          console.error('Failed to fetch MCP servers:', err)
          set({ isLoading: false, hasFetched: true })
        }
      },

      createServer: async (input) => {
        const created = await apiFetch<McpServerSummary>('/api/mcp-servers', {
          method: 'POST',
          body: JSON.stringify(input),
        })
        set((s) => ({ items: [...s.items, created] }))
        return created
      },

      updateServer: async (id, patch) => {
        const updated = await apiFetch<McpServerSummary>(`/api/mcp-servers/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? updated : it)),
          linkedByAssistant: Object.fromEntries(
            Object.entries(s.linkedByAssistant).map(([aid, list]) => [
              aid,
              list.map((it) => (it.id === id ? updated : it)),
            ])
          ),
        }))
        return updated
      },

      deleteServer: async (id) => {
        await apiFetch(`/api/mcp-servers/${id}`, { method: 'DELETE' })
        set((s) => ({
          items: s.items.filter((it) => it.id !== id),
          linkedByAssistant: Object.fromEntries(
            Object.entries(s.linkedByAssistant).map(([aid, list]) => [
              aid,
              list.filter((it) => it.id !== id),
            ])
          ),
        }))
      },

      testConnection: async (id) => {
        return apiFetch<McpTestResult>(`/api/mcp-servers/${id}/test`, {
          method: 'POST',
        })
      },

      refreshTools: async (id) => {
        const data = await apiFetch<{ tools_count: number }>(
          `/api/mcp-servers/${id}/refresh-tools`,
          { method: 'POST' }
        )
        // Refresh the server row to get updated tools_cached_at
        await get().fetchServers()
        return data.tools_count
      },

      fetchLinkedForAssistant: async (assistantId) => {
        try {
          const data = await apiFetch<McpServerSummary[]>(
            `/api/assistants/${assistantId}/mcp-servers`
          )
          set((s) => ({
            linkedByAssistant: { ...s.linkedByAssistant, [assistantId]: data },
          }))
        } catch (err) {
          console.error('Failed to fetch linked MCP servers:', err)
        }
      },

      linkToAssistant: async (assistantId, serverId) => {
        const server = get().items.find((it) => it.id === serverId)
        set((s) => {
          const prev = s.linkedByAssistant[assistantId] ?? []
          const next =
            server && !prev.some((p) => p.id === serverId) ? [...prev, server] : prev
          return { linkedByAssistant: { ...s.linkedByAssistant, [assistantId]: next } }
        })
        try {
          await apiFetch(`/api/assistants/${assistantId}/mcp-servers/${serverId}`, {
            method: 'POST',
          })
        } catch (err) {
          console.error('link MCP failed, reverting:', err)
          await get().fetchLinkedForAssistant(assistantId)
          throw err
        }
      },

      unlinkFromAssistant: async (assistantId, serverId) => {
        set((s) => ({
          linkedByAssistant: {
            ...s.linkedByAssistant,
            [assistantId]: (s.linkedByAssistant[assistantId] ?? []).filter(
              (it) => it.id !== serverId
            ),
          },
        }))
        try {
          await apiFetch(`/api/assistants/${assistantId}/mcp-servers/${serverId}`, {
            method: 'DELETE',
          })
        } catch (err) {
          console.error('unlink MCP failed, reverting:', err)
          await get().fetchLinkedForAssistant(assistantId)
          throw err
        }
      },
    }),
    {
      name: 'mcp-servers-storage',
      partialize: (state) => ({ items: state.items }),
    }
  )
)
