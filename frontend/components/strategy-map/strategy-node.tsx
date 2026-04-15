'use client'

import React, { memo, useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/react'
import {
  Target, BarChart3, Circle, Pencil, Trash2,
  UsersRound, Users, MessageSquare, Bot, ListTodo, Crosshair, Building2, StickyNote,
} from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const NODE_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  workspace: { icon: Building2, color: '#ff6b2c', label: 'Workspace' },
  objective: { icon: Target, color: '#D4835A', label: 'Objetivo' },
  key_result: { icon: BarChart3, color: '#3b82f6', label: 'Resultado-Chave' },
  team: { icon: UsersRound, color: '#8b5cf6', label: 'Equipe' },
  member: { icon: Users, color: '#06b6d4', label: 'Membro' },
  channel: { icon: MessageSquare, color: '#f59e0b', label: 'Canal' },
  assistant: { icon: Bot, color: '#ec4899', label: 'Assistente IA' },
  task: { icon: ListTodo, color: '#14b8a6', label: 'Tarefa' },
  swot: { icon: Crosshair, color: '#f97316', label: 'SWOT' },
  sticky_note: { icon: StickyNote, color: '#fbbf24', label: 'Nota' },
  custom: { icon: Circle, color: '#6b7280', label: 'Personalizado' },
}

const BSC_COLORS: Record<string, string> = {
  financial: '#f59e0b',
  customer: '#3b82f6',
  internal: '#22c55e',
  learning: '#8b5cf6',
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  on_track: { label: 'No rumo', color: '#22c55e' },
  at_risk: { label: 'Em risco', color: '#f59e0b' },
  behind: { label: 'Atrasado', color: '#ef4444' },
  draft: { label: 'Rascunho', color: '#6b7280' },
  active: { label: 'Ativo', color: '#22c55e' },
  done: { label: 'Concluído', color: '#3b82f6' },
  open: { label: 'Aberto', color: '#f59e0b' },
  in_progress: { label: 'Em progresso', color: '#3b82f6' },
  completed: { label: 'Completo', color: '#22c55e' },
}

interface StyleMeta {
  progress?: number
  confidence?: number
  status?: string
  objective_type?: string
  cycle?: string
  description?: string
  current_value?: number
  target_value?: number
  start_value?: number
  unit?: string
  kr_type?: string
  channel_type?: string
  // sticky note
  color?: string
}

function ProgressBar({ value, color, height = 3 }: { value: number; color: string; height?: number }) {
  const pct = Math.max(0, Math.min(100, value * 100))
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height, background: `${color}15` }}
    >
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function StrategyNodeInner({ data, id, selected }: NodeProps) {
  const nodeType = (data as Record<string, unknown>).nodeType as string || 'custom'
  const label = (data as Record<string, unknown>).label as string || ''
  const bscPerspective = (data as Record<string, unknown>).bscPerspective as string | null
  const styleData = (data as Record<string, unknown>).styleData as string | null
  const onEditLabel = (data as Record<string, unknown>).onEditLabel as ((id: string, label: string) => void) | undefined
  const onDelete = (data as Record<string, unknown>).onDelete as ((id: string) => void) | undefined
  const onUpdateStyle = (data as Record<string, unknown>).onUpdateStyle as ((id: string, styleData: string) => void) | undefined

  const meta: StyleMeta = useMemo(() => {
    if (!styleData) return {}
    try { return JSON.parse(styleData) } catch { return {} }
  }, [styleData])

  const isWorkspace = nodeType === 'workspace'
  const isStickyNote = nodeType === 'sticky_note'
  const cfg = NODE_CONFIG[nodeType] || NODE_CONFIG.custom
  const Icon = cfg.icon
  const bscColor = bscPerspective ? BSC_COLORS[bscPerspective] : null
  const statusInfo = meta.status ? STATUS_LABELS[meta.status] : null

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const [showActions, setShowActions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(label)
    setIsEditing(true)
  }, [label])

  const handleConfirmEdit = useCallback(() => {
    if (editValue.trim() && editValue !== label && onEditLabel) {
      onEditLabel(id, editValue.trim())
    }
    setIsEditing(false)
  }, [editValue, label, onEditLabel, id])

  const handleCancelEdit = useCallback(() => {
    setEditValue(label)
    setIsEditing(false)
  }, [label])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter') handleConfirmEdit()
    if (e.key === 'Escape') handleCancelEdit()
  }, [handleConfirmEdit, handleCancelEdit])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (onDelete) onDelete(id)
  }, [onDelete, id])

  // Compute KR progress from values
  const krProgress = useMemo(() => {
    if (nodeType !== 'key_result' || meta.target_value === undefined) return null
    const range = (meta.target_value ?? 0) - (meta.start_value ?? 0)
    if (Math.abs(range) < 0.0001) {
      return meta.kr_type === 'binary' ? ((meta.current_value ?? 0) >= 1 ? 1 : 0) : 0
    }
    return Math.max(0, Math.min(1, ((meta.current_value ?? 0) - (meta.start_value ?? 0)) / range))
  }, [nodeType, meta])

  // ─── Sticky Note rendering ───
  const STICKY_COLORS = [
    { bg: 'rgba(251,191,36,0.08)', border: '#fbbf24', text: 'rgba(251,191,36,0.7)' },
    { bg: 'rgba(59,130,246,0.08)', border: '#3b82f6', text: 'rgba(59,130,246,0.7)' },
    { bg: 'rgba(34,197,94,0.08)', border: '#22c55e', text: 'rgba(34,197,94,0.7)' },
    { bg: 'rgba(239,68,68,0.08)', border: '#ef4444', text: 'rgba(239,68,68,0.7)' },
    { bg: 'rgba(168,85,247,0.08)', border: '#a855f7', text: 'rgba(168,85,247,0.7)' },
    { bg: 'rgba(255,255,255,0.04)', border: '#555', text: 'rgba(255,255,255,0.5)' },
  ]

  if (isStickyNote) {
    const colorIdx = STICKY_COLORS.findIndex((c) => c.border === meta.color)
    const sc = colorIdx >= 0 ? STICKY_COLORS[colorIdx] : STICKY_COLORS[0]
    const [showColorPicker, setShowColorPicker] = useState(false)

    const handleColorChange = useCallback((color: string) => {
      if (onUpdateStyle) {
        onUpdateStyle(id, JSON.stringify({ ...meta, color }))
      }
      setShowColorPicker(false)
    }, [id, meta, onUpdateStyle])

    return (
      <div
        className="rounded-lg transition-all duration-200 group px-4 py-3 min-h-[60px]"
        style={{
          background: sc.bg,
          border: `1.5px dashed ${selected ? sc.border : `${sc.border}40`}`,
          boxShadow: selected ? `0 0 16px ${sc.border}20` : 'none',
          fontFamily: mono,
          zIndex: -1,
        }}
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => { if (!isEditing) { setShowActions(false); setShowColorPicker(false) } }}
      >
        <NodeResizer
          isVisible={selected}
          minWidth={140}
          minHeight={50}
          lineStyle={{ borderColor: `${sc.border}40` }}
          handleStyle={{ background: sc.border, width: 8, height: 8, borderRadius: 2, border: 'none' }}
        />
        {/* Actions */}
        {showActions && !isEditing && (
          <div className="flex items-center gap-0.5 justify-end mb-1 relative">
            <button className="w-5 h-5 rounded flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)]" onClick={handleStartEdit} title="Editar texto"><Pencil size={9} className="text-subtle" /></button>
            <button
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)]"
              onClick={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
              title="Alterar cor"
            >
              <div className="w-3 h-3 rounded-sm" style={{ background: sc.border }} />
            </button>
            {onDelete && <button className="w-5 h-5 rounded flex items-center justify-center hover:bg-[rgba(239,68,68,0.1)]" onClick={handleDelete} title="Excluir"><Trash2 size={9} className="text-red-400" /></button>}
            {showColorPicker && (
              <div className="absolute top-6 right-0 flex gap-1 p-1.5 rounded-lg z-10" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }}>
                {STICKY_COLORS.map((c) => (
                  <button
                    key={c.border}
                    className="w-5 h-5 rounded-sm transition-transform hover:scale-125"
                    style={{ background: c.border, outline: c.border === sc.border ? '2px solid white' : 'none', outlineOffset: 1 }}
                    onClick={(e) => { e.stopPropagation(); handleColorChange(c.border) }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
        {isEditing ? (
          <input ref={inputRef} value={editValue} onChange={(e) => setEditValue(e.target.value)} onKeyDown={handleKeyDown} onBlur={handleConfirmEdit}
            className="w-full bg-[#0a0a0a] border border-dim rounded-md px-2 py-1 text-heading text-xs outline-none" style={{ fontFamily: mono, borderColor: `${sc.border}50` }} />
        ) : (
          <p className="text-[12px] leading-relaxed whitespace-pre-wrap cursor-text" style={{ color: sc.text }} onDoubleClick={handleStartEdit}>
            {label || 'Clique duplo para editar...'}
          </p>
        )}
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl transition-all duration-200 group ${isWorkspace ? 'px-5 py-4 min-w-[240px] max-w-[320px]' : 'px-3.5 py-3 min-w-[200px] max-w-[280px]'}`}
      style={{
        background: isWorkspace ? '#1a1208' : '#141414',
        border: isWorkspace
          ? `2px solid #ff6b2c`
          : `1.5px solid ${selected ? (bscColor || cfg.color) : `${bscColor || cfg.color}20`}`,
        boxShadow: isWorkspace
          ? '0 0 30px rgba(255,107,44,0.15), 0 8px 24px rgba(0,0,0,0.5)'
          : selected
            ? `0 0 20px ${cfg.color}30, 0 8px 24px rgba(0,0,0,0.5)`
            : `0 2px 8px rgba(0,0,0,0.3)`,
        fontFamily: mono,
      }}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { if (!isEditing) setShowActions(false) }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{
          background: cfg.color,
          width: 8, height: 8,
          border: '2px solid #141414',
          transition: 'transform 0.15s',
        }}
      />

      {/* Header row */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
          style={{ background: `${cfg.color}18` }}
        >
          <Icon size={10} style={{ color: cfg.color }} />
        </div>
        <span
          className="text-[8px] font-semibold uppercase tracking-widest"
          style={{ color: `${cfg.color}cc` }}
        >
          {cfg.label}
        </span>

        {/* Status badge */}
        {statusInfo && (
          <span
            className="text-[7px] font-semibold uppercase px-1.5 py-0.5 rounded-md ml-auto tracking-wide"
            style={{ background: `${statusInfo.color}18`, color: statusInfo.color }}
          >
            {statusInfo.label}
          </span>
        )}

        {/* BSC perspective badge */}
        {bscPerspective && !statusInfo && (
          <span
            className="text-[7px] px-1.5 py-0.5 rounded-md ml-auto"
            style={{ background: `${bscColor}15`, color: bscColor || '#888' }}
          >
            {bscPerspective}
          </span>
        )}

        {/* Action buttons (hidden for workspace node) */}
        {showActions && !isEditing && !isWorkspace && (
          <div className="flex items-center gap-0.5 ml-auto">
            <button
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-[rgba(255,255,255,0.08)] transition-colors"
              onClick={handleStartEdit}
              title="Editar"
            >
              <Pencil size={9} className="text-subtle" />
            </button>
            <button
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-[rgba(239,68,68,0.1)] transition-colors"
              onClick={handleDelete}
              title="Excluir"
            >
              <Trash2 size={9} className="text-red-400" />
            </button>
          </div>
        )}
      </div>

      {/* Label / edit */}
      {isEditing ? (
        <div className="mb-1.5">
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleConfirmEdit}
            className="w-full bg-[#0a0a0a] border border-dim rounded-md px-2 py-1 text-heading text-xs outline-none focus:border-[#ff6b2c]/50"
            style={{ fontFamily: mono }}
          />
        </div>
      ) : (
        <p
          className="text-heading text-[11px] font-medium leading-snug line-clamp-2 cursor-text mb-1.5"
          onDoubleClick={handleStartEdit}
        >
          {label}
        </p>
      )}

      {/* Objective metadata */}
      {nodeType === 'objective' && meta.progress !== undefined && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] text-subtle">Progresso</span>
            <span className="text-[9px] font-semibold" style={{ color: cfg.color }}>
              {Math.round(meta.progress * 100)}%
            </span>
          </div>
          <ProgressBar value={meta.progress} color={cfg.color} />
          {meta.cycle && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[7px] text-subtle uppercase tracking-wider">{meta.cycle}</span>
              {meta.objective_type && (
                <span
                  className="text-[7px] px-1 py-0.5 rounded"
                  style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.4)' }}
                >
                  {meta.objective_type}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Key Result metadata */}
      {nodeType === 'key_result' && krProgress !== null && (
        <div className="mt-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[8px] text-subtle">
              {meta.current_value ?? 0}{meta.unit ? ` ${meta.unit}` : ''} / {meta.target_value ?? 0}{meta.unit ? ` ${meta.unit}` : ''}
            </span>
            <span className="text-[9px] font-semibold" style={{ color: cfg.color }}>
              {Math.round(krProgress * 100)}%
            </span>
          </div>
          <ProgressBar value={krProgress} color={cfg.color} />
          {meta.confidence !== undefined && (
            <div className="flex items-center gap-1 mt-1.5">
              <span className="text-[7px] text-subtle">Confiança</span>
              <span
                className="text-[8px] font-semibold"
                style={{ color: meta.confidence >= 0.7 ? '#22c55e' : meta.confidence >= 0.4 ? '#f59e0b' : '#ef4444' }}
              >
                {Math.round(meta.confidence * 100)}%
              </span>
            </div>
          )}
        </div>
      )}

      {/* Team metadata */}
      {nodeType === 'team' && meta.description && (
        <p className="text-[8px] text-subtle line-clamp-1 mt-0.5">{meta.description}</p>
      )}

      {/* Channel metadata */}
      {nodeType === 'channel' && meta.channel_type && (
        <span
          className="text-[7px] uppercase tracking-wider mt-0.5 inline-block px-1.5 py-0.5 rounded"
          style={{ background: `${cfg.color}12`, color: `${cfg.color}aa` }}
        >
          {meta.channel_type}
        </span>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{
          background: cfg.color,
          width: 8, height: 8,
          border: '2px solid #141414',
          transition: 'transform 0.15s',
        }}
      />
    </div>
  )
}

export const StrategyNode = memo(StrategyNodeInner)
