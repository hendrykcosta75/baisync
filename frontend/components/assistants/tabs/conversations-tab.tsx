'use client'

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Assistant, Conversation, Message, MessageChannel, LLMProvider } from '@/types/assistant'
import { Button, Input, Modal, Select, ListBox, Label, Spinner } from '@heroui/react'
import { MessageSquare, Bot, BarChart3 } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { useApiKeysStore } from '@/store/useApiKeysStore'
import { useInfiniteScroll } from '@/lib/useInfiniteScroll'
import Markdown from 'react-markdown'
import { useModels } from '@/lib/useModels'

interface ConversationsTabProps {
  assistant: Assistant
  shareToken?: string
  isReadOnly?: boolean
}

function formatDate(dateStr: string) {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))

  if (diffHours < 1) return 'Agora mesmo'
  if (diffHours < 24) return `${diffHours}h atrás`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Ontem'
  return date.toLocaleDateString()
}

const channelColors: Record<string, string> = {
  whatsapp: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  baileys: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  telegram: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
}

const channelLabels: Record<string, string> = {
  whatsapp: 'WhatsApp',
  baileys: 'WhatsApp',
  telegram: 'Telegram',
}

function SummaryProviderPicker({ onGenerate, isGenerating }: { onGenerate: (provider: LLMProvider, model: string) => void, isGenerating: boolean }) {
  const [provider, setProvider] = useState<LLMProvider>('openai')
  const { models, isLoading: modelsLoading } = useModels(provider)
  const [model, setModel] = useState('')
  const configured = useApiKeysStore(s => s.configured)

  useEffect(() => {
    if (models.length > 0 && !models.includes(model)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setModel(models[0])
    }
  }, [models, model])

  const providers: { id: LLMProvider; label: string }[] = [
    { id: 'openai', label: 'OpenAI' },
    { id: 'claude', label: 'Claude' },
    { id: 'gemini', label: 'Gemini' },
  ]

  const hasKey = configured[provider]

  return (
    <div className="flex flex-col gap-3">
      <Select
        className="w-full"
        selectedKey={provider}
        onSelectionChange={(key) => {
          if (key) setProvider(key as LLMProvider)
        }}
      >
        <Label>Provedor</Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {providers.map(p => (
              <ListBox.Item key={p.id} id={p.id} textValue={p.label}>
                <span className="flex items-center gap-2">
                  {p.label}
                  {!configured[p.id] && <span className="text-[10px] text-amber-500">(sem chave)</span>}
                </span>
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Select
        className="w-full"
        selectedKey={model}
        onSelectionChange={(key) => {
          if (key) setModel(key as string)
        }}
      >
        <Label className="flex items-center gap-2">
          Modelo
          {modelsLoading && <Spinner size="sm" />}
        </Label>
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {models.map(m => (
              <ListBox.Item key={m} id={m} textValue={m}>{m}</ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      {!hasKey && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          Chave de API não configurada para este provedor. Configure em Configurações.
        </p>
      )}

      <button
        disabled={!model || !hasKey || isGenerating}
        onClick={() => onGenerate(provider, model)}
        className="w-full py-2.5 rounded-[10px] text-sm font-medium transition-all disabled:opacity-40 flex items-center justify-center gap-2"
        style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}
      >
        {isGenerating ? 'Gerando resumo...' : 'Gerar Resumo'}
      </button>
    </div>
  )
}

export function ConversationsTab({ assistant, shareToken }: ConversationsTabProps) {
  const qs = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : ''
  const qsPrefix = shareToken ? `share_token=${encodeURIComponent(shareToken)}&` : ''
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState<MessageChannel | 'all'>('all')
  const [openConvId, setOpenConvId] = useState<string | null>(null)
  const [loadedMessages, setLoadedMessages] = useState<Record<string, Message[]>>({})
  const [messageInput, setMessageInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [deleteModalConvId, setDeleteModalConvId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isTogglingAi, setIsTogglingAi] = useState(false)
  const [summaryModalOpen, setSummaryModalOpen] = useState(false)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [summaryResult, setSummaryResult] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const fetchConversations = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams()
    if (shareToken) params.set('share_token', shareToken)
    params.set('limit', '30')
    if (cursor) params.set('cursor', cursor)
    const res = await apiFetch<{ items: Conversation[]; cursor?: string | null }>(`/api/assistants/${assistant.id}/conversations?${params.toString()}`)
    // Handle both new paginated format and legacy array format
    if (Array.isArray(res)) {
      return { items: res as Conversation[], cursor: null }
    }
    return { items: res.items || [], cursor: res.cursor }
  }, [assistant.id, shareToken])

  const { items: conversations, setItems: setConversations, isLoading: isLoadingConversations, isLoadingMore, hasMore, sentinelRef } = useInfiniteScroll<Conversation>({
    fetchFn: fetchConversations,
  })

  const fetchMessages = useCallback((convId: string) => {
    return apiFetch<{ items: Message[]; cursor?: string | null } | Message[]>(`/api/assistants/${assistant.id}/conversations/${convId}/messages?${qsPrefix}limit=100`)
      .then(res => {
        if (Array.isArray(res)) return res
        return (res as { items: Message[] }).items || []
      })
  }, [assistant.id, qsPrefix])

  // Update contact name in conversation list from SSE events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (!detail?.conversationId) return
      // Update contactName if the SSE event includes it
      if (detail.contactName) {
        setConversations(prev => prev.map(c =>
          c.id === detail.conversationId && c.contactName !== detail.contactName
            ? { ...c, contactName: detail.contactName }
            : c
        ))
      }
    }
    window.addEventListener('sse:conversation_updated', handler)
    return () => window.removeEventListener('sse:conversation_updated', handler)
  }, [setConversations])

  // Poll for new messages while conversation is open
  useEffect(() => {
    if (!openConvId) return
    const refreshMessages = () => {
      fetchMessages(openConvId).then(msgs => {
        setLoadedMessages(prev => {
          const current = prev[openConvId] || []
          if (msgs.length !== current.length) {
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
            return { ...prev, [openConvId]: msgs }
          }
          return prev
        })
      }).catch(() => {})
    }
    // SSE-driven + fallback polling
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.conversationId === openConvId) refreshMessages()
    }
    window.addEventListener('sse:conversation_updated', handler)
    const interval = setInterval(refreshMessages, 10000)
    return () => {
      window.removeEventListener('sse:conversation_updated', handler)
      clearInterval(interval)
    }
  }, [openConvId, fetchMessages])

  const handleOpenConversation = (convId: string) => {
    setOpenConvId(convId)
    setMessageInput('')
    fetchMessages(convId)
      .then(data => {
        setLoadedMessages(prev => ({ ...prev, [convId]: data }))
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
      })
      .catch(() => {})
  }

  const handleSendMessage = async (convId: string) => {
    if (!messageInput.trim() || isSending) return

    setIsSending(true)
    try {
      const msg = await apiFetch<Message>(`/api/assistants/${assistant.id}/conversations/${convId}/messages${qs}`, {
        method: 'POST',
        body: JSON.stringify({ message: messageInput.trim() }),
      })
      setLoadedMessages(prev => ({
        ...prev,
        [convId]: [...(prev[convId] || []), msg],
      }))
      setConversations(prev =>
        prev.map(c =>
          c.id === convId
            ? { ...c, lastMessage: msg.content, lastMessageAt: msg.timestamp, messageCount: c.messageCount + 1 }
            : c
        )
      )
      setMessageInput('')
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    } catch (err) {
      console.error('Failed to send message:', err)
    } finally {
      setIsSending(false)
    }
  }

  const handleDeleteConversation = async (convId: string) => {
    setIsDeleting(true)
    try {
      await apiFetch(`/api/assistants/${assistant.id}/conversations/${convId}${qs}`, { method: 'DELETE' })
      setConversations(prev => prev.filter(c => c.id !== convId))
      if (openConvId === convId) setOpenConvId(null)
    } catch (err) {
      console.error('Failed to delete conversation:', err)
    } finally {
      setIsDeleting(false)
      setDeleteModalConvId(null)
    }
  }

  const handleToggleAi = async (convId: string, currentValue: boolean) => {
    setIsTogglingAi(true)
    try {
      await apiFetch(`/api/assistants/${assistant.id}/conversations/${convId}${qs}`, {
        method: 'PATCH',
        body: JSON.stringify({ aiEnabled: !currentValue }),
      })
      setConversations(prev =>
        prev.map(c => c.id === convId ? { ...c, aiEnabled: !currentValue } : c)
      )
    } catch (err) {
      console.error('Failed to toggle AI:', err)
    } finally {
      setIsTogglingAi(false)
    }
  }

  const handleGenerateSummary = async (provider: LLMProvider, model: string) => {
    if (!openConvId) return
    setIsGeneratingSummary(true)
    setSummaryError(null)
    setSummaryResult(null)
    try {
      const res = await apiFetch<{ summary: string; tokens_used: number }>(
        `/api/assistants/${assistant.id}/conversations/${openConvId}/summary${qs}`,
        {
          method: 'POST',
          body: JSON.stringify({ provider, model }),
        }
      )
      setSummaryResult(res.summary)
    } catch (err) {
      setSummaryError('Falha ao gerar o resumo. Verifique sua chave de API e tente novamente.')
      console.error('Failed to generate summary:', err)
    } finally {
      setIsGeneratingSummary(false)
    }
  }

  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      const matchSearch = !search || c.contactName.toLowerCase().includes(search.toLowerCase())
      const normalizedChannel = c.channel === 'baileys' ? 'whatsapp' : c.channel
      const matchChannel = channelFilter === 'all' || normalizedChannel === channelFilter
      return matchSearch && matchChannel
    })
  }, [conversations, search, channelFilter])

  const openConv = conversations.find(c => c.id === openConvId)
  const openMessages = openConvId ? (loadedMessages[openConvId] || []) : []
  const totalTokens = openMessages.reduce((acc, m) => acc + (m.tokens_used ?? 0), 0)

  if (conversations.length === 0 && !isLoadingConversations) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 text-muted"><MessageSquare size={40} strokeWidth={1.5} /></div>
        <h3 className="text-lg font-semibold text-foreground mb-1">Nenhuma conversa ainda</h3>
        <p className="text-sm text-muted max-w-md">
          As conversas aparecerão aqui quando os usuários começarem a enviar mensagens ao seu assistente através das integrações conectadas.
        </p>
      </div>
    )
  }

  if (isLoadingConversations && conversations.length === 0) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Conversation list */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          className="flex-1"
          placeholder="Buscar por contato..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2">
          {(['all', 'whatsapp', 'telegram'] as const).map((ch) => (
            <Button
              key={ch}
              variant={channelFilter === ch ? 'primary' : 'outline'}
              className="text-xs capitalize"
              onPress={() => setChannelFilter(ch)}
            >
              {ch === 'all' ? 'Todos' : ch}
            </Button>
          ))}
        </div>
      </div>

      <div
        className="flex flex-col gap-3 overflow-y-auto pr-1"
        style={{ maxHeight: 'calc(100vh - 320px)', minHeight: '300px' }}
      >
        {filtered.map((conv) => (
          <div
            key={conv.id}
            role="button"
            tabIndex={0}
            className="glass-card rounded-xl p-4 cursor-pointer transition-all duration-200 hover:border-[#ff6b2c]/30"
            onClick={() => handleOpenConversation(conv.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleOpenConversation(conv.id)
              }
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-full bg-raised flex items-center justify-center text-sm font-bold text-subtle shrink-0">
                  {(conv.contactName || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className="font-semibold text-heading text-sm"
                      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                    >
                      {conv.contactName}
                    </span>
                    {channelColors[conv.channel] && (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${channelColors[conv.channel]}`}>
                        {channelLabels[conv.channel] || conv.channel}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded-full bg-raised text-[10px] font-semibold text-subtle">
                      {conv.messageCount} msgs
                    </span>
                    {conv.totalTokens > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-[#ff6b2c]/10 text-[10px] font-semibold text-[#ff6b2c]">
                        {conv.totalTokens > 1000 ? `${(conv.totalTokens / 1000).toFixed(1)}k` : conv.totalTokens} tokens
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-subtle mt-0.5 truncate">{conv.lastMessage}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-subtle whitespace-nowrap">{formatDate(conv.lastMessageAt)}</span>
                <button
                  type="button"
                  className="btn-neu-ghost !text-red-400 hover:!text-red-300 text-xs px-2 py-1"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDeleteModalConvId(conv.id)
                  }}
                >
                  Excluir
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && !isLoadingConversations && (
          <p className="text-sm text-muted text-center py-8">Nenhuma conversa corresponde aos seus filtros.</p>
        )}

        {/* Infinite scroll sentinel */}
        {hasMore && (
          <div ref={sentinelRef} className="flex justify-center py-4">
            {isLoadingMore && <Spinner size="sm" />}
          </div>
        )}
      </div>

      {/* Conversation detail modal */}
      <Modal isOpen={!!openConv} onOpenChange={(open) => { if (!open) setOpenConvId(null) }}>
        <Modal.Backdrop variant="blur">
          <Modal.Container placement="center">
            <Modal.Dialog className="w-[95vw] max-w-5xl h-[85vh] flex flex-col">
              {openConv && (
                <>
                  {/* Header */}
                  <div className="flex items-center gap-4 px-6 py-4 border-b border-dim shrink-0">
                    <button
                      className="shrink-0 font-medium px-3 py-1.5 text-[12px] transition-colors text-subtle hover:text-heading bg-transparent border-none"
                      onClick={() => setOpenConvId(null)}
                    >
                      ← Voltar
                    </button>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-[10px] flex items-center justify-center text-sm font-semibold shrink-0" style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}>
                        {(openConv.contactName || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">{openConv.contactName}</span>
                          {channelColors[openConv.channel] && (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${channelColors[openConv.channel]}`}>
                              {channelLabels[openConv.channel] || openConv.channel}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-xs text-muted">{openConv.messageCount} mensagens</p>
                          {totalTokens > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#ff6b2c]/10 text-[#ff6b2c] dark:bg-[#ff6b2c]/10 dark:text-[#ff8533] font-medium">
                              {totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens} tokens
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <button
                      className="text-xs px-3 py-1.5 rounded-[10px] min-w-0 shrink-0 transition-all"
                      style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#C75050' }}
                      onClick={() => setDeleteModalConvId(openConv.id)}
                    >
                      Excluir
                    </button>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-6">
                    <div className="flex flex-col gap-3 max-w-3xl mx-auto">
                      {openMessages.map((msg) => (
                        <div
                          key={msg.id}
                          className={`flex items-end gap-1.5 ${msg.sender === 'user' ? 'justify-start' : 'justify-end'}`}
                        >
                          {msg.sender === 'user' ? (
                            <div className="max-w-[75%] px-4 py-2.5 rounded-2xl text-sm text-body" style={{ background: '#1e1e1e', border: '1px solid #282828' }}>
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                              <div className="flex items-center gap-2 mt-1 text-subtle">
                                <span className="text-[10px]">
                                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div
                              className="max-w-[75%] px-4 py-2.5 text-sm"
                              style={{
                                background: 'rgba(255,107,0,0.12)',
                                border: '1px solid rgba(255,107,0,0.25)',
                                borderRadius: '14px 14px 4px 14px',
                                color: '#ffcea0',
                              }}
                            >
                              <p className="whitespace-pre-wrap">{msg.content}</p>
                              <div className="flex items-center gap-2 mt-1" style={{ color: 'rgba(255,206,160,0.5)' }}>
                                <span className="text-[10px]">
                                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                                {msg.tokens_used != null && msg.tokens_used > 0 && (
                                  <span className="text-[10px]">{msg.tokens_used} tok</span>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  {/* Input */}
                  <div className="border-t border-dim px-6 py-4 shrink-0">
                    {!openConv.aiEnabled && (
                      <div className="flex items-center gap-2 max-w-3xl mx-auto mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          O agente de IA está pausado para esta conversa. Mensagens do contato não receberão respostas automáticas.
                        </span>
                      </div>
                    )}
                    <div className="flex gap-3 max-w-3xl mx-auto">
                      <button
                        className="shrink-0 min-w-0 px-3 py-1.5 text-xs rounded-[10px] flex items-center gap-1 transition-all disabled:opacity-40"
                        style={{
                          background: '#121212',
                          boxShadow: openConv.aiEnabled
                            ? 'inset 2px 2px 6px rgba(0,0,0,0.5), inset -1px -1px 4px rgba(255,255,255,0.03)'
                            : '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                          color: openConv.aiEnabled ? '#D4835A' : '#8a8a8a',
                        }}
                        disabled={isTogglingAi}
                        onClick={() => handleToggleAi(openConv.id, openConv.aiEnabled)}
                      >
                        <Bot size={13} />{openConv.aiEnabled ? 'IA Ligada' : 'IA Desligada'}
                      </button>
                      <Input
                        className="flex-1"
                        placeholder="Digite uma mensagem..."
                        value={messageInput}
                        onChange={(e) => setMessageInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && openConvId) {
                            e.preventDefault()
                            handleSendMessage(openConvId)
                          }
                        }}
                      />
                      <button
                        className="shrink-0 min-w-0 px-3 py-1.5 text-xs rounded-[10px] flex items-center gap-1 transition-all"
                        style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}
                        onClick={() => {
                          setSummaryResult(null)
                          setSummaryError(null)
                          setSummaryModalOpen(true)
                        }}
                      >
                        <BarChart3 size={13} />Resumo
                      </button>
                      <button
                        className="px-4 py-1.5 text-xs rounded-[10px] transition-all disabled:opacity-40"
                        style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}
                        disabled={!messageInput.trim() || isSending}
                        onClick={() => openConvId && handleSendMessage(openConvId)}
                      >
                        {isSending ? 'Enviando...' : 'Enviar'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal isOpen={!!deleteModalConvId} onOpenChange={(open) => { if (!open) setDeleteModalConvId(null) }}>
        <Modal.Backdrop variant="blur">
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-[400px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Excluir Conversa</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted">
                  Tem certeza que deseja excluir esta conversa? Todas as mensagens serão removidas permanentemente.
                </p>
              </Modal.Body>
              <Modal.Footer>
                <button type="button" className="btn-neu-ghost text-sm" onClick={() => setDeleteModalConvId(null)}>
                  Cancelar
                </button>
                <Button
                  variant="danger"
                  isDisabled={isDeleting}
                  onPress={() => deleteModalConvId && handleDeleteConversation(deleteModalConvId)}
                >
                  {isDeleting ? 'Excluindo...' : 'Sim, excluir'}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Summary modal */}
      <Modal isOpen={summaryModalOpen} onOpenChange={(open) => { if (!open) setSummaryModalOpen(false) }}>
        <Modal.Backdrop variant="blur">
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-[600px] max-h-[80vh] flex flex-col">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Resumo da Conversa</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-4 overflow-y-auto">
                {!summaryResult && !summaryError && (
                  <SummaryProviderPicker
                    onGenerate={handleGenerateSummary}
                    isGenerating={isGeneratingSummary}
                  />
                )}

                {isGeneratingSummary && (
                  <div className="flex items-center justify-center gap-3 py-8">
                    <Spinner size="md" />
                    <span className="text-sm text-muted">Analisando conversa...</span>
                  </div>
                )}

                {summaryError && (
                  <div className="px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-700 dark:text-red-400">{summaryError}</p>
                    <button
                      className="mt-3 text-xs px-4 py-1.5 rounded-[10px] transition-all"
                      style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}
                      onClick={() => {
                        setSummaryError(null)
                        setSummaryResult(null)
                      }}
                    >
                      Tentar novamente
                    </button>
                  </div>
                )}

                {summaryResult && (
                  <div className="prose prose-sm dark:prose-invert max-w-none text-foreground">
                    <Markdown>{summaryResult}</Markdown>
                    <div className="mt-4 pt-3 border-t border-dim">
                      <button
                        className="text-xs px-4 py-1.5 rounded-[10px] transition-all"
                        style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#D4835A' }}
                        onClick={() => {
                          setSummaryResult(null)
                          setSummaryError(null)
                        }}
                      >
                        Gerar novo resumo
                      </button>
                    </div>
                  </div>
                )}
              </Modal.Body>
              <Modal.Footer>
                <button
                  className="px-4 py-1.5 rounded-[10px] text-sm transition-all"
                  style={{ background: '#121212', boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)', color: '#8a8a8a' }}
                  onClick={() => setSummaryModalOpen(false)}
                >
                  Fechar
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
