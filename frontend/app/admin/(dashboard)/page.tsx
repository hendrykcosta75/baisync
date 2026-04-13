'use client'

import React, { useEffect } from 'react'
import Link from 'next/link'
import { useAdminStore } from '@/store/useAdminStore'
import { Users, Bot, MessageSquare, MessagesSquare, DollarSign, Receipt, TrendingUp, ArrowRight } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area,
} from 'recharts'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const COLORS = ['#ff6b2c', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType
  label: string
  value: string
  sub?: React.ReactNode
  color?: string
}) {
  return (
    <div
      className="rounded-2xl border border-dim p-5 flex flex-col gap-3"
      style={{ background: '#0a0a0a' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `${color || '#ff6b2c'}15` }}
        >
          <Icon size={18} style={{ color: color || '#ff6b2c' }} />
        </div>
        <span style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <div>
        <p style={{ fontFamily: mono, fontSize: 28, fontWeight: 700, color: '#fff' }}>
          {value}
        </p>
        {sub && (
          <div style={{ fontFamily: mono, fontSize: 11, color: '#555', marginTop: 4 }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dim p-5" style={{ background: '#0a0a0a' }}>
      <h3 style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatMonth(month: string) {
  const [, m] = month.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return months[parseInt(m, 10) - 1] || m
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-dim p-3" style={{ background: '#111', fontFamily: mono }}>
      <p style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>{label}</p>
      {payload.map((p: { name: string; value: number; color: string }, i: number) => (
        <p key={i} style={{ fontSize: 12, color: p.color, fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' && p.name.toLowerCase().includes('receita') ? formatBRL(p.value) : p.value}
        </p>
      ))}
    </div>
  )
}

export default function AdminDashboardPage() {
  const { stats, fetchStats, isLoading } = useAdminStore()

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  if (isLoading && !stats) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p style={{ fontFamily: mono, fontSize: 14, color: '#555' }}>Carregando...</p>
      </div>
    )
  }

  const chargesBreakdown = [
    { name: 'Pagas', value: stats?.paid_count ?? 0 },
    { name: 'Pendentes', value: stats?.pending_count ?? 0 },
    { name: 'Canceladas', value: stats?.cancelled_count ?? 0 },
  ].filter((d) => d.value > 0)

  const chargesColors = ['#10b981', '#f59e0b', '#ef4444']

  const usersMonthData = (stats?.users_by_month ?? []).map((d) => ({
    ...d,
    label: formatMonth(d.month),
  }))

  const revenueMonthData = (stats?.revenue_by_month ?? []).map((d) => ({
    ...d,
    label: formatMonth(d.month),
  }))

  return (
    <div className="space-y-8">
      <div>
        <h1 style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: '#fff' }}>
          Painel Administrativo
        </h1>
        <p style={{ fontFamily: mono, fontSize: 13, color: '#555', marginTop: 4 }}>
          Visao geral da plataforma
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          icon={Users}
          label="Total de Usuarios"
          value={String(stats?.total_users ?? 0)}
        />
        <StatCard
          icon={Bot}
          label="Total de Assistentes"
          value={String(stats?.total_assistants ?? 0)}
        />
        <StatCard
          icon={MessageSquare}
          label="Total de Conversas"
          value={String(stats?.total_conversations ?? 0)}
        />
        <StatCard
          icon={MessagesSquare}
          label="Total de Mensagens"
          value={String(stats?.total_messages ?? 0)}
        />
        <StatCard
          icon={DollarSign}
          label="Receita Total"
          value={formatBRL(stats?.total_revenue ?? 0)}
          color="#10b981"
        />
        <StatCard
          icon={Receipt}
          label="Total de Cobrancas"
          value={String(stats?.total_charges ?? 0)}
          sub={
            <div className="flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                {stats?.paid_count ?? 0} pagas
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                {stats?.pending_count ?? 0} pendentes
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {stats?.cancelled_count ?? 0} canceladas
              </span>
            </div>
          }
        />
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Users Growth */}
        <ChartCard title="Crescimento de Usuarios">
          {usersMonthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={usersMonthData}>
                <XAxis dataKey="label" tick={{ fill: '#555', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#555', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Usuarios" fill="#ff6b2c" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center">
              <p style={{ fontFamily: mono, fontSize: 12, color: '#333' }}>Sem dados suficientes</p>
            </div>
          )}
        </ChartCard>

        {/* Revenue Chart */}
        <ChartCard title="Receita Mensal">
          {revenueMonthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={revenueMonthData}>
                <defs>
                  <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: '#555', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#555', fontSize: 11, fontFamily: mono }} axisLine={false} tickLine={false} tickFormatter={(v) => `R$${v}`} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="revenue" name="Receita" stroke="#10b981" fill="url(#revenueGradient)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center">
              <p style={{ fontFamily: mono, fontSize: 12, color: '#333' }}>Sem dados suficientes</p>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Provider Distribution */}
        <ChartCard title="Provedores de IA">
          {(stats?.providers ?? []).length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie
                    data={stats?.providers}
                    dataKey="count"
                    nameKey="provider"
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    strokeWidth={0}
                  >
                    {stats?.providers.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2">
                {stats?.providers.map((p, i) => (
                  <div key={p.provider} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>
                      {p.provider}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 12, color: '#fff', fontWeight: 600 }}>
                      {p.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[140px] flex items-center justify-center">
              <p style={{ fontFamily: mono, fontSize: 12, color: '#333' }}>Sem assistentes</p>
            </div>
          )}
        </ChartCard>

        {/* Charges Breakdown */}
        <ChartCard title="Status das Cobrancas">
          {chargesBreakdown.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie
                    data={chargesBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={35}
                    outerRadius={60}
                    strokeWidth={0}
                  >
                    {chargesBreakdown.map((_, i) => (
                      <Cell key={i} fill={chargesColors[i]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2">
                {chargesBreakdown.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: chargesColors[i] }} />
                    <span style={{ fontFamily: mono, fontSize: 12, color: '#888' }}>
                      {d.name}
                    </span>
                    <span style={{ fontFamily: mono, fontSize: 12, color: '#fff', fontWeight: 600 }}>
                      {d.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[140px] flex items-center justify-center">
              <p style={{ fontFamily: mono, fontSize: 12, color: '#333' }}>Sem cobrancas</p>
            </div>
          )}
        </ChartCard>

        {/* Recent Users */}
        <ChartCard title="Usuarios Recentes">
          {(stats?.recent_users ?? []).length > 0 ? (
            <div className="flex flex-col gap-3">
              {stats?.recent_users.map((u) => (
                <Link key={u.id} href={`/admin/users/${u.id}`} className="flex items-center justify-between group">
                  <div className="min-w-0">
                    <p style={{ fontFamily: mono, fontSize: 13, color: '#fff', fontWeight: 500 }} className="truncate group-hover:text-[#ff6b2c] transition-colors">
                      {u.name}
                    </p>
                    <p style={{ fontFamily: mono, fontSize: 11, color: '#555' }} className="truncate">
                      {u.email}
                    </p>
                  </div>
                  <span style={{ fontFamily: mono, fontSize: 10, color: '#333' }} className="shrink-0 ml-2">
                    {formatDate(u.created_at)}
                  </span>
                </Link>
              ))}
              <Link href="/admin/users" className="flex items-center gap-1 mt-1 text-[#ff6b2c] hover:underline" style={{ fontFamily: mono, fontSize: 12 }}>
                Ver todos <ArrowRight size={12} />
              </Link>
            </div>
          ) : (
            <div className="h-[140px] flex items-center justify-center">
              <p style={{ fontFamily: mono, fontSize: 12, color: '#333' }}>Sem usuarios</p>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Platform Summary */}
      <div className="rounded-2xl border border-dim p-5" style={{ background: '#0a0a0a' }}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={16} className="text-[#ff6b2c]" />
          <h3 style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: 1, textTransform: 'uppercase' }}>
            Resumo da Plataforma
          </h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p style={{ fontFamily: mono, fontSize: 11, color: '#555' }}>Media de Assistentes/Usuario</p>
            <p style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {stats?.total_users ? (stats.total_assistants / stats.total_users).toFixed(1) : '0'}
            </p>
          </div>
          <div>
            <p style={{ fontFamily: mono, fontSize: 11, color: '#555' }}>Media de Conversas/Assistente</p>
            <p style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {stats?.total_assistants ? (stats.total_conversations / stats.total_assistants).toFixed(1) : '0'}
            </p>
          </div>
          <div>
            <p style={{ fontFamily: mono, fontSize: 11, color: '#555' }}>Media de Msgs/Conversa</p>
            <p style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {stats?.total_conversations ? (stats.total_messages / stats.total_conversations).toFixed(1) : '0'}
            </p>
          </div>
          <div>
            <p style={{ fontFamily: mono, fontSize: 11, color: '#555' }}>Ticket Medio</p>
            <p style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: '#fff', marginTop: 4 }}>
              {stats?.paid_count ? formatBRL(stats.total_revenue / stats.paid_count) : 'R$ 0'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
