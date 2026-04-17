'use client'

import React, { useState } from 'react'
import { LiveKitRoom, RoomAudioRenderer } from '@livekit/components-react'
import '@livekit/components-styles'
import { RoomShell } from '@/components/meetings/RoomShell'
import { ChatEventListener } from '@/components/meetings/ChatEventListener'

interface Props {
  token: string
  serverUrl: string
  isHost: boolean
  isGuest: boolean
  meetingId: string
  displayName: string
  audioEnabled?: boolean
  videoEnabled?: boolean
  onLeave: () => void
  onEnd?: () => void
  title?: string
}

export function MeetingRoom({
  token,
  serverUrl,
  isHost,
  isGuest,
  meetingId,
  displayName,
  audioEnabled = true,
  videoEnabled = true,
  onLeave,
  onEnd,
  title,
}: Props) {
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const hasConnectedRef = React.useRef(false)

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
              <code className="text-[#ff6b2c]">{serverUrl}</code>
            </p>
            <p className="mb-1">
              <strong className="text-heading">Passos para diagnóstico:</strong>
            </p>
            <ol className="list-decimal list-inside space-y-0.5 text-[11px]">
              <li>Confira se o container LiveKit está up: <code>docker compose ps livekit</code></li>
              <li>Teste manualmente: <code>curl http://localhost:7880/</code> deve retornar HTTP 200</li>
              <li>URL acima deve ser <code>ws://localhost:7880</code>, não <code>ws://livekit:7880</code></li>
              <li>Se estiver errada: reinicie o backend (<code>cargo run</code>) e o frontend (<code>yarn dev</code>) após alterar <code>.env</code></li>
            </ol>
          </div>
          <button onClick={onLeave} className="btn-neu text-sm mt-2">
            Voltar
          </button>
        </div>
      </div>
    )
  }

  return (
    <LiveKitRoom
      serverUrl={serverUrl}
      token={token}
      connect={true}
      audio={audioEnabled}
      video={videoEnabled}
      onConnected={() => {
        console.log('[MeetingRoom] LiveKit connected to', serverUrl)
        hasConnectedRef.current = true
      }}
      onError={(err) => {
        console.error('[MeetingRoom] LiveKit error', err, 'serverUrl:', serverUrl)
        if (!hasConnectedRef.current) {
          setConnectionError(err.message || 'Erro ao conectar ao servidor de mídia.')
        }
      }}
      onDisconnected={() => {
        if (hasConnectedRef.current) {
          onLeave()
        } else {
          setConnectionError('A conexão com o servidor de mídia foi encerrada antes de ser estabelecida.')
        }
      }}
      data-lk-theme="default"
      className="fixed inset-0 z-[100] flex flex-col bg-app"
    >
      <RoomAudioRenderer />
      <ChatEventListener meetingId={meetingId} />
      <RoomShell
        isHost={isHost}
        isGuest={isGuest}
        meetingId={meetingId}
        displayName={displayName}
        title={title}
        onLeave={onLeave}
        onEnd={onEnd}
      />
    </LiveKitRoom>
  )
}
