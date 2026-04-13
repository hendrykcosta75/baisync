'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Assistant, AssistantTool, AuthType, AuthConfig, BodyContentType, KeyValuePair as KVPair, ToolSettings, ToolCallLog, ToolType } from '@/types/assistant'
import { Card, Button, Switch, Modal, Input, TextArea, Form, FieldError, Label, TextField, Select, ListBox, Tabs } from '@heroui/react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { useApiKeysStore } from '@/store/useApiKeysStore'
import { apiFetch } from '@/lib/api'
import { v4 as uuidv4 } from 'uuid'
import { AvailabilityConfigPanel, type AvailabilityConfigRef } from '@/components/assistants/tabs/availability-config'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { KeyValueEditor, KeyValuePair } from '@/components/assistants/key-value-editor'

interface ToolsTabProps {
  assistant: Assistant
  shareToken?: string
  isReadOnly?: boolean
}

const toolSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Only letters, numbers, underscores or hyphens').min(1, 'Name is required').max(64),
  description: z.string().min(1, 'Description is required'),
  endpoint: z.string().min(1, 'URL is required'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']),
  schema: z.string().optional(),
})

type ToolFormData = z.infer<typeof toolSchema>

const DEFAULT_SETTINGS: ToolSettings = {
  timeout: 30000,
  retries: 0,
  retryOnFailure: false,
  followRedirects: true,
  ignoreSSLErrors: false,
}

const DEFAULT_AUTH: AuthConfig = { type: 'none' }

const METHODS_WITH_BODY = ['POST', 'PUT', 'PATCH']

function kvPairsToJson(pairs: KeyValuePair[]): string {
  const obj: Record<string, string> = {}
  for (const p of pairs) {
    if (p.key.trim()) obj[p.key] = p.value
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : ''
}

function jsonToKvPairs(json?: string): KeyValuePair[] {
  if (!json) return []
  try {
    const obj = JSON.parse(json)
    return Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }))
  } catch {
    return []
  }
}

export function ToolsTab({ assistant, shareToken, isReadOnly }: ToolsTabProps) {
  const qs = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : ''
  const { addToolToAssistant, removeToolFromAssistant, updateToolForAssistant, toggleToolForAssistant, fetchAssistantTools } = useAssistantStore()
  const [sharedTools, setSharedTools] = useState<AssistantTool[]>([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<AssistantTool | null>(null)

  // Extended state (not in react-hook-form since they're complex objects)
  const [auth, setAuth] = useState<AuthConfig>(DEFAULT_AUTH)
  const [queryParams, setQueryParams] = useState<KeyValuePair[]>([])
  const [headerPairs, setHeaderPairs] = useState<KeyValuePair[]>([])
  const [bodyContentType, setBodyContentType] = useState<BodyContentType>('json')
  const [bodyContent, setBodyContent] = useState('')
  const [settings, setSettings] = useState<ToolSettings>(DEFAULT_SETTINGS)
  const [testResult, setTestResult] = useState<{ status?: number; body?: string; error?: string } | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  // Tool type selection modal state
  const [typeSelectionOpen, setTypeSelectionOpen] = useState(false)
  const availabilityRef = useRef<AvailabilityConfigRef>(null)
  const [builtinModalOpen, setBuiltinModalOpen] = useState(false)
  const [builtinToolType, setBuiltinToolType] = useState<ToolType>('http_request')
  const [builtinName, setBuiltinName] = useState('')
  const [builtinDescription, setBuiltinDescription] = useState('')
  const [builtinEnabled, setBuiltinEnabled] = useState(true)
  const [builtinEndpoint, setBuiltinEndpoint] = useState('')
  const [pixKeyType, setPixKeyType] = useState('cpf')
  const [pixMode, setPixMode] = useState<'direct' | 'mercadopago' | 'stripe'>('direct')
  const [stripePixCheck, setStripePixCheck] = useState<{ checking: boolean; result: { ok: boolean; msg: string } | null }>({ checking: false, result: null })
  const [cardMode, setCardMode] = useState<'stripe' | 'mercadopago'>('stripe')
  const [editingBuiltinTool, setEditingBuiltinTool] = useState<AssistantTool | null>(null)

  // URL test state (for send_document)
  const [testUrlLoading, setTestUrlLoading] = useState(false)
  const [testUrlResult, setTestUrlResult] = useState<{ ok: boolean; status: number; content_type?: string | null; content_length?: number | null; error?: string | null } | null>(null)

  // Delete confirmation state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [toolToDelete, setToolToDelete] = useState<AssistantTool | null>(null)

  const confirmDelete = (tool: AssistantTool) => {
    setToolToDelete(tool)
    setDeleteConfirmOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (toolToDelete) {
      if (shareToken) {
        try {
          await apiFetch(`/api/assistants/${assistant.id}/tools/${toolToDelete.id}${qs}`, { method: 'DELETE' })
          setSharedTools(prev => prev.filter(t => t.id !== toolToDelete.id))
        } catch (err) { console.error('Failed to delete tool:', err) }
      } else {
        removeToolFromAssistant(assistant.id, toolToDelete.id)
      }
    }
    setDeleteConfirmOpen(false)
    setToolToDelete(null)
  }

  // Tool call history state
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyTool, setHistoryTool] = useState<AssistantTool | null>(null)
  const [callLogs, setCallLogs] = useState<ToolCallLog[]>([])
  const [isLoadingLogs, setIsLoadingLogs] = useState(false)
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null)

  const openHistoryModal = async (tool: AssistantTool) => {
    setHistoryTool(tool)
    setHistoryModalOpen(true)
    setCallLogs([])
    setExpandedLogId(null)
    setIsLoadingLogs(true)
    try {
      const raw = await apiFetch<ToolCallLog[] | { items: ToolCallLog[] }>(`/api/assistants/${assistant.id}/tools/${tool.id}/calls?limit=50${shareToken ? `&share_token=${encodeURIComponent(shareToken)}` : ''}`)
      setCallLogs(Array.isArray(raw) ? raw : (raw.items || []))
    } catch (err) {
      console.error('Failed to fetch tool call logs:', err)
    } finally {
      setIsLoadingLogs(false)
    }
  }

  useEffect(() => {
    if (shareToken) {
      apiFetch<{ id: string; name: string; description: string | null; endpoint: string; method: string; schema_json: string | null; headers_json: string | null; is_enabled: boolean; tool_type: string | null }[]>(
        `/api/assistants/${assistant.id}/tools${qs}`
      )
        .then(data => setSharedTools(data.map(t => ({
          id: t.id, name: t.name, description: t.description ?? '', endpoint: t.endpoint,
          method: (t.method || 'POST') as AssistantTool['method'],
          schema: t.schema_json ?? undefined, headers: t.headers_json ?? undefined, isEnabled: t.is_enabled,
          toolType: (t.tool_type || 'http_request') as AssistantTool['toolType'],
        }))))
        .catch(() => {})
    } else {
      fetchAssistantTools(assistant.id)
    }
  }, [assistant.id, shareToken, qs, fetchAssistantTools])

  const tools = shareToken ? sharedTools : (assistant.tools || [])

  const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<ToolFormData>({
    resolver: zodResolver(toolSchema),
    defaultValues: { name: '', description: '', endpoint: '', method: 'POST', schema: '' },
  })

  const currentMethod = watch('method')

  const resetExtendedState = useCallback(() => {
    setAuth(DEFAULT_AUTH)
    setQueryParams([])
    setHeaderPairs([])
    setBodyContentType('json')
    setBodyContent('')
    setSettings(DEFAULT_SETTINGS)
    setTestResult(null)
  }, [])

  const openCreateModal = () => {
    setTypeSelectionOpen(true)
  }

  const selectToolType = (type: ToolType) => {
    setTypeSelectionOpen(false)
    if (type === 'http_request') {
      setEditingTool(null)
      reset({ name: '', description: '', endpoint: '', method: 'POST', schema: '' })
      resetExtendedState()
      setIsModalOpen(true)
    } else {
      setEditingBuiltinTool(null)
      setBuiltinToolType(type)
      const nameMap: Record<string, string> = {
        send_document: 'enviar_documento',
        notify_human: 'notificar_agente',
        schedule_appointment: 'agendar_compromisso',
        pix_payment: 'cobrar_pix',
        card_payment: 'cobrar_cartao',
      }
      const descMap: Record<string, string> = {
        send_document: 'Envia um documento ou imagem na conversa fornecendo uma URL',
        notify_human: 'Notifica um agente humano para intervir na conversa quando não conseguir resolver o problema do usuário',
        schedule_appointment: 'Agenda, cancela ou reagenda compromissos para clientes durante a conversa',
        pix_payment: 'Gera cobranças PIX e verifica pagamentos durante conversas',
        card_payment: 'Gera cobranças por cartão de crédito/débito e verifica pagamentos durante conversas',
      }
      setBuiltinName(nameMap[type] || type)
      setBuiltinDescription(descMap[type] || '')
      setBuiltinEnabled(true)
      setBuiltinEndpoint('')
      setTestUrlResult(null)
      setBuiltinModalOpen(true)
    }
  }

  const handleTestUrl = async () => {
    if (!builtinEndpoint.trim()) return
    setTestUrlLoading(true)
    setTestUrlResult(null)
    try {
      const result = await apiFetch<{ ok: boolean; status: number; content_type?: string | null; content_length?: number | null; error?: string | null }>(
        '/api/tools/test-url',
        { method: 'POST', body: JSON.stringify({ url: builtinEndpoint }) }
      )
      setTestUrlResult(result)
    } catch {
      setTestUrlResult({ ok: false, status: 0, error: 'Falha na requisição' })
    } finally {
      setTestUrlLoading(false)
    }
  }

  const openEditModal = (tool: AssistantTool) => {
    const type = tool.toolType || 'http_request'
    if (type === 'send_document' || type === 'notify_human' || type === 'schedule_appointment' || type === 'pix_payment' || type === 'card_payment') {
      setEditingBuiltinTool(tool)
      setBuiltinToolType(type)
      setBuiltinName(tool.name)
      setBuiltinDescription(tool.description)
      setBuiltinEnabled(tool.isEnabled)
      setBuiltinEndpoint(tool.endpoint || '')
      if (type === 'pix_payment' && tool.headers) {
        try {
          const h = JSON.parse(tool.headers)
          setPixKeyType(h.pix_key_type || 'cpf')
          setPixMode(h.pix_mode || 'direct')
        } catch { setPixKeyType('cpf'); setPixMode('direct') }
      }
      if (type === 'card_payment' && tool.headers) {
        try {
          const h = JSON.parse(tool.headers)
          setCardMode(h.card_mode || 'stripe')
        } catch { setCardMode('stripe') }
      }
      setTestUrlResult(null)
      setBuiltinModalOpen(true)
      return
    }
    setEditingTool(tool)
    reset({
      name: tool.name,
      description: tool.description,
      endpoint: tool.endpoint,
      method: tool.method || 'POST',
      schema: tool.schema || '',
    })
    setAuth(tool.auth || DEFAULT_AUTH)
    setQueryParams(tool.queryParams || [])
    setHeaderPairs(jsonToKvPairs(tool.headers))
    setBodyContentType(tool.bodyContentType || 'json')
    setBodyContent(tool.bodyContent || '')
    setSettings(tool.settings || DEFAULT_SETTINGS)
    setTestResult(null)
    setIsModalOpen(true)
  }

  const checkStripePixEnabled = async (): Promise<boolean> => {
    setStripePixCheck({ checking: true, result: null })
    try {
      const data = await apiFetch<{ pix_enabled: boolean; message: string }>('/api/user/stripe/check-pix')
      if (!data.pix_enabled) {
        setStripePixCheck({ checking: false, result: { ok: false, msg: data.message } })
        return false
      }
      setStripePixCheck({ checking: false, result: { ok: true, msg: data.message } })
      return true
    } catch {
      setStripePixCheck({ checking: false, result: { ok: false, msg: 'Falha ao verificar conta Stripe.' } })
      return false
    }
  }

  const handleBuiltinSubmit = async () => {
    // Validate Stripe PIX before saving
    if (builtinToolType === 'pix_payment' && pixMode === 'stripe') {
      const pixEnabled = await checkStripePixEnabled()
      if (!pixEnabled) return
    }

    const toolData: Partial<AssistantTool> = {
      name: builtinName,
      description: builtinDescription,
      endpoint: builtinToolType === 'send_document' ? builtinEndpoint : (builtinToolType === 'pix_payment' && pixMode === 'direct') ? builtinEndpoint : '',
      method: 'POST',
      isEnabled: builtinEnabled,
      toolType: builtinToolType,
      ...(builtinToolType === 'pix_payment' ? { headers: JSON.stringify({ pix_key_type: pixKeyType, pix_mode: pixMode }) } : {}),
      ...(builtinToolType === 'card_payment' ? { headers: JSON.stringify({ card_mode: cardMode }) } : {}),
    }

    if (shareToken) {
      try {
        if (editingBuiltinTool) {
          await apiFetch(`/api/assistants/${assistant.id}/tools/${editingBuiltinTool.id}${qs}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: builtinName, description: builtinDescription, is_enabled: builtinEnabled,
              tool_type: builtinToolType, endpoint: toolData.endpoint,
              ...(builtinToolType === 'pix_payment' ? { headers_json: JSON.stringify({ pix_key_type: pixKeyType, pix_mode: pixMode }) } : {}),
              ...(builtinToolType === 'card_payment' ? { headers_json: JSON.stringify({ card_mode: cardMode }) } : {}),
            }),
          })
          setSharedTools(prev => prev.map(t => t.id === editingBuiltinTool.id ? { ...t, ...toolData } as AssistantTool : t))
        } else {
          const created = await apiFetch<{ id: string }>(`/api/assistants/${assistant.id}/tools${qs}`, {
            method: 'POST',
            body: JSON.stringify({
              name: builtinName, description: builtinDescription, is_enabled: builtinEnabled,
              tool_type: builtinToolType, endpoint: toolData.endpoint,
              ...(builtinToolType === 'pix_payment' ? { headers_json: JSON.stringify({ pix_key_type: pixKeyType, pix_mode: pixMode }) } : {}),
              ...(builtinToolType === 'card_payment' ? { headers_json: JSON.stringify({ card_mode: cardMode }) } : {}),
            }),
          })
          setSharedTools(prev => [...prev, { id: created.id, ...toolData } as AssistantTool])
        }
      } catch (err) { console.error('Failed to save built-in tool:', err) }
    } else {
      if (editingBuiltinTool) {
        updateToolForAssistant(assistant.id, editingBuiltinTool.id, toolData)
      } else {
        addToolToAssistant(assistant.id, {
          id: uuidv4(),
          isEnabled: builtinEnabled,
          ...toolData,
        } as AssistantTool)
      }
    }
    // Save availability config alongside the tool (schedule_appointment)
    if (builtinToolType === 'schedule_appointment' && availabilityRef.current) {
      try { await availabilityRef.current.save() } catch (e) { console.error('Failed to save availability:', e) }
    }
    setBuiltinModalOpen(false)
    setEditingBuiltinTool(null)
  }

  const onSubmit = async (data: ToolFormData) => {
    const headersJson = kvPairsToJson(headerPairs)
    const toolData: Partial<AssistantTool> = {
      name: data.name,
      description: data.description,
      endpoint: data.endpoint,
      method: data.method,
      schema: data.schema,
      headers: headersJson || undefined,
      auth: auth.type !== 'none' ? auth : undefined,
      queryParams: queryParams.filter(p => p.key.trim()),
      bodyContentType: METHODS_WITH_BODY.includes(data.method) ? bodyContentType : undefined,
      bodyContent: METHODS_WITH_BODY.includes(data.method) ? bodyContent : undefined,
      settings,
      toolType: 'http_request',
    }

    if (shareToken) {
      try {
        if (editingTool) {
          await apiFetch(`/api/assistants/${assistant.id}/tools/${editingTool.id}${qs}`, {
            method: 'PUT', body: JSON.stringify(toolData),
          })
          setSharedTools(prev => prev.map(t => t.id === editingTool.id ? { ...t, ...toolData } as AssistantTool : t))
        } else {
          const created = await apiFetch<{ id: string }>(`/api/assistants/${assistant.id}/tools${qs}`, {
            method: 'POST', body: JSON.stringify({ ...toolData, isEnabled: true }),
          })
          setSharedTools(prev => [...prev, { id: created.id, isEnabled: true, ...toolData } as AssistantTool])
        }
      } catch (err) { console.error('Failed to save tool:', err) }
    } else {
      if (editingTool) {
        updateToolForAssistant(assistant.id, editingTool.id, toolData)
      } else {
        addToolToAssistant(assistant.id, {
          id: uuidv4(),
          isEnabled: true,
          ...toolData,
        } as AssistantTool)
      }
    }
    setIsModalOpen(false)
    setEditingTool(null)
    reset()
    resetExtendedState()
  }

  const handleTestRequest = async () => {
    setIsTesting(true)
    setTestResult(null)
    const endpoint = watch('endpoint') || (document.querySelector<HTMLInputElement>('[name="endpoint"]')?.value)
    if (!endpoint) {
      setTestResult({ error: 'URL é obrigatória para testar' })
      setIsTesting(false)
      return
    }

    try {
      const url = new URL(endpoint)
      for (const p of queryParams) {
        if (p.key.trim()) url.searchParams.set(p.key, p.value)
      }

      const reqHeaders: Record<string, string> = {}
      for (const h of headerPairs) {
        if (h.key.trim()) reqHeaders[h.key] = h.value
      }

      // Auth headers
      if (auth.type === 'bearer' && auth.token) {
        reqHeaders['Authorization'] = `Bearer ${auth.token}`
      } else if (auth.type === 'basic' && auth.username) {
        reqHeaders['Authorization'] = `Basic ${btoa(`${auth.username}:${auth.password || ''}`)}`
      } else if (auth.type === 'header' && auth.headerName) {
        reqHeaders[auth.headerName] = auth.headerValue || ''
      }

      const method = watch('method') || 'GET'
      const fetchOpts: RequestInit = {
        method,
        headers: reqHeaders,
      }

      if (METHODS_WITH_BODY.includes(method) && bodyContent) {
        if (bodyContentType === 'json') {
          reqHeaders['Content-Type'] = 'application/json'
          fetchOpts.body = bodyContent
        } else if (bodyContentType === 'form-urlencoded') {
          reqHeaders['Content-Type'] = 'application/x-www-form-urlencoded'
          fetchOpts.body = bodyContent
        } else if (bodyContentType === 'raw') {
          fetchOpts.body = bodyContent
        }
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), settings.timeout)
      fetchOpts.signal = controller.signal

      const resp = await fetch(url.toString(), fetchOpts)
      clearTimeout(timeoutId)
      const text = await resp.text()
      let formatted = text
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2)
      } catch { /* not JSON */ }
      setTestResult({ status: resp.status, body: formatted })
    } catch (err: unknown) {
      setTestResult({ error: err instanceof Error ? err.message : 'Requisição falhou' })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold mb-1 text-foreground">Ferramentas Personalizadas e Webhooks</h3>
          <p className="text-sm text-muted">
            Crie webhooks para que seu assistente possa acionar endpoints durante uma conversa.
          </p>
        </div>
        {!isReadOnly && (
          <button className="btn-neu btn-neu-lg" onClick={openCreateModal}>
            Adicionar Ferramenta
          </button>
        )}
      </div>

      {tools.length === 0 ? (
        <div className="text-sm text-muted p-8 text-center border border-dashed border-dim-hover bg-raised/50 rounded-2xl flex flex-col items-center gap-2">
          <div className="w-12 h-12 bg-raised rounded-lg flex items-center justify-center text-xl mb-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <p className="font-medium text-foreground text-base">Nenhuma ferramenta configurada</p>
          <p className="max-w-sm mb-4">Você ainda não criou nenhum endpoint de API ou webhook para este assistente.</p>
          {!isReadOnly && <button className="btn-neu text-sm" onClick={openCreateModal}>Criar Primeira Ferramenta</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
          {tools.map((tool) => {
            const toolType = tool.toolType || 'http_request'
            const isBuiltin = toolType === 'send_document' || toolType === 'notify_human' || toolType === 'schedule_appointment' || toolType === 'pix_payment' || toolType === 'card_payment'

            // Icon and badge config per type
            const iconConfig = toolType === 'send_document'
              ? { bg: 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10', text: 'text-[#ff6b2c] dark:text-[#ff6b2c]', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
              : toolType === 'notify_human'
              ? { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-600 dark:text-amber-400', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18 8A6 6 0 106 8c0 7-3 9-3 9h18s-3-2-3-9zM13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
              : toolType === 'schedule_appointment'
              ? { bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-600 dark:text-emerald-400', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }
              : toolType === 'pix_payment'
              ? { bg: 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10', text: '', icon: <img src="/logo-pix-520x520.png" alt="PIX" width={24} height={24} className="brightness-0 invert-0" style={{ filter: 'brightness(0) saturate(100%) invert(45%) sepia(96%) saturate(1500%) hue-rotate(360deg) brightness(100%) contrast(100%)' }} /> }
              : toolType === 'card_payment'
              ? { bg: 'bg-[#635BFF]/10 dark:bg-[#635BFF]/10', text: 'text-[#635BFF] dark:text-[#635BFF]', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="5" width="20" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M2 10h20" stroke="currentColor" strokeWidth="1.5" /><path d="M6 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg> }
              : { bg: 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10', text: 'text-[#ff6b2c] dark:text-[#ff6b2c]', icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.325 3.05L8.667 20.432M15.5 5.5L20 10L15.5 14.5M8.5 5.5L4 10L8.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg> }

            const badgeConfig = toolType === 'send_document'
              ? { text: 'text-[#ff6b2c] dark:text-[#ff6b2c]', bg: 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10', label: 'DOCUMENTO' }
              : toolType === 'notify_human'
              ? { text: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-100 dark:bg-amber-900/50', label: 'NOTIFICAÇÃO' }
              : toolType === 'schedule_appointment'
              ? { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-100 dark:bg-emerald-900/50', label: 'AGENDAMENTO' }
              : toolType === 'pix_payment'
              ? { text: 'text-[#ff6b2c] dark:text-[#ff6b2c]', bg: 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10', label: 'PIX' }
              : toolType === 'card_payment'
              ? { text: 'text-[#635BFF] dark:text-[#635BFF]', bg: 'bg-[#635BFF]/10 dark:bg-[#635BFF]/10', label: 'CARTÃO' }
              : { text: 'text-[#ff6b2c] dark:text-[#ff6b2c]', bg: 'bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10', label: tool.method || 'POST' }

            return (
            <Card key={tool.id} className="flex flex-col h-full hover:shadow-md transition">
              <div className="p-5 flex-1 flex flex-col">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 ${iconConfig.bg} ${iconConfig.text} rounded-lg flex items-center justify-center shrink-0`}>
                      {iconConfig.icon}
                    </div>
                    <div>
                      <h4 className="font-semibold text-foreground truncate max-w-[140px] leading-tight">{tool.name}</h4>
                      <div className="mt-0.5"><span className={`text-[10px] uppercase font-bold ${badgeConfig.text} ${badgeConfig.bg} px-1.5 py-0.5 rounded`}>{badgeConfig.label}</span></div>
                    </div>
                  </div>
                  {!isReadOnly && (
                  <Switch
                    isSelected={tool.isEnabled}
                    onChange={async (isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                      const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                      if (shareToken) {
                        try {
                          await apiFetch(`/api/assistants/${assistant.id}/tools/${tool.id}${qs}`, {
                            method: 'PUT', body: JSON.stringify({ isEnabled: val }),
                          })
                          setSharedTools(prev => prev.map(t => t.id === tool.id ? { ...t, isEnabled: val } : t))
                        } catch (err) { console.error('Failed to toggle tool:', err) }
                      } else {
                        toggleToolForAssistant(assistant.id, tool.id, val)
                      }
                    }}
                  />
                  )}
                </div>

                <p className="text-sm text-muted mt-2 line-clamp-2 flex-1">{tool.description}</p>

                <div className="mt-4 pt-4 border-t border-dim flex items-center justify-between">
                  {toolType === 'notify_human' || toolType === 'pix_payment' || toolType === 'card_payment' ? (
                    <div className="text-xs text-muted">{toolType === 'pix_payment' ? 'Cobrança PIX' : toolType === 'card_payment' ? 'Cobrança Cartão' : 'Ferramenta integrada'}</div>
                  ) : (
                    <div className="text-xs text-slate-500 font-mono truncate max-w-[150px] bg-raised px-2 py-1 rounded">
                      {tool.endpoint || '—'}
                    </div>
                  )}
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted hover:text-foreground"
                      onPress={() => openHistoryModal(tool)}
                      aria-label="Histórico de chamadas"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                        <path d="M12 7V12L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </Button>
                    {!isReadOnly && (
                      <Button variant="ghost" size="sm" onPress={() => openEditModal(tool)} aria-label="Editar ferramenta">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Button>
                    )}
                    {!isReadOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                        onPress={() => confirmDelete(tool)}
                        aria-label="Excluir ferramenta"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V4a1 1 0 011-1h6a1 1 0 011 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </Card>
            )
          })}
        </div>
      )}

      {/* ── Tool Type Selection Modal ── */}
      <Modal>
        <Modal.Backdrop isOpen={typeSelectionOpen} onOpenChange={setTypeSelectionOpen}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[560px] w-full bg-overlay p-6 rounded-2xl shadow-xl flex flex-col gap-5">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Adicionar Ferramenta</h3>
                <p className="text-sm text-muted mt-1">Selecione o tipo de ferramenta que deseja criar.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* HTTP Request */}
                <button
                  type="button"
                  className="flex flex-col items-center gap-3 p-4 rounded-xl hover:border-[#ff6b2c] hover:bg-[#ff6b2c]/5 dark:hover:bg-[#ff6b2c]/10 transition cursor-pointer text-center"
                  onClick={() => selectToolType('http_request')}
                >
                  <div className="w-12 h-12 bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10 text-[#ff6b2c] dark:text-[#ff6b2c] rounded-lg flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M13.325 3.05L8.667 20.432M15.5 5.5L20 10L15.5 14.5M8.5 5.5L4 10L8.5 14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">Requisição HTTP</p>
                    <p className="text-xs text-muted mt-1">Faz chamadas HTTP para APIs externas</p>
                  </div>
                </button>

                {/* Send Document */}
                <button
                  type="button"
                  className="flex flex-col items-center gap-3 p-4 rounded-xl hover:border-[#ff6b2c] hover:bg-[#ff6b2c]/5 dark:hover:bg-[#ff6b2c]/5 transition cursor-pointer text-center"
                  onClick={() => selectToolType('send_document')}
                >
                  <div className="w-12 h-12 bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10 text-[#ff6b2c] dark:text-[#ff6b2c] rounded-lg flex items-center justify-center">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground text-sm">Enviar Documento</p>
                    <p className="text-xs text-muted mt-1">Permite a IA enviar documentos ou imagens na conversa</p>
                  </div>
                </button>

                {/* Notify Human Agent */}
                {(() => {
                  const exists = tools.some(t => (t.toolType || 'http_request') === 'notify_human')
                  return (
                    <button
                      type="button"
                      className={`flex flex-col items-center gap-3 p-4 rounded-xl transition text-center ${
                        exists
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/10 cursor-pointer'
                      }`}
                      onClick={() => !exists && selectToolType('notify_human')}
                      disabled={exists}
                    >
                      <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M18 8A6 6 0 106 8c0 7-3 9-3 9h18s-3-2-3-9zM13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">Notificar Agente Humano</p>
                        <p className="text-xs text-muted mt-1">
                          {exists ? 'Já configurado' : 'Notifica o proprietário para intervir na conversa'}
                        </p>
                      </div>
                    </button>
                  )
                })()}

                {/* Schedule Appointment */}
                {(() => {
                  const exists = tools.some(t => (t.toolType || 'http_request') === 'schedule_appointment')
                  return (
                    <button
                      type="button"
                      className={`flex flex-col items-center gap-3 p-4 rounded-xl transition text-center ${
                        exists
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 cursor-pointer'
                      }`}
                      onClick={() => !exists && selectToolType('schedule_appointment')}
                      disabled={exists}
                    >
                      <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg flex items-center justify-center">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">Agendar Compromisso</p>
                        <p className="text-xs text-muted mt-1">
                          {exists ? 'Já configurado' : 'Permite a IA agendar compromissos para clientes'}
                        </p>
                      </div>
                    </button>
                  )
                })()}

                {/* PIX Payment */}
                {(() => {
                  const exists = tools.some(t => (t.toolType || 'http_request') === 'pix_payment')
                  return (
                    <button
                      type="button"
                      className={`flex flex-col items-center gap-3 p-4 rounded-xl transition text-center ${
                        exists
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:border-[#ff6b2c] hover:bg-[#ff6b2c]/5 dark:hover:bg-[#ff6b2c]/10 cursor-pointer'
                      }`}
                      onClick={() => !exists && selectToolType('pix_payment')}
                      disabled={exists}
                    >
                      <div className="w-12 h-12 bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10 rounded-lg flex items-center justify-center">
                        <img src="/logo-pix-520x520.png" alt="PIX" width={28} height={28} style={{ filter: 'brightness(0) saturate(100%) invert(45%) sepia(96%) saturate(1500%) hue-rotate(360deg) brightness(100%) contrast(100%)' }} />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">Cobrança PIX</p>
                        <p className="text-xs text-muted mt-1">
                          {exists ? 'Já configurado' : 'Gera cobranças PIX e verifica pagamentos'}
                        </p>
                      </div>
                    </button>
                  )
                })()}
                {/* Card Payment */}
                {(() => {
                  const exists = tools.some(t => (t.toolType || 'http_request') === 'card_payment')
                  return (
                    <button
                      type="button"
                      className={`flex flex-col items-center gap-3 p-4 rounded-xl transition text-center ${
                        exists
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:border-[#635BFF] hover:bg-[#635BFF]/5 dark:hover:bg-[#635BFF]/10 cursor-pointer'
                      }`}
                      onClick={() => !exists && selectToolType('card_payment')}
                      disabled={exists}
                    >
                      <div className="w-12 h-12 bg-[#635BFF]/10 dark:bg-[#635BFF]/10 rounded-lg flex items-center justify-center">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="2" y="5" width="20" height="14" rx="2" stroke="#635BFF" strokeWidth="1.5" />
                          <path d="M2 10h20" stroke="#635BFF" strokeWidth="1.5" />
                          <path d="M6 15h4" stroke="#635BFF" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </div>
                      <div>
                        <p className="font-semibold text-foreground text-sm">Cartao de Credito/Debito</p>
                        <p className="text-xs text-muted mt-1">
                          {exists ? 'Ja configurado' : 'Gera links de pagamento por cartao'}
                        </p>
                      </div>
                    </button>
                  )
                })()}
              </div>
              <div className="flex justify-end">
                <button type="button" className="btn-neu-ghost text-sm" onClick={() => setTypeSelectionOpen(false)}>Cancelar</button>
              </div>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── Built-in Tool Modal (Document / Notify Human) ── */}
      <Modal>
        <Modal.Backdrop isOpen={builtinModalOpen} onOpenChange={setBuiltinModalOpen}>
          <Modal.Container>
            <Modal.Dialog className={`w-full bg-overlay p-6 rounded-2xl shadow-xl flex flex-col gap-5 max-h-[90vh] overflow-y-auto ${builtinToolType === 'schedule_appointment' ? 'sm:max-w-[540px]' : 'sm:max-w-[440px]'}`}>
              <div className="flex items-center gap-3">
                {builtinToolType === 'send_document' ? (
                  <div className="w-10 h-10 bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10 text-[#ff6b2c] dark:text-[#ff6b2c] rounded-lg flex items-center justify-center shrink-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ) : builtinToolType === 'schedule_appointment' ? (
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg flex items-center justify-center shrink-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                ) : builtinToolType === 'pix_payment' ? (
                  <div className="w-10 h-10 bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/10 rounded-lg flex items-center justify-center shrink-0">
                    <img src="/logo-pix-520x520.png" alt="PIX" width={24} height={24} style={{ filter: 'brightness(0) saturate(100%) invert(45%) sepia(96%) saturate(1500%) hue-rotate(360deg) brightness(100%) contrast(100%)' }} />
                  </div>
                ) : builtinToolType === 'card_payment' ? (
                  <div className="w-10 h-10 bg-[#635BFF]/10 dark:bg-[#635BFF]/10 rounded-lg flex items-center justify-center shrink-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="2" y="5" width="20" height="14" rx="2" stroke="#635BFF" strokeWidth="1.5" />
                      <path d="M2 10h20" stroke="#635BFF" strokeWidth="1.5" />
                      <path d="M6 15h4" stroke="#635BFF" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 rounded-lg flex items-center justify-center shrink-0">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M18 8A6 6 0 106 8c0 7-3 9-3 9h18s-3-2-3-9zM13.73 21a2 2 0 01-3.46 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {editingBuiltinTool ? 'Editar' : 'Adicionar'} {
                      builtinToolType === 'send_document' ? 'Enviar Documento'
                      : builtinToolType === 'schedule_appointment' ? 'Agendar Compromisso'
                      : builtinToolType === 'pix_payment' ? 'Cobrança PIX'
                      : builtinToolType === 'card_payment' ? 'Cobrança por Cartão'
                      : 'Notificar Agente Humano'
                    }
                  </h3>
                  <p className="text-sm text-muted">
                    {builtinToolType === 'send_document'
                      ? 'A IA poderá enviar documentos e imagens na conversa por URL.'
                      : builtinToolType === 'schedule_appointment'
                      ? 'A IA poderá agendar, cancelar e reagendar compromissos para clientes.'
                      : builtinToolType === 'pix_payment'
                      ? 'A IA poderá gerar cobranças PIX e verificar pagamentos.'
                      : builtinToolType === 'card_payment'
                      ? 'A IA poderá gerar links de pagamento por cartão de crédito/débito.'
                      : 'A IA poderá notificar agentes humanos para intervir na conversa.'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <TextField>
                  <Label>Nome</Label>
                  <Input
                    value={builtinName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBuiltinName(e.target.value)}
                    placeholder="Nome da ferramenta"
                  />
                </TextField>

                <div className="flex flex-col gap-1.5">
                  <Label>Descrição</Label>
                  <TextArea
                    value={builtinDescription}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBuiltinDescription(e.target.value)}
                    placeholder="Descreva quando a IA deve usar esta ferramenta"
                    rows={3}
                  />
                  <p className="text-xs text-muted">Esta descrição guia a IA sobre quando usar a ferramenta.</p>
                </div>

                {/* URL field + test for send_document */}
                {builtinToolType === 'send_document' && (
                  <div className="flex flex-col gap-2">
                    <TextField>
                      <Label>URL do Documento</Label>
                      <Input
                        value={builtinEndpoint}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setBuiltinEndpoint(e.target.value); setTestUrlResult(null) }}
                        placeholder="https://exemplo.com/cardapio.pdf"
                      />
                    </TextField>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-neu text-sm"
                        onClick={handleTestUrl}
                        disabled={!builtinEndpoint.trim() || testUrlLoading}
                      >
                        {testUrlLoading ? 'Testando...' : 'Testar URL'}
                      </button>
                      {testUrlResult && (
                        <div className={`flex-1 text-sm px-3 py-2 rounded-lg border ${testUrlResult.ok ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
                          {testUrlResult.ok ? (
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-green-600 dark:text-green-400 shrink-0">
                                  <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                                <span className="font-medium text-green-700 dark:text-green-400 text-xs">Acessível ({testUrlResult.status})</span>
                              </div>
                              {(testUrlResult.content_type || (testUrlResult.content_length != null && testUrlResult.content_length > 0)) && (
                                <span className="text-xs text-muted ml-5">
                                  {testUrlResult.content_type && <>{testUrlResult.content_type}</>}
                                  {testUrlResult.content_length != null && testUrlResult.content_length > 0 && <> — {(testUrlResult.content_length / 1024).toFixed(1)} KB</>}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-red-600 dark:text-red-400 shrink-0">
                                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
                                <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                              </svg>
                              <span className="font-medium text-red-700 dark:text-red-400 text-xs">
                                {testUrlResult.error || `Erro HTTP ${testUrlResult.status}`}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* PIX mode and key fields */}
                {builtinToolType === 'pix_payment' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>Modo de Pagamento</Label>
                      <select
                        value={pixMode}
                        onChange={(e) => {
                          const mode = e.target.value as 'direct' | 'mercadopago' | 'stripe'
                          setPixMode(mode)
                          setStripePixCheck({ checking: false, result: null })
                          if (mode === 'stripe') {
                            // Auto-check PIX availability on Stripe
                            setStripePixCheck({ checking: true, result: null })
                            apiFetch<{ pix_enabled: boolean; message: string }>('/api/user/stripe/check-pix')
                              .then(data => setStripePixCheck({ checking: false, result: { ok: data.pix_enabled, msg: data.message } }))
                              .catch(() => setStripePixCheck({ checking: false, result: { ok: false, msg: 'Falha ao verificar conta Stripe.' } }))
                          }
                        }}
                        className="w-full bg-raised rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#ff6b2c]"
                      >
                        <option value="direct">Gerar Codigo PIX direto</option>
                        {useApiKeysStore.getState().configured.mercadopago ? (
                          <option value="mercadopago">Mercado Pago (verificacao automatica)</option>
                        ) : (
                          <option value="mercadopago" disabled>Mercado Pago (configure em Credenciais)</option>
                        )}
                        {useApiKeysStore.getState().configured.stripe ? (
                          <option value="stripe">Stripe (verificacao automatica)</option>
                        ) : (
                          <option value="stripe" disabled>Stripe (configure em Credenciais)</option>
                        )}
                      </select>
                      {pixMode === 'direct' && (
                        <p className="text-xs text-muted mt-1">O cliente recebe o QR Code direto para sua chave PIX. Confirme o pagamento manualmente na pagina Financeiro.</p>
                      )}
                      {pixMode === 'mercadopago' && (
                        <p className="text-xs text-muted mt-1">O pagamento e processado pelo Mercado Pago com verificacao automatica via webhook.</p>
                      )}
                      {pixMode === 'stripe' && (
                        <>
                          <p className="text-xs text-muted mt-1">O pagamento e processado pela Stripe com verificacao automatica.</p>
                          {stripePixCheck.checking && (
                            <p className="text-xs text-yellow-400 mt-1">Verificando se PIX esta ativado na Stripe...</p>
                          )}
                          {stripePixCheck.result && !stripePixCheck.result.ok && (
                            <p className="text-xs text-red-400 mt-1">{stripePixCheck.result.msg}</p>
                          )}
                          {stripePixCheck.result && stripePixCheck.result.ok && (
                            <p className="text-xs text-green-400 mt-1">{stripePixCheck.result.msg}</p>
                          )}
                        </>
                      )}
                    </div>

                    {pixMode === 'direct' && (
                      <>
                        <div className="flex flex-col gap-1.5">
                          <Label>Tipo da Chave PIX</Label>
                          <select
                            value={pixKeyType}
                            onChange={(e) => setPixKeyType(e.target.value)}
                            className="w-full bg-raised rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#ff6b2c]"
                          >
                            <option value="cpf">CPF</option>
                            <option value="cnpj">CNPJ</option>
                            <option value="email">Email</option>
                            <option value="phone">Telefone</option>
                            <option value="random">Chave Aleatoria</option>
                          </select>
                        </div>
                        <TextField>
                          <Label>Chave PIX</Label>
                          <Input
                            value={builtinEndpoint}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBuiltinEndpoint(e.target.value)}
                            placeholder={
                              pixKeyType === 'cpf' ? '000.000.000-00'
                              : pixKeyType === 'cnpj' ? '00.000.000/0001-00'
                              : pixKeyType === 'email' ? 'email@exemplo.com'
                              : pixKeyType === 'phone' ? '+5511999999999'
                              : 'Chave aleatoria'
                            }
                          />
                        </TextField>
                      </>
                    )}
                  </div>
                )}

                {/* Card Payment mode selector */}
                {builtinToolType === 'card_payment' && (
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <Label>Provedor de Pagamento</Label>
                      <select
                        value={cardMode}
                        onChange={(e) => setCardMode(e.target.value as 'stripe' | 'mercadopago')}
                        className="w-full bg-raised rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-[#635BFF]"
                      >
                        {useApiKeysStore.getState().configured.stripe ? (
                          <option value="stripe">Stripe</option>
                        ) : (
                          <option value="stripe" disabled>Stripe (configure em Credenciais)</option>
                        )}
                        {useApiKeysStore.getState().configured.mercadopago ? (
                          <option value="mercadopago">Mercado Pago</option>
                        ) : (
                          <option value="mercadopago" disabled>Mercado Pago (configure em Credenciais)</option>
                        )}
                      </select>
                      <div className="mt-2 space-y-1.5">
                        <p className="text-xs text-muted">
                          Os dados do cartao sao processados diretamente pelo {cardMode === 'stripe' ? 'Stripe' : 'Mercado Pago'}, sem passar pelo nosso sistema.
                        </p>
                        {cardMode === 'stripe' ? (
                          <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-1">
                            <p className="text-xs text-yellow-400 font-medium">Restricoes do Stripe no Brasil:</p>
                            <ul className="text-xs text-yellow-400/80 list-disc pl-4 space-y-0.5">
                              <li>Parcelamento nao disponivel (apenas pagamento a vista)</li>
                              <li>Nao e possivel restringir entre credito e debito — o tipo depende do cartao usado pelo cliente</li>
                            </ul>
                          </div>
                        ) : (
                          <>
                            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg space-y-1">
                              <p className="text-xs text-blue-400 font-medium">Recursos do Mercado Pago:</p>
                              <ul className="text-xs text-blue-400/80 list-disc pl-4 space-y-0.5">
                                <li>Suporte a credito e debito — o agente de IA define o tipo na cobranca</li>
                                <li>Parcelamento de 1x a 12x no credito</li>
                                <li>Requer chave publica e access token configurados em Credenciais</li>
                              </ul>
                            </div>
                            <div className="p-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg space-y-1">
                              <p className="text-xs text-yellow-400 font-medium">Restricoes de parcelamento:</p>
                              <ul className="text-xs text-yellow-400/80 list-disc pl-4 space-y-0.5">
                                <li>Valor minimo por parcela: R$ 5,00</li>
                                <li>Ex: para 2x o valor minimo e R$ 10,00, para 3x e R$ 15,00</li>
                                <li>O agente de IA ja valida automaticamente e sugere alternativas ao cliente</li>
                              </ul>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <Label>Ativada</Label>
                  <Switch
                    isSelected={builtinEnabled}
                    onChange={(isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                      setBuiltinEnabled(typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked)
                    }}
                  />
                </div>

                {/* Availability config for schedule_appointment */}
                {builtinToolType === 'schedule_appointment' && (
                  <AvailabilityConfigPanel
                    ref={availabilityRef}
                    assistantId={assistant.id}
                    shareToken={shareToken}
                  />
                )}
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="btn-neu-ghost text-sm" onClick={() => { setBuiltinModalOpen(false); setEditingBuiltinTool(null) }}>
                  Cancelar
                </button>
                <button type="button" className="btn-neu text-sm" onClick={handleBuiltinSubmit}>
                  {editingBuiltinTool ? 'Salvar' : 'Criar'}
                </button>
              </div>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── Delete Confirmation Modal ── */}
      <Modal>
        <Modal.Backdrop isOpen={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[400px] w-full bg-overlay p-6 rounded-2xl shadow-xl flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-lg flex items-center justify-center shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V4a1 1 0 011-1h6a1 1 0 011 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Excluir Ferramenta</h3>
                  <p className="text-sm text-muted">Esta ação não pode ser desfeita.</p>
                </div>
              </div>
              {toolToDelete && (
                <p className="text-sm text-body">
                  Tem certeza que deseja excluir a ferramenta <span className="font-semibold text-foreground">{toolToDelete.name}</span>?
                </p>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" className="btn-neu-ghost text-sm" onClick={() => { setDeleteConfirmOpen(false); setToolToDelete(null) }}>
                  Cancelar
                </button>
                <button type="button" className="btn-neu text-sm !text-red-400 hover:!text-red-300" onClick={handleConfirmDelete}>
                  Excluir
                </button>
              </div>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── Tool Call History Modal ── */}
      <Modal>
        <Modal.Backdrop isOpen={historyModalOpen} onOpenChange={setHistoryModalOpen}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[640px] w-full bg-overlay p-0 rounded-2xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
              <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised/80 transition-colors cursor-pointer text-subtle hover:text-heading">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </Modal.CloseTrigger>
              <Modal.Header className="px-6 pt-6 pb-0">
                <Modal.Heading className="text-xl font-semibold text-foreground">
                  Histórico de Chamadas {historyTool && <span className="text-muted font-normal text-base ml-2">— {historyTool.name}</span>}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex-1 overflow-y-auto px-6 pb-6 pt-4">
                {isLoadingLogs ? (
                  <div className="text-center text-muted py-8">Carregando...</div>
                ) : callLogs.length === 0 ? (
                  <div className="text-center text-muted py-8 flex flex-col items-center gap-2">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="opacity-40">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M12 7V12L15 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <p className="font-medium text-foreground">Nenhuma chamada registrada</p>
                    <p className="text-sm">As chamadas feitas pela IA aparecerão aqui.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {callLogs.map((log) => {
                      const isError = log.error || (log.status_code && log.status_code >= 400)
                      const isExpanded = expandedLogId === log.id
                      return (
                        <button
                          key={log.id}
                          type="button"
                          className={`w-full text-left rounded-xl border transition-colors ${
                            isError
                              ? 'border-red-500/20 bg-red-950/10 hover:bg-red-950/20'
                              : 'border-dim bg-raised/50 hover:bg-raised'
                          }`}
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                        >
                          <div className="px-4 py-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              {log.status_code ? (
                                <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${
                                  log.status_code < 400
                                    ? 'bg-green-900/30 text-green-400'
                                    : 'bg-red-900/30 text-red-400'
                                }`}>
                                  {log.status_code}
                                </span>
                              ) : (
                                <span className="shrink-0 px-2 py-0.5 rounded text-xs font-bold bg-red-900/30 text-red-400">
                                  ERR
                                </span>
                              )}
                              <span className="text-sm text-foreground font-medium truncate">{log.tool_name}</span>
                              <span className="text-xs text-muted shrink-0">{log.duration_ms}ms</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-xs text-muted">
                                {new Date(log.called_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 16 16"
                                fill="none"
                                className={`text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              >
                                <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </div>
                          </div>

                          {isExpanded && (
                            <div className="px-4 pb-4 border-t border-dim pt-3 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
                              {log.arguments && (
                                <div>
                                  <p className="text-xs font-semibold text-muted mb-1">Argumentos</p>
                                  <pre className="text-xs font-mono bg-raised rounded-lg p-2 overflow-auto max-h-[120px] text-foreground whitespace-pre-wrap">
                                    {(() => { try { return JSON.stringify(JSON.parse(log.arguments), null, 2) } catch { return log.arguments } })()}
                                  </pre>
                                </div>
                              )}

                              {log.error && (
                                <div>
                                  <p className="text-xs font-semibold text-red-400 mb-1">Erro</p>
                                  <pre className="text-xs font-mono bg-red-950/20 border border-red-500/20 rounded-lg p-2 overflow-auto max-h-[120px] text-red-400 whitespace-pre-wrap">
                                    {log.error}
                                  </pre>
                                </div>
                              )}

                              {log.response_body && (
                                <div>
                                  <p className="text-xs font-semibold text-muted mb-1">Resposta</p>
                                  <pre className="text-xs font-mono bg-raised rounded-lg p-2 overflow-auto max-h-[200px] text-foreground whitespace-pre-wrap">
                                    {(() => { try { return JSON.stringify(JSON.parse(log.response_body), null, 2) } catch { return log.response_body } })()}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── Edit/Create Tool Modal ── */}
      <Modal>
        <Modal.Backdrop isOpen={isModalOpen} onOpenChange={setIsModalOpen}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[720px] w-full bg-overlay p-0 rounded-2xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
              <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised/80 transition-colors cursor-pointer text-subtle hover:text-heading">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </Modal.CloseTrigger>
              <Modal.Header className="px-6 pt-6 pb-0">
                <Modal.Heading className="text-xl font-semibold text-foreground">
                  {editingTool ? 'Editar Ferramenta' : 'Criar Ferramenta Personalizada'}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="flex-1 overflow-y-auto px-6 pb-6">
                <Form className="flex w-full flex-col gap-0" onSubmit={handleSubmit(onSubmit)}>
                  {/* ── Name & Description (always visible) ── */}
                  <div className="flex flex-col gap-4 py-4">
                    <Controller
                      name="name"
                      control={control}
                      render={({ field }) => (
                        <TextField className="w-full" isInvalid={!!errors.name}>
                          <Label className="text-sm font-semibold mb-1 text-body">Nome da Ferramenta (Function Call)</Label>
                          <Input {...field} placeholder="e.g. get_user_plan" />
                          <span className="text-xs text-muted block mt-1">Usado internamente pela IA. Sem espaços.</span>
                          {errors.name && <FieldError>{errors.name.message}</FieldError>}
                        </TextField>
                      )}
                    />
                    <Controller
                      name="description"
                      control={control}
                      render={({ field }) => (
                        <TextField className="w-full" isInvalid={!!errors.description}>
                          <Label className="text-sm font-semibold mb-1 text-body">Descrição</Label>
                          <TextArea {...field} placeholder="Diz à IA quando usar esta ferramenta (ex: quando o usuário perguntar sobre cobrança)" />
                          {errors.description && <FieldError>{errors.description.message}</FieldError>}
                        </TextField>
                      )}
                    />
                  </div>

                  {/* ── Tabs: Parameters | Settings ── */}
                  <Tabs className="w-full mt-2">
                    <Tabs.ListContainer className="border-b border-dim w-full mb-0">
                      <Tabs.List aria-label="Tool Configuration" className="gap-4 flex">
                        <Tabs.Tab id="params">
                          Parâmetros
                          <Tabs.Indicator />
                        </Tabs.Tab>
                        <Tabs.Tab id="settings">
                          Configurações
                          <Tabs.Indicator />
                        </Tabs.Tab>
                      </Tabs.List>
                    </Tabs.ListContainer>

                    {/* ════════════ Parameters Tab ════════════ */}
                    <Tabs.Panel id="params">
                      <div className="flex flex-col gap-5 pt-4">
                        {/* Method + URL */}
                        <div className="grid grid-cols-[120px_1fr] gap-3 w-full">
                          <Controller
                            name="method"
                            control={control}
                            render={({ field: { onChange, value } }) => (
                              <Select
                                className="w-full"
                                selectedKey={value}
                                onSelectionChange={(key) => { if (key as string) onChange(key as string) }}
                              >
                                <Label className="text-sm font-semibold mb-1 text-body">Método</Label>
                                <Select.Trigger>
                                  <Select.Value />
                                  <Select.Indicator />
                                </Select.Trigger>
                                <Select.Popover>
                                  <ListBox>
                                    <ListBox.Item id="GET" textValue="GET">GET</ListBox.Item>
                                    <ListBox.Item id="POST" textValue="POST">POST</ListBox.Item>
                                    <ListBox.Item id="PUT" textValue="PUT">PUT</ListBox.Item>
                                    <ListBox.Item id="PATCH" textValue="PATCH">PATCH</ListBox.Item>
                                    <ListBox.Item id="DELETE" textValue="DELETE">DELETE</ListBox.Item>
                                  </ListBox>
                                </Select.Popover>
                              </Select>
                            )}
                          />
                          <Controller
                            name="endpoint"
                            control={control}
                            render={({ field }) => (
                              <TextField className="w-full" isInvalid={!!errors.endpoint}>
                                <Label className="text-sm font-semibold mb-1 text-body">URL</Label>
                                <Input {...field} placeholder="https://api.example.com/users/{{userId}}" />
                                <span className="text-xs text-muted block mt-1">
                                  Use {'{{variável}}'} para valores dinâmicos do contexto do agente.
                                </span>
                                {errors.endpoint && <FieldError>{errors.endpoint.message}</FieldError>}
                              </TextField>
                            )}
                          />
                        </div>

                        {/* ── Authentication Section ── */}
                        <CollapsibleSection title="Authentication" defaultOpen={auth.type !== 'none'}>
                          <div className="flex flex-col gap-3">
                            <div>
                              <Label className="text-sm font-semibold mb-1 text-body block">Tipo de Autenticação</Label>
                              <div className="flex gap-2 flex-wrap">
                                {(['none', 'bearer', 'basic', 'header'] as AuthType[]).map((type) => (
                                  <button
                                    key={type}
                                    type="button"
                                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                                      auth.type === type
                                        ? 'border-[#ff6b2c] bg-[#ff6b2c]/10 text-[#ff6b2c]'
                                        : 'border-dim text-muted hover:border-dim-hover hover:text-foreground'
                                    }`}
                                    onClick={() => setAuth({ ...DEFAULT_AUTH, type })}
                                  >
                                    {type === 'none' ? 'Nenhuma' : type === 'bearer' ? 'Token Bearer' : type === 'basic' ? 'Autenticação Básica' : 'Autenticação por Header'}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {auth.type === 'bearer' && (
                              <TextField className="w-full">
                                <Label className="text-sm font-semibold mb-1 text-body">Token</Label>
                                <Input
                                  type="password"
                                  value={auth.token || ''}
                                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAuth({ ...auth, token: e.target.value })}
                                  placeholder="Seu token bearer"
                                />
                              </TextField>
                            )}

                            {auth.type === 'basic' && (
                              <div className="grid grid-cols-2 gap-3">
                                <TextField className="w-full">
                                  <Label className="text-sm font-semibold mb-1 text-body">Usuário</Label>
                                  <Input
                                    value={auth.username || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAuth({ ...auth, username: e.target.value })}
                                    placeholder="Usuário"
                                  />
                                </TextField>
                                <TextField className="w-full">
                                  <Label className="text-sm font-semibold mb-1 text-body">Senha</Label>
                                  <Input
                                    type="password"
                                    value={auth.password || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAuth({ ...auth, password: e.target.value })}
                                    placeholder="Senha"
                                  />
                                </TextField>
                              </div>
                            )}

                            {auth.type === 'header' && (
                              <div className="grid grid-cols-2 gap-3">
                                <TextField className="w-full">
                                  <Label className="text-sm font-semibold mb-1 text-body">Nome do Header</Label>
                                  <Input
                                    value={auth.headerName || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAuth({ ...auth, headerName: e.target.value })}
                                    placeholder="X-API-Key"
                                  />
                                </TextField>
                                <TextField className="w-full">
                                  <Label className="text-sm font-semibold mb-1 text-body">Valor do Header</Label>
                                  <Input
                                    type="password"
                                    value={auth.headerValue || ''}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAuth({ ...auth, headerValue: e.target.value })}
                                    placeholder="your-api-key"
                                  />
                                </TextField>
                              </div>
                            )}
                          </div>
                        </CollapsibleSection>

                        {/* ── Query Parameters ── */}
                        <CollapsibleSection title="Parâmetros de Consulta" defaultOpen={queryParams.length > 0}>
                          <KeyValueEditor
                            pairs={queryParams}
                            onChange={setQueryParams}
                            keyPlaceholder="Nome do parâmetro"
                            valuePlaceholder="Valor ou {{variável}}"
                          />
                        </CollapsibleSection>

                        {/* ── Headers ── */}
                        <CollapsibleSection title="Headers" defaultOpen={headerPairs.length > 0}>
                          <KeyValueEditor
                            pairs={headerPairs}
                            onChange={setHeaderPairs}
                            keyPlaceholder="Nome do header"
                            valuePlaceholder="Valor do header"
                          />
                        </CollapsibleSection>

                        {/* ── Body (only for POST/PUT/PATCH) ── */}
                        {METHODS_WITH_BODY.includes(currentMethod) && (
                          <CollapsibleSection title="Corpo" defaultOpen={!!bodyContent}>
                            <div className="flex flex-col gap-3">
                              <div>
                                <Label className="text-sm font-semibold mb-1 text-body block">Tipo de Conteúdo</Label>
                                <div className="flex gap-2 flex-wrap">
                                  {(['json', 'form-urlencoded', 'form-data', 'raw'] as BodyContentType[]).map((type) => (
                                    <button
                                      key={type}
                                      type="button"
                                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                                        bodyContentType === type
                                          ? 'border-[#ff6b2c] bg-[#ff6b2c]/10 text-[#ff6b2c]'
                                          : 'border-dim text-muted hover:border-dim-hover hover:text-foreground'
                                      }`}
                                      onClick={() => setBodyContentType(type)}
                                    >
                                      {type === 'json' ? 'JSON' : type === 'form-urlencoded' ? 'Form URL-Encoded' : type === 'form-data' ? 'Form Data' : 'Raw'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <TextField className="w-full">
                                <Label className="text-sm font-semibold mb-1 text-body">Conteúdo do Corpo</Label>
                                <TextArea
                                  className="font-mono text-sm min-h-[120px]"
                                  value={bodyContent}
                                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setBodyContent(e.target.value)}
                                  placeholder={bodyContentType === 'json' ? '{\n  "key": "{{value}}"\n}' : 'key=value&other={{variable}}'}
                                />
                              </TextField>
                            </div>
                          </CollapsibleSection>
                        )}

                        {/* ── Parameters Schema (Function Calling) ── */}
                        <CollapsibleSection title="Schema de Parâmetros (Function Calling)" defaultOpen={false}>
                          <Controller
                            name="schema"
                            control={control}
                            render={({ field }) => (
                              <TextField className="w-full">
                                <Label className="text-sm font-semibold mb-1 text-body">JSON Schema</Label>
                                <TextArea
                                  {...field}
                                  className="font-mono text-sm min-h-[120px]"
                                  placeholder={'{\n  "type": "object",\n  "properties": {\n    "userId": { "type": "string", "description": "The user ID" }\n  },\n  "required": ["userId"]\n}'}
                                />
                                <span className="text-xs text-muted block mt-1">
                                  JSON Schema compatível com OpenAI definindo argumentos que a IA deve fornecer.
                                </span>
                              </TextField>
                            )}
                          />
                        </CollapsibleSection>

                        {/* ── Test / Preview ── */}
                        <CollapsibleSection title="Testar Requisição" defaultOpen={false}>
                          <div className="flex flex-col gap-3">
                            <button
                              type="button"
                              className="btn-neu text-sm self-start"
                              onClick={handleTestRequest}
                              disabled={isTesting}
                            >
                              {isTesting ? 'Enviando...' : 'Enviar Requisição de Teste'}
                            </button>
                            {testResult && (
                              <div className={`rounded-lg border p-3 text-sm font-mono overflow-auto max-h-[240px] ${
                                testResult.error
                                  ? 'border-red-500/30 bg-red-950/20 text-red-400'
                                  : 'border-dim bg-raised text-foreground'
                              }`}>
                                {testResult.error ? (
                                  <p>{testResult.error}</p>
                                ) : (
                                  <>
                                    <div className="flex items-center gap-2 mb-2 pb-2 border-b border-dim">
                                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                        testResult.status && testResult.status < 400
                                          ? 'bg-green-900/30 text-green-400'
                                          : 'bg-red-900/30 text-red-400'
                                      }`}>
                                        {testResult.status}
                                      </span>
                                      <span className="text-muted text-xs">Resposta</span>
                                    </div>
                                    <pre className="whitespace-pre-wrap text-xs leading-relaxed">{testResult.body}</pre>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </CollapsibleSection>
                      </div>
                    </Tabs.Panel>

                    {/* ════════════ Settings Tab ════════════ */}
                    <Tabs.Panel id="settings">
                      <div className="flex flex-col gap-5 pt-4">
                        <TextField className="w-full">
                          <Label className="text-sm font-semibold mb-1 text-body">Timeout (ms)</Label>
                          <Input
                            type="number"
                            value={String(settings.timeout)}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings(s => ({ ...s, timeout: Number(e.target.value) || 30000 }))}
                            placeholder="30000"
                          />
                          <span className="text-xs text-muted block mt-1">Tempo máximo de espera pela resposta em milissegundos.</span>
                        </TextField>

                        <div className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-sm font-semibold text-body">Tentar Novamente em Falha</p>
                            <p className="text-xs text-muted">Tentar novamente automaticamente em caso de falha.</p>
                          </div>
                          <Switch
                            isSelected={settings.retryOnFailure}
                            onChange={(isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                              const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                              setSettings(s => ({ ...s, retryOnFailure: val }))
                            }}
                          />
                        </div>

                        {settings.retryOnFailure && (
                          <TextField className="w-full">
                            <Label className="text-sm font-semibold mb-1 text-body">Número de Tentativas</Label>
                            <Input
                              type="number"
                              value={String(settings.retries)}
                              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSettings(s => ({ ...s, retries: Math.max(0, Math.min(5, Number(e.target.value) || 0)) }))}
                              placeholder="3"
                            />
                            <span className="text-xs text-muted block mt-1">Máx. 5 tentativas.</span>
                          </TextField>
                        )}

                        <div className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-sm font-semibold text-body">Seguir Redirecionamentos</p>
                            <p className="text-xs text-muted">Seguir automaticamente redirecionamentos HTTP 3xx.</p>
                          </div>
                          <Switch
                            isSelected={settings.followRedirects}
                            onChange={(isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                              const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                              setSettings(s => ({ ...s, followRedirects: val }))
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between py-2">
                          <div>
                            <p className="text-sm font-semibold text-body">Ignorar Erros SSL</p>
                            <p className="text-xs text-muted">Pular verificação de certificado SSL (use com cautela).</p>
                          </div>
                          <Switch
                            isSelected={settings.ignoreSSLErrors}
                            onChange={(isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                              const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                              setSettings(s => ({ ...s, ignoreSSLErrors: val }))
                            }}
                          />
                        </div>
                      </div>
                    </Tabs.Panel>
                  </Tabs>

                  {/* ── Footer Actions ── */}
                  <div className="flex justify-end gap-3 w-full mt-4 pt-4 border-t border-dim">
                    <button type="button" className="btn-neu-ghost text-sm" onClick={() => { setIsModalOpen(false); setEditingTool(null); reset(); resetExtendedState(); }}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn-neu text-sm">
                      {editingTool ? 'Atualizar Ferramenta' : 'Salvar Ferramenta'}
                    </button>
                  </div>
                </Form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}

/* ── Collapsible Section Sub-component ── */
function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="rounded-xl overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-body hover:bg-raised/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span>{title}</span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
        >
          <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {isOpen && (
        <div className="px-4 pb-4 border-t border-dim pt-3">
          {children}
        </div>
      )}
    </div>
  )
}
