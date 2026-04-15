'use client'

import React, { useEffect, useRef, useCallback } from 'react'
import { useTeamStore } from '@/store/useTeamStore'
import { Activity } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const ACTION_MAP: Record<string, { label: string; color: string }> = {
  task_created: { label: 'criou a tarefa', color: '#22c55e' },
  task_updated: { label: 'atualizou a tarefa', color: '#3b82f6' },
  task_moved: { label: 'moveu a tarefa', color: '#f59e0b' },
  task_deleted: { label: 'excluiu a tarefa', color: '#ef4444' },
  task_assigned: { label: 'atribuiu a tarefa', color: '#8b5cf6' },
  member_added: { label: 'adicionou membro', color: '#22c55e' },
  member_removed: { label: 'removeu membro', color: '#ef4444' },
  comment_added: { label: 'comentou na tarefa', color: '#3b82f6' },
  team_created: { label: 'criou a equipe', color: '#ff6b2c' },
  okr_check_in: { label: 'fez check-in no OKR', color: '#8b5cf6' },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  if (hours < 24) return `há ${hours}h`
  if (days < 7) return `há ${days}d`
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function ActivityTab({ teamId }: { teamId: string }) {
  const { activity, activityCursor, fetchActivity } = useTeamStore()
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchActivity(teamId)
  }, [teamId, fetchActivity])

  // Infinite scroll
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0]?.isIntersecting && activityCursor) {
        fetchActivity(teamId, activityCursor)
      }
    },
    [teamId, activityCursor, fetchActivity]
  )

  useEffect(() => {
    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 })
    if (sentinelRef.current) observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [handleIntersect])

  return (
    <div className="space-y-1">
      {activity.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Activity size={24} className="text-subtle mb-3" />
          <p className="text-subtle text-sm">Nenhuma atividade registrada</p>
        </div>
      ) : (
        <div className="relative pl-6">
          {/* Timeline line */}
          <div className="absolute left-[11px] top-2 bottom-2 w-px bg-dim" />

          {activity.map((entry, i) => {
            const action = ACTION_MAP[entry.action] || { label: entry.action, color: '#888' }
            return (
              <div
                key={entry.id}
                className="relative flex items-start gap-3 py-3 animate-fade-in-up opacity-0"
                style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'forwards' }}
              >
                {/* Dot */}
                <div
                  className="absolute left-[-13px] top-[18px] w-[10px] h-[10px] rounded-full border-2"
                  style={{ backgroundColor: '#0a0a0a', borderColor: action.color }}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm">
                    <span className="text-heading font-medium">{entry.actor_name}</span>
                    <span className="text-subtle"> {action.label} </span>
                    {entry.entity_name && (
                      <span className="text-body font-medium">&ldquo;{entry.entity_name}&rdquo;</span>
                    )}
                  </p>
                  {entry.details && (
                    <p className="text-subtle text-xs mt-0.5">{entry.details}</p>
                  )}
                </div>

                {/* Time */}
                <span className="text-subtle text-[10px] shrink-0 mt-1" style={{ fontFamily: mono }}>
                  {relativeTime(entry.created_at)}
                </span>
              </div>
            )
          })}

          <div ref={sentinelRef} className="h-4" />
        </div>
      )}
    </div>
  )
}
