'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Card, Button } from '@heroui/react'
import { AlertTriangle, InboxIcon, Bot, Link2, FileText, Wrench, MessageSquare, Hash, Clock, BarChart3, Settings, Check, X } from 'lucide-react'
import Link from 'next/link'
import { useAssistantStore } from '@/store/useAssistantStore'
import { apiFetch } from '@/lib/api'
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
      <polyline points={pts} fill="none" stroke="#ff6b2c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  // accepts "2026-03-30" → "30/03"
  const parts = iso.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`
  return iso
}

function UsageChart({ data, loading, error }: { data: DailyUsage[]; loading: boolean; error: string | null }) {
  const [mode, setMode] = React.useState<'requests' | 'tokens'>('requests')
  const values = data.map(d => mode === 'requests' ? d.requests : d.tokens)
  const max = Math.max(...values, 1)
  const fmt = (v: number) => mode === 'tokens' ? `${(v / 1000).toFixed(1)}k` : `${v}`
  const hasData = values.some(v => v > 0)

  return (
    <div>
      <div className="flex gap-1 h-28 px-1">
        {loading ? (
          <div className="w-full flex items-center justify-center text-subtle text-xs animate-pulse">Carregando...</div>
        ) : error ? (
          <div className="w-full flex flex-col items-center justify-center gap-1 text-center">
            <AlertTriangle size={24} className="text-red-400" />
            <p className="text-xs text-red-500">Erro ao carregar dados</p>
            <p className="text-[10px] text-subtle font-mono max-w-xs truncate" title={error}>{error}</p>
          </div>
        ) : !hasData ? (
          <div className="w-full flex flex-col items-center justify-center gap-1 text-center">
            <InboxIcon size={24} className="text-subtle" />
            <p className="text-xs text-subtle">Nenhuma requisição nos últimos 14 dias</p>
          </div>
        ) : data.map((d, i) => {
          const val = mode === 'requests' ? d.requests : d.tokens
          const pct = Math.max((val / max) * 100, 3) // always visible (min 3%)
          return (
            <div key={i} className="flex-1 h-full flex flex-col justify-end items-center group relative">
              <div
                className={`w-full rounded-t-sm transition-opacity cursor-default ${
                  val > 0
                    ? 'bg-gradient-to-t from-[#ff6b2c] to-[#ff8533] opacity-80 group-hover:opacity-100'
                    : 'bg-raised opacity-40'
                }`}
                style={{ height: `${pct}%` }}
              >
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 bg-surface rounded-md text-[11px] text-heading whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 shadow-lg">
                  {fmt(val)} {mode === 'requests' ? 'req' : 'tokens'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {!loading && !error && (
        <div className="flex items-center gap-1 px-1 mt-2">
          {data.map((d, i) => {
            const isLast = i === data.length - 1
            const show = i % 2 === 0 || isLast
            return (
              <div key={i} className="flex-1 text-center">
                {show && (
                  <span className={`text-[9px] ${isLast ? 'text-[#ff6b2c] font-semibold' : 'text-subtle'}`}>
                    {fmtChartDate(d.date)}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      <div className="flex justify-end mt-3">
        <div className="flex rounded-lg overflow-hidden">
          <button
            onClick={() => setMode('requests')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'requests' ? 'bg-[#ff6b2c] text-black' : 'text-subtle hover:text-heading hover:bg-raised'}`}
          >
            Req.
          </button>
          <button
            onClick={() => setMode('tokens')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-dim ${mode === 'tokens' ? 'bg-[#ff6b2c] text-black' : 'text-subtle hover:text-heading hover:bg-raised'}`}
          >
            Tokens
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pie Chart (token distribution by assistant) ─────────────────────────────

function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((acc, d) => acc + d.value, 0)
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <InboxIcon size={28} className="text-subtle mb-2" />
        <p className="text-xs text-subtle">Sem dados para exibir</p>
      </div>
    )
  }

  const r = 70
  const cx = 90
  const cy = 90
  const circumference = 2 * Math.PI * r
  let cumulativeOffset = 0

  return (
    <div className="flex flex-col items-center gap-4">
      <svg width={180} height={180} viewBox="0 0 180 180">
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
              strokeWidth={28}
              strokeDasharray={`${dashLen} ${dashGap}`}
              strokeDashoffset={offset}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '90px 90px' }}
            />
          )
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" className="fill-heading text-lg font-bold">{total > 1000 ? `${(total / 1000).toFixed(1)}k` : total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" className="fill-subtle text-[10px]">tokens</text>
      </svg>
      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {data.filter(d => d.value > 0).map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.color }} />
            <span className="text-xs text-subtle truncate max-w-[100px]" title={d.label}>{d.label}</span>
            <span className="text-xs text-heading font-medium">{Math.round((d.value / total) * 100)}%</span>
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
        <InboxIcon size={28} className="text-subtle mb-2" />
        <p className="text-xs text-subtle">Sem dados para exibir</p>
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
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff6b2c" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#ff6b2c" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
          const y = padY + chartH - pct * chartH
          return <line key={i} x1={padX} y1={y} x2={w - padX} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        })}
        {/* Y-axis labels */}
        {[0, 0.5, 1].map((pct, i) => {
          const y = padY + chartH - pct * chartH
          const val = Math.round(max * pct)
          const label = val > 1000 ? `${(val / 1000).toFixed(1)}k` : `${val}`
          return <text key={i} x={padX - 6} y={y + 3} textAnchor="end" className="fill-subtle text-[9px]">{label}</text>
        })}
        {/* Area + Line */}
        <path d={areaPath} fill="url(#areaGrad)" />
        <path d={linePath} fill="none" stroke="#ff6b2c" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#ff6b2c" />
        ))}
        {/* X-axis labels */}
        {data.map((d, i) => {
          if (i % 3 !== 0 && i !== data.length - 1) return null
          const x = padX + (i / (data.length - 1)) * chartW
          const parts = d.date.split('-')
          const label = parts.length === 3 ? `${parts[2]}/${parts[1]}` : d.date
          return <text key={i} x={x} y={h + 16} textAnchor="middle" className="fill-subtle text-[9px]">{label}</text>
        })}
      </svg>
    </div>
  )
}

// ─── Assistant health badge ───────────────────────────────────────────────────

function getStatus(a: Assistant) {
  const conn = a.integrations?.some(i => i.status === 'connected')
  const disc = a.integrations?.some(i => i.status === 'disconnected')
  if (conn && !disc) return { dot: 'bg-emerald-500', label: 'Saudável', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  if (conn && disc) return { dot: 'bg-yellow-400', label: 'Com alertas', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' }
  if (!conn && a.integrations?.length) return { dot: 'bg-red-500', label: 'Com erros', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
  return { dot: 'bg-gray-400', label: 'Inativo', cls: 'bg-raised text-subtle' }
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
      <div className="bg-surface rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg shadow-2xl flex flex-col" style={{ height: '520px' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-dim shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#ff6b2c] to-[#ff8533] flex items-center justify-center text-white text-sm font-bold">
              {assistant.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-sm text-heading">{assistant.name}</p>
              <p className="text-xs text-subtle">{assistant.model}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-subtle hover:text-heading w-8 h-8 flex items-center justify-center rounded-lg hover:bg-raised transition-colors"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2">
              <MessageSquare size={36} strokeWidth={1.5} className="text-muted" />
              <p className="text-subtle text-sm">Envie uma mensagem para testar <strong className="text-heading">{assistant.name}</strong></p>
            </div>
          ) : messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
                m.role === 'user' ? 'bg-[#ff6b2c] text-black rounded-br-sm' : 'bg-raised text-heading rounded-bl-sm'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="bg-raised px-4 py-2.5 rounded-2xl rounded-bl-sm text-subtle text-sm animate-pulse">•••</div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="p-4 border-t border-dim flex gap-2 shrink-0">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            placeholder="Digite uma mensagem..."
            className="flex-1 bg-raised rounded-xl px-4 py-2.5 text-sm text-heading placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-[#ff6b2c]/50 transition-shadow"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="px-4 py-2.5 bg-[#ff6b2c] text-black rounded-xl text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Assistant picker (for quick action with multiple assistants) ─────────────

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
      <div className="bg-surface rounded-2xl w-full max-w-xs shadow-2xl p-4">
        <p className="text-sm font-semibold text-heading mb-3">Qual assistente testar?</p>
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {assistants.map(a => (
            <button
              key={a.id}
              onClick={() => { onSelect(a); onClose() }}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-raised text-left transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#ff6b2c] to-[#ff8533] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {a.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-heading truncate">{a.name}</p>
                <p className="text-xs text-subtle">{a.llmProvider} · {a.model}</p>
              </div>
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onPress={onClose} className="mt-3 w-full border-none text-subtle">
          Cancelar
        </Button>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { assistants, isLoading, hasFetched, fetchAssistants } = useAssistantStore()

  // Modals
  const [testingAssistant, setTestingAssistant] = useState<Assistant | null>(null)
  const [showPicker, setShowPicker] = useState(false)

  // Stats from backend
  const [usageData, setUsageData] = useState<DailyUsage[]>([])
  const [assistantStats, setAssistantStats] = useState<Record<string, AssistantStats>>({})
  const [activity, setActivity] = useState<ActivityEvent[]>([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasFetched) fetchAssistants()
  }, [hasFetched, fetchAssistants])

  // loadStats reads assistants via getState() to avoid stale closures
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
      // Fetch integrations, files, tools + stats in parallel for each assistant
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

  // Initial load when assistants are ready
  useEffect(() => {
    if (!hasFetched) return
    loadStats()
  }, [hasFetched, loadStats])

  // SSE-driven refresh + fallback poll every 60s
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

  // ── Computed stats ──────────────────────────────────────────────────────────
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
          <span className="text-[11px] text-emerald-500 font-medium">{activeAssistants} ativos</span>
          {inactiveAssistants > 0 && <span className="text-[11px] text-subtle">· {inactiveAssistants} inativos</span>}
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
            : activeIntegrations > 0 && <span className="text-[11px] text-subtle">Todas ok</span>}
        </div>
      ),
    },
    {
      title: 'Arquivos de Conhecimento', icon: FileText, value: totalFiles, subtitle: 'Documentos enviados',
      extra: (
        <div className="mt-2 space-y-0.5">
          {totalSize > 0 && <p className="text-[11px] text-subtle">{formatBytes(totalSize)} total</p>}
          {lastUpload && <p className="text-[11px] text-subtle truncate" title={lastUpload.name}>Último: {lastUpload.name}</p>}
        </div>
      ),
    },
    {
      title: 'Ferramentas Ativas', icon: Wrench, value: totalTools, subtitle: 'Ferramentas habilitadas',
      extra: toolNames.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {toolNames.map(n => (
            <span key={n} className="px-1.5 py-0.5 rounded text-[10px] bg-raised text-subtle truncate max-w-[90px]" title={n}>{n}</span>
          ))}
          {totalTools > 3 && <span className="text-[10px] text-subtle">+{totalTools - 3}</span>}
        </div>
      ),
    },
  ]

  // ── Handlers ────────────────────────────────────────────────────────────────
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

  // ── Activity icon ────────────────────────────────────────────────────────────
  const activityIcon = (type: string): { icon: React.ReactNode; bg: string } => {
    switch (type) {
      case 'error': return { icon: <AlertTriangle size={14} className="text-red-500" />, bg: 'bg-red-100 dark:bg-red-900/30' }
      case 'upload': return { icon: <FileText size={14} className="text-[#ff6b2c]" />, bg: 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10' }
      case 'config': return { icon: <Settings size={14} className="text-[#ff6b2c]" />, bg: 'bg-[#ff6b2c]/10' }
      default: return { icon: <MessageSquare size={14} className="text-emerald-500" />, bg: 'bg-emerald-100 dark:bg-emerald-900/30' }
    }
  }

  return (
    <div className="space-y-6 pb-8">
      {/* 1. Title */}
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl font-bold tracking-tight text-heading">Visão Geral</h2>
        <p className="text-subtle">Veja o que está acontecendo com seus projetos hoje.</p>
      </div>

      {/* 2. Quick Actions */}
      <div className="flex flex-wrap gap-2">
        <Link href="/dashboard/assistants">
          <Button variant="outline" size="sm" className="gap-1.5"><Bot size={14} /> Criar Assistente</Button>
        </Link>
        <Link href="/dashboard/assistants">
          <Button variant="outline" size="sm" className="gap-1.5"><FileText size={14} /> Adicionar Arquivo</Button>
        </Link>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onPress={handleQuickTest}
          isDisabled={assistants.length === 0}
        >
          <MessageSquare size={14} /> Testar Assistente
        </Button>
        <Link href="/dashboard/assistants">
          <Button variant="outline" size="sm" className="gap-1.5"><BarChart3 size={14} /> Ver Logs</Button>
        </Link>
      </div>

      {/* 3. Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <Card key={i} className="shadow-sm">
            <Card.Content className="p-4">
              <div className="flex flex-row items-center justify-between pb-1">
                <p className="text-sm font-medium text-subtle">{stat.title}</p>
                <div className="w-7 h-7 rounded-full bg-raised flex items-center justify-center shrink-0 text-muted"><stat.icon size={14} /></div>
              </div>
              <div className="text-xl font-bold text-heading">{isLoading ? '...' : stat.value}</div>
              <p className="text-xs text-subtle">{stat.subtitle}</p>
              {!isLoading && stat.extra}
            </Card.Content>
          </Card>
        ))}
      </div>

      {/* 4. Usage Over Time */}
      <Card className="shadow-sm">
        <Card.Header className="flex flex-col items-start px-6 pt-5 pb-0">
          <Card.Title className="font-semibold text-base text-heading">Uso ao Longo do Tempo</Card.Title>
          <Card.Description className="text-sm text-subtle">Requisições e tokens por dia — últimos 14 dias</Card.Description>
        </Card.Header>
        <Card.Content className="px-6 pb-5 pt-4">
          <UsageChart data={usageData} loading={statsLoading} error={statsError} />
        </Card.Content>
      </Card>

      {/* 4b. Pie + Area Charts */}
      <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
        <Card className="shadow-sm">
          <Card.Header className="flex flex-col items-start px-6 pt-5 pb-0">
            <Card.Title className="font-semibold text-base text-heading">Distribuição por Assistente</Card.Title>
            <Card.Description className="text-sm text-subtle">Tokens usados nos últimos 7 dias</Card.Description>
          </Card.Header>
          <Card.Content className="px-6 pb-5 pt-4 flex items-center justify-center">
            <PieChart
              data={(() => {
                const colors = ['#ff6b2c', '#ff8533', '#ffaa66', '#cc5500', '#e67300', '#ff944d', '#b34700', '#ffbf80']
                return assistants.map((a, i) => ({
                  label: a.name,
                  value: assistantStats[a.id]?.total_tokens ?? 0,
                  color: colors[i % colors.length],
                }))
              })()}
            />
          </Card.Content>
        </Card>

        <Card className="shadow-sm">
          <Card.Header className="flex flex-col items-start px-6 pt-5 pb-0">
            <Card.Title className="font-semibold text-base text-heading">Tendência de Tokens</Card.Title>
            <Card.Description className="text-sm text-subtle">Uso diário de tokens — últimos 14 dias</Card.Description>
          </Card.Header>
          <Card.Content className="px-6 pb-5 pt-4">
            <AreaChart data={usageData.map(d => ({ date: d.date, value: d.tokens }))} />
          </Card.Content>
        </Card>
      </div>

      {/* 5 + 6. Split: Seus Assistentes | Atividade Recente */}
      <div className="grid gap-6 lg:grid-cols-2">

        {/* Seus Assistentes */}
        <Card className="shadow-sm flex flex-col">
          <Card.Header className="flex flex-col items-start px-6 pt-5 pb-0 shrink-0">
            <div className="flex items-center justify-between w-full">
              <div>
                <Card.Title className="font-semibold text-base text-heading">Seus Assistentes</Card.Title>
                <Card.Description className="text-sm text-subtle">Status e métricas de cada assistente</Card.Description>
              </div>
              <Link href="/dashboard/assistants">
                <Button variant="ghost" size="sm" className="text-subtle text-xs border-none">Ver todos →</Button>
              </Link>
            </div>
          </Card.Header>
          <Card.Content className="p-4 overflow-y-auto" style={{ maxHeight: '520px' }}>
            {isLoading ? (
              <p className="text-sm text-subtle p-2">Carregando...</p>
            ) : assistants.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 text-muted"><Bot size={36} strokeWidth={1.5} /></div>
                <h3 className="text-sm font-semibold text-heading mb-1">Nenhum assistente ainda</h3>
                <p className="text-xs text-subtle mb-4 max-w-xs">Crie seu primeiro assistente para começar com atendimento ao cliente com IA.</p>
                <Link href="/dashboard/assistants">
                  <Button variant="primary" size="sm">Criar Assistente</Button>
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
                    <div key={assistant.id} className="flex flex-col gap-2 p-3 rounded-xl hover:bg-raised/60 transition-colors">
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#ff6b2c] to-[#ff8533] flex items-center justify-center text-sm font-bold text-white shrink-0">
                          {assistant.name.charAt(0).toUpperCase()}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-semibold text-heading">{assistant.name}</p>
                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase flex items-center gap-1 ${status.cls}`}>
                              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status.dot}`} />
                              {status.label}
                            </span>
                          </div>
                          <p className="text-xs text-subtle mt-0.5 truncate">
                            {assistant.llmProvider} · {assistant.model}
                          </p>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <span className="text-[11px] text-subtle flex items-center gap-1">
                              <MessageSquare size={10} /> <span className="text-heading font-medium">{msgs}</span> conv (7d)
                            </span>
                            <span className="text-[11px] text-subtle flex items-center gap-1">
                              <Hash size={10} /> {tokensStr} · {cost}
                            </span>
                            {lastAt && (
                              <span className="text-[11px] text-subtle flex items-center gap-1"><Clock size={10} /> {relativeTime(lastAt)}</span>
                            )}
                          </div>
                        </div>

                        {/* Sparkline */}
                        {sparkline && (
                          <div className="hidden sm:flex items-end pt-1">
                            <Sparkline data={sparkline} />
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 pl-12">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-7 px-3"
                          onPress={() => setTestingAssistant(assistant)}
                        >
                          <MessageSquare size={12} className="mr-1 inline-block" />Testar
                        </Button>
                        <Link href={`/dashboard/assistants/${assistant.id}`}>
                          <Button variant="ghost" size="sm" className="text-xs h-7 px-3 border-none text-subtle">
                            Ver Logs
                          </Button>
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card.Content>
        </Card>

        {/* Atividade Recente */}
        <Card className="shadow-sm flex flex-col">
          <Card.Header className="flex flex-col items-start px-6 pt-5 pb-0 shrink-0">
            <div className="flex items-center justify-between w-full">
              <div>
                <Card.Title className="font-semibold text-base text-heading">Atividade Recente</Card.Title>
                <Card.Description className="text-sm text-subtle">Últimas interações e eventos</Card.Description>
              </div>
              {statsLoading && <span className="text-xs text-subtle animate-pulse">Carregando...</span>}
            </div>
          </Card.Header>
          <Card.Content className="p-4 overflow-y-auto" style={{ maxHeight: '520px' }}>
            {!statsLoading && activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="mb-3 text-muted"><InboxIcon size={36} strokeWidth={1.5} /></div>
                <p className="text-sm text-subtle">Nenhuma atividade registrada ainda.</p>
                <p className="text-xs text-subtle mt-1">As conversas aparecerão aqui automaticamente.</p>
              </div>
            ) : (
              <div className="space-y-0">
                {(activity.length > 0 ? activity : []).map((event, i) => {
                  const { icon, bg } = activityIcon(event.event_type)
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-3 py-3 ${i < activity.length - 1 ? 'border-b border-dim' : ''}`}
                    >
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5 ${bg}`}>
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-heading leading-snug">{event.description}</p>
                        {event.assistant_name && (
                          <p className="text-[11px] text-subtle mt-0.5">{event.assistant_name}</p>
                        )}
                      </div>
                      <span className="text-[11px] text-subtle shrink-0 mt-0.5">{relativeTime(event.timestamp)}</span>
                    </div>
                  )
                })}
                {statsLoading && (
                  <div className="space-y-3 pt-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 py-2">
                        <div className="w-8 h-8 rounded-full bg-raised animate-pulse shrink-0" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3 bg-raised rounded animate-pulse w-3/4" />
                          <div className="h-2.5 bg-raised rounded animate-pulse w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card.Content>
        </Card>

      </div>

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
    </div>
  )
}
