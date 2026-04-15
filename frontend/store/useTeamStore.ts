import { create } from 'zustand'
import { apiFetch } from '@/lib/api'
import type {
  TeamWithStats, TeamMember, Task, TaskAttachment, TaskComment, TeamActivityEntry,
  ActivityPage, CommentsPage, TaskStatus,
} from '@/types/team'

interface TeamState {
  teams: TeamWithStats[]
  activeTeam: TeamWithStats | null
  tasks: Task[]
  members: TeamMember[]
  activity: TeamActivityEntry[]
  activityCursor: string | null
  comments: TaskComment[]
  commentsCursor: string | null
  isLoading: boolean

  fetchTeams: (workspaceId: string) => Promise<void>
  createTeam: (workspaceId: string, name: string, description?: string, color?: string) => Promise<TeamWithStats>
  updateTeam: (teamId: string, data: { name?: string; description?: string; color?: string }) => Promise<void>
  deleteTeam: (teamId: string) => Promise<void>
  setActiveTeam: (team: TeamWithStats | null) => void

  fetchMembers: (teamId: string) => Promise<void>
  addMember: (teamId: string, userId: string, role?: string) => Promise<void>
  removeMember: (teamId: string, userId: string) => Promise<void>

  fetchTasks: (teamId: string) => Promise<void>
  createTask: (teamId: string, data: {
    title: string; description?: string; status?: string; priority?: string;
    assignee_id?: string; due_date?: string; tags?: string[];
    okr_objective_id?: string; okr_key_result_id?: string;
  }) => Promise<Task>
  updateTask: (teamId: string, taskId: string, data: Record<string, unknown>) => Promise<Task>
  moveTask: (teamId: string, taskId: string, status: TaskStatus, position: number) => Promise<void>
  deleteTask: (teamId: string, taskId: string) => Promise<void>

  fetchComments: (taskId: string, cursor?: string) => Promise<void>
  createComment: (taskId: string, content: string) => Promise<TaskComment>

  fetchActivity: (teamId: string, cursor?: string) => Promise<void>

  taskAttachments: TaskAttachment[]
  fetchTaskAttachments: (teamId: string, taskId: string) => Promise<void>
  uploadTaskAttachment: (teamId: string, taskId: string, file: File) => Promise<TaskAttachment>
  deleteTaskAttachment: (teamId: string, taskId: string, attachmentId: string) => Promise<void>
}

export const useTeamStore = create<TeamState>((set, get) => ({
  teams: [],
  activeTeam: null,
  tasks: [],
  members: [],
  activity: [],
  activityCursor: null,
  comments: [],
  commentsCursor: null,
  taskAttachments: [],
  isLoading: false,

  fetchTeams: async (workspaceId) => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<{ teams: TeamWithStats[] }>(`/api/workspaces/${workspaceId}/teams`)
      set({ teams: data.teams })
    } finally {
      set({ isLoading: false })
    }
  },

  createTeam: async (workspaceId, name, description, color) => {
    const data = await apiFetch<{ team: TeamWithStats }>(`/api/workspaces/${workspaceId}/teams`, {
      method: 'POST',
      body: JSON.stringify({ name, description, color }),
    })
    set((s) => ({ teams: [...s.teams, data.team] }))
    return data.team
  },

  updateTeam: async (teamId, body) => {
    const data = await apiFetch<{ team: TeamWithStats }>(`/api/teams/${teamId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    set((s) => ({
      teams: s.teams.map((t) => (t.id === teamId ? { ...t, ...data.team } : t)),
      activeTeam: s.activeTeam?.id === teamId ? { ...s.activeTeam, ...data.team } : s.activeTeam,
    }))
  },

  deleteTeam: async (teamId) => {
    await apiFetch(`/api/teams/${teamId}`, { method: 'DELETE' })
    set((s) => ({
      teams: s.teams.filter((t) => t.id !== teamId),
      activeTeam: s.activeTeam?.id === teamId ? null : s.activeTeam,
    }))
  },

  setActiveTeam: (team) => set({ activeTeam: team }),

  fetchMembers: async (teamId) => {
    const data = await apiFetch<{ members: TeamMember[] }>(`/api/teams/${teamId}/members`)
    set({ members: data.members })
  },

  addMember: async (teamId, userId, role = 'member') => {
    await apiFetch(`/api/teams/${teamId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, role }),
    })
    get().fetchMembers(teamId)
  },

  removeMember: async (teamId, userId) => {
    await apiFetch(`/api/teams/${teamId}/members/${userId}`, { method: 'DELETE' })
    set((s) => ({ members: s.members.filter((m) => m.user_id !== userId) }))
  },

  fetchTasks: async (teamId) => {
    const data = await apiFetch<{ tasks: Task[] }>(`/api/teams/${teamId}/tasks`)
    set({ tasks: data.tasks })
  },

  createTask: async (teamId, body) => {
    const data = await apiFetch<{ task: Task }>(`/api/teams/${teamId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    set((s) => ({ tasks: [...s.tasks, data.task] }))
    return data.task
  },

  updateTask: async (teamId, taskId, body) => {
    const data = await apiFetch<{ task: Task }>(`/api/teams/${teamId}/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === taskId ? data.task : t)) }))
    return data.task
  },

  moveTask: async (teamId, taskId, status, position) => {
    // Optimistic update
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.id === taskId ? { ...t, status, position } : t
      ),
    }))
    try {
      await apiFetch(`/api/teams/${teamId}/tasks/${taskId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ status, position }),
      })
    } catch {
      // Rollback on error
      get().fetchTasks(teamId)
    }
  },

  deleteTask: async (teamId, taskId) => {
    await apiFetch(`/api/teams/${teamId}/tasks/${taskId}`, { method: 'DELETE' })
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) }))
  },

  fetchComments: async (taskId, cursor) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    params.set('limit', '20')
    const data = await apiFetch<CommentsPage>(`/api/tasks/${taskId}/comments?${params}`)
    set((s) => ({
      comments: cursor ? [...s.comments, ...data.comments] : data.comments,
      commentsCursor: data.next_cursor,
    }))
  },

  createComment: async (taskId, content) => {
    const data = await apiFetch<{ comment: TaskComment }>(`/api/tasks/${taskId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
    set((s) => ({ comments: [data.comment, ...s.comments] }))
    return data.comment
  },

  fetchActivity: async (teamId, cursor) => {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    params.set('limit', '20')
    const data = await apiFetch<ActivityPage>(`/api/teams/${teamId}/activity?${params}`)
    set((s) => ({
      activity: cursor ? [...s.activity, ...data.entries] : data.entries,
      activityCursor: data.next_cursor,
    }))
  },

  fetchTaskAttachments: async (teamId, taskId) => {
    const data = await apiFetch<{ attachments: TaskAttachment[] }>(`/api/teams/${teamId}/tasks/${taskId}/attachments`)
    set({ taskAttachments: data.attachments })
  },

  uploadTaskAttachment: async (teamId, taskId, file) => {
    const formData = new FormData()
    formData.append('file', file)
    const data = await apiFetch<{ attachment: TaskAttachment }>(`/api/teams/${teamId}/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: formData,
    })
    set((s) => ({ taskAttachments: [...s.taskAttachments, data.attachment] }))
    return data.attachment
  },

  deleteTaskAttachment: async (teamId, taskId, attachmentId) => {
    await apiFetch(`/api/teams/${teamId}/tasks/${taskId}/attachments/${attachmentId}`, { method: 'DELETE' })
    set((s) => ({ taskAttachments: s.taskAttachments.filter((a) => a.id !== attachmentId) }))
  },
}))
