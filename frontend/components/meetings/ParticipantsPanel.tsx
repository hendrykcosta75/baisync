'use client'

import React from 'react'
import { useParticipants } from '@livekit/components-react'
import { useMeetingStore } from '@/store/useMeetingStore'
import { Button } from '@heroui/react'
import { Hand, X } from 'lucide-react'

interface Props {
  isHost: boolean
  meetingId: string
  onClose: () => void
}

export function ParticipantsPanel({ isHost, meetingId, onClose }: Props) {
  const participants = useParticipants()
  const { pendingKnocks, approveGuest, denyGuest } = useMeetingStore()
  const knocksForMeeting = pendingKnocks.filter((k) => k.meetingId === meetingId)

  return (
    <aside className="w-80 flex flex-col bg-[#0f0f0f] border-l border-[#1f1f1f]">
      <header className="flex items-center justify-between px-4 h-12 border-b border-[#1f1f1f]">
        <h3 className="text-sm font-semibold text-heading">
          Participantes ({participants.length})
        </h3>
        <button onClick={onClose} className="text-subtle hover:text-heading">
          <X size={16} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {isHost && knocksForMeeting.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-yellow-500 px-2 mb-1 flex items-center gap-1">
              <Hand size={12} />
              Aguardando aprovação ({knocksForMeeting.length})
            </p>
            <ul className="flex flex-col gap-1">
              {knocksForMeeting.map((k) => (
                <li
                  key={k.participantId}
                  className="flex items-center gap-2 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30"
                >
                  <div className="w-7 h-7 rounded-full bg-yellow-500/20 text-yellow-500 text-xs font-semibold flex items-center justify-center">
                    {k.displayName.charAt(0).toUpperCase()}
                  </div>
                  <span className="flex-1 text-sm text-heading truncate">{k.displayName}</span>
                  <Button
                    size="sm"
                    onPress={() => approveGuest(k.meetingId, k.participantId)}
                    className="bg-green-500 hover:bg-green-600 text-white text-xs h-7 px-2"
                  >
                    Aceitar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => denyGuest(k.meetingId, k.participantId)}
                    className="text-red-500 text-xs h-7 px-2"
                  >
                    Negar
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-xs font-semibold text-subtle px-2 mb-1">Na chamada</p>
        <ul className="flex flex-col">
          {participants.map((p) => (
            <li
              key={p.identity}
              className="flex items-center gap-2 p-2 rounded-lg hover:bg-[#151515]"
            >
              <div className="w-7 h-7 rounded-full bg-[#ff6b2c]/20 text-[#ff6b2c] text-xs font-semibold flex items-center justify-center">
                {(p.name || p.identity).charAt(0).toUpperCase()}
              </div>
              <span className="flex-1 text-sm text-heading truncate">
                {p.name || p.identity}
                {p.isLocal && <span className="text-subtle ml-1">(você)</span>}
              </span>
              {p.isMicrophoneEnabled ? null : (
                <span className="text-[10px] text-red-500">mic off</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}
