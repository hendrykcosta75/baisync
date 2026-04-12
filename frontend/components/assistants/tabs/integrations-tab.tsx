'use client'

import React, { useState, useEffect } from 'react'
import { Assistant } from '@/types/assistant'
import { Button, Input, Form } from '@heroui/react'
import { Send, MessageSquare, Settings, MoreVertical, ChevronDown, ChevronUp } from 'lucide-react'
import { useAssistantStore } from '@/store/useAssistantStore'

interface IntegrationsTabProps {
  assistant: Assistant
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold px-3 py-1.5" style={{ background: 'rgba(16,185,129,0.15)', color: '#34d399' }}>
        <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#34d399' }} />
        Conectado
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full text-xs font-semibold px-3 py-1.5" style={{ background: 'rgba(249,115,22,0.15)', color: '#fb923c' }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#fb923c' }} />
      Não configurado
    </span>
  )
}

export function IntegrationsTab({ assistant }: IntegrationsTabProps) {
  const { updateIntegrationForAssistant } = useAssistantStore()

  const integrations = assistant.integrations || []

  const telegramIntegration = integrations.find(i => i.provider === 'telegram')
  const whatsappIntegration = integrations.find(i => i.provider === 'whatsapp')

  const [tToken, setTToken] = useState(telegramIntegration?.token || '')
  const [cUrl, setCUrl] = useState(whatsappIntegration?.chatwootUrl || '')
  const [cToken, setCToken] = useState(whatsappIntegration?.token || '')
  const [origin, setOrigin] = useState('')
  const [expandedCard, setExpandedCard] = useState<'telegram' | 'whatsapp' | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const handleSaveTelegram = (e: React.FormEvent) => {
    e.preventDefault()
    updateIntegrationForAssistant(assistant.id, {
      provider: 'telegram',
      status: tToken.length > 5 ? 'connected' : 'disconnected',
      token: tToken
    })
  }

  const handleSaveWhatsApp = (e: React.FormEvent) => {
    e.preventDefault()
    updateIntegrationForAssistant(assistant.id, {
      provider: 'whatsapp',
      status: cToken.length > 5 && cUrl.length > 5 ? 'connected' : 'disconnected',
      token: cToken,
      chatwootUrl: cUrl
    })
  }

  const handleDisconnect = (provider: 'telegram' | 'whatsapp') => {
    updateIntegrationForAssistant(assistant.id, {
      provider,
      status: 'disconnected',
      token: '',
      phoneNumber: '',
      chatwootUrl: ''
    })
    if (provider === 'telegram') setTToken('')
    if (provider === 'whatsapp') { setCToken(''); setCUrl('') }
  }

  const cards = [
    {
      key: 'telegram' as const,
      name: 'Telegram Bot',
      description: 'Conecte seu assistente ao Telegram via Bot API para atender seus clientes automaticamente.',
      icon: (
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#0d0d0d' }}>
          <Send size={28} className="text-[#0088cc]" />
        </div>
      ),
      status: telegramIntegration?.status || 'disconnected',
    },
    {
      key: 'whatsapp' as const,
      name: 'WhatsApp (Chatwoot)',
      description: 'Receba mensagens do WhatsApp via Chatwoot e responda automaticamente com IA.',
      icon: (
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: '#0d0d0d' }}>
          <MessageSquare size={28} className="text-[#25D366]" />
        </div>
      ),
      status: whatsappIntegration?.status || 'disconnected',
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-heading">Integrações</h3>
          <p className="text-sm text-subtle mt-1">Conecte seu assistente a plataformas de mensagens.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {cards.map((card) => {
          const isConnected = card.status === 'connected'
          const isExpanded = expandedCard === card.key

          return (
            <div
              key={card.key}
              className="relative rounded-2xl p-6 flex flex-col justify-between transition-all duration-300"
              style={{
                background: isExpanded ? '#212121' : '#1a1a1a',
                boxShadow: isExpanded ? '0 8px 32px rgba(249,115,22,0.05)' : 'none',
              }}
            >
              {isConnected && (
                <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(249,115,22,0.03), transparent)' }} />
              )}

              <div className="relative">
                <div className="flex items-start justify-between mb-5">
                  {card.icon}
                  <button className="flex items-center justify-center w-8 h-8 rounded-lg text-subtle hover:text-heading transition-colors">
                    <MoreVertical size={18} />
                  </button>
                </div>

                <h4 className="text-lg font-semibold text-heading mb-3">{card.name}</h4>
                <p className="text-sm text-subtle leading-relaxed">{card.description}</p>
              </div>

              <div className="relative mt-6 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      className="flex items-center justify-center w-10 h-10 rounded-lg text-subtle hover:text-heading transition-colors"
                      onClick={() => setExpandedCard(isExpanded ? null : card.key)}
                    >
                      <Settings size={18} />
                    </button>
                    <button
                      className="text-sm font-medium text-subtle hover:text-heading transition-colors flex items-center gap-1"
                      onClick={() => setExpandedCard(isExpanded ? null : card.key)}
                    >
                      Configurar
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>
                  <StatusBadge status={card.status} />
                </div>

                {isExpanded && card.key === 'telegram' && (
                  <div className="mt-5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Form onSubmit={handleSaveTelegram} className="flex flex-col gap-4">
                      <div className="w-full">
                        <label className="text-xs font-semibold mb-1.5 block text-body">Bot Token</label>
                        <Input
                          className="w-full"
                          value={tToken}
                          onChange={(e) => setTToken(e.target.value)}
                          placeholder="123456789:ABCDEF..."
                          type="password"
                        />
                      </div>
                      <div className="flex justify-end gap-2 w-full">
                        {telegramIntegration?.status === 'connected' && (
                          <Button variant="danger" size="sm" onPress={() => handleDisconnect('telegram')}>
                            Desconectar
                          </Button>
                        )}
                        <Button variant="primary" size="sm" type="submit">
                          {telegramIntegration?.status === 'connected' ? 'Atualizar' : 'Conectar'}
                        </Button>
                      </div>
                    </Form>
                  </div>
                )}

                {isExpanded && card.key === 'whatsapp' && (
                  <div className="mt-5 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="text-sm text-subtle mb-4">
                      <p className="mb-2">Cole esta URL de Webhook no painel de Integrações do Chatwoot:</p>
                      <div className="bg-raised p-2.5 rounded-lg text-xs font-mono break-all font-semibold select-all">
                        {origin ? `${origin}/api/webhooks/chatwoot/${assistant.id}` : '...'}
                      </div>
                    </div>

                    <Form onSubmit={handleSaveWhatsApp} className="flex flex-col gap-4">
                      <div className="w-full">
                        <label className="text-xs font-semibold mb-1.5 block text-body">URL de Instalação Chatwoot</label>
                        <Input
                          className="w-full"
                          value={cUrl}
                          onChange={(e) => setCUrl(e.target.value)}
                          placeholder="https://chat.seudominio.com"
                          type="url"
                        />
                      </div>
                      <div className="w-full">
                        <label className="text-xs font-semibold mb-1.5 block text-body">Token de Acesso API Chatwoot</label>
                        <Input
                          className="w-full"
                          value={cToken}
                          onChange={(e) => setCToken(e.target.value)}
                          placeholder="Seu token de bot ou conta"
                          type="password"
                        />
                      </div>
                      <div className="flex justify-end gap-2 w-full">
                        {whatsappIntegration?.status === 'connected' && (
                          <Button variant="danger" size="sm" onPress={() => handleDisconnect('whatsapp')}>
                            Desconectar
                          </Button>
                        )}
                        <Button variant="primary" size="sm" type="submit">
                          {whatsappIntegration?.status === 'connected' ? 'Atualizar' : 'Conectar'}
                        </Button>
                      </div>
                    </Form>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
