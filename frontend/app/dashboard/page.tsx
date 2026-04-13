'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Card, Button } from '@heroui/react'
import { AlertTriangle, InboxIcon, Bot, Link2, FileText, Wrench, MessageSquare, Hash, Clock, BarChart3, Settings, Check, X } from 'lucide-react'
import Link from 'next/link'
import { useAssistantStore } from '@/store/useAssistantStore'
import { apiFetch } from '@/lib/api'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'
import type { Assistant } from '@/types/assistant'

// ─── Types from backend ───────────────────────────────────────────────────────

interface DailyUsage {
  date: string
  requests: number
  tokens: number
}

interface AssistantStats {
  total_tokens: number
  total_messages: number
  sparkline: number[]
  daily: Array<{ date: string; requests: number; tokens: number }>
  last_interaction_at: string | null
  channel_breakdown: Array<{ channel: string; count: number }>
}

interface ActivityEvent {
  event_type: string
  description: string
  assistant_id: string
  assistant_name: string
  timestamp: string
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeTime(isoStr: string | null | undefined): string {
  if (!isoStr) return '—'
  const date = new Date(isoStr)
  if (isNaN(date.getTime())) return '—'
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `há ${minutes} min`
  if (hours < 24) return `há ${hours}h`
  if (days < 7) return `há ${days}d`
  return date.toLocaleDateString('pt-BR')
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const w = 72
  const h = 22
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible shrink-0">
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="72" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#D4835A" />
          <stop offset="100%" stopColor="#D4835A" />
        </linearGradient>
      </defs>
      <polyline points={pts} fill="none" stroke="url(#sparkGrad)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Usage bar chart ──────────────────────────────────────────────────────────

function generateLocalDates(days: number): string {
  const dates: string[] = []
  const now = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    dates.push(`${yyyy}-${mm}-${dd}`)
  }
  return dates.join(',')
}

function fmtChartDate(iso: string): string {
  const parts = iso.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`
  return iso
}

function UsageChart({ data, loading, error }: { data: DailyUsage[]; loading: boolean; error: string | null }) {
  const [mode, setMode] = React.useState<'requests' | 'tokens'>('requests')
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null)
  const values = data.map(d => mode === 'requests' ? d.requests : d.tokens)
  const max = Math.max(...values, 1)
  const fmt = (v: number) => mode === 'tokens' ? `${(v / 1000).toFixed(1)}k` : `${v}`
  const hasData = values.some(v => v > 0)

  const w = 510
  const h = 170
  const padX = 5
  const padY = 10
  const chartW = w - padX * 2
  const chartH = h - padY * 2

  // Build smooth cubic bezier path
  const points = values.map((v, i) => ({
    x: padX + (i / Math.max(values.length - 1, 1)) * chartW,
    y: padY + chartH - (v / max) * chartH,
  }))

  let linePath = ''
  let areaPath = ''
  if (points.length > 1) {
    const segs: string[] = [`M${points[0].x},${points[0].y}`]
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]
      const cpx = (p0.x + p1.x) / 2
      segs.push(`C${cpx},${p0.y} ${cpx},${p1.y} ${p1.x},${p1.y}`)
    }
    linePath = segs.join(' ')
    areaPath = `${linePath} L${points[points.length - 1].x},${padY + chartH} L${points[0].x},${padY + chartH} Z`
  }

  // Pick ~4 evenly spaced label indices for date labels
  const labelIndices: number[] = []
  if (data.length > 0) {
    const step = Math.max(Math.floor((data.length - 1) / 3), 1)
    for (let i = 0; i < data.length; i += step) labelIndices.push(i)
    if (labelIndices[labelIndices.length - 1] !== data.length - 1) labelIndices.push(data.length - 1)
  }

  return (
    <div>
      {loading ? (
        <div className="w-full h-[180px] flex items-center justify-center text-[#8a8a8a] text-xs animate-pulse">Carregando...</div>
      ) : error ? (
        <div className="w-full h-[180px] flex flex-col items-center justify-center gap-1 text-center">
          <AlertTriangle size={24} className="text-red-400" />
          <p className="text-xs text-red-500">Erro ao carregar dados</p>
          <p className="text-[10px] text-[#8a8a8a] max-w-xs truncate" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }} title={error}>{error}</p>
        </div>
      ) : !hasData ? (
        <div className="w-full h-[180px] flex flex-col items-center justify-center gap-1 text-center">
          <InboxIcon size={24} className="text-[#8a8a8a]" />
          <p className="text-xs text-[#8a8a8a]">Nenhuma requisição nos últimos 14 dias</p>
        </div>
      ) : (
        <div className="relative" style={{ height: 180 }}>
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: '100%', display: 'block' }} preserveAspectRatio="none">
            <defs>
              <linearGradient id="usageAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#E8712A" stopOpacity="0.15" />
                <stop offset="100%" stopColor="#E8712A" stopOpacity="0" />
              </linearGradient>
            </defs>
            {/* Grid lines */}
            <line x1="0" y1={h * 0.25} x2={w} y2={h * 0.25} stroke="rgba(255,255,255,0.03)" />
            <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} stroke="rgba(255,255,255,0.03)" />
            <line x1="0" y1={h * 0.75} x2={w} y2={h * 0.75} stroke="rgba(255,255,255,0.03)" />
            {/* Area fill */}
            {areaPath && <path d={areaPath} fill="url(#usageAreaGrad)" />}
            {/* Line */}
            {linePath && <path d={linePath} fill="none" stroke="#D4835A" strokeWidth="2" />}
            {/* Invisible hit areas for hover */}
            {points.map((p, i) => (
              <rect
                key={i}
                x={p.x - w / values.length / 2}
                y={0}
                width={w / values.length}
                height={h}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            ))}
          </svg>
          {/* Dots as HTML elements (not distorted by preserveAspectRatio=none) */}
          {labelIndices.map((idx) => {
            const p = points[idx]
            const isLast = idx === data.length - 1
            return (
              <div
                key={idx}
                className="absolute pointer-events-none"
                style={{
                  left: `${(p.x / w) * 100}%`,
                  top: `${(p.y / h) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: isLast ? '#D4835A' : '#1E1E1E',
                  border: isLast ? 'none' : '1.5px solid #D4835A',
                }}
              />
            )
          })}
          {/* Hover dot */}
          {hoverIdx !== null && points[hoverIdx] && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${(points[hoverIdx].x / w) * 100}%`,
                top: `${(points[hoverIdx].y / h) * 100}%`,
                transform: 'translate(-50%, -50%)',
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: '#D4835A',
                border: '2px solid #1E1E1E',
              }}
            />
          )}
          {/* Tooltip */}
          {hoverIdx !== null && points[hoverIdx] && (
            <div
              className="absolute pointer-events-none z-10 px-2.5 py-1.5 rounded-lg text-[11px] whitespace-nowrap"
              style={{
                left: `${(points[hoverIdx].x / w) * 100}%`,
                top: `${(points[hoverIdx].y / h) * 100}%`,
                transform: 'translate(-50%, -130%)',
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                color: '#f0f0f0',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              }}
            >
              <span style={{ color: '#D4835A', fontWeight: 600 }}>{fmt(values[hoverIdx])}</span>
              {' '}{mode === 'requests' ? 'req' : 'tokens'}
              <span style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 6 }}>{fmtChartDate(data[hoverIdx].date)}</span>
            </div>
          )}
          {/* Date labels below chart */}
          <div className="flex justify-between px-0 mt-1">
            {labelIndices.map((idx) => {
              const isLast = idx === data.length - 1
              return (
                <span
                  key={idx}
                  className="text-[9px]"
                  style={{ color: 'rgba(255,255,255,0.15)', fontFamily: "'JetBrains Mono', monospace" }}
                >
                  {isLast ? 'Hoje' : fmtChartDate(data[idx].date)}
                </span>
              )
            })}
          </div>
        </div>
      )}
      <div className="flex justify-end mt-3">
        <div className="flex rounded-lg overflow-hidden" style={{ border: '1px solid #1e1e1e' }}>
          <button
            onClick={() => setMode('requests')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'requests' ? 'text-white' : 'text-[#8a8a8a] hover:text-[#f0f0f0]'}`}
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              background: mode === 'requests' ? 'linear-gradient(135deg, #ff6b2c, #ff8533)' : 'transparent',
            }}
          >
            Req.
          </button>
          <button
            onClick={() => setMode('tokens')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'tokens' ? 'text-white' : 'text-[#8a8a8a] hover:text-[#f0f0f0]'}`}
            style={{
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              borderLeft: '1px solid #1e1e1e',
              background: mode === 'tokens' ? 'linear-gradient(135deg, #ff6b2c, #ff8533)' : 'transparent',
            }}
          >
            Tokens
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pie Chart (token distribution) ─────────────────────────────────────

function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0)
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <InboxIcon size={28} className="text-[#8a8a8a] mb-2" />
        <p className="text-xs text-[#8a8a8a]">Sem dados para exibir</p>
      </div>
    )
  }

  const r = 70
  const cx = 90
  const cy = 90
  const circumference = 2 * Math.PI * r
  let cumulativeOffset = 0

  return (
    <div className="flex flex-col items-center gap-5">
      <svg width={180} height={180} viewBox="0 0 180 180">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={14} />
        {data.filter(d => d.value > 0).map((d, i) => {
          const pct = d.value / total
          const dashLen = pct * circumference
          const dashGap = circumference - dashLen
          const offset = -cumulativeOffset
          cumulativeOffset += dashLen
          return (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={14}
              strokeDasharray={`${dashLen} ${dashGap}`}
              strokeDashoffset={offset}
              strokeLinecap="round"
              style={{ transform: 'rotate(-90deg)', transformOrigin: '90px 90px' }}
            />
          )
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="22" fontFamily="Fira Code" fontWeight="300">{total > 1000 ? `${(total / 1000).toFixed(1)}k` : total}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="9" fontFamily="JetBrains Mono">TOKENS</text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
        {data.filter(d => d.value > 0).map((d, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: d.color }} />
            <span className="truncate max-w-[100px]" title={d.label}>{d.label}</span>
            <span className="ml-auto font-medium" style={{ fontFamily: "'JetBrains Mono', monospace", color: 'rgba(255,255,255,0.88)' }}>{Math.round((d.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Area Chart (token usage trend) ──────────────────────────────────────────

function AreaChart({ data }: { data: { date: string; value: number }[] }) {
  if (data.length === 0 || data.every(d => d.value === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <InboxIcon size={28} className="text-[#8a8a8a] mb-2" />
        <p className="text-xs text-[#8a8a8a]">Sem dados para exibir</p>
      </div>
    )
  }

  const w = 460
  const h = 160
  const padX = 40
  const padY = 20
  const chartW = w - padX * 2
  const chartH = h - padY * 2
  const max = Math.max(...data.map(d => d.value), 1)

  const points = data.map((d, i) => ({
    x: padX + (i / (data.length - 1)) * chartW,
    y: padY + chartH - (d.value / max) * chartH,
  }))

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x},${padY + chartH} L${points[0].x},${padY + chartH} Z`

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${w} ${h + 24}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="areaGradNew" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#D4835A" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#D4835A" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = padY + chartH - pct * chartH
          return <line key={i} x1={padX} y1={y} x2={w - padX} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        })}
        {[0, 0.5, 1].map((pct, i) => {
          const y = padY + chartH - pct * chartH
          const val = Math.round(max * pct)
          const label = val > 1000 ? `${(val / 1000).toFixed(1)}k` : `${val}`
          return <text key={i} x={padX - 6} y={y + 3} textAnchor="end" fill="#8a8a8a" fontSize="9">{label}</text>
        })}
        <path d={areaPath} fill="url(#areaGradNew)" />
        <path d={linePath} fill="none" stroke="#D4835A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#D4835A" />
        ))}
        {data.map((d, i) => {
          if (i % 3 !== 0 && i !== data.length - 1) return null
          const x = padX + (i / (data.length - 1)) * chartW
          const parts = d.date.split('-')
          const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : d.date
          return <text key={i} x={x} y={h + 16} textAnchor="middle" fill="#8a8a8a" fontSize="9">{label}</text>
        })}
      </svg>
    </div>
  )
}

// ─── Assistant health badge ───────────────────────────────────────────────────

function getStatus(a: Assistant) {
  const conn = a.integrations?.some(i => i.status === 'connected')
  const disc = a.integrations?.some(i => i.status === 'disconnected')
  if (conn && !disc) return { dot: 'bg-emerald-500', label: 'Saudável', cls: 'bg-emerald-900/30 text-emerald-400' }
  if (conn && disc) return { dot: 'bg-yellow-400', label: 'Com alertas', cls: 'bg-yellow-900/30 text-yellow-400' }
  if (!conn && a.integrations?.length) return { dot: 'bg-red-500', label: 'Com erros', cls: 'bg-red-900/30 text-red-400' }
  return { dot: 'bg-gray-400', label: 'Inativo', cls: 'bg-[#1e1e1e] text-[#8a8a8a]' }
}

// ─── Chat test modal ──────────────────────────────────────────────────────────

function ChatTestModal({ assistant, onClose, onMessageSent }: { assistant: Assistant; onClose: () => void; onMessageSent?: () => void }) {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)
    try {
      const res = await apiFetch<{ reply: string }>(`/api/assistants/${assistant.id}/chat`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      })
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply }])
      onMessageSent?.()
    } catch {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Não foi possível processar. Verifique se a chave de API do provedor está configurada.',
      }])
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4">
      <div className="glass-card w-full sm:max-w-lg flex flex-col rounded-t-2xl sm:rounded-2xl" style={{ height: '520px' }}>
        <div className="flex items-center justify-between px-5 py-4 shrink-0" style={{ borderBottom: '1px solid #1e1e1e' }}>
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold"
              style={{
                background: 'linear-gradient(135deg, #ff6b2c, #ff8533)',
                boxShadow: '0 0 8px rgba(255,107,44,0.15)',
              }}
            >
              {assistant.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm text-[#f0f0f0]">{assistant.name}</p>
              <p className="text-xs text-[#8a8a8a]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>{assistant.model}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-[#8a8a8a] hover:text-[#f0f0f0] w-8 h-8 flex items-center justify-center rounded-lg hover:bg-[#252525] transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2">
              <MessageSquare size={36} strokeWidth={1.5} className="text-[#5a5a5a]" />
              <p className="text-[#8a8a8a] text-sm">Envie uma mensagem para testar <strong className="text-[#f0f0f0]">{assistant.name}</strong></p>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'text-black rounded-br-sm'
                    : 'text-heading rounded-bl-sm'
                }`}
                style={{
                  background: m.role === 'user'
                    ? 'rgba(255, 107, 44, 0.15)'
                    : 'var(--c-raised)',
                  border: m.role === 'user'
                    ? '1px solid rgba(255, 107, 44, 0.25)'
                    : '1px solid #1e1e1e',
                  color: m.role === 'user' ? '#f0f0f0' : undefined,
                }}
              >
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div
                className="px-4 py-2.5 rounded-2xl rounded-bl-sm text-[#8a8a8a] text-sm animate-pulse"
                style={{ background: '#1a1a1a', border: '1px solid #1e1e1e' }}
              >
                •••
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 flex gap-2 shrink-0" style={{ borderTop: '1px solid #1e1e1e' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Digite uma mensagem..."
            className="flex-1 rounded-xl px-4 py-2.5 text-sm text-[#f0f0f0] placeholder:text-[#5a5a5a] focus:outline-none transition-all"
            style={{
              background: '#222222',
              border: '1px solid #1e1e1e',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = '#444444')}
            onBlur={(e) => (e.currentTarget.style.borderColor = '#1e1e1e')}
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="px-4 py-2.5 rounded-[10px] text-sm font-medium disabled:opacity-40 transition-all"
            style={{
              background: '#121212',
              boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
              color: '#D4835A',
            }}
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Assistant picker ─────────────

function AssistantPicker({
  assistants,
  onSelect,
  onClose,
}: {
  assistants: Assistant[]
  onSelect: (a: Assistant) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-xs p-4">
        <p className="text-sm font-semibold text-[#f0f0f0] mb-3">Qual assistente testar?</p>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {assistants.map(a => (
            <button
              key={a.id}
              onClick={() => { onSelect(a); onClose() }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#252525] text-left transition-colors"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                style={{ background: 'linear-gradient(135deg, #ff6b2c, #ff8533)' }}
              >
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#f0f0f0] truncate">{a.name}</p>
                <p className="text-xs text-[#8a8a8a]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>{a.llmProvider} · {a.model}</p>
              </div>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onPress={onClose} className="mt-3 w-full border-none text-[#8a8a8a]">
          Cancelar
        </Button>
      </div>
    </div>
  )
}

// ─── Stat Card Icon Colors ──────────────────────────────────────────────────

const statIconStyles: Record<string, { bg: string }> = {
  Assistentes: { bg: 'rgba(255,107,44,0.08)' },
  Integrações: { bg: 'rgba(34,197,94,0.1)' },
  'Arquivos de Conhecimento': { bg: 'rgba(59,130,246,0.1)' },
  'Ferramentas Ativas': { bg: 'rgba(168,85,247,0.1)' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { assistants, isLoading, hasFetched, fetchAssistants } = useAssistantStore()

  const [testingAssistant, setTestingAssistant] = useState<Assistant | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  const [usageData, setUsageData] = useState<DailyUsage[]>([])
  const [assistantStats, setAssistantStats] = useState<Record<string, AssistantStats>>({})
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasFetched) fetchAssistants()
  }, [hasFetched, fetchAssistants])

  const loadStats = useRef(async () => {
    const currentAssistants = useAssistantStore.getState().assistants
    const [usageRes, activityRes] = await Promise.allSettled([
      apiFetch<DailyUsage[]>(`/api/user/usage?days=14&dates=${generateLocalDates(14)}`),
      apiFetch<ActivityEvent[]>('/api/user/activity?limit=10'),
    ])
    if (usageRes.status === 'rejected') {
      console.error('[dashboard] usage API failed:', usageRes.reason)
      setStatsError(String(usageRes.reason))
    } else {
      setStatsError(null)
      setUsageData(usageRes.value)
    }
    if (activityRes.status === 'fulfilled') setActivity(activityRes.value)

    if (currentAssistants.length > 0) {
      const store = useAssistantStore.getState()
      const [statsResults] = await Promise.allSettled([
        Promise.allSettled(
          currentAssistants.map(a => apiFetch<AssistantStats>(`/api/assistants/${a.id}/stats`))
        ),
        Promise.allSettled(
          currentAssistants.map(a => store.refreshIntegrationsForAssistant(a.id))
        ),
        Promise.allSettled(
          currentAssistants.map(a => store.fetchAssistantFiles(a.id))
        ),
        Promise.allSettled(
          currentAssistants.map(a => store.fetchAssistantTools(a.id))
        ),
      ]) as [PromiseSettledResult<PromiseSettledResult<AssistantStats>[]>, ...unknown[]]

      if (statsResults.status === 'fulfilled') {
        const map: Record<string, AssistantStats> = {}
        statsResults.value.forEach((r, i) => {
          if (r.status === 'fulfilled') map[currentAssistants[i].id] = r.value
        })
        setAssistantStats(map)
      }
    }
    setStatsLoading(false)
  }).current

  useEffect(() => {
    if (!hasFetched) return
    loadStats()
  }, [hasFetched, loadStats])

  useEffect(() => {
    if (!hasFetched) return
    const handler = () => loadStats()
    window.addEventListener('sse:conversation_updated', handler)
    window.addEventListener('sse:pix_status_changed', handler)
    window.addEventListener('sse:notification_created', handler)
    const id = setInterval(loadStats, 60_000)
    return () => {
      window.removeEventListener('sse:conversation_updated', handler)
      window.removeEventListener('sse:pix_status_changed', handler)
      window.removeEventListener('sse:notification_created', handler)
      clearInterval(id)
    }
  }, [hasFetched, loadStats])

  // ── Computed stats ──
  const totalAssistants = assistants.length
  const activeAssistants = assistants.filter(a => a.integrations?.some(i => i.status === 'connected')).length
  const inactiveAssistants = totalAssistants - activeAssistants
  const hasAlert = assistants.some(a =>
    a.integrations?.some(i => i.status === 'disconnected') &&
    !a.integrations?.some(i => i.status === 'connected')
  )

  const activeIntegrations = assistants.reduce((acc, a) => acc + (a.integrations?.filter(i => i.status === 'connected')?.length || 0), 0)
  const errorIntegrations = assistants.reduce((acc, a) => acc + (a.integrations?.filter(i => i.status === 'disconnected')?.length || 0), 0)

  const allFiles = assistants.flatMap(a => a.files || [])
  const totalFiles = allFiles.length
  const totalSize = allFiles.reduce((acc, f) => acc + (f.size || 0), 0)
  const lastUpload = [...allFiles].sort((a, b) =>
    new Date(b.uploadedAt || 0).getTime() - new Date(a.uploadedAt || 0).getTime()
  )[0]

  const enabledTools = assistants.flatMap(a => a.tools?.filter(t => t.isEnabled) || [])
  const totalTools = enabledTools.length
  const toolNames = [...new Set(enabledTools.map(t => t.name))].slice(0, 3)

  const stats = [
    {
      title: 'Assistentes', icon: Bot, value: totalAssistants, subtitle: 'Total configurados',
      extra: totalAssistants > 0 && (
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <span className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
            {activeAssistants} ativos
          </span>
          {inactiveAssistants > 0 && <span className="text-[11px] text-[#8a8a8a]">· {inactiveAssistants} inativos</span>}
          {hasAlert && <span title="Assistente precisa de atenção"><AlertTriangle size={12} className="text-yellow-500" /></span>}
        </div>
      ),
    },
    {
      title: 'Integrações', icon: Link2, value: activeIntegrations, subtitle: 'Conexões ativas',
      extra: (
        <div className="flex items-center gap-2 mt-2">
          <span className={errorIntegrations === 0 ? 'text-emerald-500' : 'text-yellow-500'}>
            {errorIntegrations === 0 ? <Check size={14} /> : <AlertTriangle size={14} />}
          </span>
          {errorIntegrations > 0
            ? <span className="text-[11px] text-red-400 font-medium">{errorIntegrations} com erro</span>
            : activeIntegrations > 0 && <span className="text-[11px] text-[#8a8a8a]">Todas ok</span>}
        </div>
      ),
    },
    {
      title: 'Arquivos de Conhecimento', icon: FileText, value: totalFiles, subtitle: 'Documentos enviados',
      extra: (
        <div className="mt-2 space-y-0.5">
          {totalSize > 0 && <p className="text-[11px] text-[#8a8a8a]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>{formatBytes(totalSize)} total</p>}
          {lastUpload && <p className="text-[11px] text-[#8a8a8a] truncate" title={lastUpload.name}>Último: {lastUpload.name}</p>}
        </div>
      ),
    },
    {
      title: 'Ferramentas Ativas', icon: Wrench, value: totalTools, subtitle: 'Ferramentas habilitadas',
      extra: toolNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {toolNames.map(n => (
            <span
              key={n}
              className="px-1.5 py-0.5 rounded text-[10px] truncate max-w-[90px]"
              style={{ background: '#1a1a1a', color: '#8a8a8a', border: '1px solid #1e1e1e', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
              title={n}
            >
              {n}
            </span>
          ))}
          {totalTools > 3 && <span className="text-[10px] text-[#8a8a8a]">+{totalTools - 3}</span>}
        </div>
      ),
    },
  ]

  const openTestModal = (a: Assistant) => {
    setTestingAssistant(a)
    setShowPicker(false)
  }

  const handleQuickTest = () => {
    if (assistants.length === 0) return
    if (assistants.length === 1) {
      openTestModal(assistants[0])
    } else {
      setShowPicker(true)
    }
  }

  const activityIcon = (type: string): { icon: React.ReactNode; bg: string } => {
    switch (type) {
      case 'error': return { icon: <AlertTriangle size={14} className="text-red-500" />, bg: 'bg-red-900/30' }
      case 'upload': return { icon: <FileText size={14} className="text-[#ff6b2c]" />, bg: 'bg-[rgba(255,107,44,0.1)]' }
      case 'config': return { icon: <Settings size={14} className="text-[#ff6b2c]" />, bg: 'bg-[rgba(255,107,44,0.1)]' }
      default: return { icon: <MessageSquare size={14} className="text-emerald-500" />, bg: 'bg-emerald-900/30' }
    }
  }

  return (
    <PageTransition>
      <StaggerContainer className="space-y-6 pb-8">
        {/* 1. Title */}
        <StaggerItem>
          <div className="flex flex-col gap-1">
            <h2
              className="text-3xl font-light tracking-tight text-heading"
              style={{ fontFamily: "'Fira Code', 'JetBrains Mono', monospace" }}
            >
              Visão Geral
            </h2>
            <p className="text-[#8a8a8a]">Veja o que está acontecendo com seus projetos hoje.</p>
          </div>
        </StaggerItem>

        {/* 2. Quick Actions */}
        <StaggerItem>
          <div className="flex flex-wrap gap-2">
            <Link href="/dashboard/assistants">
              <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all text-[#8a8a8a] hover:text-[#f0f0f0]" style={{ background: 'transparent', border: '1px solid #1e1e1e' }}>
                <Bot size={14} /> Criar Assistente
              </button>
            </Link>
            <Link href="/dashboard/assistants">
              <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all text-[#8a8a8a] hover:text-[#f0f0f0]" style={{ background: 'transparent', border: '1px solid #1e1e1e' }}>
                <FileText size={14} /> Adicionar Arquivo
              </button>
            </Link>
            <button
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all text-[#8a8a8a] hover:text-[#f0f0f0] disabled:opacity-40"
              style={{ background: 'transparent', border: '1px solid #1e1e1e' }}
              onClick={handleQuickTest}
              disabled={assistants.length === 0}
            >
              <MessageSquare size={14} /> Testar Assistente
            </button>
            <Link href="/dashboard/assistants">
              <button className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all text-[#8a8a8a] hover:text-[#f0f0f0]" style={{ background: 'transparent', border: '1px solid #1e1e1e' }}>
                <BarChart3 size={14} /> Ver Logs
              </button>
            </Link>
          </div>
        </StaggerItem>

        {/* 3. Stats Grid */}
        <StaggerItem>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat, i) => {
              const iconStyle = statIconStyles[stat.title] || statIconStyles.Assistentes
              const isFirst = i === 0
              return (
                <div
                  key={i}
                  className={`glass-card p-4 relative overflow-hidden ${isFirst ? 'glow-orange' : ''}`}
                >
                  <div className="flex flex-row items-center justify-between pb-1">
                    <p className="text-sm font-medium text-[#8a8a8a]">{stat.title}</p>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: iconStyle.bg }}
                    >
                      <stat.icon size={16} className={i === 0 ? 'text-[#ff6b2c]' : i === 1 ? 'text-emerald-400' : i === 2 ? 'text-blue-400' : 'text-purple-400'} />
                    </div>
                  </div>
                  <div className="text-xl font-bold text-heading">
                    {isLoading ? '...' : stat.value}
                  </div>
                  <p className="text-xs text-[#8a8a8a]">{stat.subtitle}</p>
                  {!isLoading && stat.extra}
                </div>
              )
            })}
          </div>
        </StaggerItem>

        {/* 4. Usage Over Time */}
        <StaggerItem>
          <div className="glass-card p-6">
            <div className="mb-4">
              <h3 className="font-semibold text-base text-[#f0f0f0]">Uso ao Longo do Tempo</h3>
              <p className="text-sm text-[#8a8a8a]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>Requisições e tokens por dia — últimos 14 dias</p>
            </div>
            <UsageChart data={usageData} loading={statsLoading} error={statsError} />
          </div>
        </StaggerItem>

        {/* 4b. Pie + Area Charts */}
        <StaggerItem>
          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            <div className="glass-card p-6">
              <div className="mb-4">
                <h3 className="font-semibold text-base text-[#f0f0f0]">Distribuição por Assistente</h3>
                <p className="text-sm text-[#8a8a8a]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>Tokens usados nos últimos 7 dias</p>
              </div>
              <div className="flex items-center justify-center">
                <PieChart
                  data={(() => {
                    const colors = ['#D4835A', '#5B8DEF', '#5CB87A', '#C75050', '#8b5cf6', '#D4A35A', '#5BA0EF', '#7ACB87']
                    return assistants.map((a, i) => ({
                      label: a.name,
                      value: assistantStats[a.id]?.total_tokens ?? 0,
                      color: colors[i % colors.length],
                    }))
                  })()}
                />
              </div>
            </div>

            <div className="glass-card p-6">
              <div className="mb-4">
                <h3 className="font-semibold text-base text-[#f0f0f0]">Tendência de Tokens</h3>
                <p className="text-sm text-[#8a8a8a]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>Uso diário de tokens — últimos 14 dias</p>
              </div>
              <AreaChart data={usageData.map(d => ({ date: d.date, value: d.tokens }))} />
            </div>
          </div>
        </StaggerItem>

        {/* 5 + 6. Assistants + Activity */}
        <StaggerItem>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Seus Assistentes */}
            <div className="glass-card flex flex-col">
              <div className="px-6 pt-5 pb-3 shrink-0">
                <div className="flex items-center justify-between w-full">
                  <div>
                    <h3 className="font-semibold text-base text-[#f0f0f0]">Seus Assistentes</h3>
                    <p className="text-sm text-[#8a8a8a]">Status e métricas de cada assistente</p>
                  </div>
                  <Link href="/dashboard/assistants">
                    <button className="text-[#8a8a8a] text-xs hover:text-[#ff6b2c] transition-colors">Ver todos →</button>
                  </Link>
                </div>
              </div>
              <div className="p-4 overflow-y-auto" style={{ maxHeight: '520px' }}>
                {isLoading ? (
                  <p className="text-sm text-[#8a8a8a] p-2">Carregando...</p>
                ) : assistants.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    {/* Cat mascot silhouette for empty state */}
                    <div className="mb-4 opacity-30">
                      <svg viewBox="0 0 120 120" width={72} height={72} fill="none">
                        <path d="M18 72C18 44 34 24 60 24C86 24 102 44 102 72C102 92 88 108 60 108C32 108 18 92 18 72Z" fill="#ff6b2c" opacity="0.3" />
                        <path d="M26 52L16 18L46 38Z" fill="#ff6b2c" opacity="0.2" />
                        <path d="M94 52L104 18L74 38Z" fill="#ff6b2c" opacity="0.2" />
                        <ellipse cx="44" cy="68" rx="9" ry="7" fill="#ff6b2c" opacity="0.15" />
                        <ellipse cx="76" cy="68" rx="9" ry="7" fill="#ff6b2c" opacity="0.15" />
                        <path d="M56 84L60 80L64 84L60 88Z" fill="#ff6b2c" opacity="0.15" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-semibold text-[#f0f0f0] mb-1">Crie seu primeiro assistente</h3>
                    <p className="text-xs text-[#8a8a8a] mb-4 max-w-xs">Configure um assistente de IA para atendimento ao cliente via WhatsApp ou Telegram.</p>
                    <Link href="/dashboard/assistants">
                      <button className="btn-neu text-sm">Criar Assistente</button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {assistants.map((assistant) => {
                      const status = getStatus(assistant)
                      const stats = assistantStats[assistant.id]
                      const sparkline = stats?.sparkline?.length ? stats.sparkline : null
                      const msgs = stats?.total_messages ?? 0
                      const tokens = stats?.total_tokens ?? 0
                      const lastAt = stats?.last_interaction_at ?? null
                      const tokensStr = tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
                      const cost = `$${((tokens / 1000) * 0.002).toFixed(2)}`

                      return (
                        <div
                          key={assistant.id}
                          className="flex flex-col gap-2 p-3 rounded-xl transition-all duration-200 hover:bg-[rgba(255,255,255,0.03)]"
                          style={{ border: '1px solid transparent' }}
                          onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#1e1e1e')}
                          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'transparent')}
                        >
                          <div className="flex items-start gap-3">
                            <div
                              className="w-9 h-9 rounded-[10px] flex items-center justify-center text-sm font-semibold shrink-0"
                              style={{
                                background: '#121212',
                                boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                                color: '#D4835A',
                              }}
                            >
                              {assistant.name.charAt(0).toUpperCase()}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-[#f0f0f0]">{assistant.name}</p>
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase flex items-center gap-1 ${status.cls}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
                                  {status.label}
                                </span>
                              </div>
                              <p className="text-xs text-[#8a8a8a] mt-0.5 truncate" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
                                {assistant.llmProvider} · {assistant.model}
                              </p>
                              <div className="flex items-center gap-3 mt-1 flex-wrap">
                                <span className="text-[11px] text-[#8a8a8a] flex items-center gap-1" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
                                  <MessageSquare size={10} /> <span className="text-[#f0f0f0] font-medium">{msgs}</span> conv (7d)
                                </span>
                                <span className="text-[11px] text-[#8a8a8a] flex items-center gap-1" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
                                  <Hash size={10} /> {tokensStr} · {cost}
                                </span>
                                {lastAt && (
                                  <span className="text-[11px] text-[#8a8a8a] flex items-center gap-1" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
                                    <Clock size={10} /> {relativeTime(lastAt)}
                                  </span>
                                )}
                              </div>
                            </div>

                            {sparkline && (
                              <div className="hidden sm:flex items-end pt-1">
                                <Sparkline data={sparkline} />
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 pl-12">
                            <button
                              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all text-[#8a8a8a] hover:text-[#ff6b2c]"
                              style={{ background: '#1a1a1a', border: '1px solid #1e1e1e' }}
                              onClick={() => setTestingAssistant(assistant)}
                            >
                              <MessageSquare size={12} />Testar
                            </button>
                            <Link href={`/dashboard/assistants/${assistant.id}`}>
                              <button className="px-3 py-1.5 rounded-lg text-xs text-[#8a8a8a] hover:text-[#f0f0f0] transition-colors">
                                Ver Logs
                              </button>
                            </Link>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Atividade Recente */}
            <div className="glass-card flex flex-col">
              <div className="px-6 pt-5 pb-3 shrink-0">
                <div className="flex items-center justify-between w-full">
                  <div>
                    <h3 className="font-semibold text-base text-[#f0f0f0]">Atividade Recente</h3>
                    <p className="text-sm text-[#8a8a8a]">Últimas interações e eventos</p>
                  </div>
                  {statsLoading && <span className="text-xs text-[#8a8a8a] animate-pulse">Carregando...</span>}
                </div>
              </div>
              <div className="p-4 overflow-y-auto" style={{ maxHeight: '520px' }}>
                {!statsLoading && activity.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="mb-3 opacity-30">
                      <InboxIcon size={36} strokeWidth={1.5} className="text-[#ff6b2c]" />
                    </div>
                    <p className="text-sm text-[#8a8a8a]">Nenhuma atividade registrada ainda.</p>
                    <p className="text-xs text-[#5a5a5a] mt-1">As conversas aparecerão aqui automaticamente.</p>
                  </div>
                ) : (
                  <div className="space-y-0">
                    {(activity.length > 0 ? activity : []).map((event, i) => {
                      const { icon, bg } = activityIcon(event.event_type)
                      return (
                        <div
                          key={i}
                          className={`flex items-start gap-3 py-3 ${i < activity.length - 1 ? '' : ''}`}
                          style={{ borderBottom: i < activity.length - 1 ? '1px solid #1e1e1e' : 'none' }}
                        >
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5 ${bg}`}>
                            {icon}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-[#f0f0f0] leading-snug">{event.description}</p>
                            {event.assistant_name && (
                              <p className="text-[11px] text-[#8a8a8a] mt-0.5" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>{event.assistant_name}</p>
                            )}
                          </div>
                          <span className="text-[11px] text-[#8a8a8a] shrink-0 mt-0.5" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>{relativeTime(event.timestamp)}</span>
                        </div>
                      )
                    })}
                    {statsLoading && (
                      <div className="space-y-3 pt-1">
                        {Array.from({ length: 5 }).map((_, i) => (
                          <div key={i} className="flex items-center gap-3 py-2">
                            <div className="w-8 h-8 rounded-full animate-pulse shrink-0" style={{ background: '#1e1e1e' }} />
                            <div className="flex-1 space-y-1.5">
                              <div className="h-3 rounded animate-pulse w-3/4" style={{ background: '#1e1e1e' }} />
                              <div className="h-2.5 rounded animate-pulse w-1/2" style={{ background: '#1a1a1a' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </StaggerItem>

        {/* Modals */}
        {testingAssistant && (
          <ChatTestModal assistant={testingAssistant} onClose={() => setTestingAssistant(null)} onMessageSent={loadStats} />
        )}
        {showPicker && (
          <AssistantPicker
            assistants={assistants}
            onSelect={openTestModal}
            onClose={() => setShowPicker(false)}
          />
        )}
      </StaggerContainer>
    </PageTransition>
  )
}
