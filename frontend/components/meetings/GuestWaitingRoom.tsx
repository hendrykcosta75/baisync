'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useMeetingStore } from '@/store/useMeetingStore'

interface Props {
  code: string
  participantId: string
  onApproved: (result: { token: string; livekitUrl: string; room: string }) => void
  onDenied: () => void
}

export function GuestWaitingRoom({ code, participantId, onApproved, onDenied }: Props) {
  const pollGuestStatus = useMeetingStore((s) => s.pollGuestStatus)
  const [dots, setDots] = useState('')
  const stoppedRef = useRef(false)

  useEffect(() => {
    const dotsTimer = setInterval(() => {
      setDots((d) => (d.length >= 3 ? '' : d + '.'))
    }, 400)
    return () => clearInterval(dotsTimer)
  }, [])

  useEffect(() => {
    stoppedRef.current = false
    const tick = async () => {
      if (stoppedRef.current) return
      try {
        const res = await pollGuestStatus(code, participantId)
        if (res.status === 'approved') {
          stoppedRef.current = true
          onApproved({ token: res.token, livekitUrl: res.livekitUrl, room: res.room })
          return
        }
        if (res.status === 'denied') {
          stoppedRef.current = true
          onDenied()
          return
        }
      } catch {
        // keep polling on transient errors
      }
      if (!stoppedRef.current) setTimeout(tick, 2000)
    }
    tick()
    return () => {
      stoppedRef.current = true
    }
  }, [code, participantId, pollGuestStatus, onApproved, onDenied])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4">
      <div className="max-w-md text-center flex flex-col items-center gap-4">
        <Loader2 className="animate-spin text-[#ff6b2c]" size={32} />
        <h1 className="text-xl font-semibold text-heading">Aguardando aprovação{dots}</h1>
        <p className="text-sm text-subtle">
          O anfitrião foi notificado do seu pedido para entrar. Assim que ele aprovar, você entrará
          automaticamente.
        </p>
      </div>
    </div>
  )
}
