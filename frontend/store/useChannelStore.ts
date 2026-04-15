import { create } from 'zustand'
import { apiFetch } from '@/lib/api'

export interface Channel {
  id: string
  workspace_id: string
  name: string
  description: string | null
  type: 'public' | 'private' | 'dm'
  created_by: string
  created_at: string
  updated_at: string
  unread_count?: number
  other_user?: { id: string; name: string | null; email: string | null }
}

export interface ChannelMessage {
  id: string
  channel_id: string
  sender_id: string
  sender_name: string
  content: string
  message_type: 'text' | 'system'
  edited_at: string | null
  created_at: string
}

export interface ChannelMember {
  channel_id: string
  user_id: string
  role: string
  user_name: string | null
  user_email: string | null
  joined_at: string
}

export interface ChannelNote {
  id: string
  channel_id: string
  title: string
  content: string
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

export interface ChannelCanvas {
  id: string
  channel_id: string
  title: string
  canvas_data: string
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

interface ChannelState {
  channels: Channel[]
  dms: Channel[]
  activeChannel: Channel | null
  messages: ChannelMessage[]
  members: ChannelMember[]
  notes: ChannelNote[]
  canvases: ChannelCanvas[]
  nextCursor: string | null
  isLoading: boolean

  fetchChannels: (workspaceId: string) => Promise<void>
  fetchDms: (workspaceId: string) => Promise<void>
  createChannel: (workspaceId: string, name: string, description?: string, channelType?: string) => Promise<Channel>
  updateChannel: (channelId: string, name?: string, description?: string) => Promise<void>
  deleteChannel: (channelId: string) => Promise<void>
  setActiveChannel: (channel: Channel | null) => void
  fetchMessages: (channelId: string, cursor?: string) => Promise<void>
  sendMessage: (channelId: string, content: string) => Promise<void>
  editMessage: (channelId: string, messageId: string, content: string) => Promise<void>
  deleteMessage: (channelId: string, messageId: string) => Promise<void>
  markRead: (channelId: string) => Promise<void>
  createDm: (workspaceId: string, userId: string) => Promise<Channel>
  fetchMembers: (channelId: string) => Promise<void>
  addChannelMember: (channelId: string, userId: string) => Promise<void>
  removeChannelMember: (channelId: string, userId: string) => Promise<void>
  addMessage: (message: ChannelMessage) => void
  // Notes
  fetchNotes: (channelId: string) => Promise<void>
  createNote: (channelId: string, title: string) => Promise<ChannelNote>
  updateNote: (channelId: string, noteId: string, title?: string, content?: string) => Promise<void>
  deleteNote: (channelId: string, noteId: string) => Promise<void>
  // Canvases
  fetchCanvases: (channelId: string) => Promise<void>
  createCanvas: (channelId: string, title: string) => Promise<ChannelCanvas>
  getCanvas: (channelId: string, canvasId: string) => Promise<ChannelCanvas>
  updateCanvas: (channelId: string, canvasId: string, title?: string, canvasData?: string) => Promise<void>
  deleteCanvas: (channelId: string, canvasId: string) => Promise<void>
  // SSE-driven actions
  addNoteFromSSE: (note: ChannelNote) => void
  updateNoteFromSSE: (note: ChannelNote) => void
  removeNoteFromSSE: (noteId: string) => void
  addCanvasFromSSE: (canvas: ChannelCanvas) => void
  updateCanvasFromSSE: (canvas: ChannelCanvas) => void
  removeCanvasFromSSE: (canvasId: string) => void
  handleRemovedFromChannel: (channelId: string) => void
}

export const useChannelStore = create<ChannelState>()((set, get) => ({
  channels: [],
  dms: [],
  activeChannel: null,
  messages: [],
  members: [],
  notes: [],
  canvases: [],
  nextCursor: null,
  isLoading: false,

  fetchChannels: async (workspaceId: string) => {
    try {
      const data = await apiFetch<{ channels: Channel[] }>(`/api/workspaces/${workspaceId}/channels`)
      set({ channels: data.channels.filter(c => c.type !== 'dm') })
    } catch {
      // ignore
    }
  },

  fetchDms: async (workspaceId: string) => {
    try {
      const data = await apiFetch<{ dms: Channel[] }>(`/api/workspaces/${workspaceId}/dms`)
      set({ dms: data.dms })
    } catch {
      // ignore
    }
  },

  createChannel: async (workspaceId: string, name: string, description?: string, channelType = 'public') => {
    const data = await apiFetch<{ channel: Channel }>(`/api/workspaces/${workspaceId}/channels`, {
      method: 'POST',
      body: JSON.stringify({ name, description, channel_type: channelType }),
    })
    await get().fetchChannels(workspaceId)
    return data.channel
  },

  updateChannel: async (channelId: string, name?: string, description?: string) => {
    const body: Record<string, string> = {}
    if (name !== undefined) body.name = name
    if (description !== undefined) body.description = description
    await apiFetch(`/api/channels/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    // Update local state
    set(s => ({
      channels: s.channels.map(c => c.id === channelId ? { ...c, ...(name !== undefined && { name }), ...(description !== undefined && { description }) } : c),
      activeChannel: s.activeChannel?.id === channelId ? { ...s.activeChannel, ...(name !== undefined && { name }), ...(description !== undefined && { description }) } : s.activeChannel,
    }))
  },

  deleteChannel: async (channelId: string) => {
    await apiFetch(`/api/channels/${channelId}`, { method: 'DELETE' })
    set(s => ({
      channels: s.channels.filter(c => c.id !== channelId),
      activeChannel: s.activeChannel?.id === channelId ? null : s.activeChannel,
    }))
  },

  setActiveChannel: (channel: Channel | null) => {
    set({ activeChannel: channel, messages: [], nextCursor: null })
    if (channel) {
      get().fetchMessages(channel.id)
      get().markRead(channel.id)
    }
  },

  fetchMessages: async (channelId: string, cursor?: string) => {
    set({ isLoading: true })
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (cursor) params.set('cursor', cursor)

      const data = await apiFetch<{ messages: ChannelMessage[]; next_cursor: string | null }>(
        `/api/channels/${channelId}/messages?${params}`
      )

      if (cursor) {
        // Append older messages
        set(s => ({
          messages: [...s.messages, ...data.messages],
          nextCursor: data.next_cursor,
          isLoading: false,
        }))
      } else {
        set({
          messages: data.messages,
          nextCursor: data.next_cursor,
          isLoading: false,
        })
      }
    } catch {
      set({ isLoading: false })
    }
  },

  sendMessage: async (channelId: string, content: string) => {
    const data = await apiFetch<{ message: ChannelMessage }>(`/api/channels/${channelId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    })
    set(s => ({ messages: [data.message, ...s.messages] }))
  },

  editMessage: async (channelId: string, messageId: string, content: string) => {
    await apiFetch(`/api/channels/${channelId}/messages/${messageId}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    })
    set(s => ({
      messages: s.messages.map(m =>
        m.id === messageId ? { ...m, content, edited_at: new Date().toISOString() } : m
      ),
    }))
  },

  deleteMessage: async (channelId: string, messageId: string) => {
    await apiFetch(`/api/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' })
    set(s => ({ messages: s.messages.filter(m => m.id !== messageId) }))
  },

  markRead: async (channelId: string) => {
    try {
      await apiFetch(`/api/channels/${channelId}/read`, { method: 'POST' })
      set(s => ({
        channels: s.channels.map(c => c.id === channelId ? { ...c, unread_count: 0 } : c),
        dms: s.dms.map(c => c.id === channelId ? { ...c, unread_count: 0 } : c),
      }))
    } catch {
      // ignore
    }
  },

  createDm: async (workspaceId: string, userId: string) => {
    const data = await apiFetch<{ channel: Channel }>(`/api/workspaces/${workspaceId}/dms`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    })
    await get().fetchDms(workspaceId)
    return data.channel
  },

  fetchMembers: async (channelId: string) => {
    const data = await apiFetch<{ members: ChannelMember[] }>(`/api/channels/${channelId}/members`)
    set({ members: data.members })
  },

  addChannelMember: async (channelId: string, userId: string) => {
    await apiFetch(`/api/channels/${channelId}/members`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    })
    await get().fetchMembers(channelId)
  },

  removeChannelMember: async (channelId: string, userId: string) => {
    await apiFetch(`/api/channels/${channelId}/members/${userId}`, { method: 'DELETE' })
    await get().fetchMembers(channelId)
  },

  addMessage: (message: ChannelMessage) => {
    const { activeChannel } = get()
    if (activeChannel && message.channel_id === activeChannel.id) {
      set(s => ({ messages: [message, ...s.messages] }))
    }
    // Update unread count for non-active channels
    set(s => ({
      channels: s.channels.map(c =>
        c.id === message.channel_id && (!activeChannel || activeChannel.id !== c.id)
          ? { ...c, unread_count: (c.unread_count || 0) + 1 }
          : c
      ),
      dms: s.dms.map(c =>
        c.id === message.channel_id && (!activeChannel || activeChannel.id !== c.id)
          ? { ...c, unread_count: (c.unread_count || 0) + 1 }
          : c
      ),
    }))
  },

  // ─── Notes ───

  fetchNotes: async (channelId: string) => {
    try {
      const data = await apiFetch<{ notes: ChannelNote[] }>(`/api/channels/${channelId}/notes`)
      set({ notes: data.notes })
    } catch {
      set({ notes: [] })
    }
  },

  createNote: async (channelId: string, title: string) => {
    const data = await apiFetch<{ note: ChannelNote }>(`/api/channels/${channelId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
    set(s => ({ notes: [...s.notes, data.note] }))
    return data.note
  },

  updateNote: async (channelId: string, noteId: string, title?: string, content?: string) => {
    const body: Record<string, string> = {}
    if (title !== undefined) body.title = title
    if (content !== undefined) body.content = content
    await apiFetch(`/api/channels/${channelId}/notes/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    set(s => ({
      notes: s.notes.map(n =>
        n.id === noteId
          ? { ...n, ...(title !== undefined && { title }), ...(content !== undefined && { content }), updated_at: new Date().toISOString() }
          : n
      ),
    }))
  },

  deleteNote: async (channelId: string, noteId: string) => {
    await apiFetch(`/api/channels/${channelId}/notes/${noteId}`, { method: 'DELETE' })
    set(s => ({ notes: s.notes.filter(n => n.id !== noteId) }))
  },

  // ─── SSE-driven actions ───

  addNoteFromSSE: (note: ChannelNote) => {
    set(s => {
      if (s.notes.some(n => n.id === note.id)) return s
      return { notes: [...s.notes, note] }
    })
  },

  updateNoteFromSSE: (note: ChannelNote) => {
    set(s => ({
      notes: s.notes.map(n => n.id === note.id ? { ...n, ...note } : n),
    }))
  },

  removeNoteFromSSE: (noteId: string) => {
    set(s => ({ notes: s.notes.filter(n => n.id !== noteId) }))
  },

  // Canvases
  fetchCanvases: async (channelId: string) => {
    const data = await apiFetch<{ canvases: ChannelCanvas[] }>(`/api/channels/${channelId}/canvases`)
    set({ canvases: data.canvases })
  },

  createCanvas: async (channelId: string, title: string) => {
    const data = await apiFetch<{ canvas: ChannelCanvas }>(`/api/channels/${channelId}/canvases`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
    set(s => ({ canvases: [...s.canvases, data.canvas] }))
    return data.canvas
  },

  getCanvas: async (channelId: string, canvasId: string) => {
    const data = await apiFetch<{ canvas: ChannelCanvas }>(`/api/channels/${channelId}/canvases/${canvasId}`)
    return data.canvas
  },

  updateCanvas: async (channelId: string, canvasId: string, title?: string, canvasData?: string) => {
    await apiFetch(`/api/channels/${channelId}/canvases/${canvasId}`, {
      method: 'PUT',
      body: JSON.stringify({ title, canvas_data: canvasData }),
    })
    if (title) {
      set(s => ({ canvases: s.canvases.map(c => c.id === canvasId ? { ...c, title } : c) }))
    }
  },

  deleteCanvas: async (channelId: string, canvasId: string) => {
    await apiFetch(`/api/channels/${channelId}/canvases/${canvasId}`, { method: 'DELETE' })
    set(s => ({ canvases: s.canvases.filter(c => c.id !== canvasId) }))
  },

  addCanvasFromSSE: (canvas: ChannelCanvas) => {
    set(s => ({
      canvases: s.canvases.some(c => c.id === canvas.id) ? s.canvases : [...s.canvases, canvas],
    }))
  },

  updateCanvasFromSSE: (canvas: ChannelCanvas) => {
    set(s => ({
      canvases: s.canvases.map(c => c.id === canvas.id ? { ...c, ...canvas } : c),
    }))
  },

  removeCanvasFromSSE: (canvasId: string) => {
    set(s => ({ canvases: s.canvases.filter(c => c.id !== canvasId) }))
  },

  handleRemovedFromChannel: (channelId: string) => {
    set(s => ({
      channels: s.channels.filter(c => c.id !== channelId),
      dms: s.dms.filter(c => c.id !== channelId),
      activeChannel: s.activeChannel?.id === channelId ? null : s.activeChannel,
      messages: s.activeChannel?.id === channelId ? [] : s.messages,
      notes: s.activeChannel?.id === channelId ? [] : s.notes,
      canvases: s.activeChannel?.id === channelId ? [] : s.canvases,
      members: s.activeChannel?.id === channelId ? [] : s.members,
    }))
  },
}))
