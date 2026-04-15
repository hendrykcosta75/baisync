'use client'

import React, { useEffect, useState } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { Users, Shield, Crown, Trash2, Mail, UserPlus, AlertTriangle, X } from 'lucide-react'
import { UserAvatar } from '@/components/user-avatar'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const ROLE_CONFIG = {
  owner: {
    label: 'Proprietário',
    description: 'Acesso total. Pode gerenciar membros, permissões, API keys e deletar o workspace.',
    color: '#ff6b2c',
    bg: 'rgba(255,107,44,0.08)',
    icon: Crown,
  },
  admin: {
    label: 'Administrador',
    description: 'Pode gerenciar membros, canais, assistentes e API keys. Não pode deletar o workspace.',
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.08)',
    icon: Shield,
  },
  member: {
    label: 'Membro',
    description: 'Pode usar assistentes, enviar mensagens em canais e ver conversas.',
    color: '#8a8a8a',
    bg: 'rgba(255,255,255,0.03)',
    icon: Users,
  },
} as const

export function WorkspaceModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const {
    activeWorkspace,
    members,
    fetchMembers,
    inviteMember,
    removeMember,
    updateMemberRole,
    updateWorkspace,
    deleteWorkspace,
  } = useWorkspaceStore()

  const [tab, setTab] = useState<'members' | 'permissions'>('members')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [isInviting, setIsInviting] = useState(false)
  const [inviteFeedback, setInviteFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [wsName, setWsName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && activeWorkspace) {
      fetchMembers(activeWorkspace.workspace_id)
      setWsName(activeWorkspace.workspace_name)
    }
  }, [isOpen, activeWorkspace, fetchMembers])

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !activeWorkspace) return
    setIsInviting(true)
    setInviteFeedback(null)
    try {
      await inviteMember(activeWorkspace.workspace_id, inviteEmail.trim(), inviteRole)
      setInviteFeedback({ ok: true, msg: `Convite enviado para ${inviteEmail.trim()}` })
      setInviteEmail('')
    } catch {
      setInviteFeedback({ ok: false, msg: 'Falha ao enviar convite.' })
    } finally {
      setIsInviting(false)
      setTimeout(() => setInviteFeedback(null), 4000)
    }
  }

  const handleSaveName = async () => {
    if (!wsName.trim() || !activeWorkspace) return
    setSaving(true)
    try {
      await updateWorkspace(activeWorkspace.workspace_id, wsName.trim())
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const isPersonal = activeWorkspace?.workspace_type === 'personal'
  const isOwner = activeWorkspace?.role === 'owner'
  const canManage = isOwner || activeWorkspace?.role === 'admin'

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="rounded-xl border border-dim-hover w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        style={{ background: '#141414' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dim-hover shrink-0">
          <div>
            <h2 className="text-[15px] font-bold text-white" style={{ fontFamily: mono }}>
              {isPersonal ? 'Workspace Pessoal' : activeWorkspace?.workspace_name || 'Workspace'}
            </h2>
            <p className="text-[11px] text-[#5a5a5a] mt-0.5" style={{ fontFamily: mono }}>
              {isPersonal ? 'Seu perfil pessoal' : 'Membros e permissões'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#5a5a5a] hover:text-white hover:bg-dim-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Personal workspace — simple message */}
        {isPersonal && (
          <div className="p-6 text-center">
            <p className="text-[#5a5a5a] text-[13px]" style={{ fontFamily: mono }}>
              Este é seu workspace pessoal. Para colaborar com equipes, crie um workspace de empresa usando o seletor na sidebar.
            </p>
          </div>
        )}

        {/* Company workspace content */}
        {!isPersonal && (
          <>
            {/* Tabs */}
            <div className="flex border-b border-dim-hover px-5 shrink-0">
              {([
                { id: 'members' as const, label: 'Membros' },
                { id: 'permissions' as const, label: 'Permissões' },
              ]).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-4 py-2.5 text-[12px] font-medium border-b-2 transition-colors ${
                    tab === t.id
                      ? 'border-[#ff6b2c] text-white'
                      : 'border-transparent text-[#5a5a5a] hover:text-[#c0c0c0]'
                  }`}
                  style={{ fontFamily: mono }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 space-y-5">

              {tab === 'members' && (
                <>
                  {/* Workspace Name (inline) */}
                  {canManage && (
                    <div className="overflow-hidden">
                      <label className="text-[11px] text-[#5a5a5a] uppercase tracking-wide mb-1.5 block" style={{ fontFamily: mono }}>
                        Nome do Workspace
                      </label>
                      <div className="flex gap-2 min-w-0">
                        <input
                          value={wsName}
                          onChange={e => setWsName(e.target.value)}
                          placeholder="Nome da empresa"
                          className="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm text-white bg-dim border border-dim-hover focus:border-[#ff6b2c] focus:outline-none transition-colors"
                          style={{ fontFamily: mono }}
                        />
                        <button
                          onClick={handleSaveName}
                          disabled={saving || !wsName.trim()}
                          className="px-4 py-2 rounded-[10px] text-[12px] font-semibold transition-all disabled:opacity-40"
                          style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A', fontFamily: mono }}
                        >
                          {saving ? '...' : 'Salvar'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Invite */}
                  {canManage && (
                    <div className="rounded-lg border border-dim-hover p-4" style={{ background: '#1a1a1a' }}>
                      <h3 className="text-[12px] font-semibold text-subtle uppercase tracking-wide mb-3 flex items-center gap-2" style={{ fontFamily: mono }}>
                        <UserPlus size={13} className="text-[#ff6b2c]" />
                        Convidar
                      </h3>

                      <div className="relative mb-3">
                        <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5a5a5a]" />
                        <input
                          value={inviteEmail}
                          onChange={e => setInviteEmail(e.target.value)}
                          placeholder="email@exemplo.com"
                          onKeyDown={e => e.key === 'Enter' && handleInvite()}
                          className="w-full rounded-lg pl-9 pr-3 py-2 text-[13px] text-white bg-dim-hover border border-dim-hover focus:border-[#ff6b2c] focus:outline-none transition-colors placeholder-[#5a5a5a]"
                          style={{ fontFamily: mono }}
                        />
                      </div>

                      <div className="flex items-center gap-2 mb-3">
                        {(['member', 'admin'] as const).map(role => {
                          const sel = inviteRole === role
                          const Icon = role === 'member' ? Users : Shield
                          return (
                            <button
                              key={role}
                              onClick={() => setInviteRole(role)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-medium transition-all"
                              style={{
                                fontFamily: mono,
                                background: '#121212',
                                boxShadow: sel
                                  ? 'inset 2px 2px 6px rgba(0,0,0,0.5), inset -1px -1px 4px rgba(255,255,255,0.03)'
                                  : '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                                color: sel ? '#D4835A' : '#8a8a8a',
                                border: 'none',
                              }}
                            >
                              <Icon size={12} />
                              {role === 'member' ? 'Membro' : 'Admin'}
                            </button>
                          )
                        })}
                        <button
                          onClick={handleInvite}
                          disabled={isInviting || !inviteEmail.trim()}
                          className="ml-auto px-4 py-1.5 rounded-[10px] text-[12px] font-semibold transition-all disabled:opacity-40"
                          style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A', fontFamily: mono }}
                        >
                          {isInviting ? '...' : 'Enviar'}
                        </button>
                      </div>

                      {inviteFeedback && (
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-md text-[11px] font-medium"
                          style={{
                            background: inviteFeedback.ok ? 'rgba(52,211,153,0.08)' : 'rgba(239,68,68,0.08)',
                            color: inviteFeedback.ok ? '#34d399' : '#f87171',
                            fontFamily: mono,
                          }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: inviteFeedback.ok ? '#34d399' : '#f87171' }} />
                          {inviteFeedback.msg}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Members list */}
                  <div>
                    <h3 className="text-[12px] font-semibold text-subtle uppercase tracking-wide mb-2 flex items-center gap-2" style={{ fontFamily: mono }}>
                      <Users size={13} className="text-[#34d399]" />
                      Membros ({members.length})
                    </h3>
                    <div className="space-y-0.5">
                      {members.map(member => {
                        const rc = ROLE_CONFIG[member.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.member
                        const RIcon = rc.icon
                        return (
                          <div
                            key={member.user_id}
                            className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-dim transition-colors group"
                          >
                            <UserAvatar userId={member.user_id} name={member.user_name || member.user_email} size={32} />
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-[13px] font-medium truncate" style={{ fontFamily: mono }}>
                                {member.user_name || 'Sem nome'}
                              </p>
                              <p className="text-[#5a5a5a] text-[11px] truncate" style={{ fontFamily: mono }}>
                                {member.user_email}
                              </p>
                            </div>
                            <span
                              className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] uppercase font-bold shrink-0"
                              style={{ fontFamily: mono, background: rc.bg, color: rc.color }}
                            >
                              <RIcon size={10} />
                              {rc.label}
                            </span>
                            {isOwner && member.role !== 'owner' && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 shrink-0">
                                <select
                                  value={member.role}
                                  onChange={e => updateMemberRole(activeWorkspace!.workspace_id, member.user_id, e.target.value)}
                                  className="text-[10px] rounded px-1.5 py-0.5 bg-dim-hover border border-dim-hover text-subtle focus:outline-none cursor-pointer"
                                  style={{ fontFamily: mono }}
                                >
                                  <option value="member">Membro</option>
                                  <option value="admin">Admin</option>
                                </select>
                                <button
                                  className="text-[#5a5a5a] hover:text-red-400 p-1 rounded hover:bg-red-500/10 transition-colors"
                                  onClick={() => setRemovingMemberId(member.user_id)}
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Danger zone */}
                  {isOwner && (
                    <div className="rounded-lg p-4" style={{ border: '1px solid rgba(239,68,68,0.12)' }}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[12px] font-semibold text-red-400/80 flex items-center gap-1.5" style={{ fontFamily: mono }}>
                            <AlertTriangle size={12} />
                            Zona de Perigo
                          </p>
                          <p className="text-[11px] text-[#5a5a5a] mt-0.5" style={{ fontFamily: mono }}>
                            Deletar permanentemente este workspace
                          </p>
                        </div>
                        <button
                          onClick={() => setConfirmDelete(true)}
                          className="px-3 py-1.5 rounded-md text-[11px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors"
                          style={{ fontFamily: mono, border: '1px solid rgba(239,68,68,0.2)' }}
                        >
                          Deletar
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

              {tab === 'permissions' && (
                <div className="space-y-2">
                  {(Object.entries(ROLE_CONFIG) as [keyof typeof ROLE_CONFIG, typeof ROLE_CONFIG[keyof typeof ROLE_CONFIG]][]).map(([key, role]) => {
                    const Icon = role.icon
                    return (
                      <div key={key} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: role.bg }}>
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                          style={{ background: role.bg, border: `1px solid ${role.color}20` }}
                        >
                          <Icon size={15} style={{ color: role.color }} />
                        </div>
                        <div>
                          <p className="text-[13px] font-bold" style={{ fontFamily: mono, color: role.color }}>
                            {role.label}
                          </p>
                          <p className="text-[12px] text-subtle mt-0.5" style={{ fontFamily: mono }}>
                            {role.description}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="rounded-xl border border-dim-hover p-6 max-w-sm w-full" style={{ background: '#1a1a1a' }}>
            <h3 className="text-white text-base font-bold mb-2" style={{ fontFamily: mono }}>Deletar workspace?</h3>
            <p className="text-subtle text-[13px] mb-5" style={{ fontFamily: mono }}>
              Esta ação é irreversível. Todos os dados serão removidos.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-4 py-2 rounded-lg text-[13px] text-subtle hover:text-white hover:bg-dim-hover transition-colors"
                style={{ fontFamily: mono }}
              >
                Cancelar
              </button>
              <button
                onClick={() => {
                  if (activeWorkspace) {
                    deleteWorkspace(activeWorkspace.workspace_id)
                  }
                }}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
                style={{ fontFamily: mono }}
              >
                Sim, deletar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove member confirmation */}
      {removingMemberId && (() => {
        const member = members.find(m => m.user_id === removingMemberId)
        const memberLabel = member?.user_name || member?.user_email || 'este membro'
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="rounded-xl border border-dim-hover p-6 max-w-sm w-full" style={{ background: '#1a1a1a' }}>
              <h3 className="text-white text-base font-bold mb-2" style={{ fontFamily: mono }}>Remover membro?</h3>
              <p className="text-subtle text-[13px] mb-5" style={{ fontFamily: mono }}>
                <strong className="text-white">{memberLabel}</strong> será removido do workspace e perderá acesso imediatamente.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setRemovingMemberId(null)}
                  className="px-4 py-2 rounded-lg text-[13px] text-subtle hover:text-white hover:bg-dim-hover transition-colors"
                  style={{ fontFamily: mono }}
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    removeMember(activeWorkspace!.workspace_id, removingMemberId)
                    setRemovingMemberId(null)
                  }}
                  className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors"
                  style={{ fontFamily: mono }}
                >
                  Sim, remover
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
