'use client'

import React, { useEffect, useRef, useState } from 'react'
import { X, FileText, Image as ImageIcon } from 'lucide-react'
import { useBaisyncStore, type BaisyncAttachment } from '@/store/useBaisyncStore'
import { useAuthStore } from '@/store/useAuthStore'
import { BaisyncMessageComponent, StreamingMessage, ThinkingAnimation } from './baisync-message'
import { PixelGirl } from './pixel-girl'
import { usePixelAudio } from './pixel-visualizer'

const SKILLS = [
  {
    name: 'criar_atendente',
    label: 'Criar Atendente de IA',
    file: 'criar_atendente_ia.sh',
    comment: '# configure um assistente para seu negócio',
  },
  {
    name: 'sobre_plataforma',
    label: 'Sobre a Plataforma',
    file: 'sobre_plataforma.md',
    comment: '# recursos e funcionalidades disponíveis',
  },
]

const QUICK_QUESTIONS = [
  'como configurar meu primeiro assistente',
  'quais integrações estão disponíveis',
  'como funciona a base de conhecimento',
]

type SlashCommand = {
  name: string
  desc: string
  kind: 'local' | 'ai'
}

const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/help',         desc: 'lista comandos disponíveis',     kind: 'local' },
  { name: '/clear',        desc: 'limpar conversa',                kind: 'local' },
  { name: '/whoami',       desc: 'exibir info do usuário',         kind: 'local' },
  { name: '/status',       desc: 'status da conta / rate limit',   kind: 'local' },
  { name: '/usage',        desc: 'tokens consumidos nesta hora',   kind: 'local' },
  { name: '/assistants',   desc: 'listar meus assistentes',        kind: 'ai'    },
  { name: '/new',          desc: 'criar novo assistente',          kind: 'ai'    },
  { name: '/integrations', desc: 'ver integrações disponíveis',    kind: 'ai'    },
  { name: '/docs',         desc: 'sobre a plataforma',             kind: 'ai'    },
]

export function BaisyncPanel() {
  const {
    isOpen,
    close,
    messages,
    isStreaming,
    streamingContent,
    sendMessage,
    clearMessages,
    fetchRateLimit,
    rateLimit,
    activeSkill,
    setActiveSkill,
    pushLocalMessage,
    appendLiveTranscript,
    hydrate,
    hydrated,
    ralphEnabled,
    toggleRalph,
    inRalphMode,
  } = useBaisyncStore()

  const { user } = useAuthStore()
  const [input, setInput] = useState('')
  const [commandIdx, setCommandIdx] = useState(0)
  const [recording, setRecording] = useState(false)
  const [recordStart, setRecordStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [liveError, setLiveError] = useState<string | null>(null)
  const { levels, peak, source: audioSource, error: audioError } = usePixelAudio({ enabled: recording && liveStatus !== 'connected' })

  // Live voice session refs — populated by startLiveSession
  const audioCtxRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const playbackEndRef = useRef(0)

  // Terminal caret overlay state
  const [selEnd, setSelEnd] = useState(0)
  const [caretPos, setCaretPos] = useState({ x: 0, y: 0 })
  const [isTyping, setIsTyping] = useState(false)
  const caretMarkerRef = useRef<HTMLSpanElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const cmdListRef = useRef<HTMLDivElement>(null)

  // Measure cursor position (x, y) whenever input or selection changes.
  // A full mirror div wraps the text the same as the textarea with an
  // inline marker at the cursor position — offsetLeft/offsetTop on that
  // marker tell us where to draw the block caret. Y is clamped to the
  // textarea's actual height because Chrome keeps the caret on the
  // current line for trailing whitespace even though CSS pre-wrap would
  // push it to the next line in our mirror.
  useEffect(() => {
    if (!caretMarkerRef.current) return
    const CARET_H = 16
    const maxY = Math.max(0, (textareaRef.current?.clientHeight ?? 0) - CARET_H)
    const rawY = caretMarkerRef.current.offsetTop
    const clampedY = Math.min(rawY, maxY)
    // If clamped, pin X to the far right so the caret sits at end-of-line.
    const x = clampedY === rawY
      ? caretMarkerRef.current.offsetLeft
      : Math.max(0, (textareaRef.current?.clientWidth ?? 0) - 7)
    setCaretPos({ x, y: clampedY })
  }, [input, selEnd])

  const markTyping = () => {
    setIsTyping(true)
    if (typingTimeoutRef.current != null) window.clearTimeout(typingTimeoutRef.current)
    typingTimeoutRef.current = window.setTimeout(() => setIsTyping(false), 600)
  }

  useEffect(() => () => {
    if (typingTimeoutRef.current != null) window.clearTimeout(typingTimeoutRef.current)
  }, [])

  // Slash-command suggestions while the user is typing
  const commandSuggestions = React.useMemo(() => {
    const t = input.trimStart()
    if (!t.startsWith('/')) return [] as SlashCommand[]
    const q = t.slice(1).toLowerCase()
    return SLASH_COMMANDS.filter((c) => c.name.slice(1).toLowerCase().startsWith(q))
  }, [input])

  // Keep the highlighted suggestion inside the current filtered list
  const effectiveCommandIdx = commandSuggestions.length === 0
    ? 0
    : Math.min(commandIdx, commandSuggestions.length - 1)

  // Keep the highlighted suggestion scrolled into the popover viewport
  useEffect(() => {
    const parent = cmdListRef.current
    if (!parent || commandSuggestions.length === 0) return
    const child = parent.children[effectiveCommandIdx] as HTMLElement | undefined
    if (!child) return
    const top = child.offsetTop
    const bottom = top + child.offsetHeight
    if (top < parent.scrollTop) {
      parent.scrollTop = top
    } else if (bottom > parent.scrollTop + parent.clientHeight) {
      parent.scrollTop = bottom - parent.clientHeight
    }
  }, [effectiveCommandIdx, commandSuggestions.length])

  // Tick the recording timer (mm:ss)
  useEffect(() => {
    if (!recording || recordStart == null) return
    const id = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - recordStart) / 1000))
    }, 250)
    return () => window.clearInterval(id)
  }, [recording, recordStart])

  // ── Live voice session (Gemini Live → Sophie) ──
  const enqueueAudio = React.useCallback((b64: string, mimeType?: string) => {
    const ctx = audioCtxRef.current
    if (!ctx) return
    let outRate = 24000
    if (mimeType) {
      const m = mimeType.match(/rate=(\d+)/)
      if (m) outRate = parseInt(m[1], 10) || 24000
    }
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const view = new DataView(bytes.buffer)
    const sampleCount = Math.floor(bytes.byteLength / 2)
    if (sampleCount === 0) return
    const floats = new Float32Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      floats[i] = view.getInt16(i * 2, true) / 32768
    }
    const audioBuf = ctx.createBuffer(1, sampleCount, outRate)
    audioBuf.copyToChannel(floats, 0)
    const source = ctx.createBufferSource()
    source.buffer = audioBuf
    source.connect(ctx.destination)
    const startAt = Math.max(ctx.currentTime, playbackEndRef.current)
    source.start(startAt)
    playbackEndRef.current = startAt + audioBuf.duration
  }, [])

  const closeLiveSession = React.useCallback(() => {
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    try {
      workletNodeRef.current?.disconnect()
      workletNodeRef.current?.port.close()
    } catch { /* ignore */ }
    workletNodeRef.current = null
    try { micStreamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    micStreamRef.current = null
    try { audioCtxRef.current?.close() } catch { /* ignore */ }
    audioCtxRef.current = null
    playbackEndRef.current = 0
    setLiveStatus('idle')
  }, [])

  const handleLiveMessage = React.useCallback((raw: string) => {
    let msg: { type: string; data?: string; mimeType?: string; role?: string; text?: string; message?: string; used?: number; limit?: number; pct?: number; warning?: string }
    try { msg = JSON.parse(raw) } catch { return }
    switch (msg.type) {
      case 'ready':
        setLiveStatus('connected')
        break
      case 'audio':
        if (msg.data) enqueueAudio(msg.data, msg.mimeType)
        break
      case 'transcript': {
        const role = msg.role as 'user' | 'assistant' | undefined
        const text = msg.text
        if (!role || !text) break
        appendLiveTranscript(role, text)
        break
      }
      case 'rate_limit':
        if (msg.used !== undefined && msg.limit !== undefined && msg.pct !== undefined) {
          useBaisyncStore.setState({
            rateLimit: { used: msg.used, limit: msg.limit, resetAt: '', pct: msg.pct, warning: msg.warning },
          })
        }
        break
      case 'turn_complete':
      case 'interrupted':
        // No UI change here; transcript already reflects the turn
        break
      case 'error':
        setLiveStatus('error')
        setLiveError(msg.message || 'Erro desconhecido')
        break
    }
  }, [enqueueAudio, appendLiveTranscript])

  const openLiveSession = React.useCallback(async () => {
    if (wsRef.current) return
    setLiveError(null)
    setLiveStatus('connecting')

    try {
      // Audio setup
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      await ctx.audioWorklet.addModule('/worklets/pcm-downsample.js')
      if (ctx.state === 'suspended') await ctx.resume()

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream

      const micSource = ctx.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(ctx, 'pcm-downsample')
      workletNodeRef.current = workletNode
      micSource.connect(workletNode)
      // Silent sink keeps the worklet scheduled without audible feedback.
      const silent = ctx.createGain()
      silent.gain.value = 0
      workletNode.connect(silent)
      silent.connect(ctx.destination)

      // Ticket
      const ticketRes = await fetch('/api/baisync/voice/live-ticket', {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!ticketRes.ok) throw new Error('ticket request failed')
      const { ticket } = await ticketRes.json() as { ticket: string }

      // WebSocket (same-origin via Next.js rewrite)
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const wsUrl = origin.replace(/^http/, 'ws') +
        `/api/baisync/voice/live?ticket=${encodeURIComponent(ticket)}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      workletNode.port.onmessage = (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const bytes = new Uint8Array(ev.data as ArrayBuffer)
        let bin = ''
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        ws.send(JSON.stringify({ type: 'audio', data: btoa(bin) }))
      }

      ws.onmessage = (ev) => handleLiveMessage(ev.data)
      ws.onerror = () => {
        setLiveStatus('error')
        setLiveError('Erro de conexão')
      }
      ws.onclose = () => { closeLiveSession() }
    } catch (err) {
      const msg = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Permissão do microfone negada'
        : err instanceof Error ? err.message : 'Falha ao conectar'
      setLiveStatus('error')
      setLiveError(msg)
      closeLiveSession()
    }
  }, [handleLiveMessage, closeLiveSession])

  useEffect(() => () => { closeLiveSession() }, [closeLiveSession])

  const startRecording = () => {
    setRecordStart(performance.now())
    setElapsed(0)
    setRecording(true)
    void openLiveSession()
  }
  const cancelRecording = () => {
    setRecording(false)
    setRecordStart(null)
    setElapsed(0)
    closeLiveSession()
  }
  const sendRecording = () => {
    cancelRecording()
  }

  const firstName = user?.name ? user.name.split(' ')[0] : 'você'

  // ── Draggable panel anchored to bubble ──
  const PANEL_W = 400
  const PANEL_MIN_H = 300
  const PANEL_MAX_H = 800
  const GAP = 8
  const BUBBLE_SIZE = 56

  const [panelPos, setPanelPos] = useState({ right: 24, bottom: 24 })
  const [panelHeight, setPanelHeight] = useState(600)
  const [panelDragging, setPanelDragging] = useState(false)
  const panelDragStart = useRef({ x: 0, y: 0, right: 0, bottom: 0 })

  // ── Resize from top edge ──
  const [resizing, setResizing] = useState(false)
  const resizeStart = useRef({ y: 0, height: 0, bottom: 0 })

  // On open: position panel relative to bubble
  useEffect(() => {
    if (!isOpen) return

    let bubbleRight = 24
    let bubbleBottom = 24
    try {
      const saved = localStorage.getItem('baisync-bubble-pos')
      if (saved) {
        const parsed = JSON.parse(saved)
        bubbleRight = parsed.right ?? 24
        bubbleBottom = parsed.bottom ?? 24
      }
    } catch {}

    // Align panel's right edge with the bubble's right edge
    let right = bubbleRight
    const panelLeftEdge = window.innerWidth - right - PANEL_W
    if (panelLeftEdge < 8) right = window.innerWidth - PANEL_W - 8
    right = Math.max(8, right)

    // Try to place panel above the bubble
    let bottom = bubbleBottom + BUBBLE_SIZE + GAP
    const panelTopEdge = window.innerHeight - (bottom + panelHeight)

    if (panelTopEdge < 8) {
      // Not enough space above — place panel below the bubble instead
      // Panel top = viewport bottom - bubbleBottom + GAP, so bottom = bubbleBottom - panelHeight - GAP
      const belowBottom = bubbleBottom - panelHeight - GAP
      if (belowBottom >= 8) {
        bottom = belowBottom
      } else {
        // Not enough space above or below — center vertically in viewport
        bottom = Math.max(8, Math.round((window.innerHeight - panelHeight) / 2))
      }
    }

    setPanelPos({ right, bottom })
  }, [isOpen, panelHeight])

  // Panel drag logic
  useEffect(() => {
    if (!panelDragging) return

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - panelDragStart.current.x
      const dy = e.clientY - panelDragStart.current.y
      setPanelPos({
        right: Math.max(0, Math.min(panelDragStart.current.right - dx, window.innerWidth - PANEL_W)),
        bottom: Math.max(0, Math.min(panelDragStart.current.bottom - dy, window.innerHeight - panelHeight)),
      })
    }

    const onMouseUp = () => setPanelDragging(false)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [panelDragging, panelHeight])

  // Panel resize logic (drag top edge)
  useEffect(() => {
    if (!resizing) return

    const onMouseMove = (e: MouseEvent) => {
      const dy = resizeStart.current.y - e.clientY
      const newHeight = Math.max(PANEL_MIN_H, Math.min(resizeStart.current.height + dy, PANEL_MAX_H))
      setPanelHeight(newHeight)
    }

    const onMouseUp = () => setResizing(false)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [resizing])

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    setPanelDragging(true)
    panelDragStart.current = { x: e.clientX, y: e.clientY, right: panelPos.right, bottom: panelPos.bottom }
  }

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setResizing(true)
    resizeStart.current = { y: e.clientY, height: panelHeight, bottom: panelPos.bottom }
  }

  // On close: move bubble to panel's bottom-right corner
  const handleClose = () => {
    const bubblePos = {
      right: Math.max(0, panelPos.right),
      bottom: Math.max(0, panelPos.bottom - BUBBLE_SIZE - GAP),
    }
    localStorage.setItem('baisync-bubble-pos', JSON.stringify(bubblePos))
    close()
  }
  const [attachments, setAttachments] = useState<BaisyncAttachment[]>([])
  const messagesRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) fetchRateLimit()
  }, [isOpen, fetchRateLimit])

  // S2.1 — On first open, pull Sophie history from the server so chat state
  // survives across devices/browsers. `hydrate()` guards against repeat calls
  // internally (sets `hydrated` on first attempt, success or silent-fail).
  useEffect(() => {
    if (isOpen && !hydrated) void hydrate()
  }, [isOpen, hydrated, hydrate])

  useEffect(() => {
    const el = messagesRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingContent])

  const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB per file
  const MAX_TOTAL_SIZE = 20 * 1024 * 1024 // 20MB total
  const [fileError, setFileError] = useState<string | null>(null)

  const currentTotalSize = attachments.reduce((sum, a) => sum + Math.ceil(a.data_base64.length * 0.75), 0)

  const ALLOWED_TYPES = [
    'image/', 'application/pdf', 'text/plain', 'text/csv',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    setFileError(null)

    Array.from(files).forEach((file) => {
      const isAllowed = ALLOWED_TYPES.some((t) => t.endsWith('/') ? file.type.startsWith(t) : file.type === t)
      if (!isAllowed) {
        setFileError(`"${file.name}" não é suportado. Envie imagens, PDFs ou documentos de texto.`)
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        setFileError(`"${file.name}" excede 20MB`)
        return
      }
      if (currentTotalSize + file.size > MAX_TOTAL_SIZE) {
        setFileError('Limite total de 20MB atingido')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1]
        setAttachments((prev) => {
          const newTotal = prev.reduce((s, a) => s + Math.ceil(a.data_base64.length * 0.75), 0) + file.size
          if (newTotal > MAX_TOTAL_SIZE) {
            setFileError('Limite total de 20MB atingido')
            return prev
          }
          return [...prev, { name: file.name, mime_type: file.type, data_base64: base64 }]
        })
      }
      reader.readAsDataURL(file)
    })

    e.target.value = ''
  }

  const removeAttachment = (index: number) => {
    setFileError(null)
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const executeCommand = (raw: string): boolean => {
    const [head, ...rest] = raw.slice(1).split(/\s+/)
    const name = `/${head.toLowerCase()}`
    const args = rest.join(' ').trim()
    const cmd = SLASH_COMMANDS.find((c) => c.name === name)

    // Echo the typed command as a user message in the transcript
    const echo = () => pushLocalMessage({ role: 'user', content: raw })
    const reply = (content: string) =>
      pushLocalMessage({ role: 'assistant', content })

    if (!cmd) {
      echo()
      reply(`comando desconhecido: ${name}. tente **/help**`)
      return true
    }

    if (cmd.kind === 'local') {
      switch (cmd.name) {
        case '/help': {
          echo()
          const list = SLASH_COMMANDS
            .map((c) => `\`${c.name}\` — ${c.desc}`)
            .join('\n\n')
          reply(list)
          return true
        }
        case '/clear': {
          clearMessages()
          return true
        }
        case '/whoami': {
          echo()
          const email = user?.email || '--'
          const name = user?.name || '--'
          reply(`**${name}** <${email}>`)
          return true
        }
        case '/status': {
          echo()
          // Pull latest counts before reporting
          void fetchRateLimit().then(() => {
            const rl = useBaisyncStore.getState().rateLimit
            const used = rl?.used ?? 0
            const limit = rl?.limit ?? 0
            const pct = rl?.pct ?? 0
            const streaming = isStreaming ? 'streaming' : 'ocioso'
            reply(
              `estado: **${streaming}**\n\ntokens esta hora: ${used}/${limit} (${pct}%)`,
            )
          })
          return true
        }
        case '/usage': {
          echo()
          void fetchRateLimit().then(() => {
            const rl = useBaisyncStore.getState().rateLimit
            const used = rl?.used ?? 0
            const limit = rl?.limit ?? 0
            const pct = rl?.pct ?? 0
            const remaining = Math.max(0, limit - used)
            reply(
              `**Tokens consumidos nesta hora**\n\n` +
                `${used.toLocaleString('pt-BR')} / ${limit.toLocaleString('pt-BR')} tokens (${pct}%)\n` +
                `restam ${remaining.toLocaleString('pt-BR')} tokens até o próximo reset.`,
            )
          })
          return true
        }
      }
    }

    // AI-routed commands: translate to a natural-language message + send
    const prompts: Record<string, string> = {
      '/assistants': 'Liste os assistentes que eu tenho cadastrados na plataforma.',
      '/new': args
        ? `Quero criar um novo assistente: ${args}`
        : 'Quero criar um novo assistente de atendimento.',
      '/integrations': 'Quais integrações estão disponíveis na plataforma?',
      '/docs': 'Me conte em tópicos sobre a plataforma e seus recursos principais.',
    }
    const prompt = prompts[cmd.name]
    if (prompt) {
      sendMessage(prompt)
      return true
    }
    return false
  }

  const handleSend = () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || isStreaming) return

    // Slash command? Execute locally / route to AI without the raw "/foo" going out.
    if (text.startsWith('/') && attachments.length === 0) {
      setInput('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'
      executeCommand(text)
      return
    }

    const msg = text || (attachments.length > 0 ? `[${attachments.map((a) => a.name).join(', ')}]` : '')
    const atts = attachments.length > 0 ? [...attachments] : undefined
    setInput('')
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    sendMessage(msg, atts)
  }

  const isAtLimit = rateLimit && rateLimit.pct >= 100

  if (!isOpen) return null

  return (
    <div
      className="rounded-none sm:rounded-[10px]"
      data-baisync-panel
      style={{
        position: 'fixed',
        zIndex: 9999,
        bottom: panelPos.bottom,
        right: panelPos.right,
        width: 400,
        height: panelHeight,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#0b0b0d',
        border: '0.5px solid #2a2a30',
        boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.02)',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        animation: resizing ? 'none' : 'baisync-panel-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Top edge: resize height */}
      <div
        onMouseDown={handleResizeMouseDown}
        className="absolute top-0 left-4 right-4 h-2 z-10 flex items-center justify-center"
        style={{ cursor: 'ns-resize' }}
      >
        <div className="w-10 h-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors" />
      </div>

      {/* Bottom edge: drag to reposition (always accessible even if header is off-screen) */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="absolute bottom-0 left-4 right-4 h-3 z-10 flex items-end justify-center pb-0.5"
        style={{ cursor: panelDragging ? 'grabbing' : 'grab' }}
      >
        <div className="w-10 h-1 rounded-full bg-white/10 hover:bg-white/20 transition-colors" />
      </div>

      {/* Gradient glow behind panel for glassmorphism depth */}
      <div
        className="absolute -inset-24 -z-10 pointer-events-none opacity-40 blur-3xl"
        style={{
          background: 'radial-gradient(ellipse at 70% 80%, rgba(249,115,22,0.15) 0%, rgba(88,28,135,0.08) 40%, transparent 70%)',
        }}
      />

      {/* Header — terminal chrome */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="flex items-center justify-between relative"
        style={{
          flexShrink: 0,
          padding: '10px 12px',
          background: '#111114',
          borderBottom: '0.5px solid #2a2a30',
          cursor: panelDragging ? 'grabbing' : 'grab',
          userSelect: panelDragging ? 'none' : undefined,
        }}
      >
        <div className="flex items-center" style={{ gap: 8 }}>
          <div className="flex" style={{ gap: 6 }}>
            <button
              onClick={(e) => { e.stopPropagation(); handleClose() }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Fechar"
              title="Fechar"
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57', border: 'none', padding: 0, cursor: 'pointer' }}
            />
            <button
              onClick={(e) => { e.stopPropagation(); clearMessages() }}
              onMouseDown={(e) => e.stopPropagation()}
              aria-label="Limpar conversa"
              title="Limpar conversa"
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e', border: 'none', padding: 0, cursor: 'pointer' }}
            />
            <span
              aria-hidden="true"
              style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840', display: 'inline-block' }}
            />
          </div>
          <span style={{ fontSize: 12, color: '#8a8a92', marginLeft: 6 }}>~/sophie</span>
        </div>
        <div className="flex items-center" style={{ gap: 8 }}>
          {/* Ralph Loop toggle */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleRalph() }}
            onMouseDown={(e) => e.stopPropagation()}
            title={ralphEnabled ? 'Ralph Loop ativo — desativar' : 'Ativar Ralph Loop (tarefas autônomas)'}
            aria-label={ralphEnabled ? 'Desativar Ralph Loop' : 'Ativar Ralph Loop'}
            style={{
              background: 'transparent',
              border: 'none',
              padding: '2px 5px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              color: ralphEnabled ? '#ff7a1a' : '#5a5a64',
              transition: 'color 0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: 3,
            }}
            onMouseEnter={(e) => { if (!ralphEnabled) e.currentTarget.style.color = '#8a8a92' }}
            onMouseLeave={(e) => { if (!ralphEnabled) e.currentTarget.style.color = '#5a5a64' }}
          >
            <span>⚡</span>
            <span style={{ fontSize: 10 }}>
              {inRalphMode ? 'loop' : 'ralph'}
            </span>
          </button>

          <div style={{ width: '0.5px', height: 10, background: '#2a2a30' }} />

          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: recording ? '#ff3b3b' : '#28c840',
              display: 'inline-block',
              animation: recording ? 'baisync-rec-blink 1s step-end infinite' : undefined,
            }}
          />
          <span style={{ fontSize: 11, color: recording ? '#ff3b3b' : '#8a8a92' }}>
            {recording ? 'rec' : 'online'}
          </span>
        </div>
      </div>

      {/* Messages / terminal body */}
      <div
        ref={messagesRef}
        className="overflow-y-auto overflow-x-hidden"
        style={{
          flex: '1 1 0%',
          minHeight: 0,
          padding: '14px 12px 12px',
          fontSize: 13,
          lineHeight: 1.6,
          color: '#e6e6e6',
        }}
      >
        {messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col" style={{ gap: 0 }}>
            {/* $ whoami */}
            <div style={{ color: '#6b6b72' }}>$ whoami</div>
            <div style={{ color: '#e6e6e6', marginBottom: 10 }}>{firstName}</div>

            {/* $ sophie --greet */}
            <div style={{ color: '#6b6b72' }}>$ sophie --greet</div>
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: '#ff7a1a' }}>&gt;</span>
              <span style={{ color: '#e6e6e6' }}> olá, </span>
              <span style={{ color: '#ff7a1a' }}>{firstName}</span>
            </div>
            <div style={{ color: '#8a8a92', marginBottom: 14, paddingLeft: 14 }}>
              como vamos impulsionar o seu negócio hoje?
            </div>

            {/* $ ls ações/ */}
            <div style={{ color: '#6b6b72', marginBottom: 6 }}>$ ls ações/</div>

            {SKILLS.map((skill, i) => (
              <button
                key={skill.name}
                onClick={() => {
                  setActiveSkill(skill.name)
                  sendMessage(skill.label)
                }}
                className="cursor-pointer text-left transition-colors duration-200"
                style={{
                  border: '0.5px solid #2a2a30',
                  borderLeft: '2px solid #ff7a1a',
                  borderRadius: '0 6px 6px 0',
                  padding: '10px 12px',
                  marginBottom: i === SKILLS.length - 1 ? 14 : 8,
                  background: '#111114',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#16161b' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#111114' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ color: '#ff7a1a', fontSize: 12 }}>[{String(i + 1).padStart(2, '0')}]</span>
                  <span style={{ color: '#e6e6e6', fontSize: 13 }}>{skill.file}</span>
                </div>
                <div style={{ color: '#8a8a92', fontSize: 12, paddingLeft: 32 }}>
                  {skill.comment}
                </div>
              </button>
            ))}

            {/* $ history | grep faq */}
            <div style={{ color: '#6b6b72', marginBottom: 6 }}>$ history | grep faq</div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="cursor-pointer text-left transition-colors duration-200"
                  style={{
                    fontSize: 12,
                    color: '#b5b5bc',
                    padding: '6px 10px',
                    border: '0.5px dashed #2a2a30',
                    borderRadius: 4,
                    background: 'transparent',
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#ff7a1a'
                    e.currentTarget.style.color = '#e6e6e6'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#2a2a30'
                    e.currentTarget.style.color = '#b5b5bc'
                  }}
                >
                  <span style={{ color: '#ff7a1a' }}>?</span> {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Active skill indicator */}
            {activeSkill && (
              <div
                className="flex items-center"
                style={{
                  gap: 8,
                  marginBottom: 10,
                  padding: '4px 8px',
                  fontSize: 11,
                  color: '#b5b5bc',
                  background: '#111114',
                  border: '0.5px solid #2a2a30',
                  borderLeft: '2px solid #ff7a1a',
                  borderRadius: '0 4px 4px 0',
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                }}
              >
                <span style={{ color: '#6b6b72' }}>$</span>
                <span>
                  <span style={{ color: '#ff7a1a' }}>use</span> {SKILLS.find((s) => s.name === activeSkill)?.file}
                </span>
                <button
                  className="ml-auto cursor-pointer"
                  onClick={() => setActiveSkill(null)}
                  aria-label="Desativar skill"
                  style={{ background: 'transparent', border: 'none', color: '#8a8a92', display: 'flex', padding: 0 }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = '#ff3b3b' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#8a8a92' }}
                >
                  <X size={10} />
                </button>
              </div>
            )}

            {messages.map((msg) => (
              <BaisyncMessageComponent key={msg.id} message={msg} />
            ))}

            {isStreaming && streamingContent && (
              <StreamingMessage content={streamingContent} />
            )}

            {isStreaming && !streamingContent && messages[messages.length - 1]?.role !== 'status' && (
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
            )}
          </>
        )}
      </div>

      {/* Rate limit bar — shown whenever the user has spent any tokens this
           hour so `/usage` feedback is always visible, not just past 60%. */}
      {rateLimit && rateLimit.pct >= 90 && (
        <div className="px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-subtle">
              {rateLimit.warning || `${rateLimit.used.toLocaleString('pt-BR')}/${rateLimit.limit.toLocaleString('pt-BR')} tokens`}
            </span>
            <span className="text-[10px] text-subtle">{rateLimit.pct}%</span>
          </div>
          <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(Math.max(rateLimit.pct, 2), 100)}%`,
                background:
                  rateLimit.pct >= 90 ? '#ef4444'
                  : rateLimit.pct >= 80 ? '#ff6b2c'
                  : rateLimit.pct >= 60 ? '#f59e0b'
                  : '#ff6b2c66',
              }}
            />
          </div>
        </div>
      )}

      {/* Input */}
      <div
        style={{
          flexShrink: 0,
          padding: '10px 12px 12px',
          borderTop: '0.5px solid #2a2a30',
          background: '#0b0b0d',
        }}
      >
        {isAtLimit ? (
          <div className="text-center py-2">
            <p className="text-xs font-medium" style={{ color: '#ff3b3b' }}>Limite atingido</p>
            <p className="text-[10px] mt-0.5" style={{ color: '#8a8a92' }}>Tente novamente em breve</p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ gap: 8 }}>
            {/* File error */}
            {fileError && (
              <p className="text-[11px]" style={{ color: '#ff3b3b' }}>{fileError}</p>
            )}

            {/* Attachment previews */}
            {attachments.length > 0 && !recording && (
              <div className="flex flex-wrap" style={{ gap: 6 }}>
                {attachments.map((att, i) => (
                  <div
                    key={i}
                    className="flex items-center"
                    style={{
                      gap: 6,
                      padding: '4px 8px',
                      fontSize: 11,
                      background: '#111114',
                      border: '0.5px solid #2a2a30',
                      borderLeft: '2px solid #ff7a1a',
                      borderRadius: '0 4px 4px 0',
                    }}
                  >
                    {att.mime_type.startsWith('image/') ? (
                      <ImageIcon size={11} style={{ color: '#ff7a1a', flexShrink: 0 }} />
                    ) : (
                      <FileText size={11} style={{ color: '#ff7a1a', flexShrink: 0 }} />
                    )}
                    <span className="truncate" style={{ color: '#e6e6e6', maxWidth: 120 }}>{att.name}</span>
                    <button
                      onClick={() => removeAttachment(i)}
                      aria-label="Remover anexo"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#8a8a92', padding: 0, display: 'flex' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ff3b3b' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#8a8a92' }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            {recording ? (
              <>
                {/* Pixel girl (Sophie) — left of the input row, above it */}
                <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: -4, paddingLeft: 2 }}>
                  <PixelGirl size={56} audioLevel={peak} />
                </div>

                {/* Recording bar */}
                <div
                  className="flex items-center"
                  style={{
                    gap: 8,
                    padding: '8px 10px',
                    background: '#070708',
                    border: '0.5px solid #2a2a30',
                    borderRadius: 6,
                  }}
                >
                  <button
                    onClick={cancelRecording}
                    aria-label="Cancelar gravação"
                    title="Cancelar"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 0, color: '#8a8a92' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = '#ff3b3b' }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = '#8a8a92' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>

                  {/* Audio-reactive bars */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, height: 20 }}>
                    {Array.from({ length: 28 }).map((_, i) => {
                      const lv = levels[i % levels.length] ?? 0
                      const h = Math.max(0.12, Math.min(1, lv * 1.2)) * 100
                      const heard = i < 20
                      return (
                        <div
                          key={i}
                          style={{
                            width: 2,
                            background: heard ? '#ff7a1a' : '#6b6b72',
                            height: `${h}%`,
                            transition: 'height 90ms linear',
                          }}
                        />
                      )
                    })}
                  </div>

                  <span
                    style={{
                      fontSize: 11,
                      color: '#ff7a1a',
                      fontVariantNumeric: 'tabular-nums',
                      minWidth: 28,
                      textAlign: 'right',
                    }}
                  >
                    {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
                  </span>

                  <button
                    onClick={sendRecording}
                    aria-label="Enviar áudio"
                    title="Enviar áudio"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 0 }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="#ff7a1a" stroke="#ff7a1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" fill="none" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>

                {liveError && (
                  <p className="text-[10px]" style={{ color: '#ff3b3b' }}>Erro: {liveError}</p>
                )}
                {liveStatus === 'connecting' && !liveError && (
                  <p className="text-[10px]" style={{ color: '#8a8a92' }}>Conectando a Sophie...</p>
                )}
                {liveStatus === 'connected' && !liveError && (
                  <p className="text-[10px]" style={{ color: '#28c840' }}>Sophie está ouvindo · fale à vontade</p>
                )}
                {liveStatus === 'idle' && audioError && (
                  <p className="text-[10px]" style={{ color: '#ff3b3b' }}>Erro: {audioError}</p>
                )}
                {liveStatus === 'idle' && audioSource === 'simulated' && !audioError && (
                  <p className="text-[10px]" style={{ color: '#febc2e' }}>· demo — microfone não disponível</p>
                )}
              </>
            ) : (
              <>
                {/* Slash-command autocomplete */}
                {commandSuggestions.length > 0 && (
                  <div
                    ref={cmdListRef}
                    style={{
                      position: 'relative',
                      background: '#070708',
                      border: '0.5px solid #2a2a30',
                      borderRadius: 6,
                      padding: 4,
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      fontSize: 12,
                      maxHeight: 180,
                      overflowY: 'auto',
                      animation: 'baisync-msg-in 0.15s ease-out',
                    }}
                  >
                    {commandSuggestions.map((c, i) => {
                      const active = i === effectiveCommandIdx
                      return (
                        <button
                          key={c.name}
                          onClick={() => {
                            executeCommand(c.name)
                            setInput('')
                            if (textareaRef.current) textareaRef.current.style.height = 'auto'
                            textareaRef.current?.focus()
                          }}
                          onMouseEnter={() => setCommandIdx(i)}
                          className="cursor-pointer text-left"
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            padding: '6px 8px',
                            border: 'none',
                            background: active ? 'rgba(255,122,26,0.10)' : 'transparent',
                            color: active ? '#e6e6e6' : '#b5b5bc',
                            borderRadius: 4,
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          }}
                        >
                          <span style={{ color: '#ff7a1a', minWidth: 100 }}>{c.name}</span>
                          <span style={{ color: '#8a8a92', fontSize: 11 }}>{c.desc}</span>
                          {c.kind === 'ai' && (
                            <span style={{ marginLeft: 'auto', color: '#6b6b72', fontSize: 10 }}>ai</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* Terminal-style composer (idle) */}
                <div
                  className="flex items-center transition-colors duration-200"
                style={{
                  gap: 10,
                  padding: '8px 10px',
                  background: '#070708',
                  border: '0.5px solid #2a2a30',
                  borderRadius: 6,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                }}
                onFocusCapture={(e) => {
                  e.currentTarget.style.borderColor = '#ff7a1a'
                }}
                onBlurCapture={(e) => {
                  e.currentTarget.style.borderColor = '#2a2a30'
                }}
              >
                <span
                  aria-hidden="true"
                  className="select-none shrink-0"
                  style={{ color: '#ff7a1a', fontSize: 13, fontWeight: 700 }}
                >
                  $
                </span>

                {/* Terminal block caret: overlay span measured by a hidden mirror */}
                <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'stretch', minHeight: 17 }}>
                  <textarea
                    ref={textareaRef}
                    value={input}
                    maxLength={2000}
                    onChange={(e) => {
                      setInput(e.target.value)
                      setSelEnd(e.target.selectionEnd)
                      markTyping()
                      e.target.style.height = 'auto'
                      e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                    }}
                    onKeyUp={(e) => setSelEnd(e.currentTarget.selectionEnd)}
                    onClick={(e) => { setSelEnd(e.currentTarget.selectionEnd); markTyping() }}
                    onSelect={(e) => { setSelEnd(e.currentTarget.selectionEnd); markTyping() }}
                    onKeyDown={(e) => {
                      // Any key activity (typing, arrows, home/end, backspace)
                      // should make the caret solid and reset the idle timer.
                      markTyping()
                      const hasSuggestions = commandSuggestions.length > 0
                      if (hasSuggestions && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                        e.preventDefault()
                        const n = commandSuggestions.length
                        setCommandIdx(
                          e.key === 'ArrowDown'
                            ? (effectiveCommandIdx + 1) % n
                            : (effectiveCommandIdx - 1 + n) % n,
                        )
                        return
                      }
                      if (hasSuggestions && e.key === 'Tab') {
                        e.preventDefault()
                        setInput(commandSuggestions[effectiveCommandIdx].name + ' ')
                        return
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (hasSuggestions) {
                          const picked = commandSuggestions[effectiveCommandIdx]
                          executeCommand(picked.name)
                          setInput('')
                          if (textareaRef.current) textareaRef.current.style.height = 'auto'
                          return
                        }
                        handleSend()
                      }
                    }}
                    placeholder={isStreaming ? '…' : 'digite ou /help para comandos'}
                    disabled={isStreaming}
                    rows={1}
                    className="baisync-term-caret focus:outline-none disabled:opacity-50 resize-none bg-transparent border-0 p-0"
                    style={{
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      fontSize: 12,
                      color: '#e6e6e6',
                      lineHeight: '1.4',
                      width: '100%',
                      maxHeight: 120,
                      scrollbarWidth: 'none',
                      position: 'relative',
                      zIndex: 1,
                    }}
                  />

                  {/* Hidden mirror: wraps the text the same way as the
                       textarea so the marker ends up on the right line.
                       Uses the textarea's default wrap rules (break at word
                       boundaries, no mid-word breaks). */}
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      visibility: 'hidden',
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'normal',
                      wordBreak: 'normal',
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      fontSize: 12,
                      lineHeight: '1.4',
                      padding: 0,
                      margin: 0,
                      border: 0,
                      pointerEvents: 'none',
                    }}
                  >
                    {/* Use non-breaking space at the cursor so a trailing
                         space in the prefix doesn't get collapsed by the
                         wrapping algorithm, which would snap the marker
                         to the next line before the textarea does. */}
                    {input.slice(0, selEnd)}
                    <span
                      ref={caretMarkerRef}
                      style={{ display: 'inline-block', width: 0, height: '1em' }}
                    >
                      {'\u200B'}
                    </span>
                    {input.slice(selEnd)}
                  </div>

                  {/* The block caret itself, positioned where the marker is */}
                  {!isStreaming && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        left: caretPos.x,
                        top: caretPos.y,
                        width: 7,
                        height: 16,
                        background: '#ff7a1a',
                        pointerEvents: 'none',
                        animation: isTyping ? 'none' : 'baisync-caret-blink 1s step-end infinite',
                        zIndex: 2,
                      }}
                    />
                  )}
                </div>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isStreaming}
                  aria-label="Anexar documento"
                  title="Anexar"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 0, color: '#8a8a92' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.color = '#ff7a1a' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#8a8a92' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>

                <button
                  onClick={startRecording}
                  disabled={isStreaming}
                  aria-label="Gravar áudio"
                  title="Gravar áudio"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 0, color: '#8a8a92' }}
                  onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.color = '#ff7a1a' }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = '#8a8a92' }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="2" width="6" height="12" rx="3" />
                    <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                    <line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                </button>

                <button
                  onClick={handleSend}
                  disabled={isStreaming || (!input.trim() && attachments.length === 0)}
                  aria-label="Enviar"
                  title="Enviar (Enter)"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', padding: 0, opacity: isStreaming || (!input.trim() && attachments.length === 0) ? 0.3 : 1 }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="#ff7a1a" stroke="#ff7a1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" fill="none" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
