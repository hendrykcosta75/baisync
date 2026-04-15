import { create } from 'zustand'
import { apiFetch } from '@/lib/api'
import type {
  OkrObjective, OkrObjectiveByCycle, OkrKeyResult, OkrCheckIn, OkrInitiative, OkrObjectiveChild,
  OkrAttachment,
} from '@/types/okr'

interface OkrState {
  objectives: (OkrObjective | OkrObjectiveByCycle)[]
  activeObjective: OkrObjective | null
  checkIns: OkrCheckIn[]
  checkInsCursor: string | null
  initiatives: OkrInitiative[]
  isLoading: boolean
  currentCycle: string

  setCycle: (cycle: string) => void
  fetchObjectives: (workspaceId: string, cycle?: string, teamId?: string) => Promise<void>
  createObjective: (workspaceId: string, data: {
    title: string; description?: string; objective_type?: string;
    cycle: string; owner_id?: string; team_id?: string; team_ids?: string[]; parent_objective_id?: string;
  }) => Promise<OkrObjective>
  fetchChildren: (objectiveId: string) => Promise<OkrObjectiveChild[]>
  updateObjective: (objectiveId: string, data: Record<string, unknown>) => Promise<void>
  deleteObjective: (objectiveId: string) => Promise<void>
  setActiveObjective: (obj: OkrObjective | null) => void

  createKeyResult: (objectiveId: string, data: {
    title: string; kr_type?: string; start_value?: number;
    target_value: number; unit?: string; owner_id?: string;
  }) => Promise<OkrKeyResult>
  updateKeyResult: (objectiveId: string, krId: string, data: Record<string, unknown>) => Promise<void>
  deleteKeyResult: (objectiveId: string, krId: string) => Promise<void>

  fetchCheckIns: (krId: string, cursor?: string) => Promise<void>
  createCheckIn: (krId: string, data: {
    new_value: number; confidence: number; note?: string; blockers?: string;
  }) => Promise<OkrCheckIn>

  fetchAttachments: (entityType: string, entityId: string) => Promise<OkrAttachment[]>
  uploadAttachment: (entityType: string, entityId: string, file: File) => Promise<OkrAttachment>
  deleteAttachment: (entityId: string, attachmentId: string) => Promise<void>

  fetchInitiatives: (krId: string) => Promise<void>
  createInitiative: (krId: string, data: {
    title: string; status?: string; assignee_id?: string;
    task_id?: string; team_id?: string;
  }) => Promise<OkrInitiative>
}

export const useOkrStore = create<OkrState>((set, get) => ({
  objectives: [],
  activeObjective: null,
  checkIns: [],
  checkInsCursor: null,
  initiatives: [],
  isLoading: false,
  currentCycle: getCurrentCycleDefault(),

  setCycle: (cycle) => set({ currentCycle: cycle }),

  fetchObjectives: async (workspaceId, cycle, teamId) => {
    set({ isLoading: true })
    try {
      const params = new URLSearchParams()
      if (cycle) params.set('cycle', cycle)
      if (teamId) params.set('team_id', teamId)
      const data = await apiFetch<{ objectives: (OkrObjective | OkrObjectiveByCycle)[] }>(
        `/api/workspaces/${workspaceId}/okrs?${params}`
      )
      set({ objectives: data.objectives })
    } finally {
      set({ isLoading: false })
    }
  },

  createObjective: async (workspaceId, body) => {
    const data = await apiFetch<{ objective: OkrObjective }>(`/api/workspaces/${workspaceId}/okrs`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    set((s) => ({ objectives: [...s.objectives, data.objective] }))
    return data.objective
  },

  updateObjective: async (objectiveId, body) => {
    const data = await apiFetch<{ objective: OkrObjective }>(`/api/okrs/${objectiveId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    set((s) => ({
      objectives: s.objectives.map((o) => {
        const id = 'objective_id' in o ? o.objective_id : o.id
        return id === objectiveId ? data.objective : o
      }),
      activeObjective: s.activeObjective?.id === objectiveId ? data.objective : s.activeObjective,
    }))
  },

  deleteObjective: async (objectiveId) => {
    await apiFetch(`/api/okrs/${objectiveId}`, { method: 'DELETE' })
    set((s) => ({
      objectives: s.objectives.filter((o) => {
        const id = 'objective_id' in o ? o.objective_id : o.id
        return id !== objectiveId
      }),
      activeObjective: s.activeObjective?.id === objectiveId ? null : s.activeObjective,
    }))
  },

  setActiveObjective: (obj) => set({ activeObjective: obj }),

  fetchChildren: async (objectiveId) => {
    const data = await apiFetch<{ children: OkrObjectiveChild[] }>(`/api/okrs/${objectiveId}/children`)
    return data.children
  },

  createKeyResult: async (objectiveId, body) => {
    const data = await apiFetch<{ key_result: OkrKeyResult }>(`/api/okrs/${objectiveId}/key-results`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    // Re-fetch objectives to get updated KR list
    return data.key_result
  },

  updateKeyResult: async (objectiveId, krId, body) => {
    await apiFetch(`/api/okrs/${objectiveId}/key-results/${krId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  },

  deleteKeyResult: async (objectiveId, krId) => {
    await apiFetch(`/api/okrs/${objectiveId}/key-results/${krId}`, { method: 'DELETE' })
  },

  fetchCheckIns: async (krId, cursor) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    params.set('limit', '20')
    const data = await apiFetch<{ check_ins: OkrCheckIn[]; next_cursor: string | null }>(
      `/api/key-results/${krId}/check-ins?${params}`
    )
    set((s) => ({
      checkIns: cursor ? [...s.checkIns, ...data.check_ins] : data.check_ins,
      checkInsCursor: data.next_cursor,
    }))
  },

  createCheckIn: async (krId, body) => {
    const data = await apiFetch<{ check_in: OkrCheckIn }>(`/api/key-results/${krId}/check-ins`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    set((s) => ({ checkIns: [data.check_in, ...s.checkIns] }))
    return data.check_in
  },

  fetchAttachments: async (entityType, entityId) => {
    const data = await apiFetch<{ attachments: OkrAttachment[] }>(
      `/api/okr-attachments/upload/${entityType}/${entityId}`
    )
    return data.attachments
  },

  uploadAttachment: async (entityType, entityId, file) => {
    const formData = new FormData()
    formData.append('file', file)
    const data = await apiFetch<{ attachment: OkrAttachment }>(
      `/api/okr-attachments/upload/${entityType}/${entityId}`,
      { method: 'POST', body: formData }
    )
    return data.attachment
  },

  deleteAttachment: async (entityId, attachmentId) => {
    await apiFetch(`/api/okr-attachments/file/${entityId}/${attachmentId}`, { method: 'DELETE' })
  },

  fetchInitiatives: async (krId) => {
    const data = await apiFetch<{ initiatives: OkrInitiative[] }>(`/api/key-results/${krId}/initiatives`)
    set({ initiatives: data.initiatives })
  },

  createInitiative: async (krId, body) => {
    const data = await apiFetch<{ initiative: OkrInitiative }>(`/api/key-results/${krId}/initiatives`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    set((s) => ({ initiatives: [...s.initiatives, data.initiative] }))
    return data.initiative
  },
}))

function getCurrentCycleDefault(): string {
  const now = new Date()
  const quarter = Math.ceil((now.getMonth() + 1) / 3)
  return `${now.getFullYear()}-Q${quarter}`
}
