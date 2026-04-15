'use client'

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, ChevronDown } from 'lucide-react'
import { useOkrStore } from '@/store/useOkrStore'
import { useTeamStore } from '@/store/useTeamStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { OKR_TYPE_CONFIG } from '@/types/okr'
import type { OkrObjective, OkrObjectiveType } from '@/types/okr'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const TYPES: OkrObjectiveType[] = ['committed', 'aspirational', 'learning']

function generateCycles(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const cycles: string[] = []
  for (let y = year - 1; y <= year + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      cycles.push(`${y}-Q${q}`)
    }
  }
  return cycles
}

function formatCycle(cycle: string): string {
  const [year, quarter] = cycle.split('-')
  return `${quarter} ${year}`
}

export function ObjectiveFormModal({
  isOpen,
  onClose,
  workspaceId,
  objective,
  currentCycle,
  defaultTeamId,
}: {
  isOpen: boolean
  onClose: () => void
  workspaceId: string
  objective?: OkrObjective
  currentCycle: string
  defaultTeamId?: string
}) {
  const { createObjective, updateObjective, objectives } = useOkrStore()
  const { teams, fetchTeams } = useTeamStore()
  const { activeWorkspace } = useWorkspaceStore()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [objType, setObjType] = useState<OkrObjectiveType>('committed')
  const [cycle, setCycle] = useState(currentCycle)
  const [parentId, setParentId] = useState<string | null>(null)
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [cycleOpen, setCycleOpen] = useState(false)
  const [parentOpen, setParentOpen] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const cycleRef = useRef<HTMLDivElement>(null)
  const parentRef = useRef<HTMLDivElement>(null)
  const teamRef = useRef<HTMLDivElement>(null)
  const cycles = generateCycles()

  // Available parent objectives (exclude current objective if editing)
  const parentOptions = objectives.filter((o) => {
    const id = 'objective_id' in o ? o.objective_id : o.id
    return !objective || id !== objective.id
  })

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (cycleRef.current && !cycleRef.current.contains(e.target as Node)) setCycleOpen(false)
      if (parentRef.current && !parentRef.current.contains(e.target as Node)) setParentOpen(false)
      if (teamRef.current && !teamRef.current.contains(e.target as Node)) setTeamOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (isOpen && activeWorkspace?.workspace_id) {
      fetchTeams(activeWorkspace.workspace_id)
    }
  }, [isOpen, activeWorkspace?.workspace_id, fetchTeams])

  useEffect(() => {
    if (objective) {
      setTitle(objective.title)
      setDescription(objective.description || '')
      setObjType(objective.objective_type as OkrObjectiveType)
      setCycle(objective.cycle)
      setParentId(objective.parent_objective_id || null)
      setSelectedTeamIds(objective.team_ids?.length ? objective.team_ids : objective.team_id ? [objective.team_id] : defaultTeamId ? [defaultTeamId] : [])
    } else {
      setTitle('')
      setDescription('')
      setObjType('committed')
      setCycle(currentCycle)
      setParentId(null)
      setSelectedTeamIds(defaultTeamId ? [defaultTeamId] : [])
    }
  }, [objective, isOpen, currentCycle, defaultTeamId])

  if (!isOpen) return null

  const isEdit = !!objective

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      const teamPayload = selectedTeamIds.length > 0 ? { team_ids: selectedTeamIds } : {}
      if (isEdit) {
        await updateObjective(objective.id, { title, description, objective_type: objType, cycle, ...(parentId ? { parent_objective_id: parentId } : {}), ...teamPayload })
      } else {
        await createObjective(workspaceId, { title, description, objective_type: objType, cycle, ...(parentId ? { parent_objective_id: parentId } : {}), ...teamPayload })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      <div className="flex min-h-full items-center justify-center py-8 px-4">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div
          className="relative w-full max-w-md rounded-xl p-6"
          style={{
            background: '#141414',
            border: '1px solid #1e1e1e',
            boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
            animation: 'baisync-panel-in 0.2s ease-out',
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-heading text-[15px] font-bold" style={{ fontFamily: mono }}>
              {isEdit ? 'Editar Objetivo' : 'Novo Objetivo'}
            </h2>
            <button className="text-subtle hover:text-heading transition-colors" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Título do objetivo
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Aumentar a base de clientes..."
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Descrição
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o objetivo..."
              rows={3}
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full resize-none"
            />
          </div>

          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Tipo
            </label>
            <div className="flex gap-2">
              {TYPES.map((t) => {
                const cfg = OKR_TYPE_CONFIG[t]
                return (
                  <button
                    key={t}
                    type="button"
                    className="flex-1 px-3 py-2 rounded-[10px] text-xs font-medium transition-all duration-200"
                    style={{
                      background: objType === t ? `${cfg.color}15` : 'rgba(255,255,255,0.03)',
                      color: objType === t ? cfg.color : '#888',
                      border: `1px solid ${objType === t ? `${cfg.color}30` : '#1e1e1e'}`,
                    }}
                    onClick={() => setObjType(t)}
                  >
                    {cfg.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Ciclo
            </label>
            <div ref={cycleRef}>
              <button
                type="button"
                className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm transition-all duration-200 outline-none w-full flex items-center justify-between hover:border-[#ff6b2c]/30"
                style={{ fontFamily: mono }}
                onClick={() => setCycleOpen(!cycleOpen)}
              >
                <span>{formatCycle(cycle)}</span>
                <ChevronDown size={14} className={`text-subtle transition-transform duration-200 ${cycleOpen ? 'rotate-180' : ''}`} />
              </button>
              {cycleOpen && (
                <div
                  className="mt-2 rounded-xl overflow-hidden max-h-[160px] overflow-y-auto"
                  style={{ background: '#111', border: '1px solid #1e1e1e' }}
                >
                  {cycles.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-dim/50"
                      style={{
                        color: c === cycle ? '#ff6b2c' : '#c0c0c0',
                        background: c === cycle ? 'rgba(255,107,44,0.08)' : 'transparent',
                        fontFamily: mono,
                      }}
                      onClick={() => { setCycle(c); setCycleOpen(false) }}
                    >
                      {formatCycle(c)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Team selector (multi-select) */}
          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Equipes <span className="text-subtle/50">(opcional, pode selecionar várias)</span>
            </label>
            <div ref={teamRef}>
              <button
                type="button"
                className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm transition-all duration-200 outline-none w-full flex items-center justify-between hover:border-[#ff6b2c]/30"
                style={{ fontFamily: mono }}
                onClick={() => setTeamOpen(!teamOpen)}
              >
                <span className={selectedTeamIds.length > 0 ? 'text-body truncate' : 'text-subtle/50'}>
                  {selectedTeamIds.length > 0
                    ? selectedTeamIds.map((id) => teams.find((t) => t.id === id)?.name).filter(Boolean).join(', ') || 'Selecionar...'
                    : 'Nenhuma equipe (workspace)'}
                </span>
                <ChevronDown size={14} className={`text-subtle transition-transform duration-200 shrink-0 ml-2 ${teamOpen ? 'rotate-180' : ''}`} />
              </button>
              {teamOpen && (
                <div
                  className="mt-2 rounded-xl overflow-hidden max-h-[160px] overflow-y-auto"
                  style={{ background: '#111', border: '1px solid #1e1e1e' }}
                >
                  {selectedTeamIds.length > 0 && (
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-xs transition-colors hover:bg-dim/50"
                      style={{ color: '#888', fontFamily: mono }}
                      onClick={() => setSelectedTeamIds([])}
                    >
                      Limpar seleção
                    </button>
                  )}
                  {teams.map((t) => {
                    const isSelected = selectedTeamIds.includes(t.id)
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-dim/50 truncate flex items-center gap-2"
                        style={{
                          color: isSelected ? '#ff6b2c' : '#c0c0c0',
                          background: isSelected ? 'rgba(255,107,44,0.08)' : 'transparent',
                          fontFamily: mono,
                        }}
                        onClick={() => {
                          setSelectedTeamIds((prev) =>
                            isSelected ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                          )
                        }}
                      >
                        <div
                          className="w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center"
                          style={{
                            borderColor: isSelected ? '#ff6b2c' : '#444',
                            background: isSelected ? '#ff6b2c' : 'transparent',
                          }}
                        >
                          {isSelected && <span className="text-[8px] text-white font-bold">✓</span>}
                        </div>
                        {t.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Parent objective selector */}
          {parentOptions.length > 0 && (
            <div>
              <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
                Objetivo pai <span className="text-subtle/50">(opcional)</span>
              </label>
              <div ref={parentRef}>
                <button
                  type="button"
                  className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm transition-all duration-200 outline-none w-full flex items-center justify-between hover:border-[#ff6b2c]/30"
                  style={{ fontFamily: mono }}
                  onClick={() => setParentOpen(!parentOpen)}
                >
                  <span className={parentId ? 'text-body' : 'text-subtle/50'}>
                    {parentId
                      ? parentOptions.find((o) => ('objective_id' in o ? o.objective_id : o.id) === parentId)?.title || 'Selecionar...'
                      : 'Nenhum (raiz)'}
                  </span>
                  <ChevronDown size={14} className={`text-subtle transition-transform duration-200 ${parentOpen ? 'rotate-180' : ''}`} />
                </button>
                {parentOpen && (
                  <div
                    className="mt-2 rounded-xl overflow-hidden max-h-[160px] overflow-y-auto"
                    style={{ background: '#111', border: '1px solid #1e1e1e' }}
                  >
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-dim/50"
                      style={{ color: !parentId ? '#ff6b2c' : '#c0c0c0', background: !parentId ? 'rgba(255,107,44,0.08)' : 'transparent', fontFamily: mono }}
                      onClick={() => { setParentId(null); setParentOpen(false) }}
                    >
                      Nenhum (raiz)
                    </button>
                    {parentOptions.map((o) => {
                      const id = 'objective_id' in o ? o.objective_id : o.id
                      return (
                        <button
                          key={id}
                          type="button"
                          className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-dim/50 truncate"
                          style={{
                            color: id === parentId ? '#ff6b2c' : '#c0c0c0',
                            background: id === parentId ? 'rgba(255,107,44,0.08)' : 'transparent',
                            fontFamily: mono,
                          }}
                          onClick={() => { setParentId(id); setParentOpen(false) }}
                        >
                          {o.title}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-2">
            <button type="button" className="btn-neu-ghost text-sm px-4 py-2 rounded-[10px]" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-neu text-sm px-4 py-2 rounded-[10px]" disabled={!title.trim() || saving}>
              {saving ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar Objetivo'}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>,
    document.body
  )
}
