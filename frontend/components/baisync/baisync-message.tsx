'use client'

import React, { useState, useEffect, useRef } from 'react'
import type { BaisyncMessage, BaisyncUIBlock, BaisyncAction, BaisyncAttachment } from '@/store/useBaisyncStore'
import { BaisyncUIBlockRenderer } from './baisync-ui-blocks'
import { useAssistantStore } from '@/store/useAssistantStore'
import { useCalendarStore } from '@/store/useCalendarStore'
import { useNotificationStore } from '@/store/useNotificationStore'
import { useBaisyncStore } from '@/store/useBaisyncStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { apiFetch, ApiError } from '@/lib/api'

const PHRASES = [
  'Analisando pedido',
  'Examinando',
  'Processando',
  'Refletindo',
  'Considerando',
  'Formulando resposta',
  'Avaliando',
  'Estruturando ideias',
  'Pensando',
  'Conectando ideias',
  'Elaborando',
  'Organizando dados',
  'Preparando resposta',
  'Investigando',
  'Raciocinando',
]

const SPINNER_CHARS = ['·', '✢', '✳', '✶', '✻', '✽']

const COLOR_STAGES = [
  { after: 0, color: [249, 115, 22] },
  { after: 8, color: [234, 88, 12] },
  { after: 16, color: [220, 60, 20] },
  { after: 25, color: [200, 50, 30] },
  { after: 35, color: [253, 186, 116] },
  { after: 45, color: [249, 115, 22] },
]

function getStageColor(elapsedSec: number): number[] {
  let from = COLOR_STAGES[0]
  let to = COLOR_STAGES[0]
  for (let i = COLOR_STAGES.length - 1; i >= 0; i--) {
    if (elapsedSec >= COLOR_STAGES[i].after) {
      from = COLOR_STAGES[i]
      to = COLOR_STAGES[i + 1] || from
      break
    }
  }
  if (from === to) return from.color
  const t = Math.min((elapsedSec - from.after) / (to.after - from.after), 1)
  const smooth = t * t * (3 - 2 * t)
  return from.color.map((c, i) => Math.round(c + (to.color[i] - c) * smooth))
}

export function ThinkingAnimation() {
  // eslint-disable-next-line react-hooks/purity
  const initialIdx = useRef(Math.floor(Math.random() * PHRASES.length))
  const [phrase, setPhrase] = useState(PHRASES[initialIdx.current])
  const [spinnerIdx, setSpinnerIdx] = useState(0)
  const [fade, setFade] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [sweepPos, setSweepPos] = useState(0)
  // eslint-disable-next-line react-hooks/purity
  const startRef = useRef(Date.now())

  useEffect(() => {
    let i = initialIdx.current
    const iv = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        let next: number
        do { next = Math.floor(Math.random() * PHRASES.length) } while (next === i && PHRASES.length > 1)
        i = next
        setPhrase(PHRASES[i])
        setFade(true)
      }, 180)
    }, 2800)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    let i = 0
    let dir = 1
    const iv = setInterval(() => {
      i += dir
      if (i >= SPINNER_CHARS.length - 1) dir = -1
      if (i <= 0) dir = 1
      setSpinnerIdx(i)
    }, 120)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const iv = setInterval(() => {
      setSweepPos((p) => p + 1)
    }, 50)
    return () => clearInterval(iv)
  }, [])

  const [cr, cg, cb] = getStageColor(elapsed % 55)
  const dimColor = `rgba(${cr},${cg},${cb},0.4)`
  const baseColor = `rgb(${cr},${cg},${cb})`

  const fullText = phrase
  const sweepWidth = 5

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        style={{
          fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace",
          fontSize: 16,
          color: baseColor,
          width: 18,
          textAlign: 'center',
          flexShrink: 0,
          transition: 'color 1.5s ease',
        }}
      >
        {SPINNER_CHARS[spinnerIdx]}
      </span>
      <span
        style={{
          fontFamily: "'SF Mono', 'Menlo', 'Consolas', monospace",
          fontSize: 13,
          whiteSpace: 'nowrap',
          opacity: fade ? 1 : 0,
          transition: 'opacity 0.18s ease',
          display: 'inline-flex',
          alignItems: 'baseline',
        }}
      >
        {fullText.split('').map((char, i) => {
          const dist = Math.abs(
            ((sweepPos % (fullText.length + sweepWidth * 2)) - sweepWidth - i)
          )
          const bright = Math.max(0, 1 - dist / sweepWidth)
          const color =
            bright > 0
              ? `rgba(${Math.min(cr + bright * 50, 255)},${Math.min(cg + bright * 50, 255)},${Math.min(cb + bright * 40, 255)},${0.4 + bright * 0.6})`
              : dimColor
          return (
            <span key={i} style={{ color, transition: 'color 0.05s', whiteSpace: 'pre' }}>
              {char}
            </span>
          )
        })}
        <span style={{ color: dimColor }}>...</span>
      </span>
    </div>
  )
}

// Strip baisync blocks from visible content (XML tags, fenced, and raw JSON fallback)
function stripBaisyncBlocks(text: string): string {
  return text
    .replace(/<baisync-ui>[\s\S]*?<\/baisync-ui>/g, '')
    .replace(/<baisync-action>[\s\S]*?<\/baisync-action>/g, '')
    .replace(/```baisync-ui\s*\n[\s\S]*?```/g, '')
    .replace(/```baisync-action\s*\n[\s\S]*?```/g, '')
    .replace(/\{[\s]*"type"[\s]*:[\s]*"(question_box|qr_code|assistant_card)"[^}]*\}/g, '')
    .replace(/\{[\s]*"action"[\s]*:[\s]*"[^"]+?"[\s]*,[\s]*"data"[\s]*:\s*\{[^}]*\}\s*\}/g, '')
    .trim()
}

// Simple markdown renderer: bold → orange, inline code, paragraphs
function renderMarkdown(text: string): React.ReactNode[] {
  const paragraphs = text.split('\n\n')
  return paragraphs.map((para, i) => (
    <p key={i} className={i > 0 ? 'mt-3' : ''}>
      {renderInline(para)}
    </p>
  ))
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Match **bold**, `code`, and regular text
  const regex = /(\*\*(.+?)\*\*)|(`(.+?)`)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[1]) {
      // Bold text → orange
      parts.push(
        <strong key={match.index} style={{ color: '#ff6b2c', fontWeight: 600 }}>
          {match[2]}
        </strong>
      )
    } else if (match[3]) {
      // Inline code
      parts.push(
        <code key={match.index} className="px-1.5 py-0.5 rounded bg-raised text-xs font-mono">
          {match[4]}
        </code>
      )
    }

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

interface MessageProps {
  message: BaisyncMessage
}

const ACTION_LABELS: Record<string, { running: string; done: string; error: string }> = {
  // Assistentes
  create_assistant: { running: 'Criando assistente...', done: 'Assistente criado', error: 'Falha ao criar assistente' },
  update_assistant: { running: 'Atualizando assistente...', done: 'Assistente atualizado', error: 'Falha ao atualizar' },
  delete_assistant: { running: 'Excluindo assistente...', done: 'Assistente excluído', error: 'Falha ao excluir' },
  list_assistants: { running: 'Buscando assistentes...', done: 'Assistentes carregados', error: 'Falha ao buscar assistentes' },
  // Tools
  list_tools: { running: 'Buscando ferramentas...', done: 'Ferramentas carregadas', error: 'Falha ao buscar ferramentas' },
  create_tool: { running: 'Criando ferramenta...', done: 'Ferramenta criada', error: 'Falha ao criar ferramenta' },
  update_tool: { running: 'Atualizando ferramenta...', done: 'Ferramenta atualizada', error: 'Falha ao atualizar ferramenta' },
  delete_tool: { running: 'Excluindo ferramenta...', done: 'Ferramenta excluída', error: 'Falha ao excluir ferramenta' },
  toggle_tool: { running: 'Alterando ferramenta...', done: 'Ferramenta alterada', error: 'Falha ao alterar ferramenta' },
  // Integrações
  connect_whatsapp: { running: 'Conectando WhatsApp...', done: 'WhatsApp conectado', error: 'Falha na conexão' },
  connect_meta: { running: 'Conectando Meta WhatsApp...', done: 'Meta WhatsApp conectado', error: 'Falha na conexão Meta' },
  connect_telegram: { running: 'Conectando Telegram...', done: 'Telegram conectado', error: 'Falha na conexão Telegram' },
  disconnect_integration: { running: 'Desconectando integração...', done: 'Integração desconectada', error: 'Falha ao desconectar' },
  list_integrations: { running: 'Buscando integrações...', done: 'Integrações carregadas', error: 'Falha ao buscar integrações' },
  // Conversas
  list_conversations: { running: 'Buscando conversas...', done: 'Conversas carregadas', error: 'Falha ao buscar conversas' },
  list_messages: { running: 'Buscando mensagens...', done: 'Mensagens carregadas', error: 'Falha ao buscar mensagens' },
  delete_conversation: { running: 'Excluindo conversa...', done: 'Conversa excluída', error: 'Falha ao excluir conversa' },
  toggle_ai: { running: 'Alterando IA...', done: 'IA alterada', error: 'Falha ao alterar IA' },
  summarize_conversation: { running: 'Resumindo conversa...', done: 'Resumo gerado', error: 'Falha ao resumir' },
  // Access Tokens
  list_access_tokens: { running: 'Buscando tokens...', done: 'Tokens carregados', error: 'Falha ao buscar tokens' },
  create_access_token: { running: 'Criando token...', done: 'Token criado', error: 'Falha ao criar token' },
  delete_access_token: { running: 'Excluindo token...', done: 'Token excluído', error: 'Falha ao excluir token' },
  revoke_access_token: { running: 'Revogando token...', done: 'Token revogado', error: 'Falha ao revogar token' },
  // Compartilhamento
  create_share_token: { running: 'Criando link...', done: 'Link criado', error: 'Falha ao criar link' },
  get_share_token: { running: 'Buscando link...', done: 'Link carregado', error: 'Falha ao buscar link' },
  revoke_share_token: { running: 'Revogando link...', done: 'Link revogado', error: 'Falha ao revogar link' },
  // Voz
  list_voices: { running: 'Buscando vozes...', done: 'Vozes carregadas', error: 'Falha ao buscar vozes' },
  // Agenda
  list_events: { running: 'Buscando eventos...', done: 'Eventos carregados', error: 'Falha ao buscar eventos' },
  create_event: { running: 'Criando evento...', done: 'Evento criado', error: 'Falha ao criar evento' },
  update_event: { running: 'Atualizando evento...', done: 'Evento atualizado', error: 'Falha ao atualizar evento' },
  delete_event: { running: 'Excluindo evento...', done: 'Evento excluído', error: 'Falha ao excluir evento' },
  cancel_event: { running: 'Cancelando evento...', done: 'Evento cancelado', error: 'Falha ao cancelar evento' },
  // Disponibilidade
  get_availability: { running: 'Buscando disponibilidade...', done: 'Disponibilidade carregada', error: 'Falha ao buscar disponibilidade' },
  set_availability: { running: 'Configurando disponibilidade...', done: 'Disponibilidade configurada', error: 'Falha ao configurar' },
  get_available_slots: { running: 'Buscando horários...', done: 'Horários carregados', error: 'Falha ao buscar horários' },
  // Notificações
  list_notifications: { running: 'Buscando notificações...', done: 'Notificações carregadas', error: 'Falha ao buscar notificações' },
  mark_notification_read: { running: 'Marcando como lida...', done: 'Notificação marcada', error: 'Falha ao marcar' },
  mark_all_notifications_read: { running: 'Marcando todas...', done: 'Todas marcadas como lidas', error: 'Falha ao marcar' },
  delete_notification: { running: 'Excluindo notificação...', done: 'Notificação excluída', error: 'Falha ao excluir' },
  delete_all_notifications: { running: 'Excluindo todas...', done: 'Notificações excluídas', error: 'Falha ao excluir' },
  // Financeiro
  financial_overview: { running: 'Buscando resumo financeiro...', done: 'Resumo financeiro carregado', error: 'Falha ao buscar financeiro' },
  financial_summary: { running: 'Buscando resumo do assistente...', done: 'Resumo carregado', error: 'Falha ao buscar resumo' },
  list_charges: { running: 'Buscando cobranças...', done: 'Cobranças carregadas', error: 'Falha ao buscar cobranças' },
  // Analytics
  get_usage: { running: 'Buscando uso...', done: 'Dados de uso carregados', error: 'Falha ao buscar uso' },
  get_assistant_stats: { running: 'Buscando estatísticas...', done: 'Estatísticas carregadas', error: 'Falha ao buscar estatísticas' },
  get_assistant_logs: { running: 'Buscando logs...', done: 'Logs carregados', error: 'Falha ao buscar logs' },
  get_activity: { running: 'Buscando atividade...', done: 'Atividade carregada', error: 'Falha ao buscar atividade' },
  // Observabilidade (Sophie self-introspection)
  get_my_recent_errors: { running: 'Buscando meus erros recentes...', done: 'Erros carregados', error: 'Falha ao buscar erros' },
  get_platform_health: { running: 'Verificando saúde da plataforma...', done: 'Saúde carregada', error: 'Falha ao buscar saúde' },
  // Workspaces e Canais
  list_workspaces: { running: 'Buscando workspaces...', done: 'Workspaces carregados', error: 'Falha ao buscar workspaces' },
  switch_workspace: { running: 'Trocando workspace...', done: 'Workspace alterado', error: 'Falha ao trocar workspace' },
  get_workspace_members: { running: 'Buscando membros...', done: 'Membros carregados', error: 'Falha ao buscar membros' },
  list_channels: { running: 'Buscando canais...', done: 'Canais carregados', error: 'Falha ao buscar canais' },
  get_channel_messages: { running: 'Buscando mensagens do canal...', done: 'Mensagens carregadas', error: 'Falha ao buscar mensagens' },
  send_channel_message: { running: 'Enviando mensagem...', done: 'Mensagem enviada', error: 'Falha ao enviar mensagem' },
  list_channel_notes: { running: 'Buscando notas...', done: 'Notas carregadas', error: 'Falha ao buscar notas' },
  get_channel_note: { running: 'Buscando nota...', done: 'Nota carregada', error: 'Falha ao buscar nota' },
  create_channel: { running: 'Criando canal...', done: 'Canal criado', error: 'Falha ao criar canal' },
  mark_channel_read: { running: 'Marcando como lido...', done: 'Canal marcado como lido', error: 'Falha ao marcar' },
  // Planejamento Estratégico
  list_okrs: { running: 'Buscando OKRs...', done: 'OKRs carregados', error: 'Falha ao buscar OKRs' },
  list_swot: { running: 'Buscando análises SWOT...', done: 'SWOT carregado', error: 'Falha ao buscar SWOT' },

  list_teams: { running: 'Buscando equipes...', done: 'Equipes carregadas', error: 'Falha ao buscar equipes' },
  get_strategy_map: { running: 'Buscando mapa estratégico...', done: 'Mapa carregado', error: 'Falha ao buscar mapa' },
  // Skills
  list_skills: { running: 'Buscando skills...', done: 'Skills carregadas', error: 'Falha ao buscar skills' },
  create_skill: { running: 'Criando skill...', done: 'Skill criada', error: 'Falha ao criar skill' },
  update_skill: { running: 'Atualizando skill...', done: 'Skill atualizada', error: 'Falha ao atualizar skill' },
  delete_skill: { running: 'Excluindo skill...', done: 'Skill excluída', error: 'Falha ao excluir skill' },
  link_skill: { running: 'Vinculando skill...', done: 'Skill vinculada', error: 'Falha ao vincular skill' },
  unlink_skill: { running: 'Desvinculando skill...', done: 'Skill desvinculada', error: 'Falha ao desvincular skill' },
  // MCP Servers
  list_mcp_servers: { running: 'Buscando servidores MCP...', done: 'Servidores MCP carregados', error: 'Falha ao buscar servidores MCP' },
  create_mcp_server: { running: 'Criando servidor MCP...', done: 'Servidor MCP criado', error: 'Falha ao criar servidor MCP' },
  update_mcp_server: { running: 'Atualizando servidor MCP...', done: 'Servidor MCP atualizado', error: 'Falha ao atualizar servidor MCP' },
  delete_mcp_server: { running: 'Excluindo servidor MCP...', done: 'Servidor MCP excluído', error: 'Falha ao excluir servidor MCP' },
  link_mcp_server: { running: 'Vinculando servidor MCP...', done: 'Servidor MCP vinculado', error: 'Falha ao vincular servidor MCP' },
  unlink_mcp_server: { running: 'Desvinculando servidor MCP...', done: 'Servidor MCP desvinculado', error: 'Falha ao desvincular servidor MCP' },
  refresh_mcp_tools: { running: 'Atualizando ferramentas MCP...', done: 'Ferramentas MCP atualizadas', error: 'Falha ao atualizar ferramentas MCP' },
}

interface ActionResult {
  status: 'done' | 'error'
  createdAssistantId?: string
}

// Runs all actions in a message sequentially, passing context between them
function ActionSequence({ actions }: { actions: BaisyncAction[] }) {
  const { addAssistant, updateAssistant, deleteAssistant, fetchAssistants } = useAssistantStore()
  const [results, setResults] = useState<Map<number, { status: 'running' | 'done' | 'error'; label?: string }>>(new Map())
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrLabel, setQrLabel] = useState('')
  const executedRef = useRef(false)
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
  }, [])

  useEffect(() => {
    if (executedRef.current) return
    executedRef.current = true

    const runAll = async () => {
      // Context shared across sequential actions
      let createdAssistantId: string | null = null

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        setResults((prev) => new Map(prev).set(i, { status: 'running' }))

        try {
          const result = await executeAction(action, createdAssistantId)
          if (result.createdAssistantId) {
            createdAssistantId = result.createdAssistantId
          }
          setResults((prev) => new Map(prev).set(i, { status: result.status }))
          if (result.status === 'error') break
        } catch (err) {
          // Backend 4xx/5xx: surface the message to Sophie so she can retry
          // with corrected args instead of letting Next's dev overlay show it.
          if (err instanceof ApiError) {
            useBaisyncStore.getState().queueActionResult(
              `Erro ao executar ${action.action}: ${err.message} (HTTP ${err.status}). Revise os argumentos (IDs, nomes) e tente de novo.`,
            )
          } else {
            console.error('[baisync] action failed:', err)
          }
          setResults((prev) => new Map(prev).set(i, { status: 'error' }))
          break
        }
      }

      // Send all accumulated action results as one backend call so Sophie
      // gets a coherent summary instead of triggering a new round per action.
      await useBaisyncStore.getState().flushActionResults()
    }

    const isValidUUID = (id: string): boolean =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)

    const executeAction = async (action: BaisyncAction, contextAssistantId: string | null): Promise<ActionResult> => {

      // Resolves the target assistant ID for a tool call:
      //   1. A context ID from a prior create_assistant (if still in store)
      //   2. The dataId provided by Sophie, validated as UUID *and* existing
      //   3. A name-hint fallback (assistant_name / name fields Sophie sometimes
      //      passes instead of an ID)
      // Any failure sends a helpful message back to Sophie so she can retry
      // with the correct ID, instead of letting apiFetch throw a 404.
      const resolveAssistantId = (dataId?: string, nameHint?: string): string | null => {
        const assistants = useAssistantStore.getState().assistants

        if (contextAssistantId && assistants.find((a) => a.id === contextAssistantId)) {
          return contextAssistantId
        }

        if (dataId) {
          if (!isValidUUID(dataId)) {
            useBaisyncStore.getState().queueActionResult(
              `Erro: "${dataId}" não é um ID válido. Use o UUID real do assistente (listado em "Contexto do Usuário" ou via list_assistants).`,
            )
            return null
          }
          if (assistants.find((a) => a.id === dataId)) return dataId
        }

        if (nameHint) {
          const byName = assistants.find((a) => a.name === nameHint)
          if (byName) return byName.id
        }

        useBaisyncStore.getState().queueActionResult(
          dataId
            ? `Erro: assistente com id "${dataId}" não existe. Use list_assistants para ver os IDs atuais.`
            : 'Erro: nenhum assistente especificado. Use list_assistants para ver os IDs disponíveis.',
        )
        return null
      }
      if (action.action === 'create_assistant') {
        const data = action.data as {
          name: string; description?: string; llm_provider?: string
          model?: string; temperature?: number; max_tokens?: number; system_prompt?: string
        }
        const id = crypto.randomUUID()
        await addAssistant({
          id,
          name: data.name,
          description: data.description || '',
          llmProvider: (data.llm_provider || 'openai') as 'openai' | 'claude' | 'gemini',
          model: data.model || 'gpt-4o-mini',
          temperature: data.temperature ?? 0.7,
          maxTokens: data.max_tokens ?? 2048,
          systemPrompt: data.system_prompt || 'Você é um assistente útil.',
        })
        // Refresh assistants list so the new ID is available
        await fetchAssistants()
        // Find the real ID: get the most recently added assistant matching the name
        const assistants = useAssistantStore.getState().assistants
        const matches = assistants.filter((a) => a.name === data.name)
        const created = matches[matches.length - 1]
        return { status: 'done', createdAssistantId: created?.id || id }
      }

      if (action.action === 'update_assistant') {
        const data = action.data as {
          assistant_id?: string; assistant_name?: string; name?: string; description?: string
          system_prompt?: string; model?: string; temperature?: number; max_tokens?: number
        }
        const targetId = resolveAssistantId(data.assistant_id, data.assistant_name || data.name)
        if (!targetId) return { status: 'error' }
        const updates: Record<string, unknown> = {}
        if (data.name !== undefined) updates.name = data.name
        if (data.description !== undefined) updates.description = data.description
        if (data.system_prompt !== undefined) updates.systemPrompt = data.system_prompt
        if (data.model !== undefined) updates.model = data.model
        if (data.temperature !== undefined) updates.temperature = data.temperature
        if (data.max_tokens !== undefined) updates.maxTokens = data.max_tokens
        await updateAssistant(targetId, updates)
        return { status: 'done' }
      }

      if (action.action === 'delete_assistant') {
        const data = action.data as { assistant_id?: string; assistant_name?: string }
        const targetId = resolveAssistantId(data.assistant_id, data.assistant_name)
        if (!targetId) return { status: 'error' }
        await deleteAssistant(targetId)
        return { status: 'done' }
      }

      if (action.action === 'list_events') {
        const appointments = await apiFetch<{
          id: string; client_name: string; client_phone: string; date_time: string
          duration_minutes: number; appointment_type: string | null; status: string; notes: string | null
        }[]>('/api/appointments')
        const summary = appointments.length === 0
          ? 'Nenhum evento encontrado na agenda.'
          : appointments.map((a) =>
              `- **${a.client_name}** (id: ${a.id}) | ${a.date_time} | ${a.duration_minutes}min | ${a.status}${a.appointment_type ? ` | ${a.appointment_type}` : ''}${a.client_phone ? ` | tel: ${a.client_phone}` : ''}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'create_event') {
        const data = action.data as {
          client_name: string; client_phone?: string; date_time: string
          duration_minutes?: number; appointment_type?: string; notes?: string; assistant_id?: string
        }
        if (!data.client_name || !data.date_time) return { status: 'error' }
        await apiFetch('/api/appointments', {
          method: 'POST',
          body: JSON.stringify({
            client_name: data.client_name,
            client_phone: data.client_phone || '',
            date_time: data.date_time,
            duration_minutes: data.duration_minutes ?? 30,
            appointment_type: data.appointment_type || null,
            notes: data.notes || null,
            assistant_id: data.assistant_id || contextAssistantId || null,
            is_manual: false,
          }),
        })
        // Refresh calendar store if loaded
        useCalendarStore.getState().fetch()
        return { status: 'done' }
      }

      if (action.action === 'connect_whatsapp') {
        const data = action.data as { assistant_id: string; phone: string }
        const assistantId = resolveAssistantId(data.assistant_id)
        if (!assistantId || !data.phone) return { status: 'error' }

        setQrLabel('Criando integração...')
        let integrationId: string | null = null
        try {
          const existing = await apiFetch<{ id: string; channel: string; provider: string }[]>(
            `/api/assistants/${assistantId}/integrations`
          )
          const baileys = existing?.find((i) => i.channel === 'whatsapp' && i.provider === 'baileys')
          if (baileys) integrationId = baileys.id
        } catch { /* no existing */ }

        if (!integrationId) {
          const created = await apiFetch<{ id: string }>(
            `/api/assistants/${assistantId}/integrations`,
            { method: 'POST', body: JSON.stringify({ channel: 'whatsapp', provider: 'baileys', config_phone_number: data.phone }) }
          )
          integrationId = created.id
        }

        setQrLabel('Conectando ao WhatsApp...')
        await apiFetch(
          `/api/assistants/${assistantId}/integrations/${integrationId}/connect`,
          { method: 'POST' }
        )

        setQrLabel('Aguardando QR Code...')
        return new Promise<ActionResult>((resolve) => {
          let attempts = 0
          pollingRef.current = setInterval(async () => {
            attempts++
            try {
              const res = await apiFetch<{ status?: string; qr?: string }>(
                `/api/assistants/${assistantId}/integrations/${integrationId}/status`
              )
              if (res.qr) {
                setQrCode(res.qr)
                setQrLabel('Escaneie o QR Code com seu WhatsApp')
              }
              if (res.status === 'connected') {
                if (pollingRef.current) clearInterval(pollingRef.current)
                setQrCode(null)
                setQrLabel('')
                resolve({ status: 'done' })
              }
            } catch { /* ignore */ }
            if (attempts > 150) {
              if (pollingRef.current) clearInterval(pollingRef.current)
              resolve({ status: 'error' })
            }
          }, 4000)
        })
      }

      // ─── List Assistants ────────────────────────────────────────────────
      if (action.action === 'list_assistants') {
        await fetchAssistants()
        const assistants = useAssistantStore.getState().assistants
        const summary = assistants.length === 0
          ? 'Nenhum assistente configurado.'
          : assistants.map((a) =>
              `- **${a.name}** (id: ${a.id}) | ${a.llmProvider}/${a.model} | temp: ${a.temperature}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      // ─── Tools ──────────────────────────────────────────────────────────
      if (action.action === 'list_tools') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const tools = await apiFetch<{
          id: string; name: string; description: string | null; endpoint: string
          method: string; is_enabled: boolean; tool_type: string | null
        }[]>(`/api/assistants/${aid}/tools`)
        const summary = tools.length === 0
          ? 'Nenhuma ferramenta configurada neste assistente.'
          : tools.map((t) => {
              const type = t.tool_type || 'http_request'
              return `- **${t.name}** (id: ${t.id}, ${t.is_enabled ? 'ativo' : 'inativo'}, tipo: ${type}) | ${t.method} ${t.endpoint}`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'create_tool') {
        const data = action.data as {
          assistant_id: string; name: string; description?: string; endpoint?: string
          method?: string; schema_json?: string; headers_json?: string; tool_type?: string
        }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.name) return { status: 'error' }
        const toolType = data.tool_type || 'http_request'

        // Validate per tool type
        if (toolType === 'http_request' && !data.endpoint) return { status: 'error' }
        if (toolType === 'send_document' && !data.endpoint) return { status: 'error' }

        // Build payload — built-in tools (notify_human, send_document, schedule_appointment)
        // don't need schema/headers/method; backend generates schemas automatically
        const payload: Record<string, unknown> = {
          name: data.name,
          description: data.description || '',
          tool_type: toolType,
          is_enabled: true,
        }

        if (toolType === 'http_request') {
          payload.endpoint = data.endpoint
          payload.method = data.method || 'POST'
          payload.schema_json = data.schema_json || ''
          payload.headers_json = data.headers_json || ''
        } else if (toolType === 'send_document') {
          payload.endpoint = data.endpoint
        } else if (toolType === 'pix_payment') {
          payload.endpoint = data.endpoint || ''
          payload.headers_json = data.headers_json || ''
        } else if (toolType === 'card_payment') {
          payload.endpoint = ''
          payload.headers_json = data.headers_json || ''
        } else {
          // notify_human, schedule_appointment — no endpoint/schema needed
          payload.endpoint = ''
        }

        await apiFetch(`/api/assistants/${aid}/tools`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        return { status: 'done' }
      }

      if (action.action === 'update_tool') {
        const data = action.data as {
          assistant_id: string; tool_id: string; name?: string; description?: string
          endpoint?: string; method?: string; schema_json?: string; headers_json?: string; tool_type?: string
        }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.tool_id) return { status: 'error' }
        const body: Record<string, unknown> = {}
        if (data.name !== undefined) body.name = data.name
        if (data.description !== undefined) body.description = data.description
        if (data.endpoint !== undefined) body.endpoint = data.endpoint
        if (data.method !== undefined) body.method = data.method
        if (data.schema_json !== undefined) body.schema_json = data.schema_json
        if (data.headers_json !== undefined) body.headers_json = data.headers_json
        if (data.tool_type !== undefined) body.tool_type = data.tool_type
        await apiFetch(`/api/assistants/${aid}/tools/${data.tool_id}`, {
          method: 'PUT', body: JSON.stringify(body),
        })
        return { status: 'done' }
      }

      if (action.action === 'delete_tool') {
        const data = action.data as { assistant_id: string; tool_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.tool_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/tools/${data.tool_id}`, { method: 'DELETE' })
        return { status: 'done' }
      }

      if (action.action === 'toggle_tool') {
        const data = action.data as { assistant_id: string; tool_id: string; is_enabled: boolean }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.tool_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/tools/${data.tool_id}`, {
          method: 'PUT', body: JSON.stringify({ is_enabled: data.is_enabled }),
        })
        return { status: 'done' }
      }

      // ─── Integrations ──────────────────────────────────────────────────
      if (action.action === 'connect_meta') {
        const data = action.data as { assistant_id: string; phone_number_id: string; access_token: string; verify_token: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.phone_number_id || !data.access_token || !data.verify_token) return { status: 'error' }

        let integrationId: string | null = null
        try {
          const existing = await apiFetch<{ id: string; channel: string; provider: string }[]>(`/api/assistants/${aid}/integrations`)
          const meta = existing?.find((i) => i.channel === 'whatsapp' && i.provider === 'meta_official')
          if (meta) integrationId = meta.id
        } catch { /* no existing */ }

        if (!integrationId) {
          const created = await apiFetch<{ id: string }>(`/api/assistants/${aid}/integrations`, {
            method: 'POST',
            body: JSON.stringify({
              channel: 'whatsapp', provider: 'meta_official',
              config_phone_number: data.phone_number_id,
              config_token: data.access_token,
              config_webhook_verify_token: data.verify_token,
            }),
          })
          integrationId = created.id
        }

        await apiFetch(`/api/assistants/${aid}/integrations/${integrationId}/connect`, { method: 'POST' })
        return { status: 'done' }
      }

      if (action.action === 'connect_telegram') {
        const data = action.data as { assistant_id: string; bot_token: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.bot_token) return { status: 'error' }

        let integrationId: string | null = null
        try {
          const existing = await apiFetch<{ id: string; channel: string; provider: string }[]>(`/api/assistants/${aid}/integrations`)
          const tg = existing?.find((i) => i.channel === 'telegram' && i.provider === 'telegram')
          if (tg) integrationId = tg.id
        } catch { /* no existing */ }

        if (!integrationId) {
          const created = await apiFetch<{ id: string }>(`/api/assistants/${aid}/integrations`, {
            method: 'POST',
            body: JSON.stringify({ channel: 'telegram', provider: 'telegram', config_token: data.bot_token }),
          })
          integrationId = created.id
        }

        await apiFetch(`/api/assistants/${aid}/integrations/${integrationId}/connect`, { method: 'POST' })
        return { status: 'done' }
      }

      if (action.action === 'disconnect_integration') {
        const data = action.data as { assistant_id: string; integration_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.integration_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/integrations/${data.integration_id}/disconnect`, { method: 'POST' })
        return { status: 'done' }
      }

      if (action.action === 'list_integrations') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const integrations = await apiFetch<{
          id: string; channel: string; provider: string; status: string; config_phone_number: string | null
        }[]>(`/api/assistants/${aid}/integrations`)
        const summary = integrations.length === 0
          ? 'Nenhuma integração configurada neste assistente.'
          : integrations.map((i) =>
              `- **${i.channel}/${i.provider}** (id: ${i.id}) | status: ${i.status}${i.config_phone_number ? ` | tel: ${i.config_phone_number}` : ''}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      // ─── Conversations ─────────────────────────────────────────────────
      if (action.action === 'list_conversations') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const raw = await apiFetch<Record<string, unknown>[] | { items: Record<string, unknown>[] }>(`/api/assistants/${aid}/conversations`)
        const convs = Array.isArray(raw) ? raw : (raw.items || [])
        const summary = convs.length === 0
          ? 'Nenhuma conversa encontrada neste assistente.'
          : convs.map((c) => {
              const name = (c.contactName || 'Sem nome') as string
              const channel = (c.channel || '') as string
              const lastMsg = (c.lastMessage || '') as string
              const count = (c.messageCount || 0) as number
              const aiOn = c.aiEnabled !== false ? 'IA ligada' : 'IA desligada'
              const convId = (c.id || '') as string
              return `- **${name}** (${channel}, id: ${convId}) | ${count} msgs | ${aiOn} | Última: "${lastMsg.slice(0, 60)}"`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'list_messages') {
        const data = action.data as { assistant_id: string; conversation_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.conversation_id) return { status: 'error' }
        const rawMsgs = await apiFetch<Record<string, unknown>[] | { items: Record<string, unknown>[] }>(`/api/assistants/${aid}/conversations/${data.conversation_id}/messages`)
        const msgs = Array.isArray(rawMsgs) ? rawMsgs : (rawMsgs.items || [])
        const summary = msgs.length === 0
          ? 'Nenhuma mensagem nesta conversa.'
          : msgs.slice(-20).map((m) => {
              const sender = (m.sender || m.role || '?') as string
              const content = (m.content || '') as string
              return `**${sender}**: ${content.slice(0, 200)}`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'delete_conversation') {
        const data = action.data as { assistant_id: string; conversation_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.conversation_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/conversations/${data.conversation_id}`, { method: 'DELETE' })
        return { status: 'done' }
      }

      if (action.action === 'toggle_ai') {
        const data = action.data as { assistant_id: string; conversation_id: string; ai_enabled: boolean }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.conversation_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/conversations/${data.conversation_id}`, {
          method: 'PATCH', body: JSON.stringify({ aiEnabled: data.ai_enabled }),
        })
        return { status: 'done' }
      }

      if (action.action === 'summarize_conversation') {
        const data = action.data as { assistant_id: string; conversation_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.conversation_id) return { status: 'error' }
        const result = await apiFetch<{ summary?: string }>(`/api/assistants/${aid}/conversations/${data.conversation_id}/summary`, {
          method: 'POST', body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini' }),
        })
        useBaisyncStore.getState().queueActionResult(result.summary || 'Resumo não disponível.')
        return { status: 'done' }
      }

      // ─── Access Tokens ─────────────────────────────────────────────────
      if (action.action === 'list_access_tokens') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const tokens = await apiFetch<{
          id: string; name: string; permission_level: string; is_revoked: boolean
          email: string | null; expires_at: string | null; created_at: string
        }[]>(`/api/assistants/${aid}/access-tokens`)
        const summary = tokens.length === 0
          ? 'Nenhum token de acesso configurado.'
          : tokens.map((t) => {
              const revoked = t.is_revoked ? ' (revogado)' : ''
              const email = t.email ? ` | ${t.email}` : ''
              return `- **${t.name}** (id: ${t.id}) | ${t.permission_level}${revoked}${email}`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'create_access_token') {
        const data = action.data as { assistant_id: string; name: string; permission_level: string; email?: string; expires_in_days?: number }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.name || !data.permission_level) return { status: 'error' }
        const result = await apiFetch<{ token?: string }>(`/api/assistants/${aid}/access-tokens`, {
          method: 'POST',
          body: JSON.stringify({
            name: data.name, permission_level: data.permission_level,
            email: data.email || null, expires_in_days: data.expires_in_days || null,
          }),
        })
        if (result.token) {
          useBaisyncStore.getState().queueActionResult(`Token criado: \`${result.token}\``)
        }
        return { status: 'done' }
      }

      if (action.action === 'delete_access_token') {
        const data = action.data as { assistant_id: string; token_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.token_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/access-tokens/${data.token_id}`, { method: 'DELETE' })
        return { status: 'done' }
      }

      if (action.action === 'revoke_access_token') {
        const data = action.data as { assistant_id: string; token_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.token_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/access-tokens/${data.token_id}/revoke`, { method: 'PATCH' })
        return { status: 'done' }
      }

      // ─── Sharing ────────────────────────────────────────────────────────
      if (action.action === 'create_share_token') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const result = await apiFetch<{ token?: string }>(`/api/assistants/${aid}/share-token`, { method: 'POST', body: JSON.stringify({}) })
        if (result.token) {
          const shareUrl = `${window.location.origin}/shared/${result.token}`
          useBaisyncStore.getState().queueActionResult(`Link de compartilhamento criado: ${shareUrl}`)
        }
        return { status: 'done' }
      }

      if (action.action === 'get_share_token') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        try {
          const result = await apiFetch<{ token?: string }>(`/api/assistants/${aid}/share-token`)
          if (result.token) {
            const shareUrl = `${window.location.origin}/shared/${result.token}`
            useBaisyncStore.getState().queueActionResult(`Link de compartilhamento ativo: ${shareUrl}`)
          } else {
            useBaisyncStore.getState().queueActionResult('Nenhum link de compartilhamento ativo.')
          }
        } catch {
          useBaisyncStore.getState().queueActionResult('Nenhum link de compartilhamento ativo.')
        }
        return { status: 'done' }
      }

      if (action.action === 'revoke_share_token') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/share-token`, { method: 'DELETE' })
        return { status: 'done' }
      }

      // ─── Voices ─────────────────────────────────────────────────────────
      if (action.action === 'list_voices') {
        const data = action.data as { provider: string }
        const provider = data.provider || 'openai'
        let summary = ''
        if (provider === 'elevenlabs') {
          try {
            const voices = await apiFetch<{ voices?: { name: string; voice_id: string }[] }>('/api/elevenlabs/voices')
            const list = voices.voices || []
            summary = list.length === 0
              ? 'Nenhuma voz ElevenLabs disponível. Verifique se a API key está configurada.'
              : list.map((v) => `- **${v.name}** (id: ${v.voice_id})`).join('\n')
          } catch {
            summary = 'Não foi possível buscar vozes ElevenLabs. Verifique se a API key está configurada.'
          }
        } else {
          try {
            const voices = await apiFetch<{ voices?: { name: string; voice_id: string }[] }>('/api/openai/voices')
            const list = voices.voices || []
            summary = list.length === 0
              ? 'Nenhuma voz OpenAI disponível.'
              : list.map((v) => `- **${v.name}** (id: ${v.voice_id})`).join('\n')
          } catch {
            summary = 'Não foi possível buscar vozes OpenAI.'
          }
        }
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      // ─── Calendar: Update/Delete/Cancel ─────────────────────────────────
      if (action.action === 'update_event') {
        const data = action.data as { event_id: string; status?: string; date_time?: string; notes?: string; duration_minutes?: number; appointment_type?: string }
        if (!data.event_id) return { status: 'error' }
        const body: Record<string, unknown> = {}
        if (data.status !== undefined) body.status = data.status
        if (data.date_time !== undefined) body.date_time = data.date_time
        if (data.notes !== undefined) body.notes = data.notes
        if (data.duration_minutes !== undefined) body.duration_minutes = data.duration_minutes
        if (data.appointment_type !== undefined) body.appointment_type = data.appointment_type
        await apiFetch(`/api/appointments/${data.event_id}`, { method: 'PUT', body: JSON.stringify(body) })
        useCalendarStore.getState().fetch()
        return { status: 'done' }
      }

      if (action.action === 'delete_event') {
        const data = action.data as { event_id: string }
        if (!data.event_id) return { status: 'error' }
        await apiFetch(`/api/appointments/${data.event_id}`, { method: 'DELETE' })
        useCalendarStore.getState().fetch()
        return { status: 'done' }
      }

      if (action.action === 'cancel_event') {
        const data = action.data as { event_id: string }
        if (!data.event_id) return { status: 'error' }
        await apiFetch(`/api/appointments/${data.event_id}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) })
        useCalendarStore.getState().fetch()
        return { status: 'done' }
      }

      // ─── Availability ──────────────────────────────────────────────────
      if (action.action === 'get_availability') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        try {
          const avail = await apiFetch<{
            timezone: string; default_duration_minutes: number; buffer_minutes: number
            max_per_day: number; blocked_dates: string[]; schedule_json: string | null
          }>(`/api/assistants/${aid}/availability`)
          const blocked = avail.blocked_dates?.length ? avail.blocked_dates.join(', ') : 'Nenhuma'
          const summary = [
            `- **Timezone**: ${avail.timezone}`,
            `- **Duração padrão**: ${avail.default_duration_minutes} min`,
            `- **Buffer entre agendamentos**: ${avail.buffer_minutes} min`,
            `- **Máximo por dia**: ${avail.max_per_day}`,
            `- **Datas bloqueadas**: ${blocked}`,
          ].join('\n')
          useBaisyncStore.getState().queueActionResult(summary)
        } catch {
          useBaisyncStore.getState().queueActionResult('Nenhuma disponibilidade configurada para este assistente.')
        }
        return { status: 'done' }
      }

      if (action.action === 'set_availability') {
        const data = action.data as {
          assistant_id: string; timezone?: string; default_duration_minutes?: number
          buffer_minutes?: number; max_per_day?: number; schedule?: unknown
        }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const body: Record<string, unknown> = {}
        if (data.timezone !== undefined) body.timezone = data.timezone
        if (data.default_duration_minutes !== undefined) body.default_duration_minutes = data.default_duration_minutes
        if (data.buffer_minutes !== undefined) body.buffer_minutes = data.buffer_minutes
        if (data.max_per_day !== undefined) body.max_per_day = data.max_per_day
        if (data.schedule !== undefined) body.schedule = data.schedule
        await apiFetch(`/api/assistants/${aid}/availability`, { method: 'PUT', body: JSON.stringify(body) })
        return { status: 'done' }
      }

      if (action.action === 'get_available_slots') {
        const data = action.data as { assistant_id: string; date?: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const date = data.date || new Date().toISOString().split('T')[0]
        const slots = await apiFetch<string[]>(`/api/assistants/${aid}/availability/slots?date=${date}`)
        const summary = slots.length === 0
          ? `Nenhum horário disponível em ${date}.`
          : [`Horários disponíveis em **${date}**:`, ...slots.map((s) => `- ${s}`)].join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      // ─── Notifications ─────────────────────────────────────────────────
      if (action.action === 'list_notifications') {
        const notifs = await apiFetch<{
          id: string; notification_type: string; title: string; message: string; is_read: boolean; created_at: string
        }[]>('/api/notifications')
        const summary = notifs.length === 0
          ? 'Nenhuma notificação.'
          : notifs.slice(0, 20).map((n) => {
              const read = n.is_read ? '' : ' (nova)'
              return `- **${n.title}**${read} (id: ${n.id})\n  ${n.message}`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        useNotificationStore.getState().fetch()
        return { status: 'done' }
      }

      if (action.action === 'mark_notification_read') {
        const data = action.data as { notification_id: string }
        if (!data.notification_id) return { status: 'error' }
        await apiFetch(`/api/notifications/${data.notification_id}/read`, { method: 'POST' })
        useNotificationStore.getState().fetch()
        return { status: 'done' }
      }

      if (action.action === 'mark_all_notifications_read') {
        await apiFetch('/api/notifications/read-all', { method: 'POST' })
        useNotificationStore.getState().fetch()
        return { status: 'done' }
      }

      if (action.action === 'delete_notification') {
        const data = action.data as { notification_id: string }
        if (!data.notification_id) return { status: 'error' }
        await apiFetch(`/api/notifications/${data.notification_id}`, { method: 'DELETE' })
        useNotificationStore.getState().fetch()
        return { status: 'done' }
      }

      if (action.action === 'delete_all_notifications') {
        await apiFetch('/api/notifications', { method: 'DELETE' })
        useNotificationStore.getState().fetch()
        return { status: 'done' }
      }

      // ─── Financeiro ───────────────────────────────────────────────────
      if (action.action === 'financial_overview') {
        const overviews = await apiFetch<{
          assistantId: string; totalRevenue: number; totalCharges: number
          paidCount: number; unpaidCount: number; pendingCount: number
        }[]>('/api/user/financeiro/overview')
        if (overviews.length === 0) {
          useBaisyncStore.getState().queueActionResult('Nenhuma cobrança PIX encontrada em nenhum assistente.')
        } else {
          const lines = overviews.map(o => {
            const a = useAssistantStore.getState().assistants.find(a => a.id === o.assistantId)
            return `**${a?.name || o.assistantId}**: R$ ${o.totalRevenue.toFixed(2)} receita | ${o.totalCharges} cobranças (${o.paidCount} pagas, ${o.pendingCount} pendentes, ${o.unpaidCount} canceladas)`
          })
          useBaisyncStore.getState().queueActionResult(`Resumo financeiro:\n${lines.join('\n')}`)
        }
        return { status: 'done' }
      }

      if (action.action === 'financial_summary') {
        const data = action.data as { assistant_id?: string }
        const id = resolveAssistantId(data.assistant_id)
        if (!id) return { status: 'error' }
        const s = await apiFetch<{
          totalRevenue: number; totalCharges: number; paidCount: number; unpaidCount: number; pendingCount: number
        }>(`/api/assistants/${id}/financeiro/summary`)
        const a = useAssistantStore.getState().assistants.find(a => a.id === id)
        useBaisyncStore.getState().queueActionResult(
          `Financeiro de **${a?.name || id}**:\n- Receita: R$ ${s.totalRevenue.toFixed(2)}\n- Total cobranças: ${s.totalCharges}\n- Pagas: ${s.paidCount}\n- Pendentes: ${s.pendingCount}\n- Canceladas/Expiradas: ${s.unpaidCount}`
        )
        return { status: 'done' }
      }

      if (action.action === 'list_charges') {
        const data = action.data as { assistant_id?: string; limit?: number }
        const id = resolveAssistantId(data.assistant_id)
        if (!id) return { status: 'error' }
        const limit = data.limit || 50
        const rawCharges = await apiFetch<{
          items?: { id: string; amount: number; status: string; description: string
            contactPhone: string; createdAt: string; customerName?: string; customerCpf?: string; pixMode?: string }[]
        } | { id: string; amount: number; status: string; description: string
          contactPhone: string; createdAt: string; customerName?: string; customerCpf?: string; pixMode?: string }[]>(`/api/assistants/${id}/financeiro/charges?limit=${limit}`)
        const charges = Array.isArray(rawCharges) ? rawCharges : (rawCharges.items || [])
        if (charges.length === 0) {
          useBaisyncStore.getState().queueActionResult('Nenhuma cobrança encontrada para este assistente.')
        } else {
          const statusMap: Record<string, string> = { approved: 'Pago', pending: 'Pendente', cancelled: 'Cancelado', refunded: 'Estornado' }
          const lines = charges.map(c => {
            const date = new Date(c.createdAt).toLocaleDateString('pt-BR')
            const name = c.customerName || '--'
            const st = statusMap[c.status] || c.status
            const mode = c.pixMode === 'mercadopago' ? 'MP' : 'Direto'
            return `${date} | R$ ${c.amount.toFixed(2)} | ${st} | ${mode} | ${name} | ${c.description}`
          })
          useBaisyncStore.getState().queueActionResult(`Cobranças (${charges.length}):\nData | Valor | Status | Modo | Cliente | Descrição\n${lines.join('\n')}`)
        }
        return { status: 'done' }
      }

      // ─── Analytics ─────────────────────────────────────────────────────
      if (action.action === 'get_usage') {
        const days = await apiFetch<{ date: string; requests: number; tokens: number }[]>('/api/user/usage?days=30')
        if (days.length === 0) {
          useBaisyncStore.getState().queueActionResult('Nenhum dado de uso encontrado nos últimos 30 dias.')
        } else {
          const totalTokens = days.reduce((s, d) => s + d.tokens, 0)
          const totalReqs = days.reduce((s, d) => s + d.requests, 0)
          const recent = days.slice(-7).map((d) =>
            `  - ${d.date}: ${d.requests} reqs, ${d.tokens} tokens`
          ).join('\n')
          const summary = [
            `- **Total de tokens (30 dias)**: ${totalTokens}`,
            `- **Total de requisições (30 dias)**: ${totalReqs}`,
            `- **Últimos 7 dias**:\n${recent}`,
          ].join('\n')
          useBaisyncStore.getState().queueActionResult(summary)
        }
        return { status: 'done' }
      }

      if (action.action === 'get_assistant_stats') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const stats = await apiFetch<{
          total_tokens: number; total_messages: number; sparkline: number[]
          last_interaction_at: string | null; channel_breakdown: { channel: string; count: number }[]
        }>(`/api/assistants/${aid}/stats`)
        const channels = stats.channel_breakdown?.length
          ? stats.channel_breakdown.map((ch) => `${ch.channel}: ${ch.count}`).join(', ')
          : 'Nenhum'
        const summary = [
          `- **Total de tokens**: ${stats.total_tokens}`,
          `- **Total de mensagens**: ${stats.total_messages}`,
          `- **Última interação**: ${stats.last_interaction_at || 'Nenhuma'}`,
          `- **Canais**: ${channels}`,
        ].join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'get_assistant_logs') {
        const data = action.data as { assistant_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid) return { status: 'error' }
        const rawLogs = await apiFetch<{
          items?: { id: string; tool_name: string; arguments: string | null
            status_code: number | null; error: string | null; duration_ms: number; called_at: string }[]
        } | { id: string; tool_name: string; arguments: string | null
          status_code: number | null; error: string | null; duration_ms: number; called_at: string }[]>(`/api/assistants/${aid}/logs?limit=15`)
        const logs = Array.isArray(rawLogs) ? rawLogs : (rawLogs.items || [])
        const summary = logs.length === 0
          ? 'Nenhum log de ferramenta encontrado.'
          : logs.map((l) => {
              const status = l.error ? `erro: ${l.error.slice(0, 50)}` : `status: ${l.status_code || '?'}`
              return `- [${l.called_at}] **${l.tool_name}** | ${status} | ${l.duration_ms}ms`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'get_activity') {
        const activity = await apiFetch<{
          event_type: string; description: string; assistant_id: string; assistant_name: string; timestamp: string
        }[]>('/api/user/activity?limit=15')
        const summary = activity.length === 0
          ? 'Nenhuma atividade recente.'
          : activity.map((a) =>
              `- [${a.timestamp}] **${a.event_type}** (${a.assistant_name}): ${a.description.slice(0, 100)}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      // ─── Observabilidade (Sophie self-introspection — S1.3) ─────────────
      if (action.action === 'get_my_recent_errors') {
        const res = await apiFetch<{
          errors: { id: string; assistant_id: string; conversation_id: string | null
            provider: string; model: string; error: string; created_at: string
            duration_ms: number | null; tool_rounds: number | null }[]
          count: number
        }>('/api/baisync/actions/my_recent_errors')
        const summary = res.count === 0
          ? 'Nenhum erro registrado em chamadas LLM recentes.'
          : [
              `Últimos ${res.count} erros:`,
              ...res.errors.map((e) => {
                const msg = e.error.length > 200 ? `${e.error.slice(0, 200)}...` : e.error
                return `- [${e.provider}/${e.model}] ${msg} (${e.created_at})`
              }),
            ].join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'get_platform_health') {
        const res = await apiFetch<{
          circuit_breaker_state: { provider: string; open: boolean; fail_count_last_60s: number }[]
          baisync_rate_limit_usage: { used: number; limit: number; reset_at: string }
          usage_quota: { total_messages: number; total_tokens: number }
        }>('/api/baisync/actions/platform_health')
        const cbLines = res.circuit_breaker_state.map((s) => {
          const label = s.open ? '**aberto**' : 'ok'
          return `- ${s.provider}: ${label} (${s.fail_count_last_60s} falhas em 60s)`
        })
        const rl = res.baisync_rate_limit_usage
        const pct = rl.limit > 0 ? Math.round((rl.used / rl.limit) * 100) : 0
        const q = res.usage_quota
        const summary = [
          '## Circuit Breakers',
          ...cbLines,
          '',
          '## Rate Limit Sophie',
          `Usado: ${rl.used}/${rl.limit} (${pct}%) — reset em ${rl.reset_at}`,
          '',
          '## Cota Geral',
          `Mensagens: ${q.total_messages}`,
          `Tokens: ${q.total_tokens}`,
        ].join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      // ─── Workspaces e Canais ────────────────────────────────────────────

      const resolveWorkspaceId = (wsId?: string): string | null => {
        const id = wsId || useWorkspaceStore.getState().activeWorkspace?.workspace_id
        if (!id) {
          useBaisyncStore.getState().queueActionResult('Erro: nenhum workspace ativo encontrado.')
          return null
        }
        return id
      }

      if (action.action === 'list_workspaces') {
        const res = await apiFetch<{
          workspaces: { workspace_id: string; workspace_name: string; workspace_type: string; role: string }[]
          active_workspace_id: string
        }>('/api/workspaces')
        const summary = res.workspaces.length === 0
          ? 'Nenhum workspace encontrado.'
          : res.workspaces.map((w) => {
              const active = w.workspace_id === res.active_workspace_id ? ' <- ativo' : ''
              return `- **${w.workspace_name}** (id: ${w.workspace_id}, tipo: ${w.workspace_type}, role: ${w.role})${active}`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'switch_workspace') {
        const data = action.data as { workspace_id: string }
        if (!data.workspace_id) return { status: 'error' }
        await useWorkspaceStore.getState().switchWorkspace(data.workspace_id)
        useBaisyncStore.getState().queueActionResult(`Workspace alterado para ${data.workspace_id}. A página será recarregada.`)
        return { status: 'done' }
      }

      if (action.action === 'get_workspace_members') {
        const data = action.data as { workspace_id: string }
        if (!data.workspace_id) return { status: 'error' }
        const res = await apiFetch<{
          members: { user_id: string; role: string; user_name: string | null; user_email: string | null }[]
        }>(`/api/workspaces/${data.workspace_id}/members`)
        const members = res.members || []
        const summary = members.length === 0
          ? 'Nenhum membro encontrado.'
          : members.map((m) =>
              `- **${m.user_name || 'Sem nome'}** (${m.user_email || 'sem email'}) | role: ${m.role} | id: ${m.user_id}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'list_channels') {
        const data = action.data as { workspace_id?: string }
        const wsId = resolveWorkspaceId(data.workspace_id)
        if (!wsId) return { status: 'error' }
        const res = await apiFetch<{
          channels: { id: string; name: string; channel_type: string; description: string | null; unread_count: number }[]
        }>(`/api/workspaces/${wsId}/channels`)
        const channels = res.channels || []
        const summary = channels.length === 0
          ? 'Nenhum canal encontrado neste workspace.'
          : channels.map((c) => {
              const prefix = c.channel_type === 'dm' ? '' : '#'
              return `- ${prefix}**${c.name}** (id: ${c.id}, tipo: ${c.channel_type}, ${c.unread_count} não lidas)${c.description ? ` — ${c.description}` : ''}`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'get_channel_messages') {
        const data = action.data as { channel_id: string; limit?: number }
        if (!data.channel_id) return { status: 'error' }
        const limit = data.limit || 20
        const res = await apiFetch<{
          messages: { sender_name: string; content: string; created_at: string; message_type: string }[]
        }>(`/api/channels/${data.channel_id}/messages?limit=${limit}`)
        const msgs = res.messages || []
        const summary = msgs.length === 0
          ? 'Nenhuma mensagem encontrada neste canal.'
          : msgs.reverse().map((m) =>
              `- **${m.sender_name}** (${m.created_at}): ${m.content.slice(0, 200)}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'send_channel_message') {
        const data = action.data as { channel_id: string; content: string }
        if (!data.channel_id || !data.content) return { status: 'error' }
        await apiFetch(`/api/channels/${data.channel_id}/messages`, {
          method: 'POST',
          body: JSON.stringify({ content: data.content }),
        })
        useBaisyncStore.getState().queueActionResult('Mensagem enviada com sucesso.')
        return { status: 'done' }
      }

      if (action.action === 'list_channel_notes') {
        const data = action.data as { channel_id: string }
        if (!data.channel_id) return { status: 'error' }
        const res = await apiFetch<{
          notes: { id: string; title: string; created_at: string; updated_at: string }[]
        }>(`/api/channels/${data.channel_id}/notes`)
        const notes = res.notes || []
        const summary = notes.length === 0
          ? 'Nenhuma nota encontrada neste canal.'
          : notes.map((n) =>
              `- **${n.title}** (id: ${n.id}) | criada: ${n.created_at} | atualizada: ${n.updated_at}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'get_channel_note') {
        const data = action.data as { channel_id: string; note_id: string }
        if (!data.channel_id || !data.note_id) return { status: 'error' }
        const res = await apiFetch<{
          note: { id: string; title: string; content: string; created_at: string; updated_at: string }
        }>(`/api/channels/${data.channel_id}/notes/${data.note_id}`)
        const note = res.note
        const summary = `**${note.title}**\n\n${note.content || '(sem conteúdo)'}\n\n_Criada: ${note.created_at} | Atualizada: ${note.updated_at}_`
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'create_channel') {
        const data = action.data as { workspace_id?: string; name: string; description?: string; channel_type?: string }
        const wsId = resolveWorkspaceId(data.workspace_id)
        if (!wsId || !data.name) return { status: 'error' }
        const res = await apiFetch<{ channel: { id: string; name: string } }>(`/api/workspaces/${wsId}/channels`, {
          method: 'POST',
          body: JSON.stringify({
            name: data.name,
            description: data.description || null,
            channel_type: data.channel_type || 'public',
          }),
        })
        useBaisyncStore.getState().queueActionResult(`Canal #${res.channel.name} criado com sucesso (id: ${res.channel.id}).`)
        return { status: 'done' }
      }

      if (action.action === 'mark_channel_read') {
        const data = action.data as { channel_id: string }
        if (!data.channel_id) return { status: 'error' }
        await apiFetch(`/api/channels/${data.channel_id}/read`, { method: 'POST' })
        useBaisyncStore.getState().queueActionResult('Canal marcado como lido.')
        return { status: 'done' }
      }

      // ─── Strategic Planning Actions ───
      const strategicListActions: Record<string, { endpoint: string; resultKey: string; formatItem: (item: Record<string, unknown>) => string }> = {
        list_okrs: { endpoint: 'okrs', resultKey: 'objectives', formatItem: (o) => `- **${o.title}** (${o.objective_type || 'committed'}) — progresso: ${o.progress ?? 0}%` },
        list_swot: { endpoint: 'swot', resultKey: 'analyses', formatItem: (a) => `- **${a.title}** (id: ${a.id})` },

        list_teams: { endpoint: 'teams', resultKey: 'teams', formatItem: (t) => `- **${t.name}** (id: ${t.id})${t.description ? ` — ${t.description}` : ''}` },
      }

      if (strategicListActions[action.action]) {
        const data = action.data as { workspace_id: string }
        const wsId = data.workspace_id || useWorkspaceStore.getState().activeWorkspace?.workspace_id
        if (!wsId) { useBaisyncStore.getState().queueActionResult('Erro: workspace_id necessário.'); return { status: 'error' } }
        const cfg = strategicListActions[action.action]
        const res = await apiFetch<Record<string, unknown[]>>(`/api/workspaces/${wsId}/${cfg.endpoint}`)
        const items = res[cfg.resultKey] || Object.values(res).find(Array.isArray) || []
        if (items.length === 0) {
          useBaisyncStore.getState().queueActionResult(`Nenhum item encontrado em ${cfg.endpoint}.`)
        } else {
          const formatted = items.map((item) => cfg.formatItem(item as Record<string, unknown>)).join('\n')
          useBaisyncStore.getState().queueActionResult(`${items.length} item(ns) encontrado(s):\n${formatted}`)
        }
        return { status: 'done' }
      }

      if (action.action === 'get_strategy_map') {
        const data = action.data as { workspace_id: string }
        const wsId = data.workspace_id || useWorkspaceStore.getState().activeWorkspace?.workspace_id
        if (!wsId) { useBaisyncStore.getState().queueActionResult('Erro: workspace_id necessário.'); return { status: 'error' } }
        const res = await apiFetch<{ nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] }>(`/api/workspaces/${wsId}/strategy-map`)
        useBaisyncStore.getState().queueActionResult(`Mapa estratégico: ${res.nodes?.length || 0} nós, ${res.edges?.length || 0} conexões.${res.nodes?.length ? '\nNós:\n' + res.nodes.map((n) => `- [${n.node_type}] ${n.label}`).join('\n') : ''}`)
        return { status: 'done' }
      }

      // ─── Skills ────────────────────────────────────────────────────────

      if (action.action === 'list_skills') {
        const skills = await apiFetch<{
          id: string; name: string; slug: string; description: string; instructions: string
        }[]>('/api/skills')
        const summary = skills.length === 0
          ? 'Nenhuma skill configurada neste workspace.'
          : skills.map((s) =>
              `- **${s.name}** (id: ${s.id}, slug: ${s.slug})\n  ${s.description}`
            ).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'create_skill') {
        const data = action.data as { name: string; description: string; instructions: string }
        if (!data.name || !data.description || !data.instructions) return { status: 'error' }
        const skill = await apiFetch<{ id: string; name: string; slug: string }>('/api/skills', {
          method: 'POST',
          body: JSON.stringify({ name: data.name, description: data.description, instructions: data.instructions }),
        })
        useBaisyncStore.getState().queueActionResult(`Skill **${skill.name}** criada (id: ${skill.id}, slug: ${skill.slug}).`)
        return { status: 'done' }
      }

      if (action.action === 'update_skill') {
        const data = action.data as { skill_id: string; name?: string; description?: string; instructions?: string }
        if (!data.skill_id) return { status: 'error' }
        const body: Record<string, unknown> = {}
        if (data.name !== undefined) body.name = data.name
        if (data.description !== undefined) body.description = data.description
        if (data.instructions !== undefined) body.instructions = data.instructions
        await apiFetch(`/api/skills/${data.skill_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        return { status: 'done' }
      }

      if (action.action === 'delete_skill') {
        const data = action.data as { skill_id: string }
        if (!data.skill_id) return { status: 'error' }
        await apiFetch(`/api/skills/${data.skill_id}`, { method: 'DELETE' })
        return { status: 'done' }
      }

      if (action.action === 'link_skill') {
        const data = action.data as { assistant_id: string; skill_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.skill_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/skills/${data.skill_id}`, { method: 'POST' })
        return { status: 'done' }
      }

      if (action.action === 'unlink_skill') {
        const data = action.data as { assistant_id: string; skill_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.skill_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/skills/${data.skill_id}`, { method: 'DELETE' })
        return { status: 'done' }
      }

      // ─── MCP Servers ────────────────────────────────────────────────────

      if (action.action === 'list_mcp_servers') {
        const servers = await apiFetch<{
          id: string; name: string; slug: string; url: string; transport: string
          has_auth_header: boolean; tools_count: number | null; last_error: string | null
        }[]>('/api/mcp-servers')
        const summary = servers.length === 0
          ? 'Nenhum servidor MCP configurado neste workspace.'
          : servers.map((s) => {
              const auth = s.has_auth_header ? ' [auth]' : ''
              const tools = s.tools_count !== null ? `, ${s.tools_count} tools` : ''
              const err = s.last_error ? ` ⚠ ${s.last_error.slice(0, 60)}` : ''
              return `- **${s.name}** (id: ${s.id}, ${s.transport}${auth}${tools})\n  ${s.url}${err}`
            }).join('\n')
        useBaisyncStore.getState().queueActionResult(summary)
        return { status: 'done' }
      }

      if (action.action === 'create_mcp_server') {
        const data = action.data as {
          name: string; url: string; transport: string
          auth_header_name?: string; auth_header_value?: string
        }
        if (!data.name || !data.url || !data.transport) return { status: 'error' }
        const server = await apiFetch<{ id: string; name: string; slug: string }>('/api/mcp-servers', {
          method: 'POST',
          body: JSON.stringify({
            name: data.name, url: data.url, transport: data.transport,
            auth_header_name: data.auth_header_name || null,
            auth_header_value: data.auth_header_value || null,
          }),
        })
        useBaisyncStore.getState().queueActionResult(`Servidor MCP **${server.name}** criado (id: ${server.id}).`)
        return { status: 'done' }
      }

      if (action.action === 'update_mcp_server') {
        const data = action.data as {
          server_id: string; name?: string; url?: string; transport?: string
          auth_header_name?: string; auth_header_value?: string
        }
        if (!data.server_id) return { status: 'error' }
        const body: Record<string, unknown> = {}
        if (data.name !== undefined) body.name = data.name
        if (data.url !== undefined) body.url = data.url
        if (data.transport !== undefined) body.transport = data.transport
        if (data.auth_header_name !== undefined) body.auth_header_name = data.auth_header_name
        if (data.auth_header_value !== undefined) body.auth_header_value = data.auth_header_value
        await apiFetch(`/api/mcp-servers/${data.server_id}`, { method: 'PATCH', body: JSON.stringify(body) })
        return { status: 'done' }
      }

      if (action.action === 'delete_mcp_server') {
        const data = action.data as { server_id: string }
        if (!data.server_id) return { status: 'error' }
        await apiFetch(`/api/mcp-servers/${data.server_id}`, { method: 'DELETE' })
        return { status: 'done' }
      }

      if (action.action === 'link_mcp_server') {
        const data = action.data as { assistant_id: string; server_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.server_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/mcp-servers/${data.server_id}`, { method: 'POST' })
        return { status: 'done' }
      }

      if (action.action === 'unlink_mcp_server') {
        const data = action.data as { assistant_id: string; server_id: string }
        const aid = resolveAssistantId(data.assistant_id)
        if (!aid || !data.server_id) return { status: 'error' }
        await apiFetch(`/api/assistants/${aid}/mcp-servers/${data.server_id}`, { method: 'DELETE' })
        return { status: 'done' }
      }

      if (action.action === 'refresh_mcp_tools') {
        const data = action.data as { server_id: string }
        if (!data.server_id) return { status: 'error' }
        const res = await apiFetch<{ tools_count: number }>(`/api/mcp-servers/${data.server_id}/refresh-tools`, { method: 'POST' })
        useBaisyncStore.getState().queueActionResult(`Ferramentas MCP atualizadas: ${res.tools_count} tools encontradas.`)
        return { status: 'done' }
      }

      return { status: 'done' }
    }

    runAll().then(() => {
      // Strip actions from runtime state so panel toggle doesn't re-execute
      const store = useBaisyncStore.getState()
      useBaisyncStore.setState({
        messages: store.messages.map((m) => m.actions ? { ...m, actions: undefined } : m),
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-2">
      {actions.map((action, i) => {
        const result = results.get(i)
        const labels = ACTION_LABELS[action.action] || { running: 'Executando...', done: 'Concluído', error: 'Erro' }
        const isWhatsApp = action.action === 'connect_whatsapp'

        if (!result) {
          return (
            <div key={i} className="px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-subtle">{labels.running.replace('...', '')}</span>
            </div>
          )
        }

        return (
          <div key={i} className="px-3 py-2 rounded-xl text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', animation: 'baisync-msg-in 0.2s ease-out' }}>
            <div className="flex items-center gap-2">
              {result.status === 'running' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#ff6b2c' }} />
                  <span className="text-subtle">{(isWhatsApp && qrLabel) || labels.running}</span>
                </>
              )}
              {result.status === 'done' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-emerald-400">{labels.done}</span>
                </>
              )}
              {result.status === 'error' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  <span className="text-red-400">{labels.error}</span>
                </>
              )}
            </div>
          </div>
        )
      })}
      {qrCode && (
        <div className="rounded-xl p-4 flex flex-col items-center gap-3" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(8px)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrCode} alt="QR Code WhatsApp" className="w-48 h-48 rounded-lg" />
          <p className="text-xs text-subtle text-center">Escaneie com o WhatsApp do número informado</p>
        </div>
      )}
    </div>
  )
}

export function BaisyncMessageComponent({ message }: MessageProps) {
  if (message.role === 'status') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 10,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          animation: 'baisync-msg-in 0.2s ease-out',
        }}
      >
        <span style={{ color: '#ff7a1a', fontSize: 13, flexShrink: 0 }}>&gt;</span>
        <ThinkingAnimation />
      </div>
    )
  }

  if (message.role === 'user') {
    const hasAttachments = message.attachments && message.attachments.length > 0
    return (
      <div
        className="flex flex-col"
        style={{
          animation: 'baisync-msg-in 0.2s ease-out',
          gap: 4,
          marginBottom: 10,
          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
          fontSize: 13,
          lineHeight: 1.6,
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        <div>
          <span style={{ color: '#6b6b72' }}>$ </span>
          <span style={{ color: '#e6e6e6' }}>{message.content}</span>
        </div>
        {hasAttachments && (
          <div className="flex flex-wrap" style={{ gap: 6, paddingLeft: 14 }}>
            {message.attachments!.map((att: BaisyncAttachment, i: number) =>
              att.mime_type.startsWith('image/') && att.data_base64 ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={i}
                  src={`data:${att.mime_type};base64,${att.data_base64}`}
                  alt={att.name}
                  style={{ maxWidth: 160, maxHeight: 120, borderRadius: 4, border: '0.5px solid #2a2a30' }}
                />
              ) : (
                <span
                  key={i}
                  className="flex items-center"
                  style={{
                    gap: 4,
                    padding: '2px 6px',
                    fontSize: 11,
                    color: '#b5b5bc',
                    background: '#111114',
                    border: '0.5px solid #2a2a30',
                    borderRadius: 4,
                  }}
                >
                  <span style={{ color: '#ff7a1a' }}>📎</span>
                  <span className="truncate" style={{ maxWidth: 120 }}>{att.name}</span>
                </span>
              )
            )}
          </div>
        )}
      </div>
    )
  }

  // Assistant message
  const cleanText = stripBaisyncBlocks(message.content)
  return (
    <div
      className="flex flex-col"
      style={{
        animation: 'baisync-msg-in 0.25s ease-out',
        gap: 6,
        marginBottom: 10,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.6,
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
      }}
    >
      {cleanText && (
        <div style={{ display: 'flex', gap: 6, color: '#e6e6e6' }}>
          <span style={{ color: '#ff7a1a', flexShrink: 0 }}>&gt;</span>
          <div style={{ flex: 1, minWidth: 0 }}>{renderMarkdown(cleanText)}</div>
        </div>
      )}

      {/* UI Blocks */}
      {message.uiBlocks?.map((block: BaisyncUIBlock, i: number) => (
        <BaisyncUIBlockRenderer key={i} block={block} />
      ))}

      {/* Actions — auto-execute sequentially */}
      {message.actions && message.actions.length > 0 && (
        <ActionSequence actions={message.actions} />
      )}
    </div>
  )
}

// Typing indicator with bouncing dots
export function TypingIndicator() {
  return (
    <div className="flex justify-start" style={{ animation: 'baisync-msg-in 0.2s ease-out' }}>
      <div
        className="px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-1.5"
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: '#ff6b2c',
              animation: `baisync-bounce-dot 1.2s ease-in-out ${i * 0.15}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

// Streaming content display — terminal "> ..." with blinking caret
export function StreamingMessage({ content }: { content: string }) {
  const cleaned = stripBaisyncBlocks(content)
  if (!cleaned) return null

  return (
    <div
      style={{
        display: 'flex',
        gap: 6,
        marginBottom: 10,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        lineHeight: 1.6,
        color: '#e6e6e6',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        animation: 'baisync-msg-in 0.2s ease-out',
      }}
    >
      <span style={{ color: '#ff7a1a', flexShrink: 0 }}>&gt;</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {renderMarkdown(cleaned)}
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 14,
            marginLeft: 2,
            verticalAlign: 'text-bottom',
            background: '#ff7a1a',
            animation: 'baisync-caret-blink 1s step-end infinite',
          }}
        />
      </div>
    </div>
  )
}
