'use client'

import React, { useEffect, useState } from 'react'
import { MessageSquare, X } from 'lucide-react'
import { useMeetingStore } from '@/store/useMeetingStore'

const MONO_FONT = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const

interface Props {
  meetingId: string
  onOpenChat: () => void
}

export function ChatMessageToast({ meetingId, onOpenChat }: Props) {
  const toast = useMeetingStore((s) => s.toastMessage)
  const chatOpenFor = useMeetingStore((s) => s.chatOpenFor)
  const dismissToast = useMeetingStore((s) => s.dismissToast)
  const [visible, setVisible] = useState(false)

  const currentKey = toast && toast.meetingId === meetingId ? toast.localKey : null
  const shouldShow = Boolean(currentKey) && chatOpenFor !== meetingId

  useEffect(() => {
    if (!currentKey) return
    if (chatOpenFor === meetingId) {
      dismissToast(currentKey)
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(true)
    const hideTimer = setTimeout(() => setVisible(false), 3600)
    const clearTimer = setTimeout(() => dismissToast(currentKey), 4000)
    return () => {
      clearTimeout(hideTimer)
      clearTimeout(clearTimer)
    }
  }, [currentKey, chatOpenFor, meetingId, dismissToast])

  useEffect(() => {
    if (currentKey) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(false)
  }, [currentKey])

  if (!shouldShow || !toast) return null

  return (
    <div
      className={`fixed bottom-24 right-6 z-[95] w-[280px] rounded-xl overflow-hidden border border-dim bg-surface transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
      }`}
      style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between px-3 h-8 bg-raised border-b border-dim">
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-heading"
          style={MONO_FONT}
        >
          <MessageSquare size={11} className="text-[#ff6b2c]" />
          Nova mensagem
        </span>
        <button
          onClick={() => dismissToast(toast.localKey)}
          className="w-5 h-5 rounded-md flex items-center justify-center text-subtle hover:text-heading transition-colors"
          aria-label="Dispensar"
        >
          <X size={12} />
        </button>
      </div>
      <button
        onClick={() => {
          dismissToast(toast.localKey)
          onOpenChat()
        }}
        className="w-full text-left px-3 py-2.5 hover:bg-raised/60 transition-colors"
      >
        <p className="text-[11px] text-subtle truncate" style={MONO_FONT}>
          {toast.displayName}
        </p>
        <p className="text-sm text-body line-clamp-2 break-words">{toast.body}</p>
      </button>
    </div>
  )
}
