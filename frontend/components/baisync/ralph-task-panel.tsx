'use client'

import React from 'react'
import { useBaisyncStore } from '@/store/useBaisyncStore'
import type { RalphTask } from '@/types/ralph'

function TaskIcon({ status }: { status: RalphTask['status'] }) {
  if (status === 'done') {
    return <span style={{ color: '#28c840' }}>✓</span>
  }
  if (status === 'failed') {
    return <span style={{ color: '#ff3b3b' }}>✗</span>
  }
  if (status === 'running') {
    return <RunningDot />
  }
  return <span style={{ color: '#5a5a64' }}>○</span>
}

function RunningDot() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: '#ff7a1a',
        animation: 'ralph-pulse 1s ease-in-out infinite',
      }}
    />
  )
}

function statusLabel(status: RalphTask['status']): string {
  if (status === 'done') return 'done'
  if (status === 'failed') return 'err'
  if (status === 'running') return 'exec'
  return 'wait'
}

function statusColor(status: RalphTask['status']): string {
  if (status === 'done') return '#28c840'
  if (status === 'failed') return '#ff3b3b'
  if (status === 'running') return '#ff7a1a'
  return '#5a5a64'
}

export function RalphTaskPanel() {
  const ralphPlan = useBaisyncStore((s) => s.ralphPlan)

  if (!ralphPlan) return null

  const done = ralphPlan.tasks.filter((t) => t.status === 'done').length
  const total = ralphPlan.tasks.length

  return (
    <div
      style={{
        background: '#0e0e11',
        border: '0.5px solid #2a2a30',
        borderLeft: '2px solid #ff7a1a',
        borderRadius: '0 6px 6px 0',
        padding: '10px 12px',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        marginBottom: 2,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          paddingBottom: 6,
          borderBottom: '0.5px solid #2a2a30',
        }}
      >
        <span style={{ color: '#ff7a1a' }}>⚡</span>
        <span style={{ color: '#8a8a92', fontSize: 11 }}>ralph loop</span>
        <span style={{ marginLeft: 'auto', color: '#5a5a64', fontSize: 11 }}>
          {done}/{total}
        </span>
      </div>

      {/* Goal */}
      <div style={{ color: '#6b6b72', fontSize: 11, marginBottom: 8 }}>
        <span style={{ color: '#ff7a1a' }}>$</span>{' '}
        <span style={{ color: '#b5b5bc' }}>goal</span>{' '}
        <span style={{ color: '#e6e6e6' }}>{ralphPlan.overall_goal}</span>
      </div>

      {/* Task list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {ralphPlan.tasks.map((task, i) => (
          <div
            key={task.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              opacity: task.status === 'pending' ? 0.55 : 1,
              transition: 'opacity 0.3s',
            }}
          >
            {/* Index */}
            <span style={{ color: '#5a5a64', minWidth: 20, textAlign: 'right' }}>
              {String(i + 1).padStart(2, '0')}
            </span>

            {/* Status icon */}
            <span style={{ width: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TaskIcon status={task.status} />
            </span>

            {/* Title */}
            <span
              style={{
                flex: 1,
                color: task.status === 'done' ? '#8a8a92' : '#e6e6e6',
                textDecoration: task.status === 'done' ? 'line-through' : 'none',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {task.title}
            </span>

            {/* Status badge */}
            <span
              style={{
                fontSize: 10,
                color: statusColor(task.status),
                minWidth: 28,
                textAlign: 'right',
              }}
            >
              {statusLabel(task.status)}
            </span>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div
          style={{
            marginTop: 8,
            height: 2,
            background: '#1e1e24',
            borderRadius: 1,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.round((done / total) * 100)}%`,
              background: '#ff7a1a',
              borderRadius: 1,
              transition: 'width 0.5s ease',
            }}
          />
        </div>
      )}

      <style>{`
        @keyframes ralph-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </div>
  )
}
