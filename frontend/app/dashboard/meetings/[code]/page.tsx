'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import { useMeetingStore } from '@/store/useMeetingStore'
import { useActiveMeetingStore } from '@/store/useActiveMeetingStore'
import { useAuthStore } from '@/store/useAuthStore'
import { MeetingLobby } from '@/components/meetings/MeetingLobby'
import { Maximize2 } from 'lucide-react'

interface ResolvedMeeting {
  id: string
  title: string
  livekitRoomName: string
}

export default function MeetingRoomPage() {
  const params = useParams<{ code: string }>()
  const code = params.code
  const router = useRouter()
  const user = useAuthStore((s) => s.user)
  const active = useActiveMeetingStore((s) => s.active)
  const isMinimized = useActiveMeetingStore((s) => s.isMinimized)
  const restore = useActiveMeetingStore((s) => s.restore)
  const startActive = useActiveMeetingStore((s) => s.start)

  const [meeting, setMeeting] = useState<ResolvedMeeting | null>(null)
  const [isJoining, setIsJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    ;(async () => {
      try {
        const info = await apiFetch<Record<string, unknown>>(`/api/public/meetings/${code}`)
        const list = await apiFetch<Record<string, unknown>[]>('/api/meetings')
        const match = list.find((m) => m.code === code)
        if (!match) {
          setError('Reunião não encontrada neste workspace')
          return
        }
        setMeeting({
          id: match.id as string,
          title: (match.title ?? info.title ?? 'Reunião') as string,
          livekitRoomName: (match.livekit_room_name ?? '') as string,
        })
      } catch (e) {
        console.error(e)
        setError('Reunião não encontrada')
      }
    })()
  }, [code])

  const isActiveHere = active?.code === code

  const handleJoin = async ({
    audioEnabled,
    videoEnabled,
  }: {
    displayName: string
    audioEnabled: boolean
    videoEnabled: boolean
  }) => {
    if (!meeting) return
    setIsJoining(true)
    try {
      const join = await useMeetingStore.getState().join(meeting.id)
      startActive({
        meetingId: meeting.id,
        code: code,
        title: meeting.title,
        token: join.token,
        livekitUrl: join.livekitUrl,
        isHost: join.isHost,
        isGuest: false,
        displayName: user?.name ?? user?.email ?? 'Membro',
        audioEnabled,
        videoEnabled,
      })
    } catch (e) {
      console.error('join failed', e)
      setError('Não foi possível entrar na reunião')
    } finally {
      setIsJoining(false)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <div className="text-center">
          <h1
            className="text-xl font-bold text-heading"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            {error}
          </h1>
          <button
            onClick={() => router.push('/dashboard/meetings')}
            className="btn-neu-ghost text-sm mt-4"
          >
            Voltar para reuniões
          </button>
        </div>
      </div>
    )
  }

  if (!meeting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app">
        <p className="text-sm text-subtle" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
          Carregando reunião…
        </p>
      </div>
    )
  }

  if (isActiveHere && isMinimized) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center flex flex-col items-center gap-3">
          <h1
            className="text-lg font-bold text-heading"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Reunião em andamento
          </h1>
          <p className="text-sm text-subtle">A reunião está minimizada no canto inferior direito.</p>
          <button onClick={restore} className="btn-neu inline-flex items-center gap-2">
            <Maximize2 size={14} /> Voltar para tela cheia
          </button>
        </div>
      </div>
    )
  }

  if (isActiveHere) {
    // ActiveMeetingContainer (mounted in dashboard layout) is rendering fullscreen over this page.
    return null
  }

  return (
    <MeetingLobby
      title={meeting.title}
      isJoining={isJoining}
      onJoin={handleJoin}
      onCancel={() => router.push('/dashboard/meetings')}
    />
  )
}
