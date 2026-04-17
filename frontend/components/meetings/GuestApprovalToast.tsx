'use client'

import { useEffect } from 'react'
import { useMeetingStore } from '@/store/useMeetingStore'

interface KnockEvent {
  meeting_id: string
  code: string
  participant_id: string
  display_name: string
}

export function GuestApprovalToast() {
  const addPendingKnock = useMeetingStore((s) => s.addPendingKnock)

  useEffect(() => {
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent).detail as KnockEvent | undefined
      if (!detail?.participant_id) return
      addPendingKnock({
        meetingId: detail.meeting_id,
        code: detail.code,
        participantId: detail.participant_id,
        displayName: detail.display_name,
        at: new Date().toISOString(),
      })
    }
    window.addEventListener('sse:meeting_join_request', handler)
    return () => window.removeEventListener('sse:meeting_join_request', handler)
  }, [addPendingKnock])

  return null
}
