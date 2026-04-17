'use client'

import React, { useState } from 'react'
import { ParticipantGrid } from '@/components/meetings/ParticipantGrid'
import { ControlBar } from '@/components/meetings/ControlBar'
import { ChatPanel } from '@/components/meetings/ChatPanel'
import { ParticipantsPanel } from '@/components/meetings/ParticipantsPanel'
import { ChatMessageToast } from '@/components/meetings/ChatMessageToast'
import { useMeetingStore } from '@/store/useMeetingStore'

interface Props {
  isHost: boolean
  isGuest: boolean
  meetingId: string
  displayName: string
  title?: string
  onLeave: () => void
  onEnd?: () => void
  onMinimize?: () => void
}

export function RoomShell({
  isHost,
  isGuest,
  meetingId,
  displayName,
  title,
  onLeave,
  onEnd,
  onMinimize,
}: Props) {
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const pendingKnocks = useMeetingStore((s) => s.pendingKnocks)
  const chatOpenFor = useMeetingStore((s) => s.chatOpenFor)
  const unread = useMeetingStore((s) => s.unreadByMeeting[meetingId] ?? 0)
  const openChat = useMeetingStore((s) => s.openChat)
  const closeChat = useMeetingStore((s) => s.closeChat)

  const chatOpen = chatOpenFor === meetingId
  const knockBadge = isHost ? pendingKnocks.filter((k) => k.meetingId === meetingId).length : 0

  const handleToggleChat = () => {
    if (chatOpen) closeChat()
    else openChat(meetingId)
  }

  return (
    <div className="w-full h-full flex flex-col bg-app">
      <header className="flex items-center justify-between px-4 h-12 border-b border-dim bg-surface shrink-0">
        <h1
          className="text-sm font-bold text-heading truncate"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          {title || 'Reunião'}
        </h1>
        <span
          className="text-[11px] font-semibold tracking-wider uppercase text-subtle"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          {isHost ? 'Anfitrião' : isGuest ? 'Convidado' : 'Membro'}
        </span>
      </header>
      <div className="flex-1 flex overflow-hidden min-h-0">
        <main className="flex-1 relative min-h-0 min-w-0">
          <ParticipantGrid />
        </main>
        {chatOpen && (
          <ChatPanel
            meetingId={meetingId}
            isGuest={isGuest}
            displayName={displayName}
            onClose={closeChat}
          />
        )}
        {participantsOpen && (
          <ParticipantsPanel
            isHost={isHost}
            meetingId={meetingId}
            onClose={() => setParticipantsOpen(false)}
          />
        )}
      </div>
      <ControlBar
        isHost={isHost}
        chatOpen={chatOpen}
        participantsOpen={participantsOpen}
        chatBadge={unread}
        knockBadge={knockBadge}
        onToggleChat={handleToggleChat}
        onToggleParticipants={() => setParticipantsOpen((v) => !v)}
        onLeave={onLeave}
        onEndForAll={isHost && onEnd ? onEnd : undefined}
        onMinimize={onMinimize}
      />
      <ChatMessageToast meetingId={meetingId} onOpenChat={() => openChat(meetingId)} />
    </div>
  )
}
