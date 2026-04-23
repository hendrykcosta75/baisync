'use client'

import React, { useState, useEffect, useRef } from 'react'
import type { BaisyncMessage, BaisyncUIBlock, BaisyncAction, BaisyncAttachment } from '@/store/useBaisyncStore'
import { BaisyncUIBlockRenderer } from './baisync-ui-blocks'
import { useBaisyncStore } from '@/store/useBaisyncStore'
import { executeBaisyncAction } from '@/lib/baisync-actions'
import { ApiError } from '@/lib/api'

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
  tirar_print: { running: 'Capturando tela...', done: 'Screenshot enviado', error: 'Falha ao capturar tela' },
}

// Runs all actions in a message sequentially, passing context between them
function ActionSequence({ actions }: { actions: BaisyncAction[] }) {
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
      const allAttachments: BaisyncAttachment[] = []

      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        setResults((prev) => new Map(prev).set(i, { status: 'running' }))

        try {
          const result = await executeBaisyncAction(action, {
            contextAssistantId: createdAssistantId,
            setQrCode,
            setQrLabel,
            pollingRef,
          })
          if (result.createdAssistantId) {
            createdAssistantId = result.createdAssistantId
          }
          if (result.attachments?.length) {
            allAttachments.push(...result.attachments)
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
      await useBaisyncStore.getState().flushActionResults(
        allAttachments.length > 0 ? allAttachments : undefined
      )
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
