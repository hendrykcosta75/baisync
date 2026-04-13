'use client'

import React, { useState, useEffect } from 'react'
import { Modal, Button } from '@heroui/react'
import { useApiKeysStore } from '@/store/useApiKeysStore'
import { Settings, MoreVertical, Eye, EyeOff, Trash2, TestTube, Save, ChevronDown } from 'lucide-react'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'

// ─── Provider logos (larger, in icon boxes) ──────────────────────────────────

function OpenAILogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#10a37f">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 8.151A4.475 4.475 0 0 1 4.681 6.03l-.002.16v5.514a.773.773 0 0 0 .388.682l5.83 3.363-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 8.151zm16.597 3.855l-5.833-3.367 2.019-1.168a.076.076 0 0 1 .072 0l4.83 2.786a4.494 4.494 0 0 1-.692 8.108v-5.674a.772.772 0 0 0-.396-.685zm2.008-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.483V7.151a.08.08 0 0 1 .032-.063l4.84-2.791a4.496 4.496 0 0 1 6.662 4.655zm-12.66 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.496 4.496 0 0 1 7.375-3.453l-.142.08L8.68 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  )
}

function AnthropicLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#d97706">
      <path d="M17.304 3.541H13.77L19.5 20.46h3.534zm-10.608 0L.966 20.46H4.59l1.21-3.436h6.37l1.209 3.436h3.623L11.327 3.54zm-.57 10.701 2.175-6.18 2.175 6.18z" />
    </svg>
  )
}

function GeminiLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#4285f4">
      <path d="M12 24A14.304 14.304 0 0 0 0 12 14.304 14.304 0 0 0 12 0a14.305 14.305 0 0 0 12 12 14.305 14.305 0 0 0-12 12" />
    </svg>
  )
}

function ElevenLabsLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#6B21A8">
      <rect x="2" y="4" width="3" height="16" rx="1.5" />
      <rect x="7" y="7" width="3" height="13" rx="1.5" />
      <rect x="12" y="2" width="3" height="20" rx="1.5" />
      <rect x="17" y="7" width="3" height="13" rx="1.5" />
    </svg>
  )
}

function MercadoPagoLogo() {
  return (
    <img
      src="/Logo-MercadoPago.png"
      alt="Mercado Pago"
      width={28}
      height={28}
      style={{ objectFit: 'contain' }}
    />
  )
}

function StripeLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="#635BFF">
      <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z" />
    </svg>
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

type AnyProvider = 'openai' | 'claude' | 'gemini' | 'elevenlabs' | 'mercadopago' | 'stripe'

interface ProviderInfo {
  key: AnyProvider
  logo: React.ReactNode
  name: string
  description: string
  placeholder: string
  category: 'llm' | 'service'
  publicKeyField?: string
  publicKeyPlaceholder?: string
  publicKeyLabel?: string
}

const PROVIDERS: ProviderInfo[] = [
  {
    key: 'openai',
    logo: <OpenAILogo />,
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4o-mini, o1 e outros modelos de linguagem para seus assistentes.',
    placeholder: 'sk-...',
    category: 'llm',
  },
  {
    key: 'claude',
    logo: <AnthropicLogo />,
    name: 'Anthropic (Claude)',
    description: 'Claude Sonnet, Opus e Haiku para respostas mais seguras e contextuais.',
    placeholder: 'sk-ant-...',
    category: 'llm',
  },
  {
    key: 'gemini',
    logo: <GeminiLogo />,
    name: 'Google (Gemini)',
    description: 'Gemini 2.5 Pro, Flash e outros modelos multimodais do Google.',
    placeholder: 'AIza...',
    category: 'llm',
  },
  {
    key: 'elevenlabs',
    logo: <ElevenLabsLogo />,
    name: 'ElevenLabs',
    description: 'Sintese de voz realista para respostas em audio dos seus assistentes.',
    placeholder: 'sk_...',
    category: 'service',
  },
  {
    key: 'mercadopago',
    logo: <MercadoPagoLogo />,
    name: 'Mercado Pago',
    description: 'Receba pagamentos PIX e cartao com verificacao automatica via Mercado Pago.',
    placeholder: 'APP_USR-... (Access Token)',
    category: 'service',
    publicKeyField: 'mp_public_key',
    publicKeyPlaceholder: 'APP_USR-... (Public Key)',
    publicKeyLabel: 'Chave Publica (para pagamentos por cartao)',
  },
  {
    key: 'stripe',
    logo: <StripeLogo />,
    name: 'Stripe',
    description: 'Receba pagamentos PIX e cartao com verificacao automatica via Stripe.',
    placeholder: 'sk_live_... (Secret Key)',
    category: 'service',
    publicKeyField: 'stripe_public_key',
    publicKeyPlaceholder: 'pk_live_... (Publishable Key)',
    publicKeyLabel: 'Chave Publica (para pagamentos por cartao)',
  },
]

// ─── Border accent colors per provider ──────────────────────────────────────

const PROVIDER_ACCENT: Record<AnyProvider, string> = {
  openai: '#10a37f',
  claude: '#d97706',
  gemini: '#4285f4',
  elevenlabs: '#6B21A8',
  mercadopago: '#00b1ea',
  stripe: '#635BFF',
}

// ─── Provider Card ───────────────────────────────────────────────────────────

function ProviderCard({
  provider,
  isConfigured,
  onSave,
  onTest,
  onRemove,
}: {
  provider: ProviderInfo
  isConfigured: boolean
  onSave: (value: string, publicKey?: string) => Promise<void>
  onTest: () => Promise<void>
  onRemove: () => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [value, setValue] = useState('')
  const [publicKeyValue, setPublicKeyValue] = useState('')
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [, setTesting] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null)

  const handleSave = async () => {
    setSaving(true)
    await onSave(value, provider.publicKeyField ? publicKeyValue : undefined)
    setSaving(false)
    setValue('')
    setPublicKeyValue('')
    setExpanded(false)
    setFeedback({ ok: true, msg: 'Salvo com sucesso!' })
    setTimeout(() => setFeedback(null), 2500)
  }

  const handleTest = async () => {
    setTesting(true)
    await onTest()
    setTesting(false)
    setFeedback({ ok: isConfigured, msg: isConfigured ? 'Conexao verificada!' : 'Chave nao configurada' })
    setTimeout(() => setFeedback(null), 3000)
  }

  const handleRemove = async () => {
    setRemoving(true)
    await onRemove()
    setConfirmOpen(false)
    setRemoving(false)
    setFeedback({ ok: true, msg: 'Credencial removida' })
    setTimeout(() => setFeedback(null), 2500)
  }

  const accent = PROVIDER_ACCENT[provider.key]

  return (
    <>
      <div
        className="flex flex-col gap-4 transition-all duration-300"
        style={{
          background: 'rgba(255, 255, 255, 0.04)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          padding: '28px',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          borderRadius: '16px',
          borderTop: `3px solid ${accent}`,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'translateY(-2px)'
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.07)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'
          e.currentTarget.style.borderTopColor = accent
          e.currentTarget.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.35)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'translateY(0)'
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)'
          e.currentTarget.style.borderTopColor = accent
          e.currentTarget.style.boxShadow = 'none'
        }}
      >
        {/* Top row: icon + menu */}
        <div className="flex items-start justify-between">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: '#252525' }}
          >
            {provider.logo}
          </div>

          <div className="relative">
            <button
              className="p-1 rounded-md transition-colors cursor-pointer"
              style={{ color: '#5a5a5a' }}
              onClick={() => setMenuOpen(!menuOpen)}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#999')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#5a5a5a')}
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 w-40 rounded-xl shadow-xl overflow-hidden" style={{ background: '#1f1f1f' }}>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs cursor-pointer transition-colors"
                    style={{ color: '#999' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a2a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { setExpanded(!expanded); setMenuOpen(false) }}
                  >
                    <Settings size={12} />
                    {expanded ? 'Fechar config' : 'Configurar'}
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-xs cursor-pointer transition-colors"
                    style={{ color: '#999' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a2a')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { handleTest(); setMenuOpen(false) }}
                  >
                    <TestTube size={12} />
                    Testar conexao
                  </button>
                  {isConfigured && (
                    <button
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-xs cursor-pointer transition-colors"
                      style={{ color: '#ef4444' }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#2a2a2a')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      onClick={() => { setConfirmOpen(true); setMenuOpen(false) }}
                    >
                      <Trash2 size={12} />
                      Remover chave
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Name */}
        <h3 className="text-lg font-semibold m-0" style={{ color: '#f0f0f0' }}>{provider.name}</h3>

        {/* Description */}
        <p className="text-[13px] leading-relaxed m-0 flex-1" style={{ color: '#8a8a8a' }}>
          {provider.description}
        </p>

        {/* Feedback toast */}
        {feedback && (
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
            style={{
              background: feedback.ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              color: feedback.ok ? '#34d399' : '#f87171',
              animation: 'fadeSlideIn 0.3s ease both',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: feedback.ok ? '#34d399' : '#f87171' }} />
            {feedback.msg}
          </div>
        )}

        {/* Expanded config section */}
        {expanded && (
          <div
            className="flex flex-col gap-3 pt-3 border-t"
            style={{ borderColor: 'rgba(255, 255, 255, 0.06)', animation: 'fadeSlideIn 0.3s ease both' }}
          >
            <div className="flex flex-col gap-1.5">
              {provider.publicKeyField && (
                <label className="text-xs" style={{ color: '#8a8a8a' }}>{provider.key === 'stripe' ? 'Secret Key' : 'Access Token'}</label>
              )}
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type={visible ? 'text' : 'password'}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder={isConfigured ? 'Redigite para alterar...' : provider.placeholder}
                    className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all"
                    style={{
                      background: '#141414',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#f0f0f0',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                  />
                </div>
                <button
                  className="p-2.5 rounded-lg cursor-pointer transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', color: '#8a8a8a' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#f0f0f0')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#8a8a8a')}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            {provider.publicKeyField && (
              <div className="flex flex-col gap-1.5 mt-2">
                <label className="text-xs" style={{ color: '#8a8a8a' }}>{provider.publicKeyLabel}</label>
                <input
                  type="text"
                  value={publicKeyValue}
                  onChange={(e) => setPublicKeyValue(e.target.value)}
                  placeholder={provider.publicKeyPlaceholder}
                  className="w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-all"
                  style={{
                    background: '#141414',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: '#f0f0f0',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)')}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                className="btn-neu flex items-center gap-1.5"
                onClick={handleSave}
                disabled={saving || (!value.trim() && !publicKeyValue.trim())}
              >
                <Save size={12} />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              <button
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.05)', color: '#8a8a8a' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#f0f0f0' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#8a8a8a' }}
                onClick={() => { setExpanded(false); setValue('') }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between pt-4"
          style={{ borderTop: '1px solid rgba(255,255,255,0.04)', marginTop: expanded ? '0' : '4px' }}
        >
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all"
            style={{ background: 'rgba(255,255,255,0.05)', color: '#8a8a8a' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = '#f0f0f0' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#8a8a8a' }}
            onClick={() => setExpanded(!expanded)}
          >
            <Settings size={12} />
            Configurar
            <ChevronDown
              size={12}
              className="transition-transform duration-200"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
            />
          </button>

          {/* Status badge */}
          {isConfigured ? (
            <span
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{
                  background: '#22c55e',
                  boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)',
                  animation: 'baisync-status-pulse 2s infinite',
                }}
              />
              Conectado
            </span>
          ) : (
            <span
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: 'rgba(255, 255, 255, 0.03)', color: '#5a5a5a' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ background: '#444' }}
              />
              Nao configurado
            </span>
          )}
        </div>
      </div>

      {/* Confirm removal modal */}
      <Modal>
        <Modal.Backdrop isOpen={confirmOpen} onOpenChange={setConfirmOpen}>
          <Modal.Container>
            <Modal.Dialog className="max-w-sm w-full">
              <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </Modal.CloseTrigger>
              <Modal.Header>
                <Modal.Heading className="text-base font-semibold">Remover credencial</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="pb-2">
                <p className="text-sm text-subtle">
                  Tem certeza que deseja remover a chave de API do <strong className="text-heading">{provider.name}</strong>?
                  Os assistentes que usam este provedor deixarao de funcionar.
                </p>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-2 pt-4 pb-5 px-6">
                <Button variant="ghost" size="sm" onPress={() => setConfirmOpen(false)} isDisabled={removing}>
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="bg-red-500 hover:bg-red-600 border-red-500 hover:border-red-600"
                  onPress={handleRemove}
                  isDisabled={removing}
                >
                  {removing ? 'Removendo...' : 'Sim, remover'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CredentialsPage() {
  const { configured, saveKeys, fetchKeys, hasFetched, keys } = useApiKeysStore()

  useEffect(() => {
    if (!hasFetched) fetchKeys()
  }, [hasFetched, fetchKeys])

  const [filter, setFilter] = useState<'all' | 'connected' | 'disconnected'>('all')

  const filtered =
    filter === 'all'
      ? PROVIDERS
      : filter === 'connected'
        ? PROVIDERS.filter((p) => configured[p.key])
        : PROVIDERS.filter((p) => !configured[p.key])

  const connectedCount = PROVIDERS.filter((p) => configured[p.key]).length
  const disconnectedCount = PROVIDERS.length - connectedCount

  const filters = [
    { key: 'all' as const, label: 'Todas', count: PROVIDERS.length },
    { key: 'connected' as const, label: 'Conectadas', count: connectedCount },
    { key: 'disconnected' as const, label: 'Nao configuradas', count: disconnectedCount },
  ]

  return (
    <PageTransition>
      <div className="pb-10">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4 mb-6">
          <div>
            <h1
              className="text-2xl font-light tracking-tight text-heading"
              style={{ fontFamily: "'Fira Code', 'JetBrains Mono', monospace" }}
            >
              Credenciais
            </h1>
            <p className="text-sm mt-1" style={{ color: '#8a8a8a' }}>
              Gerencie e configure suas chaves de API e servicos conectados
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-4 py-2 rounded-xl text-[13px] font-medium cursor-pointer transition-all"
              style={{
                background: filter === f.key ? 'rgba(249,115,22,0.15)' : 'transparent',
                color: filter === f.key ? '#f97316' : '#8a8a8a',
                border: filter === f.key ? '1px solid rgba(249,115,22,0.3)' : '1px solid transparent',
              }}
            >
              {f.label}
              <span className="ml-1.5 text-[11px] opacity-60">{f.count}</span>
            </button>
          ))}
        </div>

        {/* Cards Grid */}
        <StaggerContainer
          className="grid gap-4"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 380px))' }}
        >
          {filtered.map((provider) => (
            <StaggerItem key={provider.key}>
              <ProviderCard
                provider={provider}
                isConfigured={configured[provider.key]}
                onSave={async (value, publicKey) => {
                  const updates: Record<string, string> = { ...keys }
                  if (value.trim()) {
                    updates[provider.key] = value
                  }
                  if (provider.publicKeyField && publicKey?.trim()) {
                    updates[provider.publicKeyField] = publicKey
                  }
                  await saveKeys(updates as unknown as typeof keys)
                }}
                onTest={fetchKeys}
                onRemove={async () => {
                  const updates: Record<string, string> = { ...keys, [provider.key]: '' }
                  if (provider.publicKeyField) {
                    updates[provider.publicKeyField] = ''
                  }
                  await saveKeys(updates as unknown as typeof keys)
                }}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>

        <style>{`
          @keyframes fadeSlideIn {
            from { opacity: 0; transform: translateY(12px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </PageTransition>
  )
}
