'use client'

import React, { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAdminStore } from '@/store/useAdminStore'
import { Plug, Wifi, WifiOff, Search, Phone } from 'lucide-react'
// Using native input for filtering
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'

const mono = "'JetBrains Mono', 'Fira Code', monospace"
const COLORS = ['#ff6b2c', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899']

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType
  label: string
  value: string
  color?: string
}) {
  return (
    <div className="bg-surface border border-dim rounded-xl p-5 flex flex-col gap-3 transition-all duration-300 hover:border-dim-hover hover:shadow-lg hover:shadow-[rgba(255,107,0,0.05)]">
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center"
        >
          <Icon size={18} style={{ color: color || '#ff6b2c' }} />
        </div>
        <span className="text-subtle" style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>
          {label}
        </span>
      </div>
      <p className="text-heading" style={{ fontFamily: mono, fontSize: 28, fontWeight: 700 }}>
        {value}
      </p>
    </div>
  )
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function statusColor(status: string) {
  switch (status) {
    case 'connected': return '#10b981'
    case 'connecting':
    case 'reconnecting': return '#f59e0b'
    default: return '#ef4444'
  }
}

function statusLabel(status: string) {
  switch (status) {
    case 'connected': return 'Conectado'
    case 'connecting': return 'Conectando'
    case 'reconnecting': return 'Reconectando'
    case 'disconnected': return 'Desconectado'
    default: return status
  }
}

function channelLabel(channel: string) {
  switch (channel) {
    case 'whatsapp': return 'WhatsApp'
    case 'telegram': return 'Telegram'
    case 'chatwoot': return 'Chatwoot'
    default: return channel
  }
}

export default function AdminIntegrationsPage() {
  const { integrationsData, fetchIntegrations, isLoading } = useAdminStore()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [channelFilter, setChannelFilter] = useState<string>('all')

  useEffect(() => {
    fetchIntegrations()
  }, [fetchIntegrations])

  const filtered = useMemo(() => {
    if (!integrationsData) return []
    return integrationsData.integrations.filter((int) => {
      if (statusFilter !== 'all' && int.status !== statusFilter) return false
      if (channelFilter !== 'all' && int.channel !== channelFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return (
          int.user_name.toLowerCase().includes(q) ||
          int.user_email.toLowerCase().includes(q) ||
          int.assistant_name.toLowerCase().includes(q) ||
          (int.phone_number && int.phone_number.includes(q))
        )
      }
      return true
    })
  }, [integrationsData, search, statusFilter, channelFilter])

  const channels = useMemo(() => {
    if (!integrationsData) return []
    return [...new Set(integrationsData.integrations.map((i) => i.channel))]
  }, [integrationsData])

  if (isLoading && !integrationsData) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-subtle" style={{ fontFamily: mono, fontSize: 14 }}>Carregando...</p>
      </div>
    )
  }

  const channelChartData = integrationsData?.by_channel ?? []

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-heading" style={{ fontFamily: mono, fontSize: 24, fontWeight: 700 }}>
          Integracoes
        </h1>
        <p className="text-subtle" style={{ fontFamily: mono, fontSize: 13, marginTop: 4 }}>
          Status de todas as conexoes da plataforma
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Plug} label="Total" value={String(integrationsData?.total ?? 0)} />
        <StatCard icon={Wifi} label="Conectadas" value={String(integrationsData?.connected ?? 0)} color="#10b981" />
        <StatCard icon={WifiOff} label="Desconectadas" value={String(integrationsData?.disconnected ?? 0)} color="#ef4444" />
        <div className="bg-surface border border-dim rounded-xl p-5 transition-all duration-300 hover:border-dim-hover">
          <h3 className="text-subtle" style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>
            Por Canal
          </h3>
          {channelChartData.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width={80} height={80}>
                <PieChart>
                  <Pie data={channelChartData} dataKey="count" nameKey="channel" cx="50%" cy="50%" innerRadius={22} outerRadius={36} strokeWidth={0}>
                    {channelChartData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-1.5">
                {channelChartData.map((c, i) => (
                  <div key={c.channel} className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="text-subtle" style={{ fontFamily: mono, fontSize: 11 }}>{channelLabel(c.channel)}</span>
                    <span className="text-heading" style={{ fontFamily: mono, fontSize: 11, fontWeight: 600 }}>{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-subtle" style={{ fontFamily: mono, fontSize: 12 }}>Sem dados</p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-subtle pointer-events-none" />
          <input
            placeholder="Buscar por usuario, assistente, telefone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-raised border border-dim rounded-lg pl-8 pr-3 py-2 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none"
            style={{ fontFamily: mono }}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-raised border border-dim rounded-lg px-3 py-2 text-body text-sm outline-none focus:border-[#ff6b2c]/50 transition-colors duration-200"
          style={{ fontFamily: mono }}
        >
          <option value="all">Todos os status</option>
          <option value="connected">Conectado</option>
          <option value="disconnected">Desconectado</option>
          <option value="connecting">Conectando</option>
        </select>
        <select
          value={channelFilter}
          onChange={(e) => setChannelFilter(e.target.value)}
          className="bg-raised border border-dim rounded-lg px-3 py-2 text-body text-sm outline-none focus:border-[#ff6b2c]/50 transition-colors duration-200"
          style={{ fontFamily: mono }}
        >
          <option value="all">Todos os canais</option>
          {channels.map((c) => (
            <option key={c} value={c}>{channelLabel(c)}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface border border-dim rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ fontFamily: mono }}>
            <thead>
              <tr className="border-b border-dim">
                <th className="text-left text-subtle text-xs font-medium px-5 py-3 uppercase tracking-wider">Usuario</th>
                <th className="text-left text-subtle text-xs font-medium px-5 py-3 uppercase tracking-wider">Assistente</th>
                <th className="text-left text-subtle text-xs font-medium px-5 py-3 uppercase tracking-wider">Canal</th>
                <th className="text-left text-subtle text-xs font-medium px-5 py-3 uppercase tracking-wider">Provedor</th>
                <th className="text-left text-subtle text-xs font-medium px-5 py-3 uppercase tracking-wider">Status</th>
                <th className="text-left text-subtle text-xs font-medium px-5 py-3 uppercase tracking-wider">Telefone</th>
                <th className="text-left text-subtle text-xs font-medium px-5 py-3 uppercase tracking-wider">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12">
                    <p className="text-subtle" style={{ fontFamily: mono, fontSize: 13 }}>
                      Nenhuma integracao encontrada
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((int, i) => (
                  <tr
                    key={int.id}
                    className="border-b border-dim last:border-b-0 transition-colors duration-200 hover:bg-raised animate-fade-in-up opacity-0"
                    style={{ animationDelay: `${i * 30}ms`, animationFillMode: 'forwards' }}
                  >
                    <td className="px-5 py-3.5">
                      <Link href={`/admin/users/${int.user_id}`} className="hover:text-[#ff6b2c] transition-colors duration-200">
                        <p className="text-heading text-sm font-medium">{int.user_name}</p>
                        <p className="text-subtle text-xs">{int.user_email}</p>
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-body text-sm">{int.assistant_name}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-sm text-body">
                        {channelLabel(int.channel)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-body text-sm">{int.provider}</td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full" style={{
                        background: `${statusColor(int.status)}15`,
                        color: statusColor(int.status),
                      }}>
                        <span className="w-1.5 h-1.5 rounded-full animate-pulse-dot" style={{ background: statusColor(int.status) }} />
                        {statusLabel(int.status)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-subtle text-sm">
                      {int.phone_number ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone size={12} />
                          {int.phone_number}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-subtle text-xs">{formatDate(int.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
