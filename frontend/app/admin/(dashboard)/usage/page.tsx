'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useAdminStore } from '@/store/useAdminStore'
import { Cpu, MessageSquare, TrendingUp, TrendingDown, Zap } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts'

const mono = "'JetBrains Mono', 'Fira Code', monospace"
const COLORS = ['#ff6b2c', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatMonth(month: string) {
  const [, m] = month.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return months[parseInt(m, 10) - 1] || m
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-overlay border border-dim rounded-xl p-3" style={{ fontFamily: mono }}>
      <p className="text-subtle" style={{ fontSize: 11, marginBottom: 4 }}>{label}</p>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <p key={i} style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>
          {p.name}: {formatNumber(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function AdminUsagePage() {
  const { usageData, fetchUsage, isLoading } = useAdminStore()

  useEffect(() => {
    fetchUsage()
  }, [fetchUsage])

  if (isLoading && !usageData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-subtle" style={{ fontFamily: mono, fontSize: 14 }}>Carregando...</p>
      </div>
    )
  }

  const tokensCurrent = usageData?.total_tokens_current_month ?? 0
  const tokensPrevious = usageData?.total_tokens_previous_month ?? 0
  const tokensDiff = tokensPrevious > 0 ? ((tokensCurrent - tokensPrevious) / tokensPrevious * 100) : 0
  const tokensUp = tokensDiff >= 0

  const chartData = (usageData?.tokens_by_month ?? []).map((d) => ({
    ...d,
    label: formatMonth(d.month),
  }))

  const providerData = usageData?.by_provider ?? []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-heading" style={{ fontFamily: mono, fontSize: 24, fontWeight: 700 }}>
          Consumo de Tokens
        </h1>
        <p className="text-subtle" style={{ fontFamily: mono, fontSize: 13, marginTop: 4 }}>
          Uso de tokens e mensagens na plataforma
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-surface border border-dim rounded-xl p-5 transition-all duration-300 hover:border-dim-hover hover:shadow-lg hover:shadow-[rgba(255,107,0,0.05)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center">
              <Cpu size={18} className="text-[#ff6b2c]" />
            </div>
            <span className="text-subtle" style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
              Tokens (Mes Atual)
            </span>
          </div>
          <p className="text-heading" style={{ fontFamily: mono, fontSize: 28, fontWeight: 700 }}>
            {formatNumber(tokensCurrent)}
          </p>
          {tokensPrevious > 0 && (
            <div className="flex items-center gap-1 mt-2">
              {tokensUp ? <TrendingUp size={14} className="text-emerald-500" /> : <TrendingDown size={14} className="text-red-500" />}
              <span style={{ fontFamily: mono, fontSize: 11, color: tokensUp ? '#10b981' : '#ef4444' }}>
                {tokensUp ? '+' : ''}{tokensDiff.toFixed(1)}% vs mes anterior
              </span>
            </div>
          )}
        </div>

        <div className="bg-surface border border-dim rounded-xl p-5 transition-all duration-300 hover:border-dim-hover hover:shadow-lg hover:shadow-[rgba(255,107,0,0.05)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center">
              <Zap size={18} style={{ color: '#f59e0b' }} />
            </div>
            <span className="text-subtle" style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
              Tokens (Mes Anterior)
            </span>
          </div>
          <p className="text-heading" style={{ fontFamily: mono, fontSize: 28, fontWeight: 700 }}>
            {formatNumber(tokensPrevious)}
          </p>
        </div>

        <div className="bg-surface border border-dim rounded-xl p-5 transition-all duration-300 hover:border-dim-hover hover:shadow-lg hover:shadow-[rgba(255,107,0,0.05)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center">
              <MessageSquare size={18} style={{ color: '#3b82f6' }} />
            </div>
            <span className="text-subtle" style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
              Mensagens (Mes Atual)
            </span>
          </div>
          <p className="text-heading" style={{ fontFamily: mono, fontSize: 28, fontWeight: 700 }}>
            {formatNumber(usageData?.total_messages_current_month ?? 0)}
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Tokens Over Time */}
        <div className="lg:col-span-2 bg-surface border border-dim rounded-xl p-5">
          <h3 className="text-subtle" style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Tokens ao Longo do Tempo
          </h3>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="tokensGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff6b2c" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ff6b2c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: '#8892B0', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#8892B0', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} tickFormatter={formatNumber} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="tokens" name="Tokens" stroke="#ff6b2c" fill="url(#tokensGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[260px] flex items-center justify-center">
              <p className="text-subtle" style={{ fontFamily: mono, fontSize: 12 }}>Sem dados suficientes</p>
            </div>
          )}
        </div>

        {/* By Provider */}
        <div className="bg-surface border border-dim rounded-xl p-5">
          <h3 className="text-subtle" style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Por Provedor
          </h3>
          {providerData.length > 0 ? (
            <div className="flex flex-col items-center gap-4">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={providerData} dataKey="tokens" nameKey="provider" cx="50%" cy="50%" innerRadius={40} outerRadius={70} strokeWidth={0}>
                    {providerData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2 w-full">
                {providerData.map((p, i) => (
                  <div key={p.provider} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="text-subtle" style={{ fontFamily: mono, fontSize: 12 }}>{p.provider}</span>
                    </div>
                    <span className="text-heading" style={{ fontFamily: mono, fontSize: 12, fontWeight: 600 }}>{formatNumber(p.tokens)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center">
              <p className="text-subtle" style={{ fontFamily: mono, fontSize: 12 }}>Sem dados</p>
            </div>
          )}
        </div>
      </div>

      {/* Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Top Users */}
        <div className="bg-surface border border-dim rounded-xl p-5">
          <h3 className="text-subtle" style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Top Usuarios por Tokens
          </h3>
          {(usageData?.top_users_by_tokens ?? []).length > 0 ? (
            <div className="space-y-1">
              {usageData?.top_users_by_tokens.map((u, i) => {
                const maxTokens = usageData.top_users_by_tokens[0]?.tokens || 1
                const pct = (u.tokens / maxTokens) * 100
                return (
                  <Link
                    key={u.user_id}
                    href={`/admin/users/${u.user_id}`}
                    className="flex items-center gap-3 p-2.5 rounded-lg transition-colors duration-200 hover:bg-raised group animate-fade-in-up opacity-0"
                    style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
                  >
                    <span className="text-subtle w-5 text-right shrink-0" style={{ fontFamily: mono, fontSize: 11 }}>
                      {i + 1}.
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-heading text-sm font-medium truncate group-hover:text-[#ff6b2c] transition-colors duration-200" style={{ fontFamily: mono }}>
                          {u.user_name}
                        </p>
                        <span className="text-heading text-sm font-semibold shrink-0 ml-2" style={{ fontFamily: mono }}>
                          {formatNumber(u.tokens)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-dim rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }} />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          ) : (
            <div className="py-8 text-center">
              <p className="text-subtle" style={{ fontFamily: mono, fontSize: 12 }}>Sem dados de uso</p>
            </div>
          )}
        </div>

        {/* Top Assistants */}
        <div className="bg-surface border border-dim rounded-xl p-5">
          <h3 className="text-subtle" style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Top Assistentes por Tokens
          </h3>
          {(usageData?.top_assistants_by_tokens ?? []).length > 0 ? (
            <ResponsiveContainer width="100%" height={Math.max(200, (usageData?.top_assistants_by_tokens.length ?? 0) * 40)}>
              <BarChart
                data={usageData?.top_assistants_by_tokens.map((a) => ({
                  name: a.assistant_name.length > 18 ? a.assistant_name.slice(0, 18) + '...' : a.assistant_name,
                  tokens: a.tokens,
                }))}
                layout="vertical"
                margin={{ left: 10, right: 20 }}
              >
                <XAxis type="number" tick={{ fill: '#8892B0', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} tickFormatter={formatNumber} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#8892B0', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} width={120} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="tokens" name="Tokens" fill="#3b82f6" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="py-8 text-center">
              <p className="text-subtle" style={{ fontFamily: mono, fontSize: 12 }}>Sem dados de uso</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
