'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAdminStore } from '@/store/useAdminStore'
import { Button, Modal } from '@heroui/react'
import {
  ArrowLeft, Bot, ShieldBan, ShieldCheck, Trash2, Shield, Key,
  DollarSign, Cpu, Plug, Calendar, Wrench, FileText, Wifi, WifiOff,
} from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

function CloseTrigger() {
  return (
    <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-dim transition-colors cursor-pointer text-subtle hover:text-heading">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </Modal.CloseTrigger>
  )
}

function SectionTitle({ icon: Icon, title, count, color }: { icon: React.ElementType; title: string; count?: number; color?: string }) {
  return (
    <h2 className="flex items-center gap-2 mb-4" style={{ fontFamily: mono, fontSize: 14, fontWeight: 700 }}>
      <Icon size={18} style={{ color: color || '#FF6B00' }} />
      <span className="text-heading">{title}</span>
      {count !== undefined && (
        <span className="text-subtle text-xs font-normal">({count})</span>
      )}
    </h2>
  )
}

function InfoCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-raised rounded-lg p-3">
      <p className="text-subtle" style={{ fontFamily: mono, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</p>
      <p style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: color || '#EDF0F7', marginTop: 4 }}>{value}</p>
    </div>
  )
}

function formatBRL(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatNumber(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatDateShort(date: string) {
  return new Date(date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function statusColor(status: string) {
  switch (status) {
    case 'connected': return '#10b981'
    case 'connecting': case 'reconnecting': return '#f59e0b'
    default: return '#ef4444'
  }
}

function chargeStatusColor(status: string) {
  switch (status) {
    case 'approved': return '#10b981'
    case 'pending': return '#f59e0b'
    case 'cancelled': return '#ef4444'
    default: return '#8892B0'
  }
}

function chargeStatusLabel(status: string) {
  switch (status) {
    case 'approved': return 'Paga'
    case 'pending': return 'Pendente'
    case 'cancelled': return 'Cancelada'
    default: return status
  }
}

function apptStatusLabel(status: string) {
  switch (status) {
    case 'pending': return 'Pendente'
    case 'confirmed': return 'Confirmado'
    case 'completed': return 'Concluido'
    case 'cancelled': return 'Cancelado'
    case 'no_show': return 'Nao compareceu'
    default: return status
  }
}

export default function AdminUserDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const {
    selectedUser, selectedUserEnriched, fetchUserDetail, fetchUserDetailEnriched,
    blockUser, deleteUser, fetchUsers, isLoading,
  } = useAdminStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState(false)

  useEffect(() => {
    if (id) {
      fetchUserDetail(id)
      fetchUserDetailEnriched(id)
    }
  }, [id, fetchUserDetail, fetchUserDetailEnriched])

  const user = selectedUserEnriched || selectedUser

  const handleBlock = useCallback(async () => {
    if (!user) return
    try {
      await blockUser(user.id, !user.blocked)
      setConfirmBlock(false)
      fetchUserDetail(id)
      fetchUserDetailEnriched(id)
      fetchUsers()
    } catch {
      // error in store
    }
  }, [user, blockUser, id, fetchUserDetail, fetchUserDetailEnriched, fetchUsers])

  const handleDelete = useCallback(async () => {
    if (!user) return
    try {
      await deleteUser(user.id)
      setConfirmDelete(false)
      router.replace('/admin/users')
    } catch {
      // error in store
    }
  }, [user, deleteUser, router])

  if (isLoading && !user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-subtle" style={{ fontFamily: mono, fontSize: 14 }}>Carregando...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <p className="text-subtle" style={{ fontFamily: mono, fontSize: 14 }}>Usuario nao encontrado</p>
      </div>
    )
  }

  const enriched = selectedUserEnriched
  const apiKeys = enriched ? [
    { name: 'OpenAI', has: enriched.has_openai_key },
    { name: 'Claude', has: enriched.has_claude_key },
    { name: 'Gemini', has: enriched.has_gemini_key },
    { name: 'ElevenLabs', has: enriched.has_elevenlabs_key },
    { name: 'MercadoPago', has: enriched.has_mercadopago_key },
  ] : []

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link href="/admin/users" className="inline-flex items-center gap-2 text-subtle hover:text-[#FF6B00] transition-colors duration-200">
        <ArrowLeft size={16} />
        <span style={{ fontFamily: mono, fontSize: 13 }}>Voltar</span>
      </Link>

      {/* User Info Card */}
      <div className="bg-surface border border-dim rounded-xl p-6 animate-fade-in-up" style={{ animationFillMode: 'forwards' }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="space-y-3">
            <h1 className="text-heading" style={{ fontFamily: mono, fontSize: 22, fontWeight: 700 }}>
              {user.name}
            </h1>
            <p className="text-subtle" style={{ fontFamily: mono, fontSize: 14 }}>
              {user.email}
            </p>
            <div className="flex items-center gap-3">
              {user.blocked ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs" style={{ fontFamily: mono, background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                  Bloqueado
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs" style={{ fontFamily: mono, background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                  Ativo
                </span>
              )}
              {enriched?.two_factor_enabled && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs" style={{ fontFamily: mono, background: 'rgba(59,130,246,0.1)', color: '#3b82f6' }}>
                  <Shield size={12} /> 2FA
                </span>
              )}
              <span className="text-subtle" style={{ fontFamily: mono, fontSize: 11 }}>
                Criado em {formatDate(user.created_at)}
              </span>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              className="border-dim text-sm"
              style={{ fontFamily: mono, color: user.blocked ? '#10b981' : '#f59e0b' }}
              onPress={() => setConfirmBlock(true)}
            >
              {user.blocked ? <ShieldCheck size={15} /> : <ShieldBan size={15} />}
              {user.blocked ? 'Desbloquear' : 'Bloquear'}
            </Button>
            <Button
              variant="ghost"
              className="border-dim text-sm"
              style={{ fontFamily: mono, color: '#ef4444' }}
              onPress={() => setConfirmDelete(true)}
            >
              <Trash2 size={15} />
              Remover
            </Button>
          </div>
        </div>
      </div>

      {enriched && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up opacity-0" style={{ animationDelay: '80ms', animationFillMode: 'forwards' }}>
            <InfoCard label="Receita Total" value={formatBRL(enriched.total_revenue)} color="#10b981" />
            <InfoCard label="Tokens Consumidos" value={formatNumber(enriched.total_tokens)} color="#FF6B00" />
            <InfoCard label="Mensagens" value={formatNumber(enriched.total_messages)} color="#3b82f6" />
            <InfoCard label="Assistentes" value={String(enriched.assistants.length)} />
          </div>

          {/* Security & API Keys */}
          <div className="bg-surface border border-dim rounded-xl p-5 animate-fade-in-up opacity-0" style={{ animationDelay: '160ms', animationFillMode: 'forwards' }}>
            <SectionTitle icon={Key} title="Seguranca e Chaves API" />
            <div className="flex flex-wrap gap-2">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border ${enriched.two_factor_enabled ? 'border-blue-500/30 text-blue-400 bg-blue-500/10' : 'border-dim text-subtle bg-raised'}`} style={{ fontFamily: mono }}>
                <Shield size={13} />
                2FA: {enriched.two_factor_enabled ? 'Ativo' : 'Inativo'}
              </span>
              {apiKeys.map((k) => (
                <span
                  key={k.name}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border ${k.has ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-dim text-subtle bg-raised'}`}
                  style={{ fontFamily: mono }}
                >
                  {k.name}: {k.has ? 'Configurada' : 'Nao'}
                </span>
              ))}
            </div>
          </div>

          {/* Financial */}
          <div className="bg-surface border border-dim rounded-xl p-5 animate-fade-in-up opacity-0" style={{ animationDelay: '240ms', animationFillMode: 'forwards' }}>
            <SectionTitle icon={DollarSign} title="Financeiro" color="#10b981" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <InfoCard label="Receita" value={formatBRL(enriched.total_revenue)} color="#10b981" />
              <InfoCard label="Pagas" value={String(enriched.paid_charges)} color="#10b981" />
              <InfoCard label="Pendentes" value={String(enriched.pending_charges)} color="#f59e0b" />
              <InfoCard label="Canceladas" value={String(enriched.cancelled_charges)} color="#ef4444" />
            </div>
            {enriched.recent_charges.length > 0 && (
              <div className="mt-4">
                <p className="text-subtle mb-2" style={{ fontFamily: mono, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' }}>Cobrancas Recentes</p>
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ fontFamily: mono }}>
                    <thead>
                      <tr className="border-b border-dim">
                        <th className="text-left text-subtle text-xs font-medium px-3 py-2">Valor</th>
                        <th className="text-left text-subtle text-xs font-medium px-3 py-2">Status</th>
                        <th className="text-left text-subtle text-xs font-medium px-3 py-2">Descricao</th>
                        <th className="text-left text-subtle text-xs font-medium px-3 py-2">Cliente</th>
                        <th className="text-left text-subtle text-xs font-medium px-3 py-2">Data</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enriched.recent_charges.map((c) => (
                        <tr key={c.id} className="border-b border-dim last:border-b-0 transition-colors duration-200 hover:bg-raised">
                          <td className="px-3 py-2 text-heading text-sm font-semibold">{formatBRL(c.amount)}</td>
                          <td className="px-3 py-2">
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style={{ background: `${chargeStatusColor(c.status)}15`, color: chargeStatusColor(c.status) }}>
                              {chargeStatusLabel(c.status)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-body text-xs max-w-[200px] truncate">{c.description || '—'}</td>
                          <td className="px-3 py-2 text-body text-xs">{c.customer_name || '—'}</td>
                          <td className="px-3 py-2 text-subtle text-xs">{formatDateShort(c.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Integrations */}
          {enriched.integrations.length > 0 && (
            <div className="bg-surface border border-dim rounded-xl p-5 animate-fade-in-up opacity-0" style={{ animationDelay: '320ms', animationFillMode: 'forwards' }}>
              <SectionTitle icon={Plug} title="Integracoes" count={enriched.integrations.length} />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {enriched.integrations.map((int) => (
                  <div key={int.id} className="bg-raised border border-dim rounded-lg p-3 flex items-center gap-3 transition-all duration-200 hover:border-dim-hover">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${statusColor(int.status)}15` }}>
                      {int.status === 'connected' ? <Wifi size={16} style={{ color: statusColor(int.status) }} /> : <WifiOff size={16} style={{ color: statusColor(int.status) }} />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-heading text-sm font-medium" style={{ fontFamily: mono }}>{int.channel}</p>
                      <p className="text-subtle text-xs" style={{ fontFamily: mono }}>{int.provider} {int.phone_number && `| ${int.phone_number}`}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Appointments */}
          {enriched.appointments_by_status.length > 0 && (
            <div className="bg-surface border border-dim rounded-xl p-5 animate-fade-in-up opacity-0" style={{ animationDelay: '400ms', animationFillMode: 'forwards' }}>
              <SectionTitle icon={Calendar} title="Agendamentos" color="#8b5cf6" />
              <div className="flex flex-wrap gap-3">
                {enriched.appointments_by_status.map((a) => (
                  <div key={a.status} className="bg-raised rounded-lg px-4 py-3 text-center">
                    <p className="text-heading" style={{ fontFamily: mono, fontSize: 20, fontWeight: 700 }}>{a.count}</p>
                    <p className="text-subtle" style={{ fontFamily: mono, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 }}>{apptStatusLabel(a.status)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assistants (Enriched) */}
          <div className="animate-fade-in-up opacity-0" style={{ animationDelay: '480ms', animationFillMode: 'forwards' }}>
            <SectionTitle icon={Bot} title="Assistentes" count={enriched.assistants.length} />

            {enriched.assistants.length === 0 ? (
              <div className="bg-surface border border-dim rounded-xl p-8 text-center">
                <p className="text-subtle" style={{ fontFamily: mono, fontSize: 13 }}>
                  Este usuario nao possui assistentes cadastrados
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {enriched.assistants.map((assistant, i) => (
                  <div
                    key={assistant.id}
                    className="bg-surface border border-dim rounded-xl p-4 transition-all duration-300 hover:border-dim-hover hover:shadow-lg hover:shadow-[rgba(255,107,0,0.05)] animate-fade-in-up opacity-0"
                    style={{ animationDelay: `${480 + i * 60}ms`, animationFillMode: 'forwards' }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-heading" style={{ fontFamily: mono, fontSize: 14, fontWeight: 600 }}>
                        {assistant.name}
                      </h3>
                      <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-raised text-subtle" style={{ fontFamily: mono }}>
                        {assistant.llm_provider}
                      </span>
                    </div>
                    {assistant.description && (
                      <p className="text-subtle line-clamp-2" style={{ fontFamily: mono, fontSize: 12, marginBottom: 8 }}>
                        {assistant.description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-3">
                      <span className="inline-flex items-center gap-1 text-subtle" style={{ fontFamily: mono, fontSize: 11 }}>
                        <Cpu size={12} /> {assistant.model}
                      </span>
                      <span className="inline-flex items-center gap-1 text-subtle" style={{ fontFamily: mono, fontSize: 11 }}>
                        <Wrench size={12} /> {assistant.tool_count} tools
                      </span>
                      <span className="inline-flex items-center gap-1 text-subtle" style={{ fontFamily: mono, fontSize: 11 }}>
                        <FileText size={12} /> {assistant.file_count} arquivos
                      </span>
                      <span className="inline-flex items-center gap-1 text-subtle" style={{ fontFamily: mono, fontSize: 11 }}>
                        <Plug size={12} /> {assistant.integration_count} integ.
                      </span>
                    </div>
                    <p className="mt-2" style={{ fontFamily: mono, fontSize: 10, color: '#333' }}>
                      {assistant.id}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Block Confirmation Modal */}
      <Modal>
        <Modal.Backdrop isOpen={confirmBlock} onOpenChange={setConfirmBlock}>
          <Modal.Container>
            <Modal.Dialog className="max-w-sm w-full bg-surface border border-dim rounded-xl">
              <CloseTrigger />
              <Modal.Header>
                <Modal.Heading className="text-heading" style={{ fontFamily: mono, fontSize: 16, fontWeight: 700 }}>
                  {user.blocked ? 'Desbloquear Usuario' : 'Bloquear Usuario'}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="pb-2">
                <p className="text-subtle" style={{ fontFamily: mono, fontSize: 13 }}>
                  {user.blocked
                    ? `Desbloquear ${user.name}?`
                    : `Bloquear ${user.name}? O usuario nao conseguira fazer login.`}
                </p>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 pt-4 pb-5 px-6">
                <Button variant="ghost" onPress={() => setConfirmBlock(false)} className="border-dim text-subtle">
                  Cancelar
                </Button>
                <Button
                  onPress={handleBlock}
                  className="border-none font-semibold"
                  style={{ background: user.blocked ? '#10b981' : '#ef4444', color: '#fff', fontFamily: mono }}
                >
                  Confirmar
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal>
        <Modal.Backdrop isOpen={confirmDelete} onOpenChange={setConfirmDelete}>
          <Modal.Container>
            <Modal.Dialog className="max-w-sm w-full bg-surface border border-dim rounded-xl">
              <CloseTrigger />
              <Modal.Header>
                <Modal.Heading style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: '#ef4444' }}>
                  Remover Usuario
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="pb-2">
                <p className="text-subtle" style={{ fontFamily: mono, fontSize: 13 }}>
                  Esta acao e irreversivel. Todos os dados de <strong className="text-heading">{user.name}</strong> serao removidos permanentemente.
                </p>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 pt-4 pb-5 px-6">
                <Button variant="ghost" onPress={() => setConfirmDelete(false)} className="border-dim text-subtle">
                  Cancelar
                </Button>
                <Button
                  onPress={handleDelete}
                  className="border-none font-semibold"
                  style={{ background: '#ef4444', color: '#fff', fontFamily: mono }}
                >
                  Remover
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
