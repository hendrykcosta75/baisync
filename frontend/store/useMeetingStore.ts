import { create } from 'zustand'
import { apiFetch } from '@/lib/api'
import type {
  CreateMeetingInput,
  CreateMeetingResponse,
  GuestJoinResponse,
  GuestStatusResponse,
  JoinMeetingResponse,
  Meeting,
  MeetingMessage,
  MeetingParticipant,
  PendingKnock,
  PublicMeetingInfo,
} from '@/types/meeting'

function mapMeeting(raw: Record<string, unknown>): Meeting {
  return {
    id: raw.id as string,
    workspaceId: (raw.workspace_id ?? raw.workspaceId) as string,
    code: raw.code as string,
    title: (raw.title ?? '') as string,
    hostUserId: (raw.host_user_id ?? raw.hostUserId) as string,
    createdBy: (raw.created_by ?? raw.createdBy) as string,
    participantMode: (raw.participant_mode ?? raw.participantMode) as Meeting['participantMode'],
    status: (raw.status ?? 'scheduled') as Meeting['status'],
    livekitRoomName: (raw.livekit_room_name ?? raw.livekitRoomName ?? '') as string,
    scheduledStart: (raw.scheduled_start ?? raw.scheduledStart ?? null) as string | null,
    startedAt: (raw.started_at ?? raw.startedAt ?? null) as string | null,
    endedAt: (raw.ended_at ?? raw.endedAt ?? null) as string | null,
    expiresAt: (raw.expires_at ?? raw.expiresAt ?? null) as string | null,
    linkUsesRemaining: (raw.link_uses_remaining ?? raw.linkUsesRemaining ?? -1) as number,
    createdAt: (raw.created_at ?? raw.createdAt ?? '') as string,
    updatedAt: (raw.updated_at ?? raw.updatedAt ?? '') as string,
    shareUrl: (raw.share_url ?? raw.shareUrl ?? '') as string,
  }
}

function mapParticipant(raw: Record<string, unknown>): MeetingParticipant {
  return {
    meetingId: (raw.meeting_id ?? raw.meetingId) as string,
    participantId: (raw.participant_id ?? raw.participantId) as string,
    userId: (raw.user_id ?? raw.userId ?? null) as string | null,
    displayName: (raw.display_name ?? raw.displayName ?? '') as string,
    role: (raw.role ?? 'guest') as MeetingParticipant['role'],
    joinStatus: (raw.join_status ?? raw.joinStatus ?? 'pending') as MeetingParticipant['joinStatus'],
    joinedAt: (raw.joined_at ?? raw.joinedAt ?? null) as string | null,
    leftAt: (raw.left_at ?? raw.leftAt ?? null) as string | null,
  }
}

function mapMessage(raw: Record<string, unknown>): MeetingMessage {
  return {
    id: raw.id as string,
    meetingId: (raw.meeting_id ?? raw.meetingId) as string,
    participantId: (raw.participant_id ?? raw.participantId) as string,
    displayName: (raw.display_name ?? raw.displayName ?? '') as string,
    body: (raw.body ?? '') as string,
    createdAt: (raw.created_at ?? raw.createdAt ?? '') as string,
  }
}

function resolveLivekitUrl(fromBackend: string): string {
  const publicUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL
  if (publicUrl && publicUrl.length > 0) return publicUrl
  return fromBackend
}

function mapPublicInfo(raw: Record<string, unknown>): PublicMeetingInfo {
  return {
    code: raw.code as string,
    title: (raw.title ?? '') as string,
    hostName: (raw.host_name ?? raw.hostName ?? null) as string | null,
    participantMode: (raw.participant_mode ?? raw.participantMode) as PublicMeetingInfo['participantMode'],
    status: (raw.status ?? 'scheduled') as PublicMeetingInfo['status'],
    knockingRequired: Boolean(raw.knocking_required ?? raw.knockingRequired),
  }
}

export interface ChatToast {
  localKey: string
  meetingId: string
  displayName: string
  body: string
}

interface MeetingState {
  meetings: Meeting[]
  isLoading: boolean
  pendingKnocks: PendingKnock[]
  messagesByMeeting: Record<string, MeetingMessage[]>
  unreadByMeeting: Record<string, number>
  chatOpenFor: string | null
  toastMessage: ChatToast | null

  fetchMeetings: () => Promise<void>
  createInstant: (title?: string) => Promise<CreateMeetingResponse>
  schedule: (input: CreateMeetingInput) => Promise<Meeting>
  end: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  join: (id: string) => Promise<JoinMeetingResponse>
  fetchParticipants: (id: string) => Promise<MeetingParticipant[]>
  approveGuest: (meetingId: string, participantId: string) => Promise<void>
  denyGuest: (meetingId: string, participantId: string) => Promise<void>

  fetchMessages: (meetingId: string) => Promise<void>
  sendMessage: (meetingId: string, body: string) => Promise<void>

  // Guest flow (public)
  fetchPublicInfo: (code: string) => Promise<PublicMeetingInfo>
  guestJoin: (code: string, displayName: string) => Promise<GuestJoinResponse>
  pollGuestStatus: (code: string, participantId: string) => Promise<GuestStatusResponse>

  // SSE integration
  addPendingKnock: (knock: PendingKnock) => void
  clearKnock: (participantId: string) => void
  appendMessage: (meetingId: string, msg: MeetingMessage) => void
  ingestMessage: (meetingId: string, msg: MeetingMessage, fromSelf?: boolean) => void
  markEnded: (meetingId: string) => void

  // Chat UI state
  openChat: (meetingId: string) => void
  closeChat: () => void
  dismissToast: (localKey?: string) => void
}

export const useMeetingStore = create<MeetingState>((set, get) => ({
  meetings: [],
  isLoading: false,
  pendingKnocks: [],
  messagesByMeeting: {},
  unreadByMeeting: {},
  chatOpenFor: null,
  toastMessage: null,

  fetchMeetings: async () => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<Record<string, unknown>[]>('/api/meetings')
      set({ meetings: data.map(mapMeeting) })
    } catch (e) {
      console.error('Failed to fetch meetings', e)
    } finally {
      set({ isLoading: false })
    }
  },

  createInstant: async (title) => {
    const raw = await apiFetch<Record<string, unknown>>('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: title ?? 'Reunião instantânea',
        participant_mode: 'workspace',
        start_now: true,
        link_expiry: '24h',
      }),
    })
    const response: CreateMeetingResponse = {
      meeting: mapMeeting(raw.meeting as Record<string, unknown>),
      token: raw.token as string,
      livekitUrl: resolveLivekitUrl((raw.livekit_url ?? raw.livekitUrl) as string),
    }
    set({ meetings: [response.meeting, ...get().meetings] })
    return response
  },

  schedule: async (input) => {
    const raw = await apiFetch<Record<string, unknown>>('/api/meetings', {
      method: 'POST',
      body: JSON.stringify({
        title: input.title,
        participant_mode: input.participantMode ?? 'workspace',
        scheduled_start: input.scheduledStart,
        link_expiry: input.linkExpiry ?? 'never',
        start_now: false,
      }),
    })
    const meeting = mapMeeting(raw.meeting as Record<string, unknown>)
    set({ meetings: [meeting, ...get().meetings] })
    return meeting
  },

  end: async (id) => {
    await apiFetch(`/api/meetings/${id}/end`, { method: 'POST' })
    set({
      meetings: get().meetings.map((m) => (m.id === id ? { ...m, status: 'ended' } : m)),
    })
  },

  remove: async (id) => {
    await apiFetch(`/api/meetings/${id}`, { method: 'DELETE' })
    set({
      meetings: get().meetings.filter((m) => m.id !== id),
    })
  },

  join: async (id) => {
    const raw = await apiFetch<Record<string, unknown>>(`/api/meetings/${id}/join`, {
      method: 'POST',
    })
    return {
      token: raw.token as string,
      livekitUrl: resolveLivekitUrl((raw.livekit_url ?? raw.livekitUrl) as string),
      room: raw.room as string,
      participantId: (raw.participant_id ?? raw.participantId) as string,
      isHost: Boolean(raw.is_host ?? raw.isHost),
    }
  },

  fetchParticipants: async (id) => {
    const data = await apiFetch<Record<string, unknown>[]>(`/api/meetings/${id}/participants`)
    return data.map(mapParticipant)
  },

  approveGuest: async (meetingId, participantId) => {
    await apiFetch(`/api/meetings/${meetingId}/approve/${participantId}`, { method: 'POST' })
    get().clearKnock(participantId)
  },

  denyGuest: async (meetingId, participantId) => {
    await apiFetch(`/api/meetings/${meetingId}/deny/${participantId}`, { method: 'POST' })
    get().clearKnock(participantId)
  },

  fetchMessages: async (meetingId) => {
    const data = await apiFetch<Record<string, unknown>[]>(`/api/meetings/${meetingId}/messages`)
    const serverMsgs = data.map(mapMessage)
    const existing = get().messagesByMeeting[meetingId] ?? []
    const serverIds = new Set(serverMsgs.map((m) => m.id))
    const extras = existing.filter((m) => !serverIds.has(m.id))
    const merged = [...serverMsgs, ...extras].sort((a, b) =>
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    )
    set({
      messagesByMeeting: {
        ...get().messagesByMeeting,
        [meetingId]: merged,
      },
    })
  },

  sendMessage: async (meetingId, body) => {
    await apiFetch(`/api/meetings/${meetingId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  },

  fetchPublicInfo: async (code) => {
    const raw = await apiFetch<Record<string, unknown>>(`/api/public/meetings/${code}`)
    return mapPublicInfo(raw)
  },

  guestJoin: async (code, displayName) => {
    const raw = await apiFetch<Record<string, unknown>>(
      `/api/public/meetings/${code}/guest-join`,
      {
        method: 'POST',
        body: JSON.stringify({ display_name: displayName }),
      }
    )
    const status = raw.status as string
    if (status === 'approved') {
      return {
        status: 'approved',
        token: raw.token as string,
        livekitUrl: resolveLivekitUrl((raw.livekit_url ?? raw.livekitUrl) as string),
        room: raw.room as string,
        participantId: (raw.participant_id ?? raw.participantId) as string,
      }
    }
    return {
      status: 'pending',
      participantId: (raw.participant_id ?? raw.participantId) as string,
    }
  },

  pollGuestStatus: async (code, participantId) => {
    const raw = await apiFetch<Record<string, unknown>>(
      `/api/public/meetings/${code}/guest-status/${participantId}`
    )
    const status = raw.status as string
    if (status === 'approved') {
      return {
        status: 'approved',
        token: raw.token as string,
        livekitUrl: resolveLivekitUrl((raw.livekit_url ?? raw.livekitUrl) as string),
        room: raw.room as string,
      }
    }
    if (status === 'denied') return { status: 'denied' }
    return { status: 'pending' }
  },

  addPendingKnock: (knock) => {
    const existing = get().pendingKnocks
    if (existing.some((k) => k.participantId === knock.participantId)) return
    set({ pendingKnocks: [knock, ...existing] })
  },

  clearKnock: (participantId) => {
    set({ pendingKnocks: get().pendingKnocks.filter((k) => k.participantId !== participantId) })
  },

  appendMessage: (meetingId, msg) => {
    const existing = get().messagesByMeeting[meetingId] ?? []
    if (existing.some((m) => m.id === msg.id)) return
    set({
      messagesByMeeting: {
        ...get().messagesByMeeting,
        [meetingId]: [...existing, msg],
      },
    })
  },

  ingestMessage: (meetingId, msg, fromSelf = false) => {
    const state = get()
    const existing = state.messagesByMeeting[meetingId] ?? []
    if (existing.some((m) => m.id === msg.id)) return

    const isChatOpen = state.chatOpenFor === meetingId
    const patch: Partial<MeetingState> = {
      messagesByMeeting: {
        ...state.messagesByMeeting,
        [meetingId]: [...existing, msg],
      },
    }

    if (!fromSelf && !isChatOpen) {
      patch.unreadByMeeting = {
        ...state.unreadByMeeting,
        [meetingId]: (state.unreadByMeeting[meetingId] ?? 0) + 1,
      }
      patch.toastMessage = {
        localKey: `${msg.id}-${Date.now()}`,
        meetingId,
        displayName: msg.displayName,
        body: msg.body,
      }
    }

    set(patch as MeetingState)
  },

  markEnded: (meetingId) => {
    set({
      meetings: get().meetings.map((m) =>
        m.id === meetingId ? { ...m, status: 'ended' } : m
      ),
    })
  },

  openChat: (meetingId) => {
    set({
      chatOpenFor: meetingId,
      unreadByMeeting: { ...get().unreadByMeeting, [meetingId]: 0 },
      toastMessage: null,
    })
  },

  closeChat: () => {
    set({ chatOpenFor: null })
  },

  dismissToast: (localKey) => {
    const current = get().toastMessage
    if (!current) return
    if (localKey && current.localKey !== localKey) return
    set({ toastMessage: null })
  },
}))
