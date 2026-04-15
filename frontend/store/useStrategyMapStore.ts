import { create } from 'zustand'
import { apiFetch } from '@/lib/api'

export interface MapNode {
  workspace_id: string
  id: string
  node_type: string
  entity_id: string | null
  label: string
  position_x: number
  position_y: number
  width: number
  height: number
  style_data: string | null
  bsc_perspective: string | null
  created_at: string
  updated_at: string
}

export interface MapEdge {
  workspace_id: string
  id: string
  source_node_id: string
  target_node_id: string
  edge_type: string
  label: string | null
  style_data: string | null
  created_at: string
}

interface StrategyMapState {
  nodes: MapNode[]
  edges: MapEdge[]
  isLoading: boolean

  fetchMap: (workspaceId: string) => Promise<void>
  syncMap: (workspaceId: string) => Promise<{ synced_nodes: number; synced_edges: number }>
  createNode: (workspaceId: string, data: {
    node_type: string; entity_id?: string; label: string;
    position_x: number; position_y: number;
    width?: number; height?: number;
    style_data?: string; bsc_perspective?: string;
  }) => Promise<MapNode>
  updateNode: (workspaceId: string, nodeId: string, data: Record<string, unknown>) => Promise<void>
  deleteNode: (workspaceId: string, nodeId: string) => Promise<void>
  batchUpdatePositions: (workspaceId: string, nodes: { id: string; position_x: number; position_y: number }[]) => Promise<void>
  createEdge: (workspaceId: string, data: {
    source_node_id: string; target_node_id: string;
    edge_type?: string; label?: string;
  }) => Promise<MapEdge>
  deleteEdge: (workspaceId: string, edgeId: string) => Promise<void>
}

export const useStrategyMapStore = create<StrategyMapState>((set) => ({
  nodes: [],
  edges: [],
  isLoading: false,

  fetchMap: async (workspaceId) => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<{ nodes: MapNode[]; edges: MapEdge[] }>(
        `/api/workspaces/${workspaceId}/strategy-map`
      )
      set({ nodes: data.nodes, edges: data.edges })
    } finally {
      set({ isLoading: false })
    }
  },

  syncMap: async (workspaceId) => {
    const data = await apiFetch<{ nodes: MapNode[]; edges: MapEdge[]; synced_nodes: number; synced_edges: number }>(
      `/api/workspaces/${workspaceId}/strategy-map/sync`,
      { method: 'POST' }
    )
    set({ nodes: data.nodes, edges: data.edges })
    return { synced_nodes: data.synced_nodes, synced_edges: data.synced_edges }
  },

  createNode: async (workspaceId, body) => {
    const data = await apiFetch<{ node: MapNode }>(
      `/api/workspaces/${workspaceId}/strategy-map/nodes`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    set((s) => ({ nodes: [...s.nodes, data.node] }))
    return data.node
  },

  updateNode: async (workspaceId, nodeId, body) => {
    await apiFetch(`/api/workspaces/${workspaceId}/strategy-map/nodes/${nodeId}`, {
      method: 'PUT', body: JSON.stringify(body),
    })
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === nodeId ? { ...n, ...body, label: (body as { label?: string }).label ?? n.label } : n
      ),
    }))
  },

  deleteNode: async (workspaceId, nodeId) => {
    await apiFetch(`/api/workspaces/${workspaceId}/strategy-map/nodes/${nodeId}`, { method: 'DELETE' })
    set((s) => ({
      nodes: s.nodes.filter((n) => n.id !== nodeId),
      edges: s.edges.filter((e) => e.source_node_id !== nodeId && e.target_node_id !== nodeId),
    }))
  },

  batchUpdatePositions: async (workspaceId, nodes) => {
    await apiFetch(`/api/workspaces/${workspaceId}/strategy-map/nodes/batch-positions`, {
      method: 'PATCH', body: JSON.stringify({ nodes }),
    })
  },

  createEdge: async (workspaceId, body) => {
    const data = await apiFetch<{ edge: MapEdge }>(
      `/api/workspaces/${workspaceId}/strategy-map/edges`,
      { method: 'POST', body: JSON.stringify(body) }
    )
    set((s) => ({ edges: [...s.edges, data.edge] }))
    return data.edge
  },

  deleteEdge: async (workspaceId, edgeId) => {
    await apiFetch(`/api/workspaces/${workspaceId}/strategy-map/edges/${edgeId}`, { method: 'DELETE' })
    set((s) => ({ edges: s.edges.filter((e) => e.id !== edgeId) }))
  },
}))
