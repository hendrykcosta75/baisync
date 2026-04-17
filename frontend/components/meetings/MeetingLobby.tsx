'use client'

import React, { useEffect, useState } from 'react'
import { Mic, MicOff, Video, VideoOff } from 'lucide-react'
import '@livekit/components-styles'

const MONO_FONT = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const
const NEU_SHADOW =
  '4px 4px 10px rgba(0,0,0,0.5), -2px -2px 8px rgba(255,255,255,0.04)'

interface Props {
  title?: string
  nameRequired?: boolean
  defaultName?: string
  isJoining?: boolean
  joinLabel?: string
  onJoin: (opts: { displayName: string; audioEnabled: boolean; videoEnabled: boolean }) => void
  onCancel?: () => void
}

export function MeetingLobby({
  title = 'Pronto para entrar?',
  nameRequired = false,
  defaultName = '',
  isJoining = false,
  joinLabel = 'Entrar agora',
  onJoin,
  onCancel,
}: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [name, setName] = useState(defaultName)
  const [nameError, setNameError] = useState<string | null>(null)
  const videoRef = React.useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let cancelled = false
    let currentStream: MediaStream | null = null

    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        currentStream = s
        setStream(s)
        if (videoRef.current) {
          videoRef.current.srcObject = s
        }
      })
      .catch((err) => {
        console.warn('getUserMedia failed', err)
      })

    return () => {
      cancelled = true
      currentStream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => {
    if (!stream) return
    stream.getVideoTracks().forEach((t) => (t.enabled = videoEnabled))
  }, [stream, videoEnabled])

  useEffect(() => {
    if (!stream) return
    stream.getAudioTracks().forEach((t) => (t.enabled = audioEnabled))
  }, [stream, audioEnabled])

  const handleJoin = () => {
    const trimmed = name.trim()
    if (nameRequired && !trimmed) {
      setNameError('Por favor, informe seu nome')
      return
    }
    setNameError(null)
    onJoin({ displayName: trimmed, audioEnabled, videoEnabled })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-app px-4">
      <div className="max-w-3xl w-full flex flex-col md:flex-row gap-6 items-center">
        {/* Camera preview */}
        <div className="relative aspect-video w-full md:flex-1 bg-black rounded-2xl overflow-hidden border border-dim">
          {videoEnabled ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-subtle">
              <div className="flex flex-col items-center gap-2">
                <VideoOff size={36} />
                <span className="text-xs" style={MONO_FONT}>Câmera desligada</span>
              </div>
            </div>
          )}

          {/* Floating controls — neumorphic round */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
            <button
              onClick={() => setAudioEnabled((v) => !v)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-[0.97] ${
                audioEnabled
                  ? 'bg-raised text-body hover:text-heading'
                  : 'bg-red-500 text-white hover:bg-red-600'
              }`}
              style={{ boxShadow: NEU_SHADOW }}
              aria-label={audioEnabled ? 'Desligar microfone' : 'Ligar microfone'}
            >
              {audioEnabled ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
            <button
              onClick={() => setVideoEnabled((v) => !v)}
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 active:scale-[0.97] ${
                videoEnabled
                  ? 'bg-raised text-body hover:text-heading'
                  : 'bg-red-500 text-white hover:bg-red-600'
              }`}
              style={{ boxShadow: NEU_SHADOW }}
              aria-label={videoEnabled ? 'Desligar câmera' : 'Ligar câmera'}
            >
              {videoEnabled ? <Video size={16} /> : <VideoOff size={16} />}
            </button>
          </div>
        </div>

        {/* Join panel */}
        <div className="w-full md:w-80 flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-bold text-heading" style={MONO_FONT}>
              {title}
            </h1>
            <p className="text-sm text-subtle mt-1">
              {nameRequired
                ? 'Digite seu nome para entrar na reunião.'
                : 'Verifique seu microfone e câmera antes de entrar.'}
            </p>
          </div>

          {nameRequired && (
            <div className="flex flex-col gap-1.5">
              <label
                className="text-subtle text-xs font-medium block"
                style={MONO_FONT}
              >
                Seu nome
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Maria Silva"
                className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm
                           placeholder:text-subtle/50
                           focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20
                           transition-all duration-200 outline-none w-full"
              />
              {nameError && <p className="text-xs text-red-400">{nameError}</p>}
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={isJoining}
            className="btn-neu btn-neu-lg w-full"
          >
            {isJoining ? 'Entrando…' : joinLabel}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={isJoining}
              className="btn-neu-ghost text-sm w-full"
            >
              Cancelar
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
