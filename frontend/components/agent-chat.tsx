'use client'

import { useState, useEffect, useRef } from 'react'

interface ChatMsg {
  role: 'user' | 'assistant'
  text?: string | null
  thinking?: string
  steps?: { icon: string; label: string }[]
  card?: {
    title: string
    name: string
    status: string
    metrics: { label: string; value: string }[]
  }
  delay: number
}

const CHAT_MESSAGES: ChatMsg[] = [
  {
    role: 'user',
    text: 'Preciso de um agente para responder dúvidas dos meus clientes sobre planos e preços.',
    delay: 0,
  },
  {
    role: 'assistant',
    text: null,
    thinking: 'Analisando o pedido do usuário...',
    delay: 1800,
  },
  {
    role: 'assistant',
    text: 'Entendido! Vou criar um agente de atendimento especializado em planos e preços. Ele vai:',
    delay: 3200,
  },
  {
    role: 'assistant',
    text: null,
    steps: [
      { icon: '◆', label: 'Acessar sua tabela de preços em tempo real' },
      { icon: '◆', label: 'Comparar planos automaticamente' },
      { icon: '◆', label: 'Responder em linguagem natural e amigável' },
      { icon: '◆', label: 'Escalar para humano quando necessário' },
    ],
    delay: 4800,
  },
  {
    role: 'assistant',
    text: null,
    card: {
      title: 'Agente Criado com Sucesso',
      name: 'Assistente de Planos — Baisync',
      status: 'Ativo',
      metrics: [
        { label: 'Tempo médio de resposta', value: '1.2s' },
        { label: 'Taxa de resolução', value: '94%' },
        { label: 'Satisfação', value: '4.8/5' },
      ],
    },
    delay: 7000,
  },
  {
    role: 'user',
    text: 'Perfeito! Pode integrar com meu WhatsApp?',
    delay: 9500,
  },
  {
    role: 'assistant',
    text: 'Integração com WhatsApp Business ativada! Seu agente já está pronto para receber mensagens. 🟢',
    delay: 11000,
  },
]

const mono = "'JetBrains Mono', 'Fira Code', monospace"

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 0' }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#888',
            animation: `typing-dot 1.4s infinite ${i * 0.2}s`,
          }}
        />
      ))}
    </div>
  )
}

function ChatMessage({ msg }: { msg: ChatMsg }) {
  const isUser = msg.role === 'user'

  if (msg.thinking) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12, animation: 'fadeSlideUp 0.4s ease' }}>
        <div
          style={{
            background: 'rgba(255,107,0,0.08)',
            border: '1px solid rgba(255,107,0,0.2)',
            borderRadius: 12,
            padding: '10px 16px',
            fontFamily: mono,
            fontSize: 12,
            color: '#ff6b2c',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#ff6b2c',
              animation: 'pulse-dot 1.5s infinite',
            }}
          />
          {msg.thinking}
        </div>
      </div>
    )
  }

  if (msg.steps) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12, animation: 'fadeSlideUp 0.4s ease' }}>
        <div
          style={{
            background: '#111',
            border: '1px solid #222',
            borderRadius: 14,
            padding: '14px 18px',
            maxWidth: '85%',
          }}
        >
          {msg.steps.map((step, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
                fontFamily: mono,
                fontSize: 12.5,
                color: '#ccc',
                animation: `fadeSlideUp 0.3s ease ${i * 0.1}s both`,
              }}
            >
              <span style={{ color: '#ff6b2c', fontSize: 8 }}>{step.icon}</span>
              {step.label}
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (msg.card) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12, animation: 'fadeSlideUp 0.5s ease' }}>
        <div
          style={{
            background: 'linear-gradient(135deg, #0a0a0a, #111)',
            border: '1px solid #2a2a2a',
            borderRadius: 16,
            padding: 0,
            maxWidth: '85%',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid #1a1a1a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span style={{ fontFamily: mono, fontSize: 12, fontWeight: 700, color: '#fff', letterSpacing: 0.5 }}>
              {msg.card.title}
            </span>
            <span
              style={{
                fontFamily: mono,
                fontSize: 10,
                color: '#22c55e',
                background: 'rgba(34,197,94,0.1)',
                padding: '3px 10px',
                borderRadius: 20,
                border: '1px solid rgba(34,197,94,0.2)',
              }}
            >
              ● {msg.card.status}
            </span>
          </div>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ fontFamily: mono, fontSize: 13, color: '#aaa', marginBottom: 14 }}>
              {msg.card.name}
            </div>
            <div style={{ display: 'flex', gap: 16 }}>
              {msg.card.metrics.map((m, i) => (
                <div key={i} style={{ flex: 1 }}>
                  <div
                    style={{
                      fontFamily: mono,
                      fontSize: 10,
                      color: '#666',
                      marginBottom: 4,
                      textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}
                  >
                    {m.label}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 18, color: '#ff6b2c', fontWeight: 700 }}>
                    {m.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12,
        animation: 'fadeSlideUp 0.4s ease',
      }}
    >
      <div
        style={{
          background: isUser ? 'rgba(255,107,0,0.12)' : '#111',
          border: isUser ? '1px solid rgba(255,107,0,0.25)' : '1px solid #222',
          borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
          padding: '10px 16px',
          maxWidth: '80%',
          fontFamily: mono,
          fontSize: 12.5,
          lineHeight: 1.6,
          color: isUser ? '#ffcea0' : '#ccc',
        }}
      >
        {msg.text}
      </div>
    </div>
  )
}

export function AgentChat() {
  const [visibleCount, setVisibleCount] = useState(0)
  const [showTyping, setShowTyping] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (visibleCount >= CHAT_MESSAGES.length) {
      const resetTimer = setTimeout(() => {
        setShowTyping(false)
        setVisibleCount(0)
        if (chatRef.current) chatRef.current.scrollTop = 0
      }, 3000)
      return () => clearTimeout(resetTimer)
    }

    const nextMsg = CHAT_MESSAGES[visibleCount]
    const delay = visibleCount === 0 ? 1500 : nextMsg.delay - (CHAT_MESSAGES[visibleCount - 1]?.delay || 0)

    if (nextMsg.role === 'assistant') {
      const typingTimer = setTimeout(() => setShowTyping(true), Math.max(0, delay - 800))
      const msgTimer = setTimeout(() => {
        setShowTyping(false)
        setVisibleCount((c) => c + 1)
      }, delay)
      return () => {
        clearTimeout(typingTimer)
        clearTimeout(msgTimer)
      }
    }

    const timer = setTimeout(() => setVisibleCount((c) => c + 1), delay)
    return () => clearTimeout(timer)
  }, [visibleCount])

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [visibleCount, showTyping])

  return (
    <div
      style={{
        background: '#0a0a0a',
        border: '1px solid #1a1a1a',
        borderRadius: 20,
        overflow: 'hidden',
        width: 520,
        boxShadow: '0 0 80px rgba(255,107,0,0.04), 0 20px 60px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '16px 20px',
          borderBottom: '1px solid #1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #ff6b2c, #ff8533)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: mono,
              fontSize: 14,
              fontWeight: 800,
              color: '#000',
            }}
          >
            B
          </div>
          <div>
            <div style={{ fontFamily: mono, fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: 0.3 }}>
              Sophie
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
              Online
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: '#555' }} />
          ))}
        </div>
      </div>

      {/* Body */}
      <div
        ref={chatRef}
        style={{
          padding: '20px 16px',
          height: 400,
          overflowY: 'auto',
          scrollBehavior: 'smooth',
        }}
      >
        {CHAT_MESSAGES.slice(0, visibleCount).map((msg, i) => (
          <ChatMessage key={i} msg={msg} />
        ))}
        {showTyping && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12, animation: 'fadeSlideUp 0.3s ease' }}>
            <div
              style={{
                background: '#111',
                border: '1px solid #222',
                borderRadius: '14px 14px 14px 4px',
                padding: '10px 16px',
              }}
            >
              <TypingDots />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div
        style={{
          padding: '14px 16px',
          borderTop: '1px solid #1a1a1a',
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            flex: 1,
            background: '#111',
            border: '1px solid #222',
            borderRadius: 12,
            padding: '10px 16px',
            fontFamily: mono,
            fontSize: 12,
            color: '#555',
          }}
        >
          Descreva o que você precisa...
        </div>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: '#ff6b2c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </div>
      </div>
    </div>
  )
}
