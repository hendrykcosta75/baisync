'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useChannelStore, type Channel, type ChannelNote } from '@/store/useChannelStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useAuthStore } from '@/store/useAuthStore'
import { useErrorStore } from '@/store/useErrorStore'
import {
  Hash, MessageSquare, Plus, Send, ChevronRight, Lock, UserPlus, X, FileText,
  Settings, UserMinus,
} from 'lucide-react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

// ─── SSE listener ───
function useChatSSE() {
  const store = useChannelStore()
  const { user } = useAuthStore()

  useEffect(() => {
    const onMessage = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && detail.channel_id) store.addMessage(detail)
    }
    const onNoteCreated = (e: Event) => {
      const note = (e as CustomEvent).detail
      if (note && store.activeChannel?.id === note.channel_id) {
        store.addNoteFromSSE(note)
      }
    }
    const onNoteUpdated = (e: Event) => {
      const note = (e as CustomEvent).detail
      if (note && store.activeChannel?.id === note.channel_id) {
        store.updateNoteFromSSE(note)
      }
    }
    const onNoteDeleted = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && store.activeChannel?.id === detail.channel_id) {
        store.removeNoteFromSSE(detail.note_id)
      }
    }
    const onMemberAdded = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail && store.activeChannel?.id === detail.channel_id) {
        store.fetchMembers(detail.channel_id)
      }
    }
    const onMemberRemoved = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail) return
      // If the current user was removed, remove channel from list
      if (detail.user_id === user?.id) {
        store.handleRemovedFromChannel(detail.channel_id)
      } else if (store.activeChannel?.id === detail.channel_id) {
        store.fetchMembers(detail.channel_id)
      }
    }

    window.addEventListener('sse:channel_message', onMessage)
    window.addEventListener('sse:channel_note_created', onNoteCreated)
    window.addEventListener('sse:channel_note_updated', onNoteUpdated)
    window.addEventListener('sse:channel_note_deleted', onNoteDeleted)
    window.addEventListener('sse:channel_member_added', onMemberAdded)
    window.addEventListener('sse:channel_member_removed', onMemberRemoved)
    return () => {
      window.removeEventListener('sse:channel_message', onMessage)
      window.removeEventListener('sse:channel_note_created', onNoteCreated)
      window.removeEventListener('sse:channel_note_updated', onNoteUpdated)
      window.removeEventListener('sse:channel_note_deleted', onNoteDeleted)
      window.removeEventListener('sse:channel_member_added', onMemberAdded)
      window.removeEventListener('sse:channel_member_removed', onMemberRemoved)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])
}

// ─── Collapsible section ───
function Section({
  title, children, action, defaultOpen = true,
}: {
  title: string; children: React.ReactNode; action?: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-1">
      <div className="flex items-center px-3 py-1.5 group">
        <button
          className="flex items-center gap-1 text-[11px] uppercase font-bold text-[#555555] tracking-wider hover:text-[#c0c0c0] transition-colors"
          style={{ fontFamily: mono }}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          {title}
        </button>
        <div className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
          {action}
        </div>
      </div>
      {open && <div className="px-1.5">{children}</div>}
    </div>
  )
}

// ─── Channel Settings Modal ───
function ChannelSettingsModal({ channel, onClose }: { channel: Channel; onClose: () => void }) {
  const { updateChannel, deleteChannel, fetchMembers, members, addChannelMember, removeChannelMember, setActiveChannel } = useChannelStore()
  const { members: wsMembers } = useWorkspaceStore()
  const { user } = useAuthStore()
  const { showError } = useErrorStore()
  const [channelName, setChannelName] = useState(channel.name)
  const [channelDesc, setChannelDesc] = useState(channel.description || '')
  const [saving, setSaving] = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    fetchMembers(channel.id)
  }, [channel.id, fetchMembers])

  const handleSave = async () => {
    setSaving(true)
    try {
      await updateChannel(channel.id, channelName, channelDesc)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao salvar canal')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteChannel(channel.id)
      onClose()
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao deletar canal')
    }
  }

  const handleAddMember = async (userId: string) => {
    try {
      await addChannelMember(channel.id, userId)
      setShowAddMember(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao adicionar membro')
    }
  }

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeChannelMember(channel.id, userId)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao remover membro')
    }
  }

  const memberIds = new Set(members.map(m => m.user_id))
  const nonMembers = wsMembers.filter(m => !memberIds.has(m.user_id))

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg rounded-xl shadow-2xl overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-2">
              <Settings size={16} className="text-[#555555]" />
              <h3 className="font-bold text-[15px]" style={{ fontFamily: mono, color: '#e2e0da' }}>
                Configurações do Canal
              </h3>
            </div>
            <button onClick={onClose} className="text-[#555555] hover:text-[#e2e0da] transition-colors">
              <X size={18} />
            </button>
          </div>

          <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Name & Description */}
            <div className="space-y-3">
              <label className="text-[11px] uppercase font-bold text-[#555555] tracking-wider" style={{ fontFamily: mono }}>
                Nome do canal
              </label>
              <input
                value={channelName}
                onChange={e => setChannelName(e.target.value)}
                className="w-full rounded-lg px-3 py-2.5 text-[13px] focus:outline-none"
                style={{ fontFamily: mono, color: '#e2e0da', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(17,17,17,0.8)', }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}
              />
              <label className="text-[11px] uppercase font-bold text-[#555555] tracking-wider" style={{ fontFamily: mono }}>
                Descrição
              </label>
              <input
                value={channelDesc}
                onChange={e => setChannelDesc(e.target.value)}
                placeholder="Descrição opcional..."
                className="w-full rounded-lg px-3 py-2.5 text-[13px] focus:outline-none placeholder-[#555555]"
                style={{ fontFamily: mono, color: '#e2e0da', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(17,17,17,0.8)', }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}
              />
              <button
                onClick={handleSave}
                disabled={saving || channelName === channel.name && channelDesc === (channel.description || '')}
                className="w-full py-2.5 rounded-lg text-[13px] font-bold transition-colors disabled:opacity-30"
                style={{ background: 'linear-gradient(135deg, #ff6b2c, #ff8533)', fontFamily: mono, color: '#e2e0da' }}
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>

            {/* Members */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] uppercase font-bold text-[#555555] tracking-wider" style={{ fontFamily: mono }}>
                  Membros ({members.length})
                </span>
                <button
                  onClick={() => setShowAddMember(!showAddMember)}
                  className="text-[#555555] hover:text-[#ff6b2c] transition-colors"
                >
                  <UserPlus size={14} />
                </button>
              </div>

              {showAddMember && nonMembers.length > 0 && (
                <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(17,17,17,0.8)' }}>
                  {nonMembers.map(m => (
                    <button
                      key={m.user_id}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left text-subtle hover:text-[#e2e0da] transition-colors"
                      style={{ background: 'transparent' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      onClick={() => handleAddMember(m.user_id)}
                    >
                      <div className="w-6 h-6 rounded-[8px] flex items-center justify-center text-[9px] font-semibold" style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}>
                        {(m.user_name || '?').slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-[12px] truncate" style={{ fontFamily: mono }}>{m.user_name || m.user_email}</span>
                      <Plus size={12} className="ml-auto text-[#555555]" />
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                {members.map(m => (
                  <div
                    key={m.user_id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg group transition-colors"
                    style={{ background: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div className="w-7 h-7 rounded-[10px] flex items-center justify-center text-[10px] font-semibold shrink-0" style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}>
                      {(m.user_name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] truncate" style={{ fontFamily: mono, color: '#e2e0da' }}>{m.user_name || 'Sem nome'}</p>
                      <p className="text-[#555555] text-[11px] truncate" style={{ fontFamily: mono }}>{m.user_email}</p>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold" style={{
                      fontFamily: mono,
                      background: m.role === 'owner' ? 'rgba(255,107,44,0.12)' : '#252525',
                      color: m.role === 'owner' ? '#ff6b2c' : '#8a8a8a',
                    }}>
                      {m.role}
                    </span>
                    {m.user_id !== user?.id && m.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id)}
                        className="opacity-0 group-hover:opacity-100 text-[#555555] hover:text-red-400 transition-all"
                      >
                        <UserMinus size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Danger Zone */}
            <div className="border border-red-500/20 rounded-lg p-4">
              <p className="text-[12px] text-subtle mb-3" style={{ fontFamily: mono }}>
                Deletar este canal permanentemente. Esta ação não pode ser desfeita.
              </p>
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-4 py-2 rounded-lg text-[12px] font-bold text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors"
                  style={{ fontFamily: mono }}
                >
                  Deletar Canal
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleDelete}
                    className="px-4 py-2 rounded-lg text-[12px] font-bold text-white bg-red-500 hover:bg-red-600 transition-colors"
                    style={{ fontFamily: mono }}
                  >
                    Confirmar
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-4 py-2 rounded-lg text-[12px] font-bold text-subtle transition-colors"
                    style={{ fontFamily: mono, border: '1px solid rgba(255,255,255,0.06)', background: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Channel List Panel ───
function ChannelListPanel() {
  const { channels, dms, activeChannel, setActiveChannel, fetchChannels, fetchDms, createChannel } = useChannelStore()
  const { activeWorkspace, members, fetchMembers } = useWorkspaceStore()
  const [showCreate, setShowCreate] = useState(false)
  const [newChannelName, setNewChannelName] = useState('')
  const [showDmPicker, setShowDmPicker] = useState(false)
  const { createDm } = useChannelStore()
  const { user } = useAuthStore()

  useEffect(() => {
    if (activeWorkspace && activeWorkspace.workspace_type !== 'personal') {
      fetchChannels(activeWorkspace.workspace_id)
      fetchDms(activeWorkspace.workspace_id)
      fetchMembers(activeWorkspace.workspace_id)
    }
  }, [activeWorkspace, fetchChannels, fetchDms, fetchMembers])

  const { showError } = useErrorStore()

  const handleCreateChannel = async () => {
    if (!newChannelName.trim() || !activeWorkspace) return
    try {
      const ch = await createChannel(activeWorkspace.workspace_id, newChannelName.trim())
      setNewChannelName('')
      setShowCreate(false)
      setActiveChannel(ch)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao criar canal')
    }
  }

  const handleCreateDm = async (userId: string) => {
    if (!activeWorkspace) return
    try {
      const dm = await createDm(activeWorkspace.workspace_id, userId)
      setShowDmPicker(false)
      setActiveChannel(dm)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao criar conversa')
    }
  }

  if (!activeWorkspace || activeWorkspace.workspace_type === 'personal') {
    return (
      <div
        className="w-[240px] flex flex-col items-center justify-center p-6 text-center shrink-0"
        style={{ background: 'rgba(17,17,17,0.6)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(255,255,255,0.06)' }}
      >
        <MessageSquare size={28} className="text-[#ff6b2c] mb-3" style={{ opacity: 0.4 }} />
        <p className="text-[#555555] text-[12px]" style={{ fontFamily: mono }}>
          Chat disponível em workspaces de empresa
        </p>
      </div>
    )
  }

  return (
    <div
      className="w-[240px] flex flex-col shrink-0 overflow-hidden"
      style={{ background: 'rgba(17,17,17,0.6)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <h3 className="text-[13px] font-bold truncate" style={{ fontFamily: mono, color: '#e2e0da' }}>
          {activeWorkspace.workspace_name}
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Channels */}
        <Section
          title="Canais"
          action={
            <button className="text-[#555555] hover:text-[#e2e0da] p-0.5" onClick={() => setShowCreate(!showCreate)}>
              <Plus size={13} />
            </button>
          }
        >
          {showCreate && (
            <div className="flex gap-1 mb-1.5 px-1.5">
              <input
                placeholder="nome-do-canal"
                value={newChannelName}
                onChange={e => setNewChannelName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateChannel()}
                autoFocus
                className="flex-1 rounded-md px-2 py-1 text-[12px] focus:outline-none"
                style={{ fontFamily: mono, color: '#e2e0da', border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)'}
                onBlur={e => e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'}
              />
              <button onClick={handleCreateChannel} className="text-[#ff6b2c] hover:text-[#e2e0da] px-1">
                <Plus size={14} />
              </button>
            </div>
          )}

          {channels.map(ch => {
            const isActive = activeChannel?.id === ch.id
            const unread = ch.unread_count ?? 0
            return (
              <button
                key={ch.id}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors ${
                  isActive ? 'text-[#ff6b2c]' : unread > 0 ? 'text-[#e2e0da]' : 'text-subtle hover:text-[#e2e0da]'
                }`}
                style={{
                  background: isActive ? 'rgba(255,255,255,0.06)' : undefined,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#252525' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = '' }}
                onClick={() => setActiveChannel(ch)}
              >
                {ch.type === 'private' ? <Lock size={13} className="shrink-0 opacity-60" /> : <Hash size={13} className="shrink-0 opacity-60" />}
                <span className={`truncate text-[13px] ${unread > 0 ? 'font-bold' : ''}`} style={{ fontFamily: mono }}>
                  {ch.name}
                </span>
                {unread > 0 && (
                  <span className="ml-auto text-[10px] font-bold text-white w-5 h-5 flex items-center justify-center rounded-full shrink-0" style={{ background: 'linear-gradient(135deg, #ff6b2c, #ff8533)' }}>
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            )
          })}
        </Section>

        {/* DMs */}
        <Section
          title="Mensagens Diretas"
          action={
            <button className="text-[#555555] hover:text-[#e2e0da] p-0.5" onClick={() => setShowDmPicker(!showDmPicker)}>
              <Plus size={13} />
            </button>
          }
        >
          {showDmPicker && (
            <div className="mb-1.5 mx-1.5 rounded-md overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)' }}>
              {members
                .filter(m => m.user_id !== user?.id)
                .map(m => (
                  <button
                    key={m.user_id}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left text-subtle hover:text-[#e2e0da] transition-colors"
                    style={{ background: 'transparent' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    onClick={() => handleCreateDm(m.user_id)}
                  >
                    <div className="w-5 h-5 rounded-[8px] flex items-center justify-center text-[9px] font-semibold" style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}>
                      {(m.user_name || '?').slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-[12px] truncate" style={{ fontFamily: mono }}>{m.user_name || m.user_email}</span>
                  </button>
                ))}
            </div>
          )}

          {dms.map(dm => {
            const other = dm.other_user
            const isActive = activeChannel?.id === dm.id
            const unread = dm.unread_count ?? 0
            return (
              <button
                key={dm.id}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors ${
                  isActive ? 'text-[#ff6b2c]' : unread > 0 ? 'text-[#e2e0da]' : 'text-subtle hover:text-[#e2e0da]'
                }`}
                style={{
                  background: isActive ? 'rgba(255,255,255,0.06)' : undefined,
                }}
                onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = '#252525' }}
                onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = '' }}
                onClick={() => setActiveChannel(dm)}
              >
                <div className="w-5 h-5 rounded-[7px] flex items-center justify-center text-[8px] font-semibold shrink-0" style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}>
                  {(other?.name || '?').slice(0, 2).toUpperCase()}
                </div>
                <span className={`truncate text-[13px] ${unread > 0 ? 'font-bold' : ''}`} style={{ fontFamily: mono }}>
                  {other?.name || other?.email || 'DM'}
                </span>
                {unread > 0 && (
                  <span className="ml-auto text-[10px] font-bold text-white w-5 h-5 flex items-center justify-center rounded-full shrink-0" style={{ background: 'linear-gradient(135deg, #ff6b2c, #ff8533)' }}>
                    {unread > 9 ? '9+' : unread}
                  </span>
                )}
              </button>
            )
          })}
        </Section>
      </div>
    </div>
  )
}

// ─── Markdown Context Menu ───
interface ContextMenuPos { x: number; y: number }
interface ContextMenuItem {
  label: string
  items?: { label: string; insert: string; wrap?: boolean }[]
}

const contextMenuItems: ContextMenuItem[] = [
  {
    label: 'Títulos',
    items: [
      { label: 'H1', insert: '# ' },
      { label: 'H2', insert: '## ' },
      { label: 'H3', insert: '### ' },
      { label: 'H4', insert: '#### ' },
    ],
  },
  {
    label: 'Formatação',
    items: [
      { label: 'Negrito', insert: '**', wrap: true },
      { label: 'Itálico', insert: '*', wrap: true },
      { label: 'Tachado', insert: '~~', wrap: true },
      { label: 'Código inline', insert: '`', wrap: true },
    ],
  },
  {
    label: 'Listas',
    items: [
      { label: 'Lista com bullet', insert: '- ' },
      { label: 'Lista numerada', insert: '1. ' },
      { label: 'Task (checkbox)', insert: '- [ ] ' },
    ],
  },
  {
    label: 'Blocos',
    items: [
      { label: 'Citação', insert: '> ' },
      { label: 'Bloco de código', insert: '```\n' + '\n```' },
      { label: 'Linha horizontal', insert: '\n---\n' },
      { label: 'Tabela', insert: '| Col1 | Col2 | Col3 |\n| --- | --- | --- |\n| | | |' },
    ],
  },
  {
    label: 'Links & Mídia',
    items: [
      { label: 'Link', insert: '[texto](url)' },
      { label: 'Imagem', insert: '![alt](url)' },
    ],
  },
]

function MarkdownContextMenu({
  pos,
  onClose,
  onInsert,
}: {
  pos: ContextMenuPos
  onClose: () => void
  onInsert: (insert: string, wrap?: boolean) => void
}) {
  const [openSub, setOpenSub] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Reposition if near edge
  const [adjustedPos, setAdjustedPos] = useState(pos)
  useEffect(() => {
    if (!menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    let x = pos.x, y = pos.y
    if (x + rect.width > window.innerWidth - 10) x = window.innerWidth - rect.width - 10
    if (y + rect.height > window.innerHeight - 10) y = window.innerHeight - rect.height - 10
    if (x < 10) x = 10
    if (y < 10) y = 10
    setAdjustedPos({ x, y })
  }, [pos])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} onContextMenu={e => { e.preventDefault(); onClose() }} />
      <div
        ref={menuRef}
        className="fixed z-50 w-48 rounded-lg shadow-2xl py-1"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', left: adjustedPos.x, top: adjustedPos.y, backdropFilter: 'blur(20px)' }}
        onMouseLeave={() => setOpenSub(null)}
      >
        {contextMenuItems.map((group, gi) => (
          <div
            key={group.label}
            className="relative"
            onMouseEnter={() => setOpenSub(gi)}
          >
            <div
              className="flex items-center justify-between px-3 py-2 text-[12px] text-[#c0c0c0] hover:text-[#e2e0da] cursor-default transition-colors"
              style={{ fontFamily: mono }}
              onMouseEnter={e => e.currentTarget.style.background = '#252525'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              {group.label}
              <ChevronRight size={11} className="text-[#555555]" />
            </div>
            {openSub === gi && group.items && (
              <div
                className="absolute left-full top-0 w-48 rounded-lg shadow-2xl py-1 -mt-1 z-[60]"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)' }}
                onMouseEnter={() => setOpenSub(gi)}
                onMouseLeave={() => setOpenSub(null)}
              >
                {group.items.map(item => (
                  <button
                    key={item.label}
                    className="w-full text-left px-3 py-2 text-[12px] text-[#c0c0c0] hover:text-[#e2e0da] transition-colors"
                    style={{ fontFamily: mono }}
                    onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                    onClick={() => { onInsert(item.insert, item.wrap); onClose() }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Notes Editor (Obsidian-style: click to edit, blur to render) ───
function NotesEditor({
  channelId,
  note,
}: {
  channelId: string
  note: ChannelNote
}) {
  const { updateNote } = useChannelStore()
  const [content, setContent] = useState(note.content)
  const [editing, setEditing] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuPos | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync from prop when note changes
  useEffect(() => {
    setContent(note.content)
  }, [note.id, note.content])

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [editing])

  // Debounced save
  const saveContent = useCallback((newContent: string) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      updateNote(channelId, note.id, undefined, newContent)
    }, 800)
  }, [channelId, note.id, updateNote])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setContent(val)
    saveContent(val)
  }

  // Context menu insert
  const handleInsert = (insert: string, wrap?: boolean) => {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = content.substring(start, end)

    let newContent: string
    let cursorPos: number

    if (wrap && selected) {
      newContent = content.substring(0, start) + insert + selected + insert + content.substring(end)
      cursorPos = end + insert.length * 2
    } else if (wrap) {
      const placeholder = 'texto'
      newContent = content.substring(0, start) + insert + placeholder + insert + content.substring(end)
      cursorPos = start + insert.length
      setTimeout(() => {
        ta.setSelectionRange(start + insert.length, start + insert.length + placeholder.length)
        ta.focus()
      }, 0)
      setContent(newContent)
      saveContent(newContent)
      return
    } else {
      newContent = content.substring(0, start) + insert + content.substring(end)
      cursorPos = start + insert.length
    }

    setContent(newContent)
    saveContent(newContent)
    setTimeout(() => { ta.setSelectionRange(cursorPos, cursorPos); ta.focus() }, 0)
  }

  // Handle Tab and Enter for lists
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = textareaRef.current
    if (!ta) return

    // Escape to exit edit mode
    if (e.key === 'Escape') {
      setEditing(false)
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const newContent = content.substring(0, start) + '  ' + content.substring(end)
      setContent(newContent)
      saveContent(newContent)
      setTimeout(() => { ta.setSelectionRange(start + 2, start + 2) }, 0)
      return
    }

    if (e.key === 'Enter') {
      const start = ta.selectionStart
      const lineStart = content.lastIndexOf('\n', start - 1) + 1
      const currentLine = content.substring(lineStart, start)

      const bulletMatch = currentLine.match(/^(\s*)([-*+])\s/)
      const numMatch = currentLine.match(/^(\s*)(\d+)\.\s/)
      const taskMatch = currentLine.match(/^(\s*)- \[[ x]\]\s/)

      let continuation = ''
      if (taskMatch) {
        if (currentLine.trim() === '- [ ]' || currentLine.trim() === '- [x]') {
          e.preventDefault()
          const newContent = content.substring(0, lineStart) + '\n' + content.substring(start)
          setContent(newContent)
          saveContent(newContent)
          setTimeout(() => { ta.setSelectionRange(lineStart + 1, lineStart + 1) }, 0)
          return
        }
        continuation = taskMatch[1] + '- [ ] '
      } else if (bulletMatch) {
        if (currentLine.trim() === '-' || currentLine.trim() === '*' || currentLine.trim() === '+') {
          e.preventDefault()
          const newContent = content.substring(0, lineStart) + '\n' + content.substring(start)
          setContent(newContent)
          saveContent(newContent)
          setTimeout(() => { ta.setSelectionRange(lineStart + 1, lineStart + 1) }, 0)
          return
        }
        continuation = bulletMatch[1] + bulletMatch[2] + ' '
      } else if (numMatch) {
        if (currentLine.trim().match(/^\d+\.$/)) {
          e.preventDefault()
          const newContent = content.substring(0, lineStart) + '\n' + content.substring(start)
          setContent(newContent)
          saveContent(newContent)
          setTimeout(() => { ta.setSelectionRange(lineStart + 1, lineStart + 1) }, 0)
          return
        }
        const nextNum = parseInt(numMatch[2]) + 1
        continuation = numMatch[1] + nextNum + '. '
      }

      if (continuation) {
        e.preventDefault()
        const newContent = content.substring(0, start) + '\n' + continuation + content.substring(start)
        setContent(newContent)
        saveContent(newContent)
        const newPos = start + 1 + continuation.length
        setTimeout(() => { ta.setSelectionRange(newPos, newPos) }, 0)
      }
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {editing ? (
        /* Edit mode — full-width textarea */
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Don't exit edit mode if context menu is open
            if (ctxMenu) return
            setEditing(false)
          }}
          onContextMenu={e => {
            e.preventDefault()
            setCtxMenu({ x: e.clientX, y: e.clientY })
          }}
          placeholder="# Comece a escrever...&#10;&#10;Use Markdown ou clique com botão direito para opções de formatação. Esc para sair da edição."
          className="flex-1 resize-none bg-transparent px-5 py-4 text-[13px] text-[#c0c0c0] focus:outline-none placeholder-[#3a3a3a] leading-relaxed"
          style={{ fontFamily: mono }}
          spellCheck={false}
        />
      ) : (
        /* Rendered mode — click anywhere to edit */
        <div
          className="flex-1 overflow-y-auto px-5 py-4 cursor-text prose prose-sm prose-invert max-w-none
            prose-headings:text-[#e2e0da] prose-headings:font-bold
            prose-p:text-[#c0c0c0] prose-p:leading-relaxed
            prose-a:text-[#ff6b2c] prose-a:no-underline hover:prose-a:underline
            prose-strong:text-[#e2e0da]
            prose-code:text-[#ff6b2c] prose-code:bg-dim-hover prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px]
            prose-pre:bg-[rgba(17,17,17,0.8)] prose-pre:border prose-pre:border-[rgba(255,255,255,0.06)] prose-pre:rounded-lg
            prose-blockquote:border-[rgba(249,115,22,0.4)] prose-blockquote:text-subtle
            prose-li:text-[#c0c0c0]
            prose-hr:border-[rgba(255,255,255,0.06)]
            prose-table:text-[#c0c0c0]
            prose-th:text-[#e2e0da] prose-th:border-b prose-th:border-[rgba(255,255,255,0.06)] prose-th:px-3 prose-th:py-1.5
            prose-td:border-b prose-td:border-[rgba(255,107,44,0.04)] prose-td:px-3 prose-td:py-1.5"
          style={{ fontFamily: mono, fontSize: 13 }}
          onClick={() => setEditing(true)}
        >
          {content ? (
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          ) : (
            <p className="text-[#3a3a3a] text-[13px] italic">Clique para começar a escrever...</p>
          )}
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <MarkdownContextMenu
          pos={ctxMenu}
          onClose={() => {
            setCtxMenu(null)
            // Re-focus textarea after menu closes
            setTimeout(() => textareaRef.current?.focus(), 0)
          }}
          onInsert={handleInsert}
        />
      )}
    </div>
  )
}

// ─── Channel Tabs with shared notes ───
function ChannelTabs({
  channel,
  activeTab,
  onTabChange,
}: {
  channel: Channel
  activeTab: string
  onTabChange: (tab: string) => void
}) {
  const { notes, fetchNotes, createNote, deleteNote, updateNote } = useChannelStore()
  const { showError } = useErrorStore()
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => {
    if (channel.type !== 'dm') {
      fetchNotes(channel.id)
    }
  }, [channel.id, channel.type, fetchNotes])

  const addNotesTab = async () => {
    try {
      const note = await createNote(channel.id, 'Anotações')
      onTabChange(`note-${note.id}`)
      setShowAddMenu(false)
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao criar anotação')
    }
  }

  const removeTab = async (noteId: string) => {
    try {
      await deleteNote(channel.id, noteId)
      if (activeTab === `note-${noteId}`) onTabChange('messages')
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao remover anotação')
    }
  }

  const startRename = (noteId: string, currentTitle: string) => {
    setRenamingId(noteId)
    setRenameValue(currentTitle)
  }

  const finishRename = async (noteId: string) => {
    try {
      if (renameValue.trim()) {
        await updateNote(channel.id, noteId, renameValue.trim())
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Erro ao renomear anotação')
    }
    setRenamingId(null)
  }

  return (
    <div className="flex items-center shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(17,17,17,0.8)', backdropFilter: 'blur(12px)' }}>
      <div className="flex items-center gap-0.5 px-4 flex-1 min-w-0 overflow-x-auto">
        {/* Messages tab */}
        <button
          className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap ${
            activeTab === 'messages'
              ? 'border-[#ff6b2c] text-[#ff6b2c]'
              : 'border-transparent text-[#555555] hover:text-[#c0c0c0]'
          }`}
          style={{
            fontFamily: mono,
            background: activeTab === 'messages' ? '#252525' : undefined,
          }}
          onClick={() => onTabChange('messages')}
        >
          Mensagens
        </button>

        {/* Note tabs */}
        {notes.map(note => (
          <div key={note.id} className="flex items-center group">
            {renamingId === note.id ? (
              <div className="flex items-center px-1">
                <input
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') finishRename(note.id); if (e.key === 'Escape') setRenamingId(null) }}
                  onBlur={() => finishRename(note.id)}
                  autoFocus
                  className="w-24 px-2 py-1 text-[12px] rounded focus:outline-none"
                  style={{ fontFamily: mono, color: '#e2e0da', border: '1px solid #ff6b2c', background: 'rgba(17,17,17,0.8)' }}
                />
              </div>
            ) : (
              <button
                className={`px-3 py-2 text-[12px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === `note-${note.id}`
                    ? 'border-[#ff6b2c] text-[#ff6b2c]'
                    : 'border-transparent text-[#555555] hover:text-[#c0c0c0]'
                }`}
                style={{
                  fontFamily: mono,
                  background: activeTab === `note-${note.id}` ? '#252525' : undefined,
                }}
                onClick={() => onTabChange(`note-${note.id}`)}
                onDoubleClick={() => startRename(note.id, note.title)}
              >
                {note.title}
              </button>
            )}
            <button
              onClick={() => removeTab(note.id)}
              className="opacity-0 group-hover:opacity-100 text-[#555555] hover:text-red-400 p-0.5 -ml-1 transition-opacity"
            >
              <X size={10} />
            </button>
          </div>
        ))}
      </div>

      {/* Add tab button */}
      {channel.type !== 'dm' && (
        <div className="relative px-2 shrink-0">
          <button
            onClick={() => setShowAddMenu(!showAddMenu)}
            className="w-6 h-6 rounded flex items-center justify-center text-[#555555] hover:text-[#e2e0da] transition-colors"
            style={{ background: 'transparent' }}
            onMouseEnter={e => e.currentTarget.style.background = '#252525'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <Plus size={14} />
          </button>
          {showAddMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowAddMenu(false)} />
              <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-lg shadow-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(20px)' }}>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-subtle hover:text-[#e2e0da] transition-colors text-left"
                  style={{ fontFamily: mono }}
                  onMouseEnter={e => e.currentTarget.style.background = '#252525'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                  onClick={addNotesTab}
                >
                  <FileText size={13} />
                  Anotações
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Message Area ───
function MessageArea() {
  const {
    activeChannel, messages, nextCursor, isLoading,
    sendMessage, fetchMessages, markRead, notes,
  } = useChannelStore()
  const { user } = useAuthStore()
  const [input, setInput] = useState('')
  const [activeTab, setActiveTab] = useState('messages')
  const [showSettings, setShowSettings] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isLoadingOlderRef = useRef(false)

  // Reset tab when switching channels
  useEffect(() => {
    setActiveTab('messages')
  }, [activeChannel?.id])

  // Auto-scroll to bottom only for new messages, not pagination
  useEffect(() => {
    if (!isLoadingOlderRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length])

  const { showError } = useErrorStore()

  const handleSend = async () => {
    if (!input.trim() || !activeChannel) return
    const msg = input.trim()
    setInput('')
    try {
      await sendMessage(activeChannel.id, msg)
    } catch (err) {
      setInput(msg)
      showError(err instanceof Error ? err.message : 'Erro ao enviar mensagem')
    }
  }

  const handleScroll = async () => {
    const el = containerRef.current
    if (!el || !nextCursor || isLoading || !activeChannel) return
    if (el.scrollTop <= 50) {
      isLoadingOlderRef.current = true
      const prevHeight = el.scrollHeight
      await fetchMessages(activeChannel.id, nextCursor)
      // Restore scroll position after older messages are loaded
      requestAnimationFrame(() => {
        const newHeight = el.scrollHeight
        el.scrollTop = newHeight - prevHeight
        isLoadingOlderRef.current = false
      })
    }
  }

  if (!activeChannel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <MessageSquare size={40} className="mx-auto mb-3" style={{ color: 'rgba(255,107,44,0.12)' }} />
          <p className="text-[#555555] text-[13px]" style={{ fontFamily: mono }}>
            Selecione um canal ou conversa
          </p>
        </div>
      </div>
    )
  }

  const channelLabel = activeChannel.type === 'dm'
    ? (activeChannel as Channel & { other_user?: { name: string } }).other_user?.name || activeChannel.name
    : activeChannel.name

  const displayMessages = [...messages].reverse()
  const isNoteTab = activeTab.startsWith('note-')
  const activeNoteId = isNoteTab ? activeTab.replace('note-', '') : null
  const activeNote = activeNoteId ? notes.find(n => n.id === activeNoteId) : null

  return (
    <div className="flex-1 flex flex-col min-w-0">
      {/* Channel Header */}
      <div
        className="flex items-center justify-between px-5 h-12 shrink-0"
        style={{ background: 'rgba(17,17,17,0.8)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {activeChannel.type !== 'dm' && <Hash size={16} className="text-[#555555] shrink-0" />}
          <h2 className="font-bold text-[15px] truncate" style={{ fontFamily: mono, color: '#e2e0da' }}>
            {channelLabel}
          </h2>
          {activeChannel.description && (
            <span className="text-[#555555] text-[12px] hidden sm:block truncate ml-2" style={{ fontFamily: mono }}>
              {activeChannel.description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {activeChannel.type !== 'dm' && (
            <button
              onClick={() => setShowSettings(true)}
              className="text-[#555555] hover:text-[#e2e0da] p-1.5 rounded-lg transition-colors"
              onMouseEnter={e => e.currentTarget.style.background = '#252525'}
              onMouseLeave={e => e.currentTarget.style.background = ''}
            >
              <Settings size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Channel Tabs */}
      <ChannelTabs channel={activeChannel} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Notes panel */}
      {isNoteTab && activeNote && (
        <NotesEditor channelId={activeChannel.id} note={activeNote} />
      )}

      {/* Messages (only when messages tab is active) */}
      {!isNoteTab && (
        <>
          <div
            ref={containerRef}
            className="flex-1 overflow-y-auto px-5 py-4 space-y-3"
            onScroll={handleScroll}
          >
            {isLoading && messages.length === 0 && (
              <div className="text-center text-[#555555] text-[12px] py-8" style={{ fontFamily: mono }}>Carregando...</div>
            )}

            {displayMessages.length === 0 && !isLoading && (
              <div className="text-center py-12">
                <Hash size={36} className="mx-auto mb-3" style={{ color: 'rgba(255,107,44,0.12)' }} />
                <p className="font-bold text-[16px] mb-1" style={{ fontFamily: mono, color: '#e2e0da' }}>
                  {activeChannel.type === 'dm' ? 'Início da conversa' : `# ${activeChannel.name}`}
                </p>
                <p className="text-[#555555] text-[13px]" style={{ fontFamily: mono }}>
                  {activeChannel.type === 'dm'
                    ? 'Envie a primeira mensagem.'
                    : `Este é o início do canal # ${activeChannel.name}. ${activeChannel.description || ''}`}
                </p>
              </div>
            )}

            {displayMessages.map(msg => {
              const isOwn = msg.sender_id === user?.id
              const isSystem = msg.message_type === 'system'

              if (isSystem) {
                return (
                  <div key={msg.id} className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                    <span className="text-[11px] text-[#555555] whitespace-nowrap" style={{ fontFamily: mono }}>{msg.content}</span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
                  </div>
                )
              }

              return (
                <div
                  key={msg.id}
                  className={`flex gap-3 group -mx-2 px-2 py-1 rounded-lg transition-colors ${isOwn ? 'justify-end' : ''}`}
                  style={{ background: 'transparent' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {!isOwn && (
                    <div
                      className="w-8 h-8 rounded-[10px] flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5"
                      style={{
                        background: '#121212',
                        boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                        color: '#D4835A',
                        fontFamily: mono,
                      }}
                    >
                      {msg.sender_name.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className={`${isOwn ? 'max-w-[75%]' : 'flex-1'} min-w-0 ${isOwn ? 'text-right' : ''}`}>
                    {!isOwn && (
                      <div className="flex items-baseline gap-2">
                        <span className="text-[13px] font-bold" style={{ fontFamily: mono, color: '#e2e0da' }}>
                          {msg.sender_name}
                        </span>
                        <span className="text-[11px] text-[#555555]" style={{ fontFamily: mono }}>
                          {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.edited_at && <span className="text-[10px] text-[#4a4a4a]">(editado)</span>}
                      </div>
                    )}
                    <div
                      className="text-[#c0c0c0] text-[13px] leading-relaxed break-words prose prose-sm prose-invert max-w-none
                        prose-headings:text-[#e2e0da] prose-headings:font-bold prose-headings:mt-2 prose-headings:mb-1
                        prose-p:text-[#c0c0c0] prose-p:leading-relaxed prose-p:my-0.5
                        prose-a:text-[#ff6b2c] prose-a:no-underline hover:prose-a:underline
                        prose-strong:text-[#e2e0da]
                        prose-code:text-[#ff6b2c] prose-code:bg-dim-hover prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px]
                        prose-pre:bg-[rgba(17,17,17,0.8)] prose-pre:border prose-pre:border-[rgba(255,255,255,0.06)] prose-pre:rounded-lg prose-pre:my-1
                        prose-blockquote:border-[rgba(249,115,22,0.4)] prose-blockquote:text-subtle
                        prose-li:text-[#c0c0c0]
                        prose-hr:border-[rgba(255,255,255,0.06)]"
                      style={{ fontFamily: mono }}
                    >
                      <Markdown remarkPlugins={[remarkGfm]}>{msg.content}</Markdown>
                    </div>
                    {isOwn && (
                      <div className="flex items-center gap-1.5 justify-end mt-0.5">
                        <span className="text-[10px] text-[#555555]" style={{ fontFamily: mono }}>
                          {new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.edited_at && <span className="text-[10px] text-[#4a4a4a]">(editado)</span>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-5 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div
              className="flex items-end gap-2 rounded-xl transition-all"
              style={{ background: '#222222', border: '1px solid rgba(255,255,255,0.06)' }}
              onFocus={e => {
                const el = e.currentTarget
                el.style.borderColor = 'rgba(249,115,22,0.4)'
                el.style.boxShadow = '0 0 20px rgba(255,107,44,0.1)'
              }}
              onBlur={e => {
                const el = e.currentTarget
                el.style.borderColor = 'rgba(255,255,255,0.06)'
                el.style.boxShadow = 'none'
              }}
            >
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder={`Enviar mensagem para ${activeChannel.type === 'dm' ? channelLabel : '#' + activeChannel.name}`}
                className="flex-1 resize-none bg-transparent px-4 py-3 text-[13px] focus:outline-none placeholder-[#555555]"
                style={{ fontFamily: mono, minHeight: 44, maxHeight: 120, color: '#e2e0da' }}
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="m-1.5 w-8 h-8 rounded-[10px] flex items-center justify-center transition-all disabled:opacity-30"
                style={{
                  background: '#121212',
                  boxShadow: input.trim()
                    ? '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)'
                    : 'none',
                  color: input.trim() ? '#D4835A' : '#555555',
                }}
              >
                <Send size={15} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Settings Modal */}
      {showSettings && activeChannel.type !== 'dm' && (
        <ChannelSettingsModal channel={activeChannel} onClose={() => setShowSettings(false)} />
      )}
    </div>
  )
}

// ─── Main Page ───
export default function ChatPage() {
  useChatSSE()
  return (
    <div className="flex h-[calc(100vh-3.5rem)] -m-5 lg:-m-6 overflow-hidden" style={{ background: '#0a0a0a', borderLeft: '1px solid rgba(255,255,255,0.06)' }}>
      <ChannelListPanel />
      <MessageArea />
    </div>
  )
}
