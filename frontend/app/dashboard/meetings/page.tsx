'use client'

import React, { useEffect, useMemo } from 'react'
import { Video } from 'lucide-react'
import { useMeetingStore } from '@/store/useMeetingStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { MeetingsList } from '@/components/meetings/MeetingsList'
import { CreateMeetingDropdown } from '@/components/meetings/CreateMeetingDropdown'
import { JoinByCodeInput } from '@/components/meetings/JoinByCodeInput'

const MONO_FONT = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const

export default function MeetingsPage() {
  const { meetings, isLoading, fetchMeetings } = useMeetingStore()
  const { activeWorkspace } = useWorkspaceStore()
  const isPersonal = activeWorkspace?.workspace_type === 'personal'

  useEffect(() => {
    fetchMeetings()
  }, [fetchMeetings])

  const active = useMemo(() => meetings.filter((m) => m.status === 'active'), [meetings])
  const scheduled = useMemo(() => meetings.filter((m) => m.status === 'scheduled'), [meetings])
  const ended = useMemo(() => meetings.filter((m) => m.status === 'ended'), [meetings])

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1
            className="text-xl font-bold text-heading flex items-center gap-2"
            style={MONO_FONT}
          >
            <Video size={20} className="text-[#ff6b2c]" />
            Reuniões
          </h1>
          <p className="text-sm text-subtle mt-1">
            Crie e participe de reuniões por vídeo com membros do workspace e convidados.
          </p>
        </div>
        <CreateMeetingDropdown />
      </div>

      <div className="glass-card p-4">
        <p className="text-[11px] font-semibold tracking-wider uppercase text-subtle mb-2" style={MONO_FONT}>
          Entrar com código
        </p>
        <JoinByCodeInput />
      </div>

      {!isPersonal && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-heading" style={MONO_FONT}>
            Em andamento
          </h2>
          <MeetingsList
            meetings={active}
            emptyLabel={
              isLoading ? 'Carregando…' : 'Nenhuma reunião em andamento no workspace.'
            }
          />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-heading" style={MONO_FONT}>
          Agendadas
        </h2>
        <MeetingsList
          meetings={scheduled}
          emptyLabel={isLoading ? 'Carregando…' : 'Nenhuma reunião agendada.'}
        />
      </section>

      {ended.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-heading" style={MONO_FONT}>
            Histórico
          </h2>
          <MeetingsList meetings={ended.slice(0, 20)} />
        </section>
      )}
    </div>
  )
}
