'use client'

import React from 'react'
import type { BaisyncUIBlock } from '@/store/useBaisyncStore'
import { useBaisyncStore } from '@/store/useBaisyncStore'
import { Bot, QrCode } from 'lucide-react'

const glassCard = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  backdropFilter: 'blur(8px)',
} as const

interface UIBlockProps {
  block: BaisyncUIBlock
}

function QuestionBox({ block }: UIBlockProps) {
  const { sendMessage } = useBaisyncStore()
  const data = (block.data || {}) as { question?: string; options?: string[] }

  return (
    <div className="rounded-xl p-4" style={{ ...glassCard, animation: 'baisync-msg-in 0.25s ease-out' }}>
      <p className="text-sm font-medium text-heading mb-3">{data.question || ''}</p>
      <div className="flex flex-wrap gap-2">
        {data.options?.map((opt, i) => (
          <button
            key={i}
            className="px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all duration-200 hover:-translate-y-0.5"
            style={{
              background: 'rgba(249,115,22,0.08)',
              border: '1px solid rgba(249,115,22,0.15)',
              color: '#ff6b2c',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(249,115,22,0.15)'
              e.currentTarget.style.borderColor = 'rgba(249,115,22,0.3)'
              e.currentTarget.style.boxShadow = '0 2px 8px rgba(249,115,22,0.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(249,115,22,0.08)'
              e.currentTarget.style.borderColor = 'rgba(249,115,22,0.15)'
              e.currentTarget.style.boxShadow = 'none'
            }}
            onClick={() => sendMessage(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

function QRCodeDisplay({ block }: UIBlockProps) {
  const data = (block.data || {}) as { assistant_id?: string; message?: string }

  return (
    <div className="rounded-xl p-4 flex flex-col items-center gap-3" style={{ ...glassCard, animation: 'baisync-msg-in 0.25s ease-out' }}>
      <div
        className="w-14 h-14 rounded-xl flex items-center justify-center"
        style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.15)' }}
      >
        <QrCode size={28} className="text-[#ff6b2c]" />
      </div>
      <p className="text-sm text-heading font-medium text-center">{data.message || 'Escaneie o QR Code'}</p>
      <p className="text-[11px] text-subtle text-center leading-relaxed">
        Acesse a aba de Integrações do assistente para visualizar e escanear o QR Code do Baileys.
      </p>
      <a
        href={data.assistant_id ? `/dashboard/assistants/${data.assistant_id}?tab=integrations` : '#'}
        className="px-4 py-2 rounded-lg text-xs font-medium transition-all duration-200 hover:-translate-y-0.5"
        style={{
          background: 'linear-gradient(135deg, #ff6b2c, #ff8533)',
          color: '#fff',
          boxShadow: '0 2px 8px rgba(249,115,22,0.2)',
        }}
      >
        Ir para Integrações
      </a>
    </div>
  )
}

function AssistantCard({ block }: UIBlockProps) {
  const data = (block.data || {}) as { name?: string; provider?: string; model?: string; status?: string }

  return (
    <div className="rounded-xl p-4 flex items-start gap-3" style={{ ...glassCard, animation: 'baisync-msg-in 0.25s ease-out' }}>
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
        style={{
          background: 'linear-gradient(135deg, #ff6b2c, #ff8533)',
          boxShadow: '0 2px 8px rgba(249,115,22,0.2)',
        }}
      >
        <Bot size={20} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-heading">{data.name || 'Assistente'}</p>
        <p className="text-[11px] text-subtle mt-0.5">{data.provider || '--'} / {data.model || '--'}</p>
        <span
          className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-0.5 rounded-full text-[10px] font-semibold"
          style={{ background: 'rgba(16,185,129,0.1)', color: '#34d399', border: '1px solid rgba(16,185,129,0.15)' }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#34d399' }} />
          {data.status || 'Criado'}
        </span>
      </div>
    </div>
  )
}

export function BaisyncUIBlockRenderer({ block }: UIBlockProps) {
  if (!block || !block.type) return null
  switch (block.type) {
    case 'question_box':
      return <QuestionBox block={block} />
    case 'qr_code':
      return <QRCodeDisplay block={block} />
    case 'assistant_card':
      return <AssistantCard block={block} />
    default:
      return null
  }
}
