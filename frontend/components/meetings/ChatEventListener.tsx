'use client'

import { useEffect } from 'react'
import { useDataChannel, useLocalParticipant } from '@livekit/components-react'
import { useMeetingStore } from '@/store/useMeetingStore'
import type { MeetingMessage } from '@/types/meeting'

interface Props {
  meetingId: string
}

interface IncomingPayload {
  id: string
  body: string
  display_name: string
  created_at: string
  participant_id: string
}

export function ChatEventListener({ meetingId }: Props) {
  const ingestMessage = useMeetingStore((s) => s.ingestMessage)
  const { localParticipant } = useLocalParticipant()
  const localParticipantId = localParticipant?.identity ?? ''

  // SSE — backend-persisted chat (members)
  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent).detail
      if (!detail || detail.meeting_id !== meetingId) return
      const raw = detail.message
      if (!raw) return
      const msg: MeetingMessage = {
        id: raw.id as string,
        meetingId,
        participantId: (raw.participant_id ?? raw.participantId) as string,
        displayName: (raw.display_name ?? raw.displayName ?? '') as string,
        body: (raw.body ?? '') as string,
        createdAt: (raw.created_at ?? raw.createdAt ?? '') as string,
      }
      const fromSelf = msg.participantId === localParticipantId
      ingestMessage(meetingId, msg, fromSelf)
    }
    window.addEventListener('sse:meeting_chat_message', handler)
    return () => window.removeEventListener('sse:meeting_chat_message', handler)
  }, [meetingId, localParticipantId, ingestMessage])

  // LiveKit data channel — guest messages + echoes
  useDataChannel('chat', (msg) => {
    try {
      const decoded: IncomingPayload = JSON.parse(new TextDecoder().decode(msg.payload))
      const fromSelf =
        msg.from?.identity === localParticipantId ||
        decoded.participant_id === localParticipantId
      const out: MeetingMessage = {
        id: decoded.id,
        meetingId,
        participantId: decoded.participant_id,
        displayName: decoded.display_name,
        body: decoded.body,
        createdAt: decoded.created_at,
      }
      ingestMessage(meetingId, out, fromSelf)
    } catch {
      // ignore malformed
    }
  })

  return null
}
