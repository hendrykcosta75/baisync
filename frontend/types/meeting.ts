export type MeetingStatus = 'scheduled' | 'active' | 'ended'
export type ParticipantMode = 'personal' | 'workspace'
export type ParticipantRole = 'host' | 'member' | 'guest'
export type JoinStatus = 'pending' | 'approved' | 'denied' | 'left'
export type LinkExpiry = 'never' | 'single_use' | '24h' | '7d'

export interface Meeting {
  id: string
  workspaceId: string
  code: string
  title: string
  hostUserId: string
  createdBy: string
  participantMode: ParticipantMode
  status: MeetingStatus
  livekitRoomName: string
  scheduledStart: string | null
  startedAt: string | null
  endedAt: string | null
  expiresAt: string | null
  linkUsesRemaining: number
  createdAt: string
  updatedAt: string
  shareUrl: string
}

export interface MeetingParticipant {
  meetingId: string
  participantId: string
  userId: string | null
  displayName: string
  role: ParticipantRole
  joinStatus: JoinStatus
  joinedAt: string | null
  leftAt: string | null
}

export interface MeetingMessage {
  id: string
  meetingId: string
  participantId: string
  displayName: string
  body: string
  createdAt: string
}

export interface CreateMeetingInput {
  title?: string
  participantMode?: ParticipantMode
  scheduledStart?: string
  linkExpiry?: LinkExpiry
  startNow?: boolean
}

export interface CreateMeetingResponse {
  meeting: Meeting
  token: string
  livekitUrl: string
}

export interface JoinMeetingResponse {
  token: string
  livekitUrl: string
  room: string
  participantId: string
  isHost: boolean
}

export interface PendingKnock {
  meetingId: string
  code: string
  participantId: string
  displayName: string
  at: string
}

export interface PublicMeetingInfo {
  code: string
  title: string
  hostName: string | null
  participantMode: ParticipantMode
  status: MeetingStatus
  knockingRequired: boolean
}

export type GuestJoinResponse =
  | {
      status: 'approved'
      token: string
      livekitUrl: string
      room: string
      participantId: string
    }
  | {
      status: 'pending'
      participantId: string
    }

export type GuestStatusResponse =
  | { status: 'pending' }
  | { status: 'approved'; token: string; livekitUrl: string; room: string }
  | { status: 'denied' }
