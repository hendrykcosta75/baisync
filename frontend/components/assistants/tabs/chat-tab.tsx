'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Assistant } from '@/types/assistant'
import { Card, Button, Input } from '@heroui/react'
import { MessageSquare } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import { TestPanel } from './test-panel'

interface ChatTabProps {
  assistant: Assistant
  shareToken?: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  audioBase64?: string
}

interface ChatResponse {
  reply: string
  replies: string[]
  conversation_id: string
  tokens_used: number
  audio_base64?: string
}

interface ConversationListItem {
  id: string
  contactName: string
  channel: string
  lastMessage: string
  lastMessageAt: string
  messageCount: number
}

interface MessageResponse {
  id: string
  content: string
  sender: string
  timestamp: string
}

export function ChatTab({ assistant, shareToken }: ChatTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingHistory, setIsLoadingHistory] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [showTestPanel, setShowTestPanel] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const conversationIdRef = useRef<string | null>(null)

  // Keep ref in sync so callbacks always see latest value
  useEffect(() => {
    conversationIdRef.current = conversationId
  }, [conversationId])

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true)
    try {
      const conversations = await apiFetch<ConversationListItem[]>(
        `/api/assistants/${assistant.id}/conversations`
      )
      const playground = conversations.find(c => c.channel === 'playground')
      if (playground && playground.messageCount > 0) {
        setConversationId(playground.id)
        const msgs = await apiFetch<MessageResponse[]>(
          `/api/assistants/${assistant.id}/conversations/${playground.id}/messages`
        )
        setMessages(
          msgs.map(m => ({
            id: m.id,
            role: m.sender as 'user' | 'assistant',
            content: m.content,
          }))
        )
      }
    } catch {
      // Ignore - no history
    } finally {
      setIsLoadingHistory(false)
    }
  }, [assistant.id])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessageToPlayground = async (text: string): Promise<ChatResponse> => {
    const url = shareToken
      ? `/api/assistants/${assistant.id}/chat?share_token=${encodeURIComponent(shareToken)}`
      : `/api/assistants/${assistant.id}/chat`
    const res = await apiFetch<ChatResponse>(url, {
      method: 'POST',
      body: JSON.stringify({ message: text }),
    })
    if (res.conversation_id) {
      setConversationId(res.conversation_id)
    }
    return res
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setError(null)

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)

    try {
      const res = await sendMessageToPlayground(text)

      const parts = res.replies && res.replies.length > 1 ? res.replies : [res.reply]
      const assistantMsgs: ChatMessage[] = parts.map((text, i) => ({
        id: `assistant-${Date.now()}-${i}`,
        role: 'assistant' as const,
        content: text,
        audioBase64: i === 0 ? res.audio_base64 : undefined,
      }))
      setMessages(prev => [...prev, ...assistantMsgs])
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao enviar mensagem'
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearConversation = async () => {
    const convId = conversationIdRef.current
    if (convId) {
      try {
        await apiFetch(`/api/assistants/${assistant.id}/conversations/${convId}`, {
          method: 'DELETE',
        })
      } catch {
        // Ignore - clear locally anyway
      }
    }
    setMessages([])
    setConversationId(null)
    setError(null)
  }

  // Callback for TestPanel: sends a message to the official assistant and returns the reply
  const handleTestSendToPlayground = useCallback(async (message: string): Promise<string | null> => {
    try {
      const res = await sendMessageToPlayground(message)

      const userMsg: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: message,
      }
      const parts = res.replies && res.replies.length > 1 ? res.replies : [res.reply]
      const assistantMsgs: ChatMessage[] = parts.map((text, i) => ({
        id: `assistant-${Date.now()}-${i}`,
        role: 'assistant' as const,
        content: text,
      }))
      setMessages(prev => [...prev, userMsg, ...assistantMsgs])

      return res.reply
    } catch {
      return null
    }
  }, [assistant.id])

  // Callback for TestPanel: clears playground conversation
  const handleTestClearPlayground = useCallback(async () => {
    await clearConversation()
  }, [assistant.id])

  return (
    <div className="flex flex-col gap-4 w-full">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Playground</h3>
          <p className="text-xs text-muted">
            Teste seu assistente sem configurar integrações de mensagens.
          </p>
        </div>
        <div className="flex gap-2">
          {messages.length > 0 && (
            <Button variant="ghost" className="text-xs border-none text-slate-500" onPress={clearConversation}>
              Limpar chat
            </Button>
          )}
          <Button
            variant={showTestPanel ? 'outline' : 'secondary'}
            className="text-xs"
            onPress={() => setShowTestPanel(!showTestPanel)}
          >
            {showTestPanel ? 'Fechar teste' : 'Teste automatizado'}
          </Button>
        </div>
      </div>

      <div className={`flex ${showTestPanel ? 'flex-col lg:flex-row gap-6' : ''}`}>
        {/* Chat Column */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          <Card className="flex flex-col" style={{ height: '500px' }}>
            <div className="flex-1 overflow-y-auto p-3 sm:p-4">
              {isLoadingHistory ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <p className="text-sm text-muted">Carregando conversa...</p>
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="mb-3 text-muted"><MessageSquare size={36} strokeWidth={1.5} /></div>
                  <p className="text-sm text-muted">Envie uma mensagem para testar seu assistente.</p>
                  <p className="text-xs text-muted mt-1">
                    Usando <span className="font-medium text-foreground">{assistant.llmProvider}</span> / <span className="font-medium text-foreground">{assistant.model}</span>
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                          msg.role === 'user'
                            ? 'bg-[#ff6b2c] text-white'
                            : 'bg-raised text-foreground'
                        }`}
                      >
                        {msg.content}
                        {msg.audioBase64 && (
                          <audio
                            className="mt-2 w-full max-w-[260px] h-8"
                            controls
                            src={`data:audio/mpeg;base64,${msg.audioBase64}`}
                          />
                        )}
                      </div>
                    </div>
                  ))}
                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="px-3 py-2 rounded-xl text-sm bg-raised text-muted">
                        <span className="inline-flex gap-1">
                          <span className="animate-pulse">●</span>
                          <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>●</span>
                          <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>●</span>
                        </span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {error && (
              <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800">
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <div className="border-t border-dim p-2 sm:p-3 flex gap-2 min-w-0">
              <Input
                className="flex-1 min-w-0"
                placeholder="Digite uma mensagem..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
              />
              <Button
                variant="primary"
                onPress={handleSend}
                isDisabled={!input.trim() || isLoading}
                className="shrink-0"
              >
                Enviar
              </Button>
            </div>
          </Card>
        </div>

        {/* Test Panel */}
        {showTestPanel && (
          <div className="w-full lg:w-[380px] lg:shrink-0">
            <TestPanel
              assistant={assistant}
              onSendToPlayground={handleTestSendToPlayground}
              onClearPlayground={handleTestClearPlayground}
            />
          </div>
        )}
      </div>
    </div>
  )
}
