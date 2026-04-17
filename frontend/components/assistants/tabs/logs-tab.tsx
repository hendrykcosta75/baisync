'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Card, Button, Spinner } from '@heroui/react'
import { apiFetch } from '@/lib/api'
import { useInfiniteScroll } from '@/lib/useInfiniteScroll'
import type { Assistant } from '@/types/assistant'
import { AlertTriangle, Wrench, Check, BookOpen, BarChart2, MessageSquare, Zap } from 'lucide-react'

interface LogsTabProps {
  assistant: Assistant
  shareToken?: string
}

interface AssistantLog {
  id: string
  tool_id: string
  tool_name: string
  arguments: string | null
  status_code: number | null
  response_body: string | null
  error: string | null
  duration_ms: number
  called_at: string
}

interface DailyPoint {
  date: string
  requests: number
  tokens: number
}

interface ChannelCount {
  channel: string
  count: number
}

interface AssistantStats {
  total_tokens: number
  total_messages: number
  sparkline: number[]
  daily: DailyPoint[]
  last_interaction_at: string | null
  channel_breakdown: ChannelCount[]
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatDate(isoStr: string) {
  const d = new Date(isoStr)
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function relativeTime(isoStr: string) {
  const diff = Date.now() - new Date(isoStr).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m}min`
  if (h < 24) return `há ${h}h`
  return `há ${d}d`
}

function tryFormatJson(str: string | null): string {
  if (!str) return '—'
  try { return JSON.stringify(JSON.parse(str), null, 2) } catch { return str }
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toString()
}

function shortDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length === 3) return `${parts[2]}/${parts[1]}`
  return dateStr
}

function channelLabel(channel: string): string {
  switch (channel) {
    case 'baileys': return 'WhatsApp (Baileys)'
    case 'whatsapp': return 'WhatsApp (API Oficial)'
    case 'telegram': return 'Telegram'
    default: return channel.charAt(0).toUpperCase() + channel.slice(1)
  }
}

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

function channelColor(channel: string): string {
  switch (channel) {
    case 'baileys': return 'bg-emerald-500'
    case 'whatsapp': return 'bg-green-600'
    case 'telegram': return 'bg-blue-500'
    default: return 'bg-[#ff6b2c]'
  }
}

// ─── Bar Chart ────────────────────────────────────────────────────────────────

function BarChart({
  data,
  valueKey,
  label,
  color = '#ff6b2c',
}: {
  data: DailyPoint[]
  valueKey: 'requests' | 'tokens'
  label: string
  color?: string
}) {
  const values = data.map(d => d[valueKey])
  const max = Math.max(...values, 1)
  const total = values.reduce((a, b) => a + b, 0)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-subtle uppercase tracking-wider">{label}</p>
        <p className="text-sm font-bold text-heading">{formatNumber(total)}<span className="text-xs text-subtle font-normal ml-1">total</span></p>
      </div>
      <div className="flex items-stretch gap-[3px] h-16">
        {data.map((d, i) => {
          const height = max > 0 ? Math.max((d[valueKey] / max) * 100, d[valueKey] > 0 ? 8 : 0) : 0
          return (
            <div
              key={i}
              className="group relative flex-1 flex flex-col items-center justify-end h-full"
            >
              <div
                className="w-full rounded-t-sm transition-opacity hover:opacity-80"
                style={{ height: `${height}%`, backgroundColor: color, minHeight: d[valueKey] > 0 ? 3 : 0 }}
              />
              {/* Tooltip on hover */}
              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
                <div className="bg-overlay rounded px-2 py-1 text-[10px] whitespace-nowrap shadow-lg">
                  <p className="font-semibold text-heading">{shortDate(d.date)}</p>
                  <p className="text-subtle">{formatNumber(d[valueKey])}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {/* X-axis: first and last label */}
      <div className="flex justify-between">
        <span className="text-[9px] text-subtle/70">{data.length > 0 ? shortDate(data[0].date) : ''}</span>
        <span className="text-[9px] text-subtle/70">{data.length > 0 ? shortDate(data[data.length - 1].date) : 'hoje'}</span>
      </div>
    </div>
  )
}

// ─── Channel Breakdown ────────────────────────────────────────────────────────

function ChannelBreakdown({ channels }: { channels: ChannelCount[] }) {
  const total = channels.reduce((a, c) => a + c.count, 0)
  if (total === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold text-subtle uppercase tracking-wider">Canais</p>
      <div className="flex flex-col gap-2">
        {channels.map(c => {
          const pct = Math.round((c.count / total) * 100)
          return (
            <div key={c.channel} className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full shrink-0 ${channelColor(c.channel)}`} />
              <span className="text-xs text-body flex-1">{channelLabel(c.channel)}</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-raised rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${channelColor(c.channel)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-subtle w-8 text-right">{c.count}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ code }: { code: number | null }) {
  if (code === null) return <span className="text-[10px] text-subtle">—</span>
  const ok = code < 400
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold font-mono ${
      ok
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    }`}>
      {code}
    </span>
  )
}

// ─── Log entry ────────────────────────────────────────────────────────────────

function LogEntry({ log }: { log: AssistantLog }) {
  const [expanded, setExpanded] = useState(false)
  const isError = !!log.error || (log.status_code !== null && log.status_code >= 400)

  return (
    <div className={`glass-card rounded-xl overflow-hidden transition-all duration-200 hover:border-[#ff6b2c]/30 ${isError ? '!border-red-500/40' : ''}`}>
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-raised/60 transition-colors text-left"
      >
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0 ${
          isError ? 'bg-red-100 dark:bg-red-900/30' : 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10'
        }`}>
          {isError
            ? <AlertTriangle size={14} className="text-red-500" />
            : <Wrench size={14} className="text-[#ff6b2c]" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-heading truncate">{log.tool_name}</span>
            <StatusBadge code={log.status_code} />
            {log.error && (
              <span className="text-[10px] text-red-500 truncate max-w-[200px]">{log.error}</span>
            )}
          </div>
          <p className="text-[11px] text-subtle mt-0.5">{formatDate(log.called_at)}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs font-mono text-subtle">{log.duration_ms}ms</p>
          <p className="text-[10px] text-subtle">{relativeTime(log.called_at)}</p>
        </div>

        <span className={`text-subtle text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {expanded && (
        <div className="border-t border-dim px-4 py-3 space-y-3 bg-raised/30">
          <div>
            <p className="text-[10px] font-semibold text-subtle uppercase tracking-wider mb-1">Argumentos</p>
            <pre className="text-[11px] font-mono text-heading bg-app rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all">
              {tryFormatJson(log.arguments)}
            </pre>
          </div>

          {log.error && (
            <div>
              <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-1">Erro</p>
              <pre className="text-[11px] font-mono text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all">
                {log.error}
              </pre>
            </div>
          )}

          {log.response_body && (
            <div>
              <p className="text-[10px] font-semibold text-subtle uppercase tracking-wider mb-1">Resposta</p>
              <pre className="text-[11px] font-mono text-heading bg-app rounded-lg px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                {tryFormatJson(log.response_body)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Tab ─────────────────────────────────────────────────────────────────────

type LogFilter = 'all' | 'errors' | 'slow'

export function LogsTab({ assistant, shareToken }: LogsTabProps) {
  const stqs = shareToken ? `&share_token=${encodeURIComponent(shareToken)}` : ''
  const [stats, setStats] = useState<AssistantStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchLogs = useCallback(async (cursor?: string) => {
    const offset = cursor ? parseInt(cursor, 10) : 0
    const res = await apiFetch<{ items: AssistantLog[]; nextOffset?: number | null } | AssistantLog[]>(
      `/api/assistants/${assistant.id}/logs?limit=50&offset=${offset}${stqs}`
    )
    if (Array.isArray(res)) {
      return { items: res, cursor: null }
    }
    return {
      items: res.items || [],
      cursor: res.nextOffset != null ? String(res.nextOffset) : null,
    }
  }, [assistant.id, stqs])

  const { items: logs, isLoading: loading, isLoadingMore: loadingMore, hasMore, sentinelRef, reset: resetLogs } = useInfiniteScroll<AssistantLog>({
    fetchFn: fetchLogs,
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatsLoading(true)
    apiFetch<AssistantStats>(`/api/assistants/${assistant.id}/stats?days=14&dates=${generateLocalDates(14)}${stqs}`)
      .then(data => setStats(data))
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false))
  }, [assistant.id, refreshKey, stqs])

  // Poll every 30s — refresh stats and logs
  useEffect(() => {
    const id = setInterval(() => {
      setRefreshKey(k => k + 1)
      resetLogs()
    }, 30_000)
    return () => clearInterval(id)
  }, [resetLogs])

  const filtered = logs.filter(l => {
    if (filter === 'errors') return !!l.error || (l.status_code !== null && l.status_code >= 400)
    if (filter === 'slow') return l.duration_ms > 2000
    return true
  })

  const totalCalls = logs.length
  const errorCount = logs.filter(l => !!l.error || (l.status_code !== null && l.status_code >= 400)).length
  const toolSet = [...new Set(logs.map(l => l.tool_name))]
  const hasKnowledge = (assistant.files?.length ?? 0) > 0

  return (
    <div className="flex flex-col gap-6">

      {/* ── Analytics section ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Charts card */}
        <Card className="lg:col-span-2">
          <Card.Content className="p-5 flex flex-col gap-5">
            <div className="flex items-center gap-2">
              <BarChart2 size={16} className="text-[#ff6b2c]" />
              <p className="text-sm font-semibold text-heading">Atividade (últimos 14 dias)</p>
            </div>
            {statsLoading ? (
              <div className="space-y-4">
                <div className="h-20 rounded-lg bg-raised animate-pulse" />
                <div className="h-20 rounded-lg bg-raised animate-pulse" />
              </div>
            ) : stats && stats.daily.length > 0 ? (
              <div className="flex flex-col gap-5">
                <BarChart data={stats.daily} valueKey="requests" label="Requisições" color="#ff6b2c" />
                <BarChart data={stats.daily} valueKey="tokens" label="Tokens consumidos" color="#06b6d4" />
              </div>
            ) : (
              <p className="text-xs text-subtle py-4 text-center">Nenhum dado de uso ainda.</p>
            )}
          </Card.Content>
        </Card>

        {/* Right column: summary + channels */}
        <div className="flex flex-col gap-4">
          {/* Summary */}
          <Card className="border border-dim">
            <Card.Content className="p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-amber-500" />
                <p className="text-sm font-semibold text-heading">Resumo</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] text-subtle uppercase font-bold">Mensagens</p>
                  <p className="text-xl font-bold text-heading mt-0.5">
                    {statsLoading ? '…' : formatNumber(stats?.total_messages ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-subtle uppercase font-bold">Tokens</p>
                  <p className="text-xl font-bold text-heading mt-0.5">
                    {statsLoading ? '…' : formatNumber(stats?.total_tokens ?? 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-subtle uppercase font-bold">Ferramentas</p>
                  <p className="text-xl font-bold text-heading mt-0.5">{loading ? '…' : totalCalls}</p>
                </div>
                <div>
                  <p className="text-[10px] text-subtle uppercase font-bold">Erros</p>
                  <p className={`text-xl font-bold mt-0.5 ${errorCount > 0 ? 'text-red-500' : 'text-heading'}`}>
                    {loading ? '…' : errorCount}
                  </p>
                </div>
              </div>
              {stats?.last_interaction_at && (
                <div className="pt-2 border-t border-dim">
                  <p className="text-[10px] text-subtle uppercase font-bold">Última interação</p>
                  <p className="text-xs text-body mt-0.5">{relativeTime(stats.last_interaction_at)}</p>
                </div>
              )}
            </Card.Content>
          </Card>

          {/* Channel breakdown */}
          {stats && stats.channel_breakdown.length > 0 && (
            <Card className="border border-dim">
              <Card.Content className="p-5 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <MessageSquare size={16} className="text-emerald-500" />
                  <p className="text-sm font-semibold text-heading">Canais</p>
                </div>
                <ChannelBreakdown channels={stats.channel_breakdown} />
              </Card.Content>
            </Card>
          )}
        </div>
      </div>

      {/* Knowledge base note */}
      {hasKnowledge && (
        <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-[#ff6b2c]/5 dark:bg-[#ff6b2c]/10 border border-[#ff6b2c]/20 dark:border-[#ff6b2c]/30">
          <BookOpen size={15} className="text-[#ff6b2c] mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-semibold text-[#ff6b2c] dark:text-[#ff8533]">RAG ativo</p>
            <p className="text-xs text-[#ff6b2c] dark:text-[#ff8533]">
              O assistente consulta automaticamente os {assistant.files?.length} arquivo{assistant.files?.length !== 1 ? 's' : ''} da base de conhecimento a cada mensagem recebida.
              O contexto recuperado é injetado no prompt antes de chamar o LLM.
            </p>
          </div>
        </div>
      )}

      {/* Tool call logs */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-heading">Chamadas de Ferramentas</p>
          <div className="ml-auto flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="text-xs"
              onPress={() => setRefreshKey(k => k + 1)}
              isDisabled={loading}
            >
              {loading ? '↻' : '↻ Atualizar'}
            </Button>
            {(['all', 'errors', 'slow'] as const).map(f => (
              <Button
                key={f}
                variant={filter === f ? 'primary' : 'outline'}
                size="sm"
                className="text-xs"
                onPress={() => setFilter(f)}
              >
                {f === 'all' ? 'Todos' : f === 'errors' ? `Erros ${errorCount > 0 ? `(${errorCount})` : ''}` : 'Lentos >2s'}
              </Button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 rounded-xl bg-raised animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-3 text-muted">{filter === 'all' ? <Wrench size={36} strokeWidth={1.5} /> : <Check size={36} strokeWidth={1.5} />}</div>
            <p className="text-sm font-semibold text-heading">
              {filter === 'all' ? 'Nenhuma chamada registrada' : 'Nenhum resultado para este filtro'}
            </p>
            <p className="text-xs text-subtle mt-1 max-w-xs">
              {filter === 'all'
                ? 'As chamadas às ferramentas configuradas aparecerão aqui.'
                : 'Tente selecionar outro filtro.'}
            </p>
          </div>
        ) : (
          <div
            className="space-y-2 overflow-y-auto pr-1"
            style={{ maxHeight: 'calc(100vh - 420px)', minHeight: '300px' }}
          >
            {filtered.map(log => <LogEntry key={log.id} log={log} />)}
            {hasMore && (
              <div ref={sentinelRef} className="flex justify-center py-4">
                {loadingMore && <Spinner size="sm" />}
              </div>
            )}
          </div>
        )}

        {!loading && toolSet.length > 0 && (
          <div className="mt-2 p-4 rounded-xl bg-raised/30">
            <p className="text-xs font-semibold text-subtle uppercase tracking-wider mb-2">Ferramentas utilizadas</p>
            <div className="flex flex-wrap gap-2">
              {toolSet.map(name => {
                const count = logs.filter(l => l.tool_name === name).length
                const errs = logs.filter(l => l.tool_name === name && (!!l.error || (l.status_code !== null && l.status_code >= 400))).length
                return (
                  <div key={name} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface text-xs">
                    <span className="font-medium text-heading">{name}</span>
                    <span className="text-subtle">{count}x</span>
                    {errs > 0 && <span className="text-red-400">{errs} err</span>}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
