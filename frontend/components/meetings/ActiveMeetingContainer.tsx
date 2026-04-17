'use client'

import React, { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import '@livekit/components-styles'
import { RoomShell } from '@/components/meetings/RoomShell'
import { MiniMeetingWidget } from '@/components/meetings/MiniMeetingWidget'
import { ChatEventListener } from '@/components/meetings/ChatEventListener'
import { ChatMessageToast } from '@/components/meetings/ChatMessageToast'
import { useActiveMeetingStore } from '@/store/useActiveMeetingStore'
import { useMeetingStore } from '@/store/useMeetingStore'

export function ActiveMeetingContainer() {
  const active = useActiveMeetingStore((s) => s.active)
  const isMinimized = useActiveMeetingStore((s) => s.isMinimized)
  const minimize = useActiveMeetingStore((s) => s.minimize)
  const restore = useActiveMeetingStore((s) => s.restore)
  const stop = useActiveMeetingStore((s) => s.stop)
  const end = useMeetingStore((s) => s.end)
  const pathname = usePathname()
  const router = useRouter()

  const [connectionError, setConnectionError] = useState<string | null>(null)
  const hasConnectedRef = React.useRef(false)
  const markEnded = useMeetingStore((s) => s.markEnded)

  useEffect(() => {
    hasConnectedRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConnectionError(null)
  }, [active?.meetingId])

  useEffect(() => {
    if (!active) return
    const currentMeetingId = active.meetingId
    const currentCode = active.code
    const handler = (evt: Event) => {
      const detail = (evt as CustomEvent).detail
      if (detail?.meeting_id === currentMeetingId) {
        markEnded(currentMeetingId)
        stop()
        if (pathname === `/dashboard/meetings/${currentCode}`) {
          router.push('/dashboard/meetings')
        }
      }
    }
    window.addEventListener('sse:meeting_ended', handler)
    return () => window.removeEventListener('sse:meeting_ended', handler)
  }, [active, markEnded, stop, pathname, router])

  if (!active) return null

  const roomRoute = `/dashboard/meetings/${active.code}`
  const isOnRoomRoute = pathname === roomRoute
  const showFullscreen = isOnRoomRoute && !isMinimized
  const showMini = !showFullscreen

  const handleLeave = () => {
    stop()
    if (isOnRoomRoute) router.push('/dashboard/meetings')
  }

  const handleEnd = async () => {
    try {
      await end(active.meetingId)
    } catch (e) {
      console.warn('end meeting failed', e)
    }
    stop()
    if (isOnRoomRoute) router.push('/dashboard/meetings')
  }

  const handleMaximize = () => {
    restore()
    if (!isOnRoomRoute) router.push(roomRoute)
  }

  if (connectionError) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-app px-4">
        <div className="max-w-lg text-center flex flex-col items-center gap-3">
          <h1
            className="text-xl font-bold text-heading"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Não foi possível conectar à reunião
          </h1>
          <p className="text-sm text-red-400">{connectionError}</p>
          <div className="text-xs text-subtle text-left glass-card p-3 w-full">
            <p className="mb-2">
              <strong className="text-heading">URL tentada:</strong>{' '}
              <code className="text-[#ff6b2c]">{active.livekitUrl}</code>
            </p>
            <p className="mb-1">
              <strong className="text-heading">Passos para diagnóstico:</strong>
            </p>
            <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
              <li>Confira se o container LiveKit está up: <code>docker compose ps livekit</code></li>
              <li>Teste manualmente: <code>curl http://localhost:7880/</code> deve retornar HTTP 200</li>
              <li>URL acima deve ser <code>ws://localhost:7880</code>, não <code>ws://livekit:7880</code></li>
              <li>Se estiver errada: reinicie o backend e o frontend após alterar <code>.env</code></li>
            </ol>
          </div>
          <button onClick={handleLeave} className="btn-neu text-sm mt-2">
            Voltar
          </button>
        </div>
      </div>
    )
  }

  return (
    <LiveKitRoom
      serverUrl={active.livekitUrl}
      token={active.token}
      connect={true}
      audio={active.audioEnabled}
      video={active.videoEnabled}
      onConnected={() => {
        console.log('[ActiveMeeting] connected to', active.livekitUrl)
        hasConnectedRef.current = true
      }}
      onError={(err) => {
        console.error('[ActiveMeeting] error', err, 'serverUrl:', active.livekitUrl)
        if (!hasConnectedRef.current) {
          setConnectionError(err.message || 'Erro ao conectar ao servidor de mídia.')
        }
      }}
      onDisconnected={() => {
        if (hasConnectedRef.current) {
          stop()
        } else {
          setConnectionError('A conexão com o servidor de mídia foi encerrada antes de ser estabelecida.')
        }
      }}
      data-lk-theme="default"
      className={
        showFullscreen
          ? 'fixed inset-0 z-[100] flex flex-col bg-app'
          : 'contents'
      }
    >
      <RoomAudioRenderer />
      <ChatEventListener meetingId={active.meetingId} />
      {showFullscreen && (
        <RoomShell
          isHost={active.isHost}
          isGuest={active.isGuest}
          meetingId={active.meetingId}
          displayName={active.displayName}
          title={active.title}
          onLeave={handleLeave}
          onEnd={active.isHost ? handleEnd : undefined}
          onMinimize={minimize}
        />
      )}
      {showMini && (
        <>
          <MiniMeetingWidget
            title={active.title}
            onMaximize={handleMaximize}
            onLeave={handleLeave}
          />
          <ChatMessageToast
            meetingId={active.meetingId}
            onOpenChat={handleMaximize}
          />
        </>
      )}
    </LiveKitRoom>
  )
}
