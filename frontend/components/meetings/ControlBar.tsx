'use client'

import React from 'react'
import {
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react'
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  MonitorUp,
  MessageSquare,
  Users,
  PhoneOff,
  X,
  Minimize2,
} from 'lucide-react'

const NEU_SHADOW =
  '4px 4px 10px rgba(0,0,0,0.5), -2px -2px 8px rgba(255,255,255,0.04)'

interface Props {
  isHost: boolean
  onToggleChat: () => void
  onToggleParticipants: () => void
  onLeave: () => void
  onEndForAll?: () => void
  onMinimize?: () => void
  chatOpen?: boolean
  participantsOpen?: boolean
  chatBadge?: number
  knockBadge?: number
}

export function ControlBar({
  isHost,
  onToggleChat,
  onToggleParticipants,
  onLeave,
  onEndForAll,
  onMinimize,
  chatOpen,
  participantsOpen,
  chatBadge = 0,
  knockBadge = 0,
}: Props) {
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant()
  const room = useRoomContext()

  const toggleMic = async () => {
    try {
      await localParticipant?.setMicrophoneEnabled(!isMicrophoneEnabled)
    } catch (e) {
      console.warn('mic toggle failed', e)
    }
  }

  const toggleCam = async () => {
    try {
      await localParticipant?.setCameraEnabled(!isCameraEnabled)
    } catch (e) {
      console.warn('cam toggle failed', e)
    }
  }

  const toggleScreen = async () => {
    try {
      await localParticipant?.setScreenShareEnabled(
        !isScreenShareEnabled,
        isScreenShareEnabled ? undefined : { audio: true, selfBrowserSurface: 'include' }
      )
    } catch (e) {
      console.warn('screen share toggle failed', e)
    }
  }

  const handleLeave = () => {
    room?.disconnect()
    onLeave()
  }

  const btnBase =
    'relative w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 active:scale-[0.97]'
  const btnNeu = 'bg-raised text-body hover:text-heading'
  const btnDanger = 'bg-red-500 text-white hover:bg-red-600'
  const btnActiveOrange = 'bg-[#ff6b2c] text-white hover:brightness-110'

  return (
    <div className="flex items-center justify-center gap-2 p-3 bg-surface border-t border-dim">
      <button
        onClick={toggleMic}
        className={`${btnBase} ${isMicrophoneEnabled ? btnNeu : btnDanger}`}
        style={{ boxShadow: NEU_SHADOW }}
        aria-label={isMicrophoneEnabled ? 'Desligar microfone' : 'Ligar microfone'}
        aria-pressed={!isMicrophoneEnabled}
      >
        {isMicrophoneEnabled ? <Mic size={18} /> : <MicOff size={18} />}
      </button>
      <button
        onClick={toggleCam}
        className={`${btnBase} ${isCameraEnabled ? btnNeu : btnDanger}`}
        style={{ boxShadow: NEU_SHADOW }}
        aria-label={isCameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
        aria-pressed={!isCameraEnabled}
      >
        {isCameraEnabled ? <Video size={18} /> : <VideoOff size={18} />}
      </button>
      <button
        onClick={toggleScreen}
        className={`${btnBase} ${isScreenShareEnabled ? btnActiveOrange : btnNeu}`}
        style={{ boxShadow: NEU_SHADOW }}
        aria-label="Compartilhar tela"
        aria-pressed={isScreenShareEnabled}
      >
        <MonitorUp size={18} />
      </button>
      <button
        onClick={onToggleChat}
        className={`${btnBase} ${chatOpen ? btnActiveOrange : btnNeu}`}
        style={{ boxShadow: NEU_SHADOW }}
        aria-label="Chat"
      >
        <MessageSquare size={18} />
        {chatBadge > 0 && (
          <span
            className="absolute -top-1 -right-1 text-[10px] font-bold bg-red-500 text-white rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            {chatBadge}
          </span>
        )}
      </button>
      <button
        onClick={onToggleParticipants}
        className={`${btnBase} ${participantsOpen ? btnActiveOrange : btnNeu}`}
        style={{ boxShadow: NEU_SHADOW }}
        aria-label="Participantes"
      >
        <Users size={18} />
        {knockBadge > 0 && (
          <span
            className="absolute -top-1 -right-1 text-[10px] font-bold bg-yellow-500 text-black rounded-full min-w-[16px] h-[16px] px-1 flex items-center justify-center"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            {knockBadge}
          </span>
        )}
      </button>
      {onMinimize && (
        <button
          onClick={onMinimize}
          className={`${btnBase} ${btnNeu}`}
          style={{ boxShadow: NEU_SHADOW }}
          aria-label="Minimizar"
          title="Minimizar reunião"
        >
          <Minimize2 size={18} />
        </button>
      )}

      <div className="w-px h-8 bg-dim mx-2" />

      <button
        onClick={handleLeave}
        className={`${btnBase} ${btnDanger}`}
        style={{ boxShadow: NEU_SHADOW }}
        aria-label="Sair"
        title="Sair da reunião"
      >
        <PhoneOff size={18} />
      </button>
      {isHost && onEndForAll && (
        <button
          onClick={onEndForAll}
          className="btn-neu text-sm !text-red-400 hover:!text-red-300 inline-flex items-center gap-1.5"
          aria-label="Encerrar para todos"
        >
          <X size={14} />
          Encerrar para todos
        </button>
      )}
    </div>
  )
}
