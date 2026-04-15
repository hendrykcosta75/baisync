import { create } from 'zustand'
import { apiFetch } from '@/lib/api'

export interface SwotAnalysis {
  workspace_id: string
  id: string
  title: string
  description: string | null
  cycle: string | null
  created_by: string
  created_at: string
  updated_at: string
  items?: SwotItem[]
}

export interface SwotItem {
  analysis_id: string
  id: string
  quadrant: 'strengths' | 'weaknesses' | 'opportunities' | 'threats'
  content: string
  priority: number
  linked_objective_id: string | null
  author_id: string
  position: number
  created_at: string
}

interface SwotState {
  analyses: SwotAnalysis[]
  activeAnalysis: SwotAnalysis | null
  isLoading: boolean

  fetchAnalyses: (workspaceId: string) => Promise<void>
  createAnalysis: (workspaceId: string, data: { title: string; description?: string; cycle?: string }) => Promise<SwotAnalysis>
  getAnalysis: (workspaceId: string, analysisId: string) => Promise<void>
  deleteAnalysis: (workspaceId: string, analysisId: string) => Promise<void>

  createItem: (analysisId: string, data: { quadrant: string; content: string; priority?: number; linked_objective_id?: string }) => Promise<SwotItem>
  updateItem: (analysisId: string, itemId: string, data: Record<string, unknown>) => Promise<void>
  deleteItem: (analysisId: string, itemId: string) => Promise<void>
}

export const useSwotStore = create<SwotState>((set) => ({
  analyses: [],
  activeAnalysis: null,
  isLoading: false,

  fetchAnalyses: async (workspaceId) => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<{ analyses: SwotAnalysis[] }>(`/api/workspaces/${workspaceId}/swot`)
      set({ analyses: data.analyses })
    } finally {
      set({ isLoading: false })
    }
  },

  createAnalysis: async (workspaceId, body) => {
    const data = await apiFetch<{ analysis: SwotAnalysis }>(`/api/workspaces/${workspaceId}/swot`, {
      method: 'POST', body: JSON.stringify(body),
    })
    set((s) => ({ analyses: [...s.analyses, data.analysis] }))
    return data.analysis
  },

  getAnalysis: async (workspaceId, analysisId) => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<{ analysis: SwotAnalysis }>(`/api/workspaces/${workspaceId}/swot/${analysisId}`)
      set({ activeAnalysis: data.analysis })
    } finally {
      set({ isLoading: false })
    }
  },

  deleteAnalysis: async (workspaceId, analysisId) => {
    await apiFetch(`/api/workspaces/${workspaceId}/swot/${analysisId}`, { method: 'DELETE' })
    set((s) => ({
      analyses: s.analyses.filter((a) => a.id !== analysisId),
      activeAnalysis: s.activeAnalysis?.id === analysisId ? null : s.activeAnalysis,
    }))
  },

  createItem: async (analysisId, body) => {
    const data = await apiFetch<{ item: SwotItem }>(`/api/swot/${analysisId}/items`, {
      method: 'POST', body: JSON.stringify(body),
    })
    set((s) => {
      if (!s.activeAnalysis || s.activeAnalysis.id !== analysisId) return s
      const items = [...(s.activeAnalysis.items || []), data.item]
      return { activeAnalysis: { ...s.activeAnalysis, items } }
    })
    return data.item
  },

  updateItem: async (analysisId, itemId, body) => {
    await apiFetch(`/api/swot/${analysisId}/items/${itemId}`, {
      method: 'PUT', body: JSON.stringify(body),
    })
  },

  deleteItem: async (analysisId, itemId) => {
    await apiFetch(`/api/swot/${analysisId}/items/${itemId}`, { method: 'DELETE' })
    set((s) => {
      if (!s.activeAnalysis || s.activeAnalysis.id !== analysisId) return s
      const items = (s.activeAnalysis.items || []).filter((i) => i.id !== itemId)
      return { activeAnalysis: { ...s.activeAnalysis, items } }
    })
  },
}))
