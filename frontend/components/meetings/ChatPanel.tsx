'use client'

import React, { useEffect, useRef, useState } from 'react'
import { useDataChannel } from '@livekit/components-react'
import { Send, X } from 'lucide-react'
import { useMeetingStore } from '@/store/useMeetingStore'

const MONO_FONT = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const
const NEU_ICON_SHADOW =
  '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)'

interface Props {
  meetingId: string
  isGuest: boolean
  displayName: string
  onClose: () => void
}

export function ChatPanel({ meetingId, isGuest, displayName, onClose }: Props) {
  const messagesByMeeting = useMeetingStore((s) => s.messagesByMeeting)
  const fetchMessages = useMeetingStore((s) => s.fetchMessages)
  const sendMessage = useMeetingStore((s) => s.sendMessage)
  const openChat = useMeetingStore((s) => s.openChat)
  const closeChat = useMeetingStore((s) => s.closeChat)
  const ingestMessage = useMeetingStore((s) => s.ingestMessage)
  const messages = messagesByMeeting[meetingId] ?? []
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { send: sendViaDataChannel } = useDataChannel('chat')

  useEffect(() => {
    openChat(meetingId)
    return () => {
      closeChat()
    }
  }, [meetingId, openChat, closeChat])

  useEffect(() => {
    if (!isGuest) fetchMessages(meetingId).catch(() => {})
  }, [meetingId, isGuest, fetchMessages])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setDraft('')

    const createdAt = new Date().toISOString()
    const id = crypto.randomUUID()
    const participantId = isGuest ? 'guest' : 'member'

    const payload = {
      id,
      body,
      display_name: displayName,
      created_at: createdAt,
      participant_id: participantId,
    }

    if (isGuest) {
      // Guests only have the data channel — no SSE echo for them, so insert optimistically.
      try {
        sendViaDataChannel(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true })
      } catch {
        // ignore
      }
      ingestMessage(
        meetingId,
        {
          id,
          meetingId,
          participantId,
          displayName,
          body,
          createdAt,
        },
        true
      )
    } else {
      // Members receive the authoritative copy via SSE — no optimistic insert (avoids duplicates).
      try {
        await sendMessage(meetingId, body)
      } catch (err) {
        console.error('send failed', err)
        return
      }
      // Echo via data channel so any connected guest sees it without needing SSE.
      try {
        sendViaDataChannel(new TextEncoder().encode(JSON.stringify(payload)), { reliable: true })
      } catch {
        // ignore
      }
    }
  }

  const canSend = draft.trim().length > 0

  return (
    <aside className="w-80 flex flex-col bg-surface border-l border-dim">
      <header className="flex items-center justify-between px-4 h-12 border-b border-dim">
        <h3 className="text-sm font-bold text-heading" style={MONO_FONT}>
          Chat
        </h3>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-md flex items-center justify-center text-subtle hover:text-heading transition-colors duration-200"
          aria-label="Fechar chat"
        >
          <X size={16} />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <p className="text-xs text-subtle text-center py-6" style={MONO_FONT}>
            Nenhuma mensagem ainda.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className="flex flex-col">
            <span className="text-[11px] text-subtle" style={MONO_FONT}>
              {m.displayName}
            </span>
            <p className="text-sm text-body break-words whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSend} className="p-2 border-t border-dim flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Escreva uma mensagem"
          className="flex-1 bg-raised border border-dim rounded-[10px] px-3 py-2 text-body text-sm
                     placeholder:text-subtle/50
                     focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20
                     transition-all duration-200 outline-none"
        />
        <button
          type="submit"
          disabled={!canSend}
          className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-raised text-subtle hover:text-[#ff6b2c] transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ boxShadow: NEU_ICON_SHADOW }}
          aria-label="Enviar mensagem"
        >
          <Send size={14} />
        </button>
      </form>
    </aside>
  )
}
