'use client'

import React, { useEffect, useState } from 'react'
import { useWorkspaceStore, type Workspace } from '@/store/useWorkspaceStore'
import { useAuthStore } from '@/store/useAuthStore'
import { ChevronDown, Plus, User, Check } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { workspaces, activeWorkspace, fetchWorkspaces, switchWorkspace, createWorkspace } = useWorkspaceStore()
  const { user } = useAuthStore()
  const [isOpen, setIsOpen] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

  const handleSwitch = async (ws: Workspace) => {
    if (ws.workspace_id === activeWorkspace?.workspace_id) {
      setIsOpen(false)
      return
    }
    await switchWorkspace(ws.workspace_id)
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createWorkspace(newName.trim())
      setShowCreate(false)
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  const displayName = activeWorkspace
    ? (activeWorkspace.workspace_type === 'personal' ? 'Personal Workspace' : activeWorkspace.workspace_name)
    : 'Personal Workspace'

  // Collapsed: just show icon
  if (collapsed) {
    return (
      <div className="hidden lg:flex items-center justify-center h-11 shrink-0" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        <button
          className="w-7 h-7 rounded-[10px] flex items-center justify-center hover:opacity-80 transition-opacity"
          style={{
            background: '#121212',
            boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
            color: '#D4835A',
          }}
          onClick={() => setIsOpen(!isOpen)}
          title={displayName}
        >
          {activeWorkspace?.workspace_type === 'personal'
            ? <User size={15} />
            : <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700 }}>{displayName.charAt(0).toUpperCase()}</span>}
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Workspace select box — primary sidebar element */}
      <button
        className="w-full flex items-center gap-2.5 px-4 h-11 shrink-0 hover:bg-dim transition-colors"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div
          className="w-7 h-7 rounded-[10px] flex items-center justify-center shrink-0"
          style={{
            background: '#121212',
            boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
            color: '#D4835A',
          }}
        >
          {activeWorkspace?.workspace_type === 'personal'
            ? <User size={14} />
            : <span style={{ fontFamily: mono, fontSize: 10, fontWeight: 700 }}>{displayName.charAt(0).toUpperCase()}</span>}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <span className="text-[13px] font-semibold text-white truncate block" style={{ fontFamily: mono, letterSpacing: '-0.02em' }}>
            {displayName}
          </span>
        </div>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} style={{ color: '#D4835A', opacity: 0.5 }} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => { setIsOpen(false); setShowCreate(false) }} />
          <div
            className="absolute left-2 right-2 top-full mt-1 z-[60] rounded-xl border border-dim-hover shadow-2xl overflow-hidden"
            style={{ background: '#1a1a1a' }}
          >
            <div className="max-h-[280px] overflow-y-auto py-1">
              {workspaces.length === 0 && (
                <div className="px-4 py-3 text-[12px] text-[#5a5a5a]" style={{ fontFamily: mono }}>
                  Nenhum workspace encontrado
                </div>
              )}
              {workspaces.map(ws => {
                const isActive = ws.workspace_id === activeWorkspace?.workspace_id
                const label = ws.workspace_type === 'personal' ? 'Personal Workspace' : ws.workspace_name
                return (
                  <button
                    key={ws.workspace_id}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                      isActive ? 'bg-dim-hover' : 'hover:bg-[#1e1e1e]'
                    }`}
                    onClick={() => handleSwitch(ws)}
                  >
                    <div
                      className="w-5 h-5 rounded-md flex items-center justify-center font-bold text-[10px] shrink-0"
                      style={{
                        background: ws.workspace_type === 'personal'
                          ? 'rgba(255,107,44,0.15)'
                          : 'rgba(139,92,246,0.15)',
                        color: ws.workspace_type === 'personal' ? '#ff6b2c' : '#8b5cf6',
                        fontFamily: mono,
                      }}
                    >
                      {ws.workspace_type === 'personal' ? <User size={13} /> : label.charAt(0).toUpperCase()}
                    </div>
                    <span className={`flex-1 truncate text-[12px] ${isActive ? 'text-white font-semibold' : 'text-subtle'}`} style={{ fontFamily: mono }}>
                      {label}
                    </span>
                    {isActive && <Check size={14} className="text-[#ff6b2c] shrink-0" />}
                  </button>
                )
              })}
            </div>

            <div className="border-t border-dim-hover p-2 overflow-hidden">
              {showCreate ? (
                <div className="flex gap-2 p-1 min-w-0">
                  <input
                    placeholder="Nome da empresa"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreate()}
                    autoFocus
                    className="flex-1 min-w-0 rounded-md px-3 py-1.5 text-sm text-white border border-dim-hover bg-dim-hover focus:border-[#ff6b2c] focus:outline-none"
                    style={{ fontFamily: mono }}
                  />
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="shrink-0 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold transition-all disabled:opacity-40"
                    style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A', fontFamily: mono }}
                  >
                    {creating ? '...' : 'Criar'}
                  </button>
                </div>
              ) : (
                <button
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-subtle hover:text-white hover:bg-dim-hover transition-colors"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus size={15} />
                  <span className="text-[12px]" style={{ fontFamily: mono, fontWeight: 500 }}>
                    Criar novo workspace
                  </span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
