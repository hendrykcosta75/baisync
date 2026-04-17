'use client'

import React from 'react'
import {
  ParticipantTile,
  useLocalParticipant,
  useRoomContext,
  useTracks,
} from '@livekit/components-react'
import { Track } from 'livekit-client'
import { Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'

const MONO_FONT = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const
const NEU_SHADOW_SM =
  '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)'
const NEU_SHADOW =
  '4px 4px 10px rgba(0,0,0,0.5), -2px -2px 8px rgba(255,255,255,0.04)'

interface Props {
  title: string
  onMaximize: () => void
  onLeave: () => void
}

export function MiniMeetingWidget({ title, onMaximize, onLeave }: Props) {
  const { localParticipant } = useLocalParticipant()
  const room = useRoomContext()
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  )

  const [micOn, setMicOn] = React.useState(localParticipant?.isMicrophoneEnabled ?? true)
  const [camOn, setCamOn] = React.useState(localParticipant?.isCameraEnabled ?? true)

  const featured = tracks.find((t) => t.source === Track.Source.ScreenShare) ?? tracks[0]

  const toggleMic = async () => {
    const next = !micOn
    await localParticipant?.setMicrophoneEnabled(next)
    setMicOn(next)
  }
  const toggleCam = async () => {
    const next = !camOn
    await localParticipant?.setCameraEnabled(next)
    setCamOn(next)
  }
  const handleLeave = () => {
    room?.disconnect()
    onLeave()
  }

  const iconBtnBase =
    'w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200 active:scale-[0.97]'

  return (
    <div
      className="fixed bottom-20 right-6 z-[90] w-[280px] rounded-xl overflow-hidden border border-dim bg-surface flex flex-col"
      style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)' }}
    >
      <div className="flex items-center justify-between px-3 h-8 bg-raised border-b border-dim">
        <span className="text-[11px] font-semibold text-heading truncate" style={MONO_FONT}>
          {title || 'Reunião'}
        </span>
        <button
          onClick={onMaximize}
          className="w-6 h-6 rounded-md flex items-center justify-center text-subtle hover:text-[#ff6b2c] transition-colors duration-200"
          aria-label="Maximizar"
          title="Voltar para tela cheia"
        >
          <Maximize2 size={13} />
        </button>
      </div>
      <div className="relative aspect-video bg-black">
        {featured ? (
          <ParticipantTile
            trackRef={featured}
            className="w-full h-full"
            disableSpeakingIndicator
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-subtle" style={MONO_FONT}>
            Conectando…
          </div>
        )}
      </div>
      <div className="flex items-center justify-center gap-2 p-2 bg-surface border-t border-dim">
        <button
          onClick={toggleMic}
          className={`${iconBtnBase} ${micOn ? 'bg-raised text-body hover:text-heading' : 'bg-red-500 text-white'}`}
          style={{ boxShadow: NEU_SHADOW_SM }}
          aria-label="Microfone"
        >
          {micOn ? <Mic size={13} /> : <MicOff size={13} />}
        </button>
        <button
          onClick={toggleCam}
          className={`${iconBtnBase} ${camOn ? 'bg-raised text-body hover:text-heading' : 'bg-red-500 text-white'}`}
          style={{ boxShadow: NEU_SHADOW_SM }}
          aria-label="Câmera"
        >
          {camOn ? <Video size={13} /> : <VideoOff size={13} />}
        </button>
        <button
          onClick={handleLeave}
          className={`${iconBtnBase} bg-red-500 text-white hover:bg-red-600`}
          style={{ boxShadow: NEU_SHADOW }}
          aria-label="Sair"
          title="Sair da reunião"
        >
          <PhoneOff size={13} />
        </button>
      </div>
    </div>
  )
}
