'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Assistant, LLMProvider } from '@/types/assistant'
import { Card, Button, Select, ListBox, Label, TextArea, TextField, Input, Spinner } from '@heroui/react'
import { apiFetch } from '@/lib/api'
import { useModels } from '@/lib/useModels'
import { useApiKeysStore } from '@/store/useApiKeysStore'
import Markdown from 'react-markdown'

interface TestPanelProps {
  assistant: Assistant
  onSendToPlayground: (message: string) => Promise<string | null>
  onClearPlayground: () => Promise<void>
}

interface TestMessage {
  role: 'user' | 'assistant'
  content: string
}

type TestStatus = 'idle' | 'running' | 'stopped' | 'finished'

export function TestPanel({ assistant, onSendToPlayground, onClearPlayground }: TestPanelProps) {
  const [provider, setProvider] = useState<LLMProvider>(assistant.llmProvider)
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [maxMessages, setMaxMessages] = useState(10)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [messages, setMessages] = useState<TestMessage[]>([])
  const [currentStep, setCurrentStep] = useState(0)
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [evaluation, setEvaluation] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { models, isLoading: modelsLoading } = useModels(provider)
  const configured = useApiKeysStore(s => s.configured)
  const keys = useApiKeysStore(s => s.keys)
  const hasKey = configured[provider] || !!keys?.[provider]

  useEffect(() => {
    if (models.length > 0 && !models.includes(model)) {
      setModel(models[0])
    }
  }, [models, model])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const generatePrompt = async () => {
    if (!assistant.systemPrompt) {
      setError('O assistente oficial não possui prompt de sistema configurado.')
      return
    }
    setIsGeneratingPrompt(true)
    setError(null)
    try {
      const res = await apiFetch<{ prompt: string }>('/api/test-agent/generate-prompt', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          model,
          assistant_system_prompt: assistant.systemPrompt,
        }),
      })
      setSystemPrompt(res.prompt)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar prompt')
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  const runTest = async () => {
    if (!systemPrompt.trim() || !model) return

    abortRef.current = false
    setTestStatus('running')
    setMessages([])
    setEvaluation(null)
    setError(null)
    setCurrentStep(0)

    await onClearPlayground()

    const conversationHistory: TestMessage[] = []

    for (let i = 0; i < maxMessages; i++) {
      if (abortRef.current) {
        setTestStatus('stopped')
        return
      }

      setCurrentStep(i + 1)

      // 1. Test agent generates a message (as "user" talking to the official assistant)
      let testAgentMessage: string
      try {
        const testRes = await apiFetch<{ reply: string }>('/api/test-agent/chat', {
          method: 'POST',
          body: JSON.stringify({
            provider,
            model,
            system_prompt: systemPrompt,
            messages: conversationHistory.map(m => ({
              // Invert roles for the test agent's perspective:
              // what the test agent said = "assistant" in test agent context
              // what the official assistant replied = "user" in test agent context
              role: m.role === 'user' ? 'assistant' : 'user',
              content: m.content,
            })),
          }),
        })
        testAgentMessage = testRes.reply
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro no agente de teste')
        setTestStatus('stopped')
        return
      }

      const userMsg: TestMessage = { role: 'user', content: testAgentMessage }
      conversationHistory.push(userMsg)
      setMessages(prev => [...prev, userMsg])

      if (abortRef.current) {
        setTestStatus('stopped')
        return
      }

      // 2. Send to official assistant via playground
      const assistantReply = await onSendToPlayground(testAgentMessage)
      if (!assistantReply) {
        setError('O assistente oficial não respondeu.')
        setTestStatus('stopped')
        return
      }

      const assistantMsg: TestMessage = { role: 'assistant', content: assistantReply }
      conversationHistory.push(assistantMsg)
      setMessages(prev => [...prev, assistantMsg])
    }

    setTestStatus('finished')
  }

  const stopTest = () => {
    abortRef.current = true
  }

  const evaluateConversation = async () => {
    if (messages.length === 0) return
    setIsEvaluating(true)
    setError(null)
    try {
      const res = await apiFetch<{ evaluation: string }>('/api/test-agent/evaluate', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          model,
          assistant_system_prompt: assistant.systemPrompt || '',
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      setEvaluation(res.evaluation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao avaliar conversa')
    } finally {
      setIsEvaluating(false)
    }
  }

  const isConfigured = systemPrompt.trim() && model && hasKey

  return (
    <div className="flex flex-col gap-4 w-full">
      <div>
        <h3 className="font-semibold text-foreground">Teste Automatizado</h3>
        <p className="text-xs text-muted">
          Configure um agente de teste para conversar com seu assistente automaticamente.
        </p>
      </div>

      {/* Configuration */}
      {testStatus === 'idle' && (
        <div className="flex flex-col gap-3">
          {/* Provider */}
          <Select
            className="w-full"
            selectedKey={provider}
            onSelectionChange={(key) => {
              const selected = key as LLMProvider
              if (selected) setProvider(selected)
            }}
          >
            <Label>Provedor</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="openai" textValue="OpenAI">OpenAI</ListBox.Item>
                <ListBox.Item id="claude" textValue="Claude">Claude</ListBox.Item>
                <ListBox.Item id="gemini" textValue="Gemini">Gemini</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>

          {!hasKey && (
            <p className="text-xs text-amber-500">
              Chave de API não configurada para {provider}.
            </p>
          )}

          {/* Model */}
          <Select
            className="w-full"
            selectedKey={model}
            onSelectionChange={(key) => {
              const selected = key as string
              if (selected) setModel(selected)
            }}
            isDisabled={modelsLoading}
          >
            <Label>Modelo</Label>
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

          {/* System Prompt */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label className="text-sm">Prompt do Agente de Teste</Label>
              <Button
                variant="ghost"
                className="text-xs border-none text-[#ff6b2c]"
                onPress={generatePrompt}
                isDisabled={isGeneratingPrompt || !hasKey || !model}
              >
                {isGeneratingPrompt ? (
                  <span className="flex items-center gap-1">
                    <Spinner size="sm" /> Gerando...
                  </span>
                ) : (
                  'Gerar automaticamente'
                )}
              </Button>
            </div>
            <TextField className="w-full">
              <TextArea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Instrua o agente de teste sobre como se comportar como cliente..."
                rows={5}
              />
            </TextField>
          </div>

          {/* Max Messages */}
          <TextField className="w-full">
            <Label>Número de mensagens</Label>
            <Input
              type="number"
              value={String(maxMessages)}
              onChange={(e) => setMaxMessages(Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))}
              min={1}
              max={50}
            />
          </TextField>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          <button
            type="button"
            onClick={runTest}
            disabled={!isConfigured}
            className="btn-neu btn-neu-lg w-full text-center"
          >
            Iniciar Teste
          </button>
        </div>
      )}

      {/* Running / Results */}
      {testStatus !== 'idle' && (
        <div className="flex flex-col gap-3">
          {/* Status bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {testStatus === 'running' && (
                <>
                  <Spinner size="sm" />
                  <span className="text-xs text-muted">
                    Mensagem {currentStep} de {maxMessages}
                  </span>
                </>
              )}
              {testStatus === 'stopped' && (
                <span className="text-xs text-amber-500">
                  Teste interrompido ({messages.length} mensagens)
                </span>
              )}
              {testStatus === 'finished' && (
                <span className="text-xs text-emerald-500">
                  Teste concluído ({messages.length} mensagens)
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {testStatus === 'running' && (
                <Button variant="danger" className="text-xs" onPress={stopTest}>
                  Parar
                </Button>
              )}
              {testStatus !== 'running' && (
                <Button
                  variant="ghost"
                  className="text-xs border-none text-slate-500"
                  onPress={() => {
                    setTestStatus('idle')
                    setMessages([])
                    setEvaluation(null)
                    setError(null)
                  }}
                >
                  Novo teste
                </Button>
              )}
            </div>
          </div>

          {/* Conversation */}
          <Card className="flex flex-col" style={{ height: '340px' }}>
            <div className="flex-1 overflow-y-auto p-3">
              {messages.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs text-muted">Aguardando mensagens...</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className="flex flex-col max-w-[85%]">
                        <span className="text-[10px] text-muted mb-0.5 px-1">
                          {msg.role === 'user' ? 'Agente de Teste' : 'Assistente Oficial'}
                        </span>
                        <div
                          className={`px-3 py-2 rounded-xl text-xs whitespace-pre-wrap ${
                            msg.role === 'user'
                              ? 'bg-[#ff6b2c] text-white'
                              : 'bg-raised text-foreground'
                          }`}
                        >
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  ))}
                  {testStatus === 'running' && (
                    <div className="flex justify-start">
                      <div className="px-3 py-2 rounded-xl text-xs bg-raised text-muted">
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
          </Card>

          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}

          {/* Evaluate button */}
          {testStatus !== 'running' && messages.length > 0 && !evaluation && (
            <button
              type="button"
              onClick={evaluateConversation}
              disabled={isEvaluating}
              className="btn-neu w-full text-center"
            >
              {isEvaluating ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" /> Avaliando...
                </span>
              ) : (
                'Avaliar Conversa'
              )}
            </button>
          )}

          {/* Evaluation result */}
          {evaluation && (
            <Card className="p-4 overflow-y-auto" style={{ maxHeight: '300px' }}>
              <div className="prose prose-sm dark:prose-invert max-w-none text-xs">
                <Markdown>{evaluation}</Markdown>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}
