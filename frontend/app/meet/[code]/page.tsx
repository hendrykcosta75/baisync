'use client'

import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useMeetingStore } from '@/store/useMeetingStore'
import { useAuthStore } from '@/store/useAuthStore'
import { MeetingLobby } from '@/components/meetings/MeetingLobby'
import { MeetingRoom } from '@/components/meetings/MeetingRoom'
import { GuestWaitingRoom } from '@/components/meetings/GuestWaitingRoom'
import type { PublicMeetingInfo } from '@/types/meeting'

type Stage =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'lobby'; info: PublicMeetingInfo }
  | { kind: 'waiting'; participantId: string; name: string }
  | { kind: 'joined'; token: string; livekitUrl: string; room: string; name: string; meetingId: string; title: string }

export default function PublicMeetPage() {
  const params = useParams<{ code: string }>()
  const code = params.code
  const router = useRouter()
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const { fetchPublicInfo, guestJoin } = useMeetingStore()
  const [stage, setStage] = useState<Stage>({ kind: 'loading' })
  const [joining, setJoining] = useState(false)
  const [pendingOpts, setPendingOpts] = useState<{ audio: boolean; video: boolean } | null>(null)

  useEffect(() => {
    if (!code) return
    if (isAuthenticated) {
      router.replace(`/dashboard/meetings/${code}`)
      return
    }
    ;(async () => {
      try {
        const info = await fetchPublicInfo(code)
        if (info.status === 'ended') {
          setStage({ kind: 'error', message: 'Esta reunião já foi encerrada.' })
          return
        }
        setStage({ kind: 'lobby', info })
      } catch {
        setStage({ kind: 'error', message: 'Link inválido ou expirado.' })
      }
    })()
  }, [code, isAuthenticated, router, fetchPublicInfo])

  const handleJoin = async (opts: {
    displayName: string
    audioEnabled: boolean
    videoEnabled: boolean
  }) => {
    if (stage.kind !== 'lobby') return
    setJoining(true)
    setPendingOpts({ audio: opts.audioEnabled, video: opts.videoEnabled })
    try {
      const res = await guestJoin(code, opts.displayName)
      if (res.status === 'approved') {
        setStage({
          kind: 'joined',
          token: res.token,
          livekitUrl: res.livekitUrl,
          room: res.room,
          name: opts.displayName,
          meetingId: res.participantId,
          title: stage.info.title,
        })
      } else {
        setStage({ kind: 'waiting', participantId: res.participantId, name: opts.displayName })
      }
    } catch {
      setStage({ kind: 'error', message: 'Não foi possível solicitar entrada.' })
    } finally {
      setJoining(false)
    }
  }

  if (stage.kind === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <p className="text-sm text-subtle">Carregando…</p>
      </div>
    )
  }

  if (stage.kind === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a] px-4">
        <div className="text-center max-w-md">
          <h1 className="text-xl font-semibold text-heading">{stage.message}</h1>
          <p className="text-sm text-subtle mt-2">Peça um novo link ao anfitrião da reunião.</p>
        </div>
      </div>
    )
  }

  if (stage.kind === 'lobby') {
    return (
      <MeetingLobby
        title={stage.info.title || 'Reunião'}
        nameRequired
        isJoining={joining}
        joinLabel={stage.info.knockingRequired ? 'Pedir para entrar' : 'Entrar agora'}
        onJoin={handleJoin}
      />
    )
  }

  if (stage.kind === 'waiting') {
    return (
      <GuestWaitingRoom
        code={code}
        participantId={stage.participantId}
        onApproved={(res) =>
          setStage({
            kind: 'joined',
            token: res.token,
            livekitUrl: res.livekitUrl,
            room: res.room,
            name: stage.name,
            meetingId: stage.participantId,
            title: '',
          })
        }
        onDenied={() =>
          setStage({ kind: 'error', message: 'Sua entrada foi negada pelo anfitrião.' })
        }
      />
    )
  }

  return (
    <MeetingRoom
      token={stage.token}
      serverUrl={stage.livekitUrl}
      isHost={false}
      isGuest={true}
      meetingId={stage.meetingId}
      displayName={stage.name}
      audioEnabled={pendingOpts?.audio ?? true}
      videoEnabled={pendingOpts?.video ?? true}
      title={stage.title}
      onLeave={() => {
        setStage({ kind: 'error', message: 'Você saiu da reunião.' })
      }}
    />
  )
}
