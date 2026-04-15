'use client'

import React, { useState, useEffect, useRef } from 'react'
import { Target, ChevronDown, ChevronRight, Plus, GitBranch, Trash2, Paperclip, Download, X as XIcon } from 'lucide-react'
import { OKR_TYPE_CONFIG, getConfidenceColor, getProgressPercent } from '@/types/okr'
import type { OkrObjective, OkrObjectiveByCycle, OkrKeyResult, OkrObjectiveType, OkrStatus, OkrAttachment } from '@/types/okr'
import { useOkrStore } from '@/store/useOkrStore'
import { useTeamStore } from '@/store/useTeamStore'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const STATUS_LABELS: Record<string, string> = {
  on_track: 'No Prazo',
  at_risk: 'Em Risco',
  behind: 'Atrasado',
  achieved: 'Alcançado',
}

export function OkrCard({
  objective,
  onCheckIn,
  onAddKr,
  onDelete,
}: {
  objective: OkrObjective | OkrObjectiveByCycle
  onCheckIn: (krId: string, currentValue: number) => void
  onAddKr: (objectiveId: string) => void
  onDelete?: (objectiveId: string) => void
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [attachments, setAttachments] = useState<OkrAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { fetchAttachments, uploadAttachment, deleteAttachment } = useOkrStore()

  const id = 'objective_id' in objective ? objective.objective_id : objective.id
  const title = objective.title
  const objType = objective.objective_type as OkrObjectiveType
  const status = objective.status as OkrStatus
  const progress = Math.round((objective.progress ?? 0) * 100)
  const confidence = objective.confidence ?? 0.5
  const krs: OkrKeyResult[] = ('key_results' in objective && Array.isArray(objective.key_results))
    ? objective.key_results
    : []

  const teamIds: string[] = ('team_ids' in objective && Array.isArray(objective.team_ids) && objective.team_ids.length > 0)
    ? objective.team_ids
    : ('team_id' in objective && objective.team_id ? [objective.team_id] : [])
  const { teams } = useTeamStore()

  const hasParent = 'parent_objective_id' in objective && !!objective.parent_objective_id
  const hasChildren = 'children' in objective && Array.isArray(objective.children) && objective.children.length > 0

  const typeCfg = OKR_TYPE_CONFIG[objType] || OKR_TYPE_CONFIG.committed
  const confColor = getConfidenceColor(confidence)

  useEffect(() => {
    if (expanded) {
      fetchAttachments('objectives', id).then(setAttachments).catch(() => {})
    }
  }, [expanded, id, fetchAttachments])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const att = await uploadAttachment('objectives', id, file)
      setAttachments((prev) => [...prev, att])
    } catch {
      // Error handled by store
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDeleteAttachment = async (attachmentId: string) => {
    try {
      await deleteAttachment(id, attachmentId)
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId))
    } catch {
      // Error handled by store
    }
  }

  return (
    <div
      className="rounded-xl overflow-hidden transition-all duration-300"
      style={{ background: '#141414', border: '1px solid #1e1e1e' }}
    >
      {/* Header — always visible */}
      <div
        className="flex items-center gap-3 p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <Target size={16} style={{ color: '#D4835A' }} className="shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-heading text-sm font-semibold truncate" style={{ fontFamily: mono }}>
              {title}
            </h3>
            <span
              className="px-2 py-0.5 rounded text-[10px] font-medium shrink-0"
              style={{ background: `${typeCfg.color}15`, color: typeCfg.color }}
            >
              {typeCfg.label}
            </span>
            {(hasParent || hasChildren) && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                style={{ background: 'rgba(139,92,246,0.1)', color: '#8b5cf6' }}
                title={hasParent ? 'Sub-objetivo' : 'Tem sub-objetivos'}
              >
                <GitBranch size={10} />
                {hasParent ? 'Sub' : 'Pai'}
              </span>
            )}
            {teamIds.length > 0 && teamIds.map((tid) => {
              const team = teams.find((t) => t.id === tid)
              if (!team) return null
              return (
                <span
                  key={tid}
                  className="px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0"
                  style={{ background: `${team.color || '#8b5cf6'}15`, color: team.color || '#8b5cf6' }}
                >
                  {team.name}
                </span>
              )
            })}
          </div>

          {/* Progress bar */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-dim overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  background: `linear-gradient(90deg, ${confColor}80, ${confColor})`,
                }}
              />
            </div>
            <span className="text-heading text-xs font-medium shrink-0 w-10 text-right">{progress}%</span>
          </div>
        </div>

        {/* Confidence badge */}
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
          style={{ background: `${confColor}15`, color: confColor }}
          title={`Confiança: ${Math.round(confidence * 10)}/10`}
        >
          {Math.round(confidence * 10)}
        </div>

        {/* Status badge */}
        <span
          className="px-2 py-0.5 rounded text-[10px] font-medium shrink-0"
          style={{ background: `${confColor}12`, color: confColor }}
        >
          {STATUS_LABELS[status] || status}
        </span>

        {/* Delete */}
        {onDelete && (
          <button
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 hover:bg-[rgba(239,68,68,0.1)] transition-colors"
            onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true) }}
            title="Excluir objetivo"
          >
            <Trash2 size={14} className="text-subtle hover:text-red-400 transition-colors" />
          </button>
        )}

        {/* Chevron */}
        <div className="text-subtle shrink-0">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </div>
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="px-5 py-3 border-t border-dim flex items-center justify-between" style={{ background: 'rgba(239,68,68,0.04)' }}>
          <span className="text-sm text-red-400" style={{ fontFamily: mono }}>Excluir este objetivo?</span>
          <div className="flex items-center gap-2">
            <button
              className="btn-neu text-[11px] px-3 py-1 rounded-lg"
              onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false) }}
            >
              Cancelar
            </button>
            <button
              className="text-[11px] px-3 py-1 rounded-lg font-medium transition-colors"
              style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
              onClick={(e) => { e.stopPropagation(); onDelete?.(id); setShowDeleteConfirm(false) }}
            >
              Confirmar
            </button>
          </div>
        </div>
      )}

      {/* Expanded: Key Results */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-dim pt-4 space-y-3">
          {krs.length === 0 ? (
            <p className="text-subtle text-sm py-2">Nenhum resultado-chave definido</p>
          ) : (
            krs.map((kr, i) => {
              const krProgress = Math.round(getProgressPercent(kr))
              const krConfColor = getConfidenceColor(kr.confidence)
              return (
                <div
                  key={kr.id}
                  className="flex items-center gap-3 py-2 animate-fade-in-up opacity-0"
                  style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-body text-sm">{kr.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-20 h-1 rounded-full bg-dim overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${krProgress}%`, backgroundColor: krConfColor }}
                        />
                      </div>
                      <span className="text-subtle text-[10px]">
                        {kr.current_value}/{kr.target_value} {kr.unit || ''}
                      </span>
                    </div>
                  </div>

                  {/* KR confidence */}
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
                    style={{ background: `${krConfColor}15`, color: krConfColor }}
                  >
                    {Math.round(kr.confidence * 10)}
                  </div>

                  {/* Check-in button */}
                  <button
                    className="btn-neu text-[11px] px-2.5 py-1 rounded-lg shrink-0"
                    onClick={(e) => { e.stopPropagation(); onCheckIn(kr.id, kr.current_value) }}
                  >
                    Check-in
                  </button>
                </div>
              )
            })
          )}

          <button
            className="flex items-center gap-1.5 text-subtle text-xs hover:text-heading transition-colors pt-1"
            onClick={(e) => { e.stopPropagation(); onAddKr(id) }}
          >
            <Plus size={14} />
            Adicionar Resultado-Chave
          </button>

          {/* Attachments / Supporting Documents */}
          <div className="pt-3 border-t border-dim mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-subtle text-xs font-medium flex items-center gap-1.5">
                <Paperclip size={12} />
                Documentos de Comprovação
              </span>
              <label className={`flex items-center gap-1 text-[11px] cursor-pointer transition-colors ${uploading ? 'text-subtle pointer-events-none' : 'text-subtle hover:text-heading'}`}>
                <Plus size={12} />
                {uploading ? 'Enviando...' : 'Anexar'}
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </label>
            </div>
            {attachments.length > 0 && (
              <div className="space-y-1.5">
                {attachments.map((att) => (
                  <div key={att.id} className="flex items-center gap-2 py-1 px-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <Paperclip size={10} className="text-subtle shrink-0" />
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL}/api/okr-attachments/file/${att.entity_id}/${att.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-body hover:text-heading truncate flex-1 transition-colors"
                    >
                      {att.file_name}
                    </a>
                    <span className="text-[9px] text-subtle shrink-0">
                      {(att.file_size / 1024).toFixed(0)} KB
                    </span>
                    <button
                      className="w-5 h-5 rounded flex items-center justify-center hover:bg-[rgba(239,68,68,0.1)] transition-colors shrink-0"
                      onClick={(e) => { e.stopPropagation(); handleDeleteAttachment(att.id) }}
                    >
                      <XIcon size={10} className="text-subtle hover:text-red-400" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
