'use client'

import React from 'react'
import {
  ParticipantTile,
  useIsSpeaking,
  useTrackMutedIndicator,
  useTracks,
} from '@livekit/components-react'
import type { TrackReference } from '@livekit/components-core'
import { Track, type Participant } from 'livekit-client'
import { Maximize2, Mic, MicOff, MonitorUp, VideoOff } from 'lucide-react'

const MONO_FONT = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const

function initials(name: string): string {
  const clean = name.trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function colorFromIdentity(identity: string): string {
  let hash = 0
  for (let i = 0; i < identity.length; i++) {
    hash = (hash * 31 + identity.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 45%, 28%)`
}

function MicStatusBadge({ muted }: { muted: boolean }) {
  return (
    <span
      className={`inline-flex items-center justify-center w-6 h-6 rounded-md backdrop-blur-sm transition-colors duration-200 ${
        muted ? 'bg-red-500/85 text-white' : 'bg-green-500/85 text-white'
      }`}
      aria-label={muted ? 'Microfone desligado' : 'Microfone ligado'}
      title={muted ? 'Microfone desligado' : 'Microfone ligado'}
    >
      {muted ? <MicOff size={12} /> : <Mic size={12} />}
    </span>
  )
}

interface MutedProbeProps {
  trackRef: TrackReference
  onChange: (identity: string, muted: boolean) => void
}

function MicMutedProbe({ trackRef, onChange }: MutedProbeProps) {
  const { isMuted } = useTrackMutedIndicator(trackRef)
  const identity = trackRef.participant.identity
  React.useEffect(() => {
    onChange(identity, isMuted)
  }, [identity, isMuted, onChange])
  return null
}

function CamMutedProbe({ trackRef, onChange }: MutedProbeProps) {
  const { isMuted } = useTrackMutedIndicator(trackRef)
  const identity = trackRef.participant.identity
  React.useEffect(() => {
    onChange(identity, isMuted)
  }, [identity, isMuted, onChange])
  return null
}

interface TileWrapperProps {
  participant: Participant
  micMuted: boolean
  children: React.ReactNode
  label: string
  isScreenShare: boolean
}

function TileWrapper({
  participant,
  micMuted,
  children,
  label,
  isScreenShare,
}: TileWrapperProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const isSpeaking = useIsSpeaking(participant)

  const toggleFullscreen = async () => {
    const el = ref.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else {
        await el.requestFullscreen()
      }
    } catch (e) {
      console.warn('fullscreen toggle failed', e)
    }
  }

  const showSpeaking = !isScreenShare && isSpeaking && !micMuted

  const speakingClasses = showSpeaking
    ? 'border-[#ff6b2c] shadow-[0_0_0_2px_rgba(255,107,44,0.35),0_0_24px_rgba(255,107,44,0.25)]'
    : 'border-dim'

  return (
    <div
      ref={ref}
      className={`group relative rounded-xl overflow-hidden border bg-surface min-h-0 aspect-video w-full transition-all duration-200 fullscreen:aspect-auto fullscreen:h-screen fullscreen:w-screen fullscreen:rounded-none ${speakingClasses}`}
    >
      {children}
      {isScreenShare && (
        <div
          className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ff6b2c]/90 text-white text-[10px] font-semibold pointer-events-none"
          style={MONO_FONT}
        >
          <MonitorUp size={11} /> Compartilhando tela
        </div>
      )}
      <button
        onClick={toggleFullscreen}
        className={`absolute top-2 right-2 w-8 h-8 rounded-md flex items-center justify-center bg-black/55 backdrop-blur-sm text-white transition-all duration-200 hover:bg-black/75 active:scale-[0.95] ${
          isScreenShare ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
        }`}
        aria-label="Maximizar vídeo"
        title="Expandir em tela cheia"
      >
        <Maximize2 size={14} />
      </button>
      <div
        className="absolute bottom-2 left-2 right-2 flex items-center justify-between gap-2 text-[11px] text-heading pointer-events-none"
        style={MONO_FONT}
      >
        <span className="px-2 py-0.5 rounded-md bg-black/55 backdrop-blur-sm truncate max-w-[70%]">
          {label}
        </span>
        {!isScreenShare && <MicStatusBadge muted={micMuted} />}
      </div>
      {showSpeaking && (
        <span
          className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#ff6b2c]/90 text-white text-[10px] font-semibold pointer-events-none"
          style={MONO_FONT}
          aria-hidden="true"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inset-0 rounded-full bg-white animate-ping opacity-75" />
            <span className="relative rounded-full bg-white h-2 w-2" />
          </span>
          Falando
        </span>
      )}
    </div>
  )
}

export function ParticipantGrid() {
  const mediaTracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  )

  const micTracks = useTracks([Track.Source.Microphone], { onlySubscribed: false })

  const micTrackRefs = React.useMemo(
    () => micTracks.filter((t) => Boolean(t.publication)) as TrackReference[],
    [micTracks]
  )

  const camTrackRefs = React.useMemo(
    () =>
      mediaTracks.filter(
        (t) => t.source === Track.Source.Camera && Boolean(t.publication)
      ) as TrackReference[],
    [mediaTracks]
  )

  const [mutedMap, setMutedMap] = React.useState<Record<string, boolean>>({})
  const [camMutedMap, setCamMutedMap] = React.useState<Record<string, boolean>>({})

  const handleMuteChange = React.useCallback((identity: string, muted: boolean) => {
    setMutedMap((prev) => (prev[identity] === muted ? prev : { ...prev, [identity]: muted }))
  }, [])

  const handleCamMuteChange = React.useCallback((identity: string, muted: boolean) => {
    setCamMutedMap((prev) => (prev[identity] === muted ? prev : { ...prev, [identity]: muted }))
  }, [])

  const count = mediaTracks.length || 1
  const cols = count === 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4

  return (
    <>
      {micTrackRefs.map((t) => (
        <MicMutedProbe
          key={`mic-${t.participant.identity}-${t.publication?.trackSid ?? 'x'}`}
          trackRef={t}
          onChange={handleMuteChange}
        />
      ))}
      {camTrackRefs.map((t) => (
        <CamMutedProbe
          key={`cam-${t.participant.identity}-${t.publication?.trackSid ?? 'x'}`}
          trackRef={t}
          onChange={handleCamMuteChange}
        />
      ))}
      <div
        className="h-full w-full grid gap-2 p-2 content-center place-items-stretch"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: 'minmax(180px, 1fr)',
        }}
      >
        {mediaTracks.map((track) => {
          const hasPublication = Boolean(track.publication)
          const isScreenShare = track.source === Track.Source.ScreenShare
          const name =
            track.participant.name ||
            track.participant.identity ||
            'Participante'
          const id = track.participant.identity || name
          const displayLabel = isScreenShare ? `Tela de ${name}` : name
          const hasMicTrack = mutedMap[id] !== undefined
          const micMuted = !hasMicTrack || mutedMap[id]
          const camMuted = camMutedMap[id] ?? track.publication?.isMuted ?? false
          const showVideo = hasPublication && (isScreenShare || !camMuted)

          return (
            <TileWrapper
              key={`${id}-${track.source}-${track.publication?.trackSid ?? 'placeholder'}`}
              participant={track.participant}
              micMuted={micMuted}
              label={displayLabel}
              isScreenShare={isScreenShare}
            >
              {showVideo ? (
                <ParticipantTile
                  trackRef={track}
                  className="absolute inset-0 w-full h-full"
                  disableSpeakingIndicator
                />
              ) : (
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-3"
                  style={{
                    background: `linear-gradient(135deg, ${colorFromIdentity(id)}, #161616)`,
                  }}
                >
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center bg-black/40 text-heading text-lg font-bold"
                    style={MONO_FONT}
                  >
                    {initials(name)}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-subtle" style={MONO_FONT}>
                    <VideoOff size={12} />
                    <span className="truncate max-w-[180px]">{name}</span>
                  </div>
                </div>
              )}
            </TileWrapper>
          )
        })}
      </div>
    </>
  )
}
