'use client'

import React from 'react'
import Link from 'next/link'
import type { TeamWithStats } from '@/types/team'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function TeamCard({ team }: { team: TeamWithStats }) {
  const { task_counts } = team
  const total = task_counts.open + task_counts.in_progress + task_counts.done
  const healthColor =
    task_counts.done > task_counts.open
      ? '#22c55e'
      : task_counts.done === task_counts.open
        ? '#f59e0b'
        : '#ef4444'

  return (
    <Link href={`/dashboard/teams/${team.id}`}>
      <div
        className="rounded-xl p-5 transition-all duration-300 cursor-pointer group"
        style={{
          background: '#141414',
          border: '1px solid #1e1e1e',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 6px rgba(0,0,0,0.2)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,107,44,0.2)'
          e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 20px rgba(0,0,0,0.35)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = '#1e1e1e'
          e.currentTarget.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,0.04), 0 2px 6px rgba(0,0,0,0.2)'
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: team.color || '#ff6b2c' }}
          />
          <h3
            className="text-heading text-sm font-semibold truncate"
            style={{ fontFamily: mono }}
          >
            {team.name}
          </h3>
          <div
            className="w-2 h-2 rounded-full shrink-0 ml-auto"
            style={{ backgroundColor: healthColor }}
          />
        </div>

        {/* Description */}
        {team.description && (
          <p className="text-body text-sm leading-relaxed mb-4 line-clamp-2">
            {team.description}
          </p>
        )}

        {/* Members */}
        <div className="flex items-center gap-1 mb-4">
          {Array.from({ length: Math.min(team.member_count, 3) }).map((_, i) => (
            <div
              key={i}
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium text-heading"
              style={{
                background: '#1e1e1e',
                border: '1px solid #2a2a2a',
                marginLeft: i > 0 ? '-4px' : '0',
                zIndex: 3 - i,
              }}
            >
              {String.fromCharCode(65 + i)}
            </div>
          ))}
          {team.member_count > 3 && (
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-medium text-subtle"
              style={{
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                marginLeft: '-4px',
              }}
            >
              +{team.member_count - 3}
            </div>
          )}
          <span className="text-subtle text-xs ml-2">
            {team.member_count} {team.member_count === 1 ? 'membro' : 'membros'}
          </span>
        </div>

        {/* Task counts */}
        <div className="flex items-center gap-3 text-xs">
          <span className="text-subtle">
            <span style={{ color: '#f59e0b' }}>{task_counts.open}</span> abertas
          </span>
          <span className="text-[#1e1e1e]">·</span>
          <span className="text-subtle">
            <span style={{ color: '#3b82f6' }}>{task_counts.in_progress}</span> em progresso
          </span>
          <span className="text-[#1e1e1e]">·</span>
          <span className="text-subtle">
            <span style={{ color: '#22c55e' }}>{task_counts.done}</span> concluídas
          </span>
        </div>

        {/* OKR Progress */}
        {team.okr_progress !== null && team.okr_progress !== undefined && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-subtle text-[10px]" style={{ fontFamily: mono }}>
                OKRs
              </span>
              <span className="text-subtle text-[10px]">
                {Math.round(team.okr_progress * 100)}%
              </span>
            </div>
            <div className="h-1 rounded-full bg-dim overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.round(team.okr_progress * 100)}%`,
                  background: 'linear-gradient(90deg, #D4835A, #ff6b2c)',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  )
}
