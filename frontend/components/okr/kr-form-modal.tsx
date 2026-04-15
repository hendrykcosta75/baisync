'use client'

import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useOkrStore } from '@/store/useOkrStore'
import type { KrType } from '@/types/okr'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const KR_TYPES: { key: KrType; label: string }[] = [
  { key: 'number', label: 'Numérico' },
  { key: 'percentage', label: 'Percentual' },
  { key: 'binary', label: 'Binário' },
]

export function KrFormModal({
  isOpen,
  onClose,
  objectiveId,
}: {
  isOpen: boolean
  onClose: () => void
  objectiveId: string
}) {
  const { createKeyResult } = useOkrStore()
  const [title, setTitle] = useState('')
  const [krType, setKrType] = useState<KrType>('number')
  const [startValue, setStartValue] = useState(0)
  const [targetValue, setTargetValue] = useState(100)
  const [unit, setUnit] = useState('')
  const [saving, setSaving] = useState(false)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)
    try {
      await createKeyResult(objectiveId, {
        title,
        kr_type: krType,
        start_value: krType === 'binary' ? 0 : startValue,
        target_value: krType === 'binary' ? 1 : targetValue,
        unit: krType === 'binary' ? undefined : unit || undefined,
      })
      setTitle('')
      setKrType('number')
      setStartValue(0)
      setTargetValue(100)
      setUnit('')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-4 rounded-xl p-6 max-h-[85vh] overflow-y-auto"
        style={{
          background: '#141414',
          border: '1px solid #1e1e1e',
          boxShadow: '0 24px 48px rgba(0,0,0,0.5)',
          animation: 'baisync-panel-in 0.2s ease-out',
        }}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-heading text-[15px] font-bold" style={{ fontFamily: mono }}>
            Novo Resultado-Chave
          </h2>
          <button className="text-subtle hover:text-heading transition-colors" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Título
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Aumentar NPS de 40 para 60..."
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
              autoFocus
              required
            />
          </div>

          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Tipo
            </label>
            <div className="flex gap-2">
              {KR_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className="flex-1 px-3 py-2 rounded-[10px] text-xs font-medium transition-all duration-200"
                  style={{
                    background: krType === t.key ? 'rgba(255,107,44,0.12)' : 'rgba(255,255,255,0.03)',
                    color: krType === t.key ? '#ff6b2c' : '#888',
                    border: `1px solid ${krType === t.key ? 'rgba(255,107,44,0.3)' : '#1e1e1e'}`,
                  }}
                  onClick={() => setKrType(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {krType === 'binary' ? (
            <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e1e' }}>
              <p className="text-body text-sm">
                Resultado binário: <span className="text-heading font-medium">Concluído</span> ou <span className="text-heading font-medium">Não concluído</span>
              </p>
              <p className="text-subtle text-xs mt-1">O valor será 0 (não concluído) ou 1 (concluído)</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
                    Valor inicial
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={startValue}
                    onChange={(e) => setStartValue(parseFloat(e.target.value) || 0)}
                    className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
                  />
                </div>
                <div>
                  <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
                    Meta
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={targetValue}
                    onChange={(e) => setTargetValue(parseFloat(e.target.value) || 0)}
                    className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
                  />
                </div>
              </div>
              <div>
                <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
                  Unidade
                </label>
                <input
                  type="text"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="Ex: leads, %, pontos..."
                  className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-3 mt-2">
            <button type="button" className="btn-neu-ghost text-sm px-4 py-2 rounded-[10px]" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-neu text-sm px-4 py-2 rounded-[10px]" disabled={!title.trim() || saving}>
              {saving ? 'Salvando...' : 'Criar KR'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
