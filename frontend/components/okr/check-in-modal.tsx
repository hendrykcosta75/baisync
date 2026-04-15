'use client'

import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Paperclip, Trash2, FileText, Upload } from 'lucide-react'
import { useOkrStore } from '@/store/useOkrStore'
import { getConfidenceColor } from '@/types/okr'
import type { OkrAttachment } from '@/types/okr'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function CheckInModal({
  isOpen,
  onClose,
  krId,
  currentValue,
}: {
  isOpen: boolean
  onClose: () => void
  krId: string
  currentValue: number
}) {
  const { createCheckIn, uploadAttachment, fetchAttachments, deleteAttachment } = useOkrStore()
  const [newValue, setNewValue] = useState(currentValue)
  const [confidence, setConfidence] = useState(5)
  const [note, setNote] = useState('')
  const [blockers, setBlockers] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [existingAttachments, setExistingAttachments] = useState<OkrAttachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen && krId) {
      fetchAttachments('key-results', krId).then(setExistingAttachments).catch(() => {})
      setPendingFiles([])
      setNewValue(currentValue)
      setConfidence(5)
      setNote('')
      setBlockers('')
    }
  }, [isOpen, krId, currentValue, fetchAttachments])

  if (!isOpen) return null

  const handleFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter((f) => f.size <= 10 * 1024 * 1024)
    setPendingFiles((prev) => [...prev, ...validFiles])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleRemovePending = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleDeleteExisting = async (attachmentId: string) => {
    try {
      await deleteAttachment(krId, attachmentId)
      setExistingAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
    } catch {}
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const checkIn = await createCheckIn(krId, {
        new_value: newValue,
        confidence: confidence / 10,
        note: note || undefined,
        blockers: blockers || undefined,
      })
      // Upload pending files attached to this KR
      for (const file of pendingFiles) {
        await uploadAttachment('key-results', krId, file)
      }
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
            Check-in
          </h2>
          <button className="text-subtle hover:text-heading transition-colors" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Value */}
          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Valor atual
            </label>
            <input
              type="number"
              step="any"
              value={newValue}
              onChange={(e) => setNewValue(parseFloat(e.target.value) || 0)}
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
              autoFocus
            />
          </div>

          {/* Confidence */}
          <div>
            <label className="text-subtle text-xs font-medium mb-2 block" style={{ fontFamily: mono }}>
              Confiança ({confidence}/10)
            </label>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: 10 }).map((_, i) => {
                const level = i + 1
                const filled = level <= confidence
                const color = getConfidenceColor(level / 10)
                return (
                  <button
                    key={level}
                    type="button"
                    className="w-7 h-7 rounded-full transition-all duration-200 text-[10px] font-bold"
                    style={{
                      background: filled ? `${color}25` : 'rgba(255,255,255,0.03)',
                      color: filled ? color : '#555',
                      border: `1.5px solid ${filled ? color : '#2a2a2a'}`,
                      transform: filled ? 'scale(1.05)' : 'scale(1)',
                    }}
                    onClick={() => setConfidence(level)}
                  >
                    {level}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              O que aconteceu?
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Descreva o progresso..."
              rows={3}
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full resize-none"
            />
          </div>

          {/* Blockers */}
          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 block" style={{ fontFamily: mono }}>
              Bloqueios (opcional)
            </label>
            <textarea
              value={blockers}
              onChange={(e) => setBlockers(e.target.value)}
              placeholder="Há algo impedindo o progresso?"
              rows={2}
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full resize-none"
            />
          </div>

          {/* Attachments */}
          <div>
            <label className="text-subtle text-xs font-medium mb-1.5 flex items-center gap-1.5" style={{ fontFamily: mono }}>
              <Paperclip size={12} />
              Comprovantes (opcional)
            </label>

            {/* Existing attachments */}
            {existingAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center gap-2 px-3 py-2 rounded-lg mb-1.5"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #1e1e1e' }}
              >
                <FileText size={14} className="text-subtle shrink-0" />
                <span className="text-body text-xs truncate flex-1">{att.file_name}</span>
                <span className="text-subtle text-[10px] shrink-0">{formatSize(att.file_size)}</span>
                <button
                  type="button"
                  className="text-subtle hover:text-red-400 transition-colors shrink-0"
                  onClick={() => handleDeleteExisting(att.id)}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

            {/* Pending files */}
            {pendingFiles.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 rounded-lg mb-1.5"
                style={{ background: 'rgba(255,107,44,0.04)', border: '1px solid rgba(255,107,44,0.15)' }}
              >
                <Upload size={14} style={{ color: '#D4835A' }} className="shrink-0" />
                <span className="text-body text-xs truncate flex-1">{file.name}</span>
                <span className="text-subtle text-[10px] shrink-0">{formatSize(file.size)}</span>
                <button
                  type="button"
                  className="text-subtle hover:text-red-400 transition-colors shrink-0"
                  onClick={() => handleRemovePending(i)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileAdd}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.csv,.txt"
            />
            <button
              type="button"
              className="flex items-center gap-1.5 text-subtle text-xs hover:text-heading transition-colors mt-1"
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip size={12} />
              Anexar arquivo (max 10MB)
            </button>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 mt-1">
            <button type="button" className="btn-neu-ghost text-sm px-4 py-2 rounded-[10px]" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn-neu text-sm px-4 py-2 rounded-[10px]" disabled={saving}>
              {saving ? 'Salvando...' : 'Registrar Check-in'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
