'use client'

import React, { useState } from 'react'
import { useTeamStore } from '@/store/useTeamStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { Plus, X, Shield, User, Users } from 'lucide-react'
import { useToastStore } from '@/store/useToastStore'
import { ApiError } from '@/lib/api'
import { UserAvatar } from '@/components/user-avatar'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function MembersTab({ teamId }: { teamId: string }) {
  const { members, addMember, removeMember } = useTeamStore()
  const { members: wsMembers, fetchMembers: fetchWsMembers, activeWorkspace } = useWorkspaceStore()
  const addToast = useToastStore((s) => s.addToast)
  const [showAddMenu, setShowAddMenu] = useState(false)

  const handleAddClick = async () => {
    if (activeWorkspace?.workspace_id && wsMembers.length === 0) {
      await fetchWsMembers(activeWorkspace.workspace_id)
    }
    setShowAddMenu(!showAddMenu)
  }

  const availableMembers = wsMembers.filter(
    (wm) => !members.some((m) => m.user_id === wm.user_id)
  )

  const getWorkloadColor = (open: number) => {
    if (open > 10) return '#ef4444'
    if (open >= 5) return '#f59e0b'
    return '#22c55e'
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-heading text-base font-semibold" style={{ fontFamily: mono }}>
          Membros da Equipe
        </h3>
        <div className="relative">
          <button className="btn-neu text-sm px-3 py-2 rounded-[10px] flex items-center gap-1.5" onClick={handleAddClick}>
            <Plus size={14} />
            Adicionar Membro
          </button>
          {showAddMenu && (
            <div
              className="absolute right-0 top-full mt-2 w-64 rounded-xl overflow-hidden z-20"
              style={{ background: '#141414', border: '1px solid #1e1e1e', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
            >
              {availableMembers.length === 0 ? (
                <div className="px-4 py-3 text-subtle text-sm">Todos os membros já foram adicionados</div>
              ) : (
                availableMembers.map((wm) => (
                  <button
                    key={wm.user_id}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-left hover:bg-dim transition-colors"
                    onClick={async () => {
                      try {
                        await addMember(teamId, wm.user_id)
                        setShowAddMenu(false)
                      } catch (err) {
                        const msg = err instanceof ApiError ? err.message : 'Erro ao adicionar membro'
                        addToast('error', msg)
                      }
                    }}
                  >
                    <UserAvatar userId={wm.user_id} name={wm.user_name || wm.user_email} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-heading text-sm truncate">{wm.user_name || 'Usuário'}</p>
                      <p className="text-subtle text-[10px] truncate">{wm.user_email}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Members list */}
      <div className="space-y-1">
        {members.map((m) => {
          const open = m.task_count?.open ?? 0
          const done = m.task_count?.done ?? 0
          const assigned = m.task_count?.assigned ?? 0
          const workloadColor = getWorkloadColor(open)

          return (
            <div
              key={m.user_id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl transition-colors hover:bg-dim/30"
              style={{ background: '#141414', border: '1px solid #1e1e1e' }}
            >
              {/* Avatar */}
              <UserAvatar userId={m.user_id} name={m.user_name || m.user_email} size={36} />

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-heading text-sm font-medium truncate">{m.user_name || 'Usuário'}</p>
                  <span
                    className="px-1.5 py-0.5 rounded text-[10px] font-medium flex items-center gap-1"
                    style={{
                      background: m.role === 'leader' ? 'rgba(255,107,44,0.12)' : 'rgba(255,255,255,0.04)',
                      color: m.role === 'leader' ? '#D4835A' : '#888',
                    }}
                  >
                    {m.role === 'leader' ? <Shield size={9} /> : <User size={9} />}
                    {m.role === 'leader' ? 'Líder' : 'Membro'}
                  </span>
                </div>
                <p className="text-subtle text-xs mt-0.5">{m.user_email}</p>
              </div>

              {/* Workload bar */}
              <div className="w-24 shrink-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-subtle text-[10px]">{assigned} tarefas</span>
                  <span className="text-[10px]" style={{ color: workloadColor }}>{open} abertas</span>
                </div>
                <div className="h-1.5 rounded-full bg-dim overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: assigned > 0 ? `${Math.min(100, (done / assigned) * 100)}%` : '0%',
                      backgroundColor: workloadColor,
                    }}
                  />
                </div>
              </div>

              {/* Remove */}
              {m.role !== 'leader' && (
                <button
                  className="text-subtle hover:text-red-400 transition-colors shrink-0"
                  onClick={async () => {
                    try {
                      await removeMember(teamId, m.user_id)
                    } catch (err) {
                      const msg = err instanceof ApiError ? err.message : 'Erro ao remover membro'
                      addToast('error', msg)
                    }
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )
        })}

        {members.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users size={24} className="text-subtle mb-3" />
            <p className="text-subtle text-sm">Nenhum membro na equipe</p>
          </div>
        )}
      </div>
    </div>
  )
}
