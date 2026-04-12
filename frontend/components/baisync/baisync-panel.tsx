'use client'

import React, { useEffect, useRef, useState } from 'react'
import { X, Send, Trash2, Sparkles, Bot, BookOpen, MessageCircleQuestion, Paperclip, FileText, Image as ImageIcon } from 'lucide-react'
import { useBaisyncStore, type BaisyncAttachment } from '@/store/useBaisyncStore'
import { useAuthStore } from '@/store/useAuthStore'
import { BaisyncMessageComponent, StreamingMessage, ThinkingAnimation, TypingIndicator } from './baisync-message'

// ── Fairy Dust SVG particles ──

const DUST_COLORS = ['#FFE8B0', '#FFD080', '#FFBC60', '#FFF0CC', '#FFD699']

function starEdgePoint(cx: number, cy: number, outer: number, inner: number) {
  const verts: { x: number; y: number }[] = []
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 - Math.PI / 2
    verts.push({ x: cx + Math.cos(a) * outer, y: cy + Math.sin(a) * outer })
    const ma = a + Math.PI / 4
    verts.push({ x: cx + Math.cos(ma) * inner, y: cy + Math.sin(ma) * inner })
  }
  const idx = Math.floor(Math.random() * verts.length)
  const next = (idx + 1) % verts.length
  const t = Math.random()
  return {
    x: verts[idx].x + (verts[next].x - verts[idx].x) * t,
    y: verts[idx].y + (verts[next].y - verts[idx].y) * t,
  }
}

function makeDust() {
  const cx = 14, cy = 14, outer = 12, inner = 5
  const origin = starEdgePoint(cx, cy, outer, inner)
  const dx = origin.x - cx
  const dy = origin.y - cy
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const travel = 6 + Math.random() * 14

  return {
    x1: origin.x,
    y1: origin.y,
    x2: origin.x + (dx / len) * travel + (Math.random() - 0.5) * 5,
    y2: origin.y + (dy / len) * travel + Math.random() * 6,
    size: 1 + Math.random() * 1.5,
    dur: 1.3 + Math.random() * 1.5,
    delay: Math.random() * 4,
    isSparkle: Math.random() > 0.35,
    rays: Math.random() > 0.5 ? 6 : 8,
  }
}

function SparkleShape({ size, rays, color }: { size: number; rays: number; color: string }) {
  const lines = []
  for (let i = 0; i < rays; i++) {
    const angle = (i * Math.PI * 2) / rays
    const r = i % 2 === 0 ? size : size * 0.5
    lines.push(
      <line key={i} x1={0} y1={0} x2={Math.cos(angle) * r} y2={Math.sin(angle) * r}
        stroke={color} strokeWidth={0.4} strokeLinecap="round" />
    )
  }
  return <g>{lines}</g>
}

function FairyDust() {
  const [dusts] = useState(() => Array.from({ length: 14 }, makeDust))

  return (
    <svg viewBox="0 0 28 28" width={28} height={28}
      style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {dusts.map((d, i) => {
        const mx = d.x1 * 0.55 + d.x2 * 0.45 + (Math.random() - 0.5) * 3
        const my = d.y1 * 0.55 + d.y2 * 0.45 - 2
        const color = DUST_COLORS[i % DUST_COLORS.length]

        if (!d.isSparkle) {
          return (
            <circle key={i} r={d.size * 0.3} fill={color} opacity="0">
              <animate attributeName="cx" values={`${d.x1};${mx};${d.x2}`} dur={`${d.dur}s`} begin={`${d.delay}s`} repeatCount="indefinite" />
              <animate attributeName="cy" values={`${d.y1};${my};${d.y2}`} dur={`${d.dur}s`} begin={`${d.delay}s`} repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;0.95;0.5;0" dur={`${d.dur}s`} begin={`${d.delay}s`} repeatCount="indefinite" />
            </circle>
          )
        }

        return (
          <g key={i} opacity="0">
            <animateTransform attributeName="transform" type="translate"
              values={`${d.x1} ${d.y1};${mx} ${my};${d.x2} ${d.y2}`}
              dur={`${d.dur}s`} begin={`${d.delay}s`} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0.9;0.4;0"
              dur={`${d.dur}s`} begin={`${d.delay}s`} repeatCount="indefinite" />
            <SparkleShape size={d.size} rays={d.rays} color={color} />
          </g>
        )
      })}
    </svg>
  )
}

const SKILLS = [
  {
    name: 'criar_atendente',
    label: 'Criar Atendente de IA',
    desc: 'Configure um assistente personalizado para o seu negócio',
    icon: <Bot size={20} className="text-[#ff6b2c]" />,
  },
  {
    name: 'sobre_plataforma',
    label: 'Sobre a Plataforma',
    desc: 'Entenda os recursos e funcionalidades disponíveis',
    icon: <BookOpen size={20} className="text-[#ff6b2c]" />,
  },
]

const QUICK_QUESTIONS = [
  'Como configurar meu primeiro assistente?',
  'Quais integrações estão disponíveis?',
  'Como funciona a base de conhecimento?',
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
  } = useBaisyncStore()

  const { user } = useAuthStore()
  const [input, setInput] = useState('')

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
  }, [isOpen])

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

  const handleSend = () => {
    const text = input.trim()
    if ((!text && attachments.length === 0) || isStreaming) return
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
      className="rounded-none sm:rounded-2xl"
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
        background: '#0a0a0a',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        boxShadow: '0 8px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.03)',
        fontFamily: 'var(--font-jetbrains-mono), -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
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

      {/* Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        className="flex items-center justify-between px-4 py-3 relative"
        style={{
          flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          cursor: panelDragging ? 'grabbing' : 'grab',
          userSelect: panelDragging ? 'none' : undefined,
        }}
      >
        <div className="flex items-center gap-3">
          <div>
            <p className="text-sm font-bold text-heading tracking-tight">Baisync Agent</p>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-500"
                style={{ animation: 'baisync-status-pulse 2s ease-in-out infinite' }}
              />
              <span className="text-[10px] text-subtle font-light">Online</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearMessages}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-subtle hover:text-heading transition-all duration-200 cursor-pointer hover:-translate-y-0.5"
            style={{ background: 'transparent' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            title="Limpar conversa"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-subtle hover:text-heading transition-all duration-200 cursor-pointer hover:-translate-y-0.5"
            style={{ background: 'transparent' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <X size={16} />
          </button>
        </div>
        {/* Decorative gradient line */}
        <div className="absolute bottom-0 left-4 right-4 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(249,115,22,0.3), transparent)' }} />
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="overflow-y-auto overflow-x-hidden p-4 space-y-1.5" style={{ flex: '1 1 0%', minHeight: 0 }}>
        {messages.length === 0 && !isStreaming ? (
          <div className="flex flex-col items-center justify-center h-full gap-5">
            {/* Welcome */}
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <Sparkles size={28} className="text-[#ff6b2c]" />
                <FairyDust />
              </div>
              <div className="text-left">
                <p className="text-base font-bold text-heading">
                  Olá{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
                </p>
                <p
                  className="text-sm font-semibold"
                  style={{
                    background: 'linear-gradient(90deg, #ff6b2c 0%, #ff8533 40%, #fff 50%, #ff8533 60%, #ff6b2c 100%)',
                    backgroundSize: '200% 100%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                    animation: 'baisync-text-shimmer 3s ease-in-out infinite',
                  }}
                >
                  Como vamos impulsionar o seu negócio hoje?
                </p>
              </div>
            </div>

            {/* Skill cards */}
            <div className="flex flex-col gap-2.5 w-full max-w-[320px]">
              {SKILLS.map((skill) => (
                <button
                  key={skill.name}
                  className="flex items-start gap-3 px-4 py-3.5 rounded-xl text-left cursor-pointer group/skill transition-all duration-200 hover:-translate-y-0.5"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.07)'
                    e.currentTarget.style.borderColor = 'rgba(249,115,22,0.25)'
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(249,115,22,0.08)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                  onClick={() => {
                    setActiveSkill(skill.name)
                    sendMessage(skill.label)
                  }}
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200"
                    style={{ background: 'rgba(249,115,22,0.1)' }}
                  >
                    {skill.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-heading block">{skill.label}</span>
                    <span className="text-[11px] text-subtle leading-tight block mt-0.5">{skill.desc}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Quick question chips */}
            <div className="flex flex-wrap gap-1.5 max-w-[320px] justify-center">
              {QUICK_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  className="px-3 py-1.5 rounded-full text-[10px] font-medium text-subtle cursor-pointer transition-all duration-200 hover:text-heading hover:-translate-y-0.5"
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'
                    e.currentTarget.style.background = 'rgba(249,115,22,0.06)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                    e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                  }}
                  onClick={() => sendMessage(q)}
                >
                  <MessageCircleQuestion size={10} className="inline mr-1 opacity-50" />
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Active skill indicator */}
            {activeSkill && (
              <div
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px]"
                style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.15)' }}
              >
                <Sparkles size={10} className="text-[#ff6b2c]" />
                <span className="text-[#ff6b2c] font-medium">
                  Skill ativa: {SKILLS.find((s) => s.name === activeSkill)?.label}
                </span>
                <button className="ml-auto text-subtle hover:text-heading cursor-pointer" onClick={() => setActiveSkill(null)}>
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
              <div className="flex justify-start px-1 py-2" style={{ animation: 'baisync-msg-in 0.2s ease-out' }}>
                <ThinkingAnimation />
              </div>
            )}
          </>
        )}
      </div>

      {/* Rate limit bar */}
      {rateLimit && rateLimit.pct >= 60 && (
        <div className="px-4 py-1.5" style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-subtle">{rateLimit.warning || `${rateLimit.used}/${rateLimit.limit} mensagens`}</span>
            <span className="text-[10px] text-subtle">{rateLimit.pct}%</span>
          </div>
          <div className="w-full h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(rateLimit.pct, 100)}%`,
                background: rateLimit.pct >= 90 ? '#ef4444' : rateLimit.pct >= 80 ? '#ff6b2c' : '#f59e0b',
              }}
            />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="px-4 py-3" style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {isAtLimit ? (
          <div className="text-center py-2">
            <p className="text-xs text-red-400 font-medium">Limite atingido</p>
            <p className="text-[10px] text-subtle mt-0.5">Tente novamente em breve</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {/* File error */}
            {fileError && (
              <p className="text-[11px] text-red-400 px-1">{fileError}</p>
            )}

            {/* Attachment previews */}
            {attachments.length > 0 && (
              <div className="flex gap-1.5 flex-wrap px-1">
                {attachments.map((att, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] group/att"
                    style={{
                      background: 'rgba(249,115,22,0.1)',
                      border: '1px solid rgba(249,115,22,0.2)',
                    }}
                  >
                    {att.mime_type.startsWith('image/') ? (
                      <ImageIcon size={12} className="text-[#ff6b2c] shrink-0" />
                    ) : (
                      <FileText size={12} className="text-[#ff6b2c] shrink-0" />
                    )}
                    <span className="text-heading truncate max-w-[120px]">{att.name}</span>
                    <button
                      onClick={() => removeAttachment(i)}
                      className="text-subtle hover:text-red-400 cursor-pointer transition-colors ml-0.5"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 items-end">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isStreaming}
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-30 cursor-pointer transition-all duration-200 hover:scale-105"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)'; e.currentTarget.style.background = 'rgba(249,115,22,0.08)' } }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
                title="Enviar arquivo"
              >
                <Paperclip size={16} className="text-subtle" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                maxLength={2000}
                onChange={(e) => {
                  setInput(e.target.value)
                  // Auto-resize
                  e.target.style.height = 'auto'
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                placeholder="Digite sua mensagem..."
                disabled={isStreaming}
                rows={1}
                className="flex-1 py-2.5 px-4 text-sm text-heading placeholder:text-subtle focus:outline-none disabled:opacity-50 transition-all duration-200 resize-none"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 20,
                  maxHeight: 120,
                  lineHeight: '1.4',
                  scrollbarWidth: 'none',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(249,115,22,0.4)'
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.08)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              />
              <button
                onClick={handleSend}
                disabled={isStreaming || (!input.trim() && attachments.length === 0)}
                className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 disabled:opacity-30 cursor-pointer transition-all duration-200 hover:scale-105"
                style={{
                  background: 'linear-gradient(135deg, #ff6b2c, #ff8533)',
                  boxShadow: '0 2px 12px rgba(249,115,22,0.25)',
                }}
                onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.boxShadow = '0 4px 20px rgba(249,115,22,0.4)' }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 2px 12px rgba(249,115,22,0.25)' }}
              >
                <Send size={16} className="text-white" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
