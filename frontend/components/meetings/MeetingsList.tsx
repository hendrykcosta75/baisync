'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Video, Clock, CheckCheck, Trash2, XCircle } from 'lucide-react'
import { useMeetingStore } from '@/store/useMeetingStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useToastStore } from '@/store/useToastStore'
import type { Meeting } from '@/types/meeting'

const MONO_FONT = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const

const NEU_ICON_SHADOW =
  '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)'

interface Props {
  meetings: Meeting[]
  emptyLabel?: string
}

function StatusBadge({ status }: { status: Meeting['status'] }) {
  const map = {
    active: 'text-green-500 border-green-500/30 bg-green-500/10',
    scheduled: 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10',
    ended: 'text-subtle border-dim bg-dim',
  } as const
  const label = {
    active: 'Em andamento',
    scheduled: 'Agendada',
    ended: 'Encerrada',
  } as const
  return (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md border ${map[status]}`}
      style={MONO_FONT}
    >
      {label[status]}
    </span>
  )
}

export function MeetingsList({ meetings, emptyLabel = 'Nenhuma reunião.' }: Props) {
  const router = useRouter()
  const { end, remove } = useMeetingStore()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const addToast = useToastStore((s) => s.addToast)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (meetings.length === 0) {
    return (
      <div
        className="text-center py-10 text-subtle text-sm border border-dashed border-dim rounded-xl"
        style={MONO_FONT}
      >
        {emptyLabel}
      </div>
    )
  }

  const copy = async (meeting: Meeting) => {
    try {
      await navigator.clipboard.writeText(meeting.shareUrl)
      setCopiedCode(meeting.code)
      setTimeout(() => setCopiedCode(null), 1500)
    } catch {
      // noop
    }
  }

  const handleCancel = async (meeting: Meeting) => {
    setBusyId(meeting.id)
    try {
      await end(meeting.id)
      addToast('success', `Reunião "${meeting.title || 'sem título'}" cancelada`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao cancelar reunião'
      addToast('error', msg)
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (meeting: Meeting) => {
    setBusyId(meeting.id)
    try {
      await remove(meeting.id)
      addToast('success', 'Reunião removida do histórico')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao excluir reunião'
      addToast('error', msg)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <ul className="flex flex-col gap-2">
      {meetings.map((m, i) => (
        <li
          key={m.id}
          className="group flex items-center gap-3 p-3 rounded-xl bg-surface border border-dim hover:border-[#ff6b2c]/30 transition-all duration-300 animate-fade-in-up opacity-0"
          style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
        >
          <div className="w-9 h-9 rounded-lg bg-raised text-[#ff6b2c] flex items-center justify-center shrink-0">
            <Video size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p
                className="text-sm font-semibold text-heading truncate"
                style={MONO_FONT}
              >
                {m.title || 'Reunião'}
              </p>
              <StatusBadge status={m.status} />
            </div>
            <div className="flex items-center gap-2 text-xs text-subtle mt-0.5" style={MONO_FONT}>
              <span>{m.code}</span>
              {m.scheduledStart && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {new Date(m.scheduledStart).toLocaleString('pt-BR', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => copy(m)}
              className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-raised text-subtle hover:text-[#ff6b2c] transition-all duration-200"
              style={{ boxShadow: NEU_ICON_SHADOW }}
              aria-label="Copiar link"
              title="Copiar link da reunião"
            >
              {copiedCode === m.code ? <CheckCheck size={14} /> : <Copy size={14} />}
            </button>
            {m.status !== 'ended' && (
              <button
                onClick={() => router.push(`/dashboard/meetings/${m.code}`)}
                className="btn-neu text-sm"
              >
                Entrar
              </button>
            )}
            {m.hostUserId === currentUserId && m.status !== 'ended' && (
              <button
                onClick={() => handleCancel(m)}
                disabled={busyId === m.id}
                className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-raised text-subtle hover:text-yellow-500 transition-all duration-200 disabled:opacity-40"
                style={{ boxShadow: NEU_ICON_SHADOW }}
                aria-label="Cancelar reunião"
                title={
                  m.status === 'active'
                    ? 'Cancelar reunião e expulsar todos os participantes'
                    : 'Cancelar reunião agendada'
                }
              >
                <XCircle size={14} />
              </button>
            )}
            {m.hostUserId === currentUserId && m.status !== 'active' && (
              <button
                onClick={() => handleDelete(m)}
                disabled={busyId === m.id}
                className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-raised text-subtle hover:text-red-500 transition-all duration-200 disabled:opacity-40"
                style={{ boxShadow: NEU_ICON_SHADOW }}
                aria-label="Remover do histórico"
                title="Remover do histórico"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
