'use client'

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTeamStore } from '@/store/useTeamStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { X } from 'lucide-react'
import type { TeamWithStats } from '@/types/team'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const COLOR_PRESETS = [
  '#ff6b2c', '#8b5cf6', '#3b82f6', '#22c55e',
  '#f59e0b', '#ef4444', '#ec4899', '#06b6d4',
]

export function TeamFormModal({
  isOpen,
  onClose,
  team,
}: {
  isOpen: boolean
  onClose: () => void
  team?: TeamWithStats
}) {
  const { createTeam, updateTeam } = useTeamStore()
  const { activeWorkspace } = useWorkspaceStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (team) {
      setName(team.name)
      setDescription(team.description || '')
      setColor(team.color || COLOR_PRESETS[0])
    } else {
      setName('')
      setDescription('')
      setColor(COLOR_PRESETS[0])
    }
  }, [team, isOpen])

  if (!isOpen) return null

  const isEdit = !!team

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !activeWorkspace) return
    setSaving(true)
    try {
      if (isEdit) {
        await updateTeam(team.id, { name: name.trim(), description: description.trim() || undefined, color })
      } else {
        await createTeam(activeWorkspace.workspace_id, name.trim(), description.trim() || undefined, color)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      <div className="flex min-h-full items-center justify-center py-8 px-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="relative w-full max-w-md rounded-xl p-6"
        style={{
          background: '#141414',
          border: '1px solid #1e1e1e',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          animation: 'baisync-panel-in 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2
            className="text-heading text-[15px] font-bold"
            style={{ fontFamily: mono }}
          >
            {isEdit ? 'Editar Equipe' : 'Nova Equipe'}
          </h2>
          <button
            className="text-subtle hover:text-heading transition-colors"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* Name */}
          <div>
            <label
              className="text-subtle text-xs font-medium mb-1.5 block"
              style={{ fontFamily: mono }}
            >
              Nome da equipe
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Marketing, Engenharia..."
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
              autoFocus
              required
            />
          </div>

          {/* Description */}
          <div>
            <label
              className="text-subtle text-xs font-medium mb-1.5 block"
              style={{ fontFamily: mono }}
            >
              Descrição
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva o propósito desta equipe..."
              rows={3}
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full resize-none"
            />
          </div>

          {/* Color */}
          <div>
            <label
              className="text-subtle text-xs font-medium mb-1.5 block"
              style={{ fontFamily: mono }}
            >
              Cor
            </label>
            <div className="flex items-center gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="w-7 h-7 rounded-full transition-all duration-200 shrink-0"
                  style={{
                    backgroundColor: c,
                    border: color === c ? '2px solid #e2e0da' : '2px solid transparent',
                    boxShadow: color === c ? `0 0 12px ${c}40` : 'none',
                    transform: color === c ? 'scale(1.1)' : 'scale(1)',
                  }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 mt-2">
            <button
              type="button"
              className="btn-neu-ghost text-sm px-4 py-2 rounded-[10px]"
              onClick={onClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-neu text-sm px-4 py-2 rounded-[10px]"
              disabled={!name.trim() || saving}
            >
              {saving ? 'Salvando...' : isEdit ? 'Salvar' : 'Criar Equipe'}
            </button>
          </div>
        </form>
      </div>
      </div>
    </div>,
    document.body
  )
}
