'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { Button, Modal, Spinner } from '@heroui/react'
import { Banknote, TrendingUp, Clock, XCircle, CheckCircle2, AlertCircle, ChevronDown } from 'lucide-react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { apiFetch } from '@/lib/api'
import { useInfiniteScroll } from '@/lib/useInfiniteScroll'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'
import type { AssistantFinancialOverview, PixChargeSummary } from '@/types/assistant'

const monoFont = "'JetBrains Mono', 'Fira Code', monospace"

function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '--'
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatPhone(phone: string): string {
  if (!phone) return '--'
  const clean = phone.replace(/\D/g, '')
  if (clean.length === 13) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`
  if (clean.length === 12) return `+${clean.slice(0, 2)} (${clean.slice(2, 4)}) ${clean.slice(4, 8)}-${clean.slice(8)}`
  return phone
}

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  approved: { label: 'Pago', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: <CheckCircle2 size={14} /> },
  pending: { label: 'Pendente', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: <Clock size={14} /> },
  cancelled: { label: 'Cancelado', color: 'text-red-400', bg: 'bg-red-500/10', icon: <XCircle size={14} /> },
  expired: { label: 'Expirado', color: 'text-zinc-500', bg: 'bg-zinc-500/10', icon: <AlertCircle size={14} /> },
  refunded: { label: 'Estornado', color: 'text-blue-400', bg: 'bg-blue-500/10', icon: <AlertCircle size={14} /> },
}

export default function FinanceiroPage() {
  const { assistants, fetchAssistants, hasFetched } = useAssistantStore()
  const [overviews, setOverviews] = useState<AssistantFinancialOverview[]>([])
  const [selectedAssistant, setSelectedAssistant] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [chargesAssistantId, setChargesAssistantId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const fetchCharges = useCallback(async (cursor?: string) => {
    if (!chargesAssistantId) return { items: [] as PixChargeSummary[], cursor: null }
    const offset = cursor ? parseInt(cursor, 10) : 0
    const statusParam = statusFilter ? `&status=${statusFilter}` : ''
    const res = await apiFetch<{ items: PixChargeSummary[]; nextOffset?: number | null } | PixChargeSummary[]>(
      `/api/assistants/${chargesAssistantId}/financeiro/charges?limit=50&offset=${offset}${statusParam}`
    )
    if (Array.isArray(res)) {
      return { items: res, cursor: null }
    }
    return {
      items: res.items || [],
      cursor: res.nextOffset != null ? String(res.nextOffset) : null,
    }
  }, [chargesAssistantId, statusFilter])

  const [chargesResetKey, setChargesResetKey] = useState(0)

  const { items: charges, setItems: setCharges, isLoading: chargesLoading, isLoadingMore: chargesLoadingMore, hasMore: chargesHasMore, sentinelRef: chargesSentinelRef, reset: resetCharges } = useInfiniteScroll<PixChargeSummary>({
    fetchFn: fetchCharges,
    enabled: !!chargesAssistantId,
    resetKey: `${chargesAssistantId}-${statusFilter}-${chargesResetKey}`,
  })
  const [confirmCharge, setConfirmCharge] = useState<PixChargeSummary | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<PixChargeSummary | null>(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (!hasFetched) fetchAssistants()
  }, [hasFetched, fetchAssistants])

  useEffect(() => {
    loadOverview()
  }, [])

  // Auto-refresh on SSE events
  useEffect(() => {
    const refresh = () => {
      loadOverview()
      setChargesResetKey(k => k + 1)
    }
    window.addEventListener('sse:pix_status_changed', refresh)
    window.addEventListener('sse:pix_charge_created', refresh)
    window.addEventListener('sse:card_status_changed', refresh)
    window.addEventListener('sse:card_charge_created', refresh)
    return () => {
      window.removeEventListener('sse:pix_status_changed', refresh)
      window.removeEventListener('sse:pix_charge_created', refresh)
      window.removeEventListener('sse:card_status_changed', refresh)
      window.removeEventListener('sse:card_charge_created', refresh)
    }
  }, [])

  useEffect(() => {
    if (selectedAssistant !== 'all') {
      setChargesAssistantId(selectedAssistant)
    } else if (overviews.length > 0) {
      setChargesAssistantId(overviews[0].assistantId)
    } else {
      setChargesAssistantId(null)
    }
  }, [selectedAssistant, overviews])

  async function loadOverview() {
    setLoading(true)
    try {
      const data = await apiFetch<AssistantFinancialOverview[]>('/api/user/financeiro/overview')
      setOverviews(data || [])
    } catch (err) {
      console.error('Failed to load financial overview:', err)
    } finally {
      setLoading(false)
    }
  }

  // Charges are loaded via useInfiniteScroll hook above

  async function approveCharge() {
    if (!confirmCharge) return
    setConfirming(true)
    const assistantId = selectedAssistant !== 'all' ? selectedAssistant : overviews[0]?.assistantId
    if (!assistantId) { setConfirming(false); return }
    try {
      await apiFetch(`/api/assistants/${assistantId}/financeiro/charges/${confirmCharge.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'approved' }),
      })
      setCharges(prev => prev.map(c => c.id === confirmCharge.id ? { ...c, status: 'approved' as const } : c))
      loadOverview()
      setConfirmCharge(null)
    } catch (err) {
      console.error('Failed to approve charge:', err)
    } finally {
      setConfirming(false)
    }
  }

  async function confirmCancelCharge() {
    if (!cancelTarget) return
    const assistantId = selectedAssistant !== 'all' ? selectedAssistant : overviews[0]?.assistantId
    if (!assistantId) return
    setCancelling(true)
    try {
      await apiFetch(`/api/assistants/${assistantId}/financeiro/charges/${cancelTarget.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled' }),
      })
      setCharges(prev => prev.map(c => c.id === cancelTarget.id ? { ...c, status: 'cancelled' as const } : c))
      loadOverview()
      setCancelTarget(null)
    } catch (err) {
      console.error('Failed to cancel charge:', err)
    } finally {
      setCancelling(false)
    }
  }

  // Aggregate totals
  const totals = overviews.reduce(
    (acc, o) => ({
      revenue: acc.revenue + o.totalRevenue,
      total: acc.total + o.totalCharges,
      paid: acc.paid + o.paidCount,
      pending: acc.pending + o.pendingCount,
      unpaid: acc.unpaid + o.unpaidCount,
    }),
    { revenue: 0, total: 0, paid: 0, pending: 0, unpaid: 0 }
  )

  // Filter totals for selected assistant
  const displayTotals = selectedAssistant === 'all'
    ? totals
    : (() => {
        const o = overviews.find(o => o.assistantId === selectedAssistant)
        return o
          ? { revenue: o.totalRevenue, total: o.totalCharges, paid: o.paidCount, pending: o.pendingCount, unpaid: o.unpaidCount }
          : { revenue: 0, total: 0, paid: 0, pending: 0, unpaid: 0 }
      })()

  const selectedName = selectedAssistant === 'all'
    ? 'Todos os Assistentes'
    : assistants.find(a => a.id === selectedAssistant)?.name || 'Assistente'

  return (
    <PageTransition>
      <div className="space-y-6 pb-12">
        {/* Header */}
        <StaggerContainer>
          <StaggerItem>
            <div className="flex items-center justify-between">
              <div>
                <h1
                  className="text-2xl font-bold text-white"
                  style={{ fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)" }}
                >
                  Financeiro
                </h1>
                <p className="text-sm mt-1" style={{ color: '#8a8a8a', fontFamily: monoFont }}>
                  Acompanhe cobranças PIX e receitas dos seus assistentes
                </p>
              </div>

              {/* Assistant selector */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl transition text-sm"
                  style={{
                    fontFamily: monoFont,
                    background: 'rgba(255,107,44,0.03)',
                    border: '1px solid rgba(255, 107, 44, 0.08)',
                    backdropFilter: 'blur(8px)',
                    color: '#f0f0f0',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255, 107, 44, 0.25)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255, 107, 44, 0.08)')}
                >
                  <span className="max-w-[180px] truncate">{selectedName}</span>
                  <ChevronDown size={14} className={`transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} style={{ color: '#8a8a8a' }} />
                </button>
                {dropdownOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                    <div
                      className="absolute right-0 top-full mt-2 z-50 min-w-[220px] rounded-xl shadow-2xl overflow-hidden"
                      style={{
                        background: '#0a0a0a',
                        border: '1px solid rgba(255, 107, 44, 0.08)',
                        backdropFilter: 'blur(12px)',
                      }}
                    >
                      <button
                        onClick={() => { setSelectedAssistant('all'); setDropdownOpen(false) }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#111] ${selectedAssistant === 'all' ? 'text-[#ff6b2c] font-semibold' : ''}`}
                        style={{ fontFamily: monoFont, color: selectedAssistant === 'all' ? undefined : '#f0f0f0' }}
                      >
                        Todos os Assistentes
                      </button>
                      {assistants.map(a => (
                        <button
                          key={a.id}
                          onClick={() => { setSelectedAssistant(a.id); setDropdownOpen(false) }}
                          className={`w-full text-left px-4 py-2.5 text-sm transition hover:bg-[#111] truncate ${selectedAssistant === a.id ? 'text-[#ff6b2c] font-semibold' : ''}`}
                          style={{ fontFamily: monoFont, color: selectedAssistant === a.id ? undefined : '#f0f0f0' }}
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </StaggerItem>
        </StaggerContainer>

        {/* Summary Cards */}
        <StaggerContainer className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Revenue */}
          <StaggerItem>
            <div className="glass-card relative overflow-hidden p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)' }}>
                  <TrendingUp size={16} className="text-emerald-400" />
                </div>
                <span className="text-xs uppercase" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Receita</span>
              </div>
              <p className="text-2xl font-bold text-emerald-400" style={{ fontFamily: monoFont }}>
                {loading ? '...' : formatBRL(displayTotals.revenue)}
              </p>
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full -translate-y-8 translate-x-8" style={{ background: 'rgba(34,197,94,0.05)' }} />
            </div>
          </StaggerItem>

          {/* Total Charges */}
          <StaggerItem>
            <div className="glass-card relative overflow-hidden p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(255,107,44,0.1)' }}>
                  <Banknote size={16} className="text-[#ff6b2c]" />
                </div>
                <span className="text-xs uppercase" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Total</span>
              </div>
              <p className="text-2xl font-bold text-white" style={{ fontFamily: monoFont }}>
                {loading ? '...' : displayTotals.total}
              </p>
              <div className="absolute top-0 right-0 w-24 h-24 rounded-full -translate-y-8 translate-x-8" style={{ background: 'rgba(255,107,44,0.05)' }} />
            </div>
          </StaggerItem>

          {/* Paid */}
          <StaggerItem>
            <div className="glass-card relative overflow-hidden p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(34,197,94,0.1)' }}>
                  <CheckCircle2 size={16} className="text-emerald-400" />
                </div>
                <span className="text-xs uppercase" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Pagas</span>
              </div>
              <p className="text-2xl font-bold text-white" style={{ fontFamily: monoFont }}>
                {loading ? '...' : displayTotals.paid}
              </p>
            </div>
          </StaggerItem>

          {/* Pending */}
          <StaggerItem>
            <div className="glass-card relative overflow-hidden p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'rgba(245,158,11,0.1)' }}>
                  <Clock size={16} className="text-amber-400" />
                </div>
                <span className="text-xs uppercase" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Pendentes</span>
              </div>
              <p className="text-2xl font-bold text-white" style={{ fontFamily: monoFont }}>
                {loading ? '...' : displayTotals.pending}
              </p>
            </div>
          </StaggerItem>
        </StaggerContainer>

        {/* Per-assistant breakdown (only when viewing all) */}
        {selectedAssistant === 'all' && overviews.length > 0 && (
          <StaggerContainer className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {overviews.map(o => {
              const a = assistants.find(a => a.id === o.assistantId)
              return (
                <StaggerItem key={o.assistantId}>
                  <div
                    className="glass-card transition cursor-pointer"
                    style={{ border: '1px solid rgba(255, 107, 44, 0.08)' }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(255, 107, 44, 0.25)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255, 107, 44, 0.08)')}
                  >
                    <button className="p-5 w-full text-left" onClick={() => setSelectedAssistant(o.assistantId)}>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="font-semibold text-sm truncate max-w-[180px]" style={{ fontFamily: monoFont, color: '#f0f0f0' }}>
                          {a?.name || 'Assistente'}
                        </h3>
                        <span className="text-emerald-400 font-bold text-sm" style={{ fontFamily: monoFont }}>
                          {formatBRL(o.totalRevenue)}
                        </span>
                      </div>
                      <div className="flex gap-4 text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>
                        <span>{o.totalCharges} cobranças</span>
                        <span className="text-emerald-400">{o.paidCount} pagas</span>
                        <span className="text-amber-400">{o.pendingCount} pendentes</span>
                      </div>
                    </button>
                  </div>
                </StaggerItem>
              )
            })}
          </StaggerContainer>
        )}

        {/* Charges Table */}
        <StaggerContainer>
          <StaggerItem>
            <div className="glass-card overflow-hidden">
              <div className="p-5" style={{ borderBottom: '1px solid rgba(255, 107, 44, 0.08)' }}>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold" style={{ fontFamily: monoFont, color: '#f0f0f0' }}>Cobranças</h2>
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1">
                      {[
                        { value: '', label: 'Todos' },
                        { value: 'approved', label: 'Pagos' },
                        { value: 'pending', label: 'Pendentes' },
                        { value: 'cancelled', label: 'Cancelados' },
                      ].map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => setStatusFilter(opt.value)}
                          className={`px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer ${
                            statusFilter === opt.value
                              ? 'bg-[#ff6b2c]/20 text-[#ff6b2c]'
                              : 'text-[#8a8a8a] hover:text-[#f0f0f0]'
                          }`}
                          style={{
                            fontFamily: monoFont,
                            background: statusFilter === opt.value ? undefined : 'rgba(255,107,44,0.03)',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={() => setChargesResetKey(k => k + 1)}
                      isDisabled={chargesLoading}
                    >
                      {chargesLoading ? 'Carregando...' : 'Atualizar'}
                    </Button>
                  </div>
                </div>
              </div>

              {charges.length === 0 && !chargesLoading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,107,44,0.03)' }}>
                    <Banknote size={24} style={{ color: '#5a5a5a' }} />
                  </div>
                  <p className="text-sm" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>
                    {loading ? 'Carregando...' : 'Nenhuma cobrança encontrada'}
                  </p>
                  <p className="text-xs max-w-sm text-center" style={{ color: '#5a5a5a' }}>
                    As cobranças PIX geradas pelos seus assistentes aparecem aqui.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255, 107, 44, 0.08)' }}>
                        <th className="text-left px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Data</th>
                        <th className="text-left px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Cliente</th>
                        <th className="text-left px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Descricao</th>
                        <th className="text-right px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Valor</th>
                        <th className="text-center px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Modo</th>
                        <th className="text-center px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Status</th>
                        <th className="text-left px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Contato</th>
                        <th className="text-center px-5 py-3 text-xs uppercase font-medium" style={{ fontFamily: monoFont, color: '#8a8a8a', letterSpacing: '0.05em' }}>Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charges.map((charge) => {
                        const status = statusConfig[charge.status] || statusConfig.pending
                        return (
                          <tr key={charge.id} className="table-row-hover transition" style={{ borderBottom: '1px solid rgba(255, 107, 44, 0.04)' }}>
                            <td className="px-5 py-4">
                              <div className="flex flex-col">
                                <span className="text-sm" style={{ fontFamily: monoFont, color: '#f0f0f0' }}>{formatDate(charge.createdAt)}</span>
                                <span className="text-xs" style={{ fontFamily: monoFont, color: '#5a5a5a' }}>{formatTime(charge.createdAt)}</span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col">
                                <span className="text-sm max-w-[160px] truncate" style={{ color: '#f0f0f0' }}>{charge.customerName || '--'}</span>
                                <span className="text-xs" style={{ fontFamily: monoFont, color: '#5a5a5a' }}>{charge.customerCpf || '--'}</span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <span className="text-sm max-w-[200px] truncate block" style={{ color: '#f0f0f0' }}>{charge.description}</span>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <span className="text-sm font-bold text-white" style={{ fontFamily: monoFont }}>
                                {formatBRL(charge.amount)}
                              </span>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex justify-center">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                                  charge.paymentType === 'card'
                                    ? 'text-purple-400 bg-purple-500/10'
                                    : charge.pixMode === 'mercadopago'
                                    ? 'text-blue-400 bg-blue-500/10'
                                    : charge.pixMode === 'stripe'
                                    ? 'text-indigo-400 bg-indigo-500/10'
                                    : 'text-[#8a8a8a]'
                                }`} style={{ fontFamily: monoFont, background: charge.paymentType !== 'card' && charge.pixMode !== 'mercadopago' && charge.pixMode !== 'stripe' ? 'rgba(255,107,44,0.03)' : undefined }}>
                                  {charge.paymentType === 'card'
                                    ? (charge.pixMode === 'stripe' ? 'Cartao Stripe' : 'Cartao MP')
                                    : charge.pixMode === 'mercadopago' ? 'PIX MP'
                                    : charge.pixMode === 'stripe' ? 'PIX Stripe'
                                    : 'PIX Direto'}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex justify-center">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${status.color} ${status.bg}`} style={{ fontFamily: monoFont }}>
                                  {status.icon}
                                  {status.label}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <span className="text-sm" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>{formatPhone(charge.contactPhone)}</span>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex justify-center gap-1.5">
                                {charge.paymentType !== 'card' && charge.pixMode === 'direct' && charge.status === 'pending' && (
                                  <button
                                    onClick={() => setConfirmCharge(charge)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 transition cursor-pointer"
                                    style={{ fontFamily: monoFont }}
                                  >
                                    <CheckCircle2 size={12} />
                                    Confirmar
                                  </button>
                                )}
                                {charge.status === 'pending' && (
                                  <button
                                    onClick={() => setCancelTarget(charge)}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 transition cursor-pointer"
                                    style={{ fontFamily: monoFont }}
                                  >
                                    <XCircle size={12} />
                                    Cancelar
                                  </button>
                                )}
                                {charge.status !== 'pending' && (
                                  <span className="text-xs" style={{ color: '#5a5a5a' }}>--</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {chargesHasMore && (
                    <div ref={chargesSentinelRef} className="flex justify-center py-4">
                      {chargesLoadingMore && <Spinner size="sm" />}
                    </div>
                  )}
                </div>
              )}
            </div>
          </StaggerItem>
        </StaggerContainer>

        {/* Confirm Payment Modal */}
        <Modal>
          <Modal.Backdrop isOpen={!!confirmCharge} onOpenChange={(open) => { if (!open) setConfirmCharge(null) }}>
            <Modal.Container>
              <Modal.Dialog className="max-w-sm w-full">
                <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </Modal.CloseTrigger>
                <Modal.Header>
                  <Modal.Heading className="text-base font-semibold">Confirmar Pagamento</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="pb-2">
                  {confirmCharge && (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm text-subtle">
                        Confirma que o pagamento abaixo foi recebido?
                      </p>
                      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,107,44,0.08)' }}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>Valor</span>
                          <span className="text-sm font-bold text-emerald-400" style={{ fontFamily: monoFont }}>{formatBRL(confirmCharge.amount)}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>Cliente</span>
                          <span className="text-sm" style={{ fontFamily: monoFont, color: '#f0f0f0' }}>{confirmCharge.customerName || '--'}</span>
                        </div>
                        {confirmCharge.customerCpf && (
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>CPF</span>
                            <span className="text-sm" style={{ fontFamily: monoFont, color: '#f0f0f0' }}>{confirmCharge.customerCpf}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>Descricao</span>
                          <span className="text-sm max-w-[200px] truncate text-right" style={{ color: '#f0f0f0' }}>{confirmCharge.description}</span>
                        </div>
                      </div>
                      <p className="text-xs" style={{ color: '#5a5a5a' }}>
                        Ao confirmar, o cliente sera notificado automaticamente e o valor sera contabilizado na receita.
                      </p>
                    </div>
                  )}
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2 pt-4 pb-5 px-6">
                  <Button variant="ghost" size="sm" onPress={() => setConfirmCharge(null)} isDisabled={confirming}>
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 border-emerald-600 hover:border-emerald-700"
                    onPress={approveCharge}
                    isDisabled={confirming}
                  >
                    {confirming ? 'Confirmando...' : 'Sim, pagamento recebido'}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>

        {/* Cancel Charge Confirmation Modal */}
        <Modal>
          <Modal.Backdrop isOpen={!!cancelTarget} onOpenChange={(open) => { if (!open) setCancelTarget(null) }}>
            <Modal.Container>
              <Modal.Dialog className="max-w-sm w-full">
                <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </Modal.CloseTrigger>
                <Modal.Header>
                  <Modal.Heading className="text-base font-semibold">Cancelar Cobranca</Modal.Heading>
                </Modal.Header>
                <Modal.Body className="pb-2">
                  {cancelTarget && (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm text-subtle">
                        Tem certeza que deseja cancelar esta cobranca?
                      </p>
                      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,107,44,0.08)' }}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>Valor</span>
                          <span className="text-sm font-bold text-red-400" style={{ fontFamily: monoFont }}>{formatBRL(cancelTarget.amount)}</span>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>Cliente</span>
                          <span className="text-sm" style={{ fontFamily: monoFont, color: '#f0f0f0' }}>{cancelTarget.customerName || '--'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs" style={{ fontFamily: monoFont, color: '#8a8a8a' }}>Descricao</span>
                          <span className="text-sm max-w-[200px] truncate text-right" style={{ color: '#f0f0f0' }}>{cancelTarget.description}</span>
                        </div>
                      </div>
                      <p className="text-xs" style={{ color: '#5a5a5a' }}>
                        Esta acao nao pode ser desfeita. O cliente sera notificado do cancelamento.
                      </p>
                    </div>
                  )}
                </Modal.Body>
                <Modal.Footer className="flex justify-end gap-2 pt-4 pb-5 px-6">
                  <Button variant="ghost" size="sm" onPress={() => setCancelTarget(null)} isDisabled={cancelling}>
                    Voltar
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 border-red-600 hover:border-red-700"
                    onPress={confirmCancelCharge}
                    isDisabled={cancelling}
                  >
                    {cancelling ? 'Cancelando...' : 'Sim, cancelar cobranca'}
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      </div>
    </PageTransition>
  )
}
