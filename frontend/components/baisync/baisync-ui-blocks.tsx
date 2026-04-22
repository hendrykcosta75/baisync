'use client'

import React from 'react'
import type { BaisyncUIBlock } from '@/store/useBaisyncStore'
import { useBaisyncStore } from '@/store/useBaisyncStore'
import { RalphTaskPanel } from './ralph-task-panel'
import { QrCode } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const termBox: React.CSSProperties = {
  background: '#111114',
  border: '0.5px solid #2a2a30',
  borderLeft: '2px solid #ff7a1a',
  borderRadius: '0 6px 6px 0',
  padding: '10px 12px',
  fontFamily: mono,
  fontSize: 13,
  lineHeight: 1.6,
  color: '#e6e6e6',
  animation: 'baisync-msg-in 0.25s ease-out',
}

interface UIBlockProps {
  block: BaisyncUIBlock
}

function QuestionBox({ block }: UIBlockProps) {
  const { sendMessage } = useBaisyncStore()
  const data = (block.data || {}) as { question?: string; options?: string[] }

  return (
    <div style={termBox}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <span style={{ color: '#ff7a1a', flexShrink: 0 }}>?</span>
        <span style={{ color: '#e6e6e6' }}>{data.question || ''}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 14 }}>
        {data.options?.map((opt, i) => (
          <button
            key={i}
            onClick={() => sendMessage(opt)}
            className="cursor-pointer text-left transition-colors duration-200"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              fontSize: 12,
              color: '#b5b5bc',
              background: 'transparent',
              border: '0.5px dashed #2a2a30',
              borderRadius: 4,
              fontFamily: mono,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#ff7a1a'
              e.currentTarget.style.color = '#e6e6e6'
              e.currentTarget.style.background = '#0b0b0d'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#2a2a30'
              e.currentTarget.style.color = '#b5b5bc'
              e.currentTarget.style.background = 'transparent'
            }}
          >
            <span style={{ color: '#ff7a1a', fontSize: 11 }}>[{String(i + 1).padStart(2, '0')}]</span>
            <span>{opt}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function QRCodeDisplay({ block }: UIBlockProps) {
  const data = (block.data || {}) as { assistant_id?: string; message?: string }

  return (
    <div style={termBox}>
      <div style={{ color: '#6b6b72', marginBottom: 6 }}>$ qr --generate</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div
          style={{
            width: 44,
            height: 44,
            background: '#070708',
            border: '0.5px solid #2a2a30',
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <QrCode size={24} color="#ff7a1a" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#e6e6e6', fontSize: 12 }}>{data.message || 'escaneie o qr code'}</div>
          <div style={{ color: '#8a8a92', fontSize: 11, marginTop: 2 }}>
            # disponível na aba integrações do assistente
          </div>
        </div>
      </div>
      <a
        href={data.assistant_id ? `/dashboard/assistants/${data.assistant_id}?tab=integrations` : '#'}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: '#ff7a1a',
          textDecoration: 'none',
          fontFamily: mono,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline' }}
        onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none' }}
      >
        <span>→</span>
        <span>ir para integrações</span>
      </a>
    </div>
  )
}

function AssistantCard({ block }: UIBlockProps) {
  const data = (block.data || {}) as { name?: string; provider?: string; model?: string; status?: string }

  return (
    <div style={termBox}>
      <div style={{ color: '#6b6b72', marginBottom: 6 }}>$ assistant --create</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ color: '#28c840' }}>[✓]</span>
        <span style={{ color: '#e6e6e6' }}>{data.name || 'assistente'}</span>
      </div>
      <div style={{ color: '#8a8a92', fontSize: 12, paddingLeft: 28 }}>
        <div>
          <span style={{ color: '#6b6b72' }}>provider:</span> {data.provider || '--'}
        </div>
        <div>
          <span style={{ color: '#6b6b72' }}>model:</span>{' '}
          <span style={{ color: '#b5b5bc' }}>{data.model || '--'}</span>
        </div>
        <div style={{ marginTop: 4 }}>
          <span style={{ color: '#6b6b72' }}>status:</span>{' '}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: '#28c840',
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 6, height: 6, borderRadius: '50%', background: '#28c840', display: 'inline-block' }}
            />
            {data.status || 'criado'}
          </span>
        </div>
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
    case 'ralph_tasks':
      return <RalphTaskPanel />
    default:
      return null
  }
}
