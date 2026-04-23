'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { UserAvatar } from '@/components/user-avatar'
import { Users } from 'lucide-react'
import type { ChannelMember } from '@/store/useChannelStore'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export interface MentionCandidate {
  kind: 'user' | 'everyone'
  /** user uuid for users; the literal "todos" for the everyone row */
  value: string
  label: string
  email?: string | null
}

interface Props {
  members: ChannelMember[]
  /** Current user id — excluded from candidates so you don't mention yourself. */
  selfId: string | null
  query: string
  onSelect: (candidate: MentionCandidate) => void
  onClose: () => void
}

/** Matches "todos" variants so typing `@tod` still surfaces the everyone option. */
function matchesEveryone(query: string) {
  const q = query.toLowerCase()
  return q === '' || 'todos'.startsWith(q) || 'everyone'.startsWith(q) || 'all'.startsWith(q)
}

export function MentionAutocomplete({ members, selfId, query, onSelect, onClose }: Props) {
  const candidates = useMemo<MentionCandidate[]>(() => {
    const q = query.toLowerCase()
    const userMatches: MentionCandidate[] = members
      .filter((m) => m.user_id !== selfId)
      .filter((m) => {
        if (!q) return true
        const name = (m.user_name ?? '').toLowerCase()
        const email = (m.user_email ?? '').toLowerCase()
        return name.includes(q) || email.includes(q)
      })
      .slice(0, 8)
      .map((m) => ({
        kind: 'user' as const,
        value: m.user_id,
        label: m.user_name ?? m.user_email ?? 'Usuário',
        email: m.user_email,
      }))

    const list: MentionCandidate[] = []
    if (matchesEveryone(query)) {
      list.push({ kind: 'everyone', value: 'todos', label: 'todos', email: null })
    }
    list.push(...userMatches)
    return list
  }, [members, selfId, query])

  const [activeIndex, setActiveIndex] = useState(0)
  const [prevKey, setPrevKey] = useState(`${query}:${candidates.length}`)
  const currentKey = `${query}:${candidates.length}`
  if (prevKey !== currentKey) {
    setPrevKey(currentKey)
    setActiveIndex(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (candidates.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => (i + 1) % candidates.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length)
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        onSelect(candidates[activeIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [candidates, activeIndex, onSelect, onClose])

  if (candidates.length === 0) return null

  return (
    <div
      className="absolute bottom-full left-0 right-0 mb-2 rounded-xl overflow-hidden"
      style={{
        background: '#161616',
        border: '1px solid #1e1e1e',
        boxShadow: '0 8px 20px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.04)',
        maxHeight: 280,
        overflowY: 'auto',
        zIndex: 30,
      }}
      role="listbox"
      aria-label="Mencionar membro do canal"
    >
      <div
        className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
        style={{ fontFamily: mono, color: '#555555', borderBottom: '1px solid #1e1e1e' }}
      >
        Mencionar
      </div>
      {candidates.map((c, i) => {
        const active = i === activeIndex
        return (
          <button
            key={`${c.kind}:${c.value}`}
            type="button"
            role="option"
            aria-selected={active}
            onMouseEnter={() => setActiveIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              onSelect(c)
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors"
            style={{
              background: active ? 'rgba(255,107,44,0.08)' : 'transparent',
              borderLeft: active ? '2px solid #ff6b2c' : '2px solid transparent',
            }}
          >
            {c.kind === 'everyone' ? (
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'rgba(255,107,44,0.12)', color: '#ff6b2c' }}
                aria-hidden="true"
              >
                <Users size={14} />
              </div>
            ) : (
              <UserAvatar userId={c.value} name={c.label} size={28} />
            )}
            <div className="min-w-0 flex-1">
              <div
                className="text-[13px] font-medium truncate"
                style={{ fontFamily: mono, color: active ? '#e2e0da' : '#c0c0c0' }}
              >
                @{c.label}
              </div>
              {c.kind === 'everyone' ? (
                <div className="text-[11px] truncate" style={{ fontFamily: mono, color: '#555555' }}>
                  Notificar todos os membros do canal
                </div>
              ) : c.email ? (
                <div className="text-[11px] truncate" style={{ fontFamily: mono, color: '#555555' }}>
                  {c.email}
                </div>
              ) : null}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Given the current textarea value and caret position, return the active
 * mention "trigger" if the caret is inside a `@query` that we should autocomplete.
 * Returns `null` when no trigger is active.
 */
export function detectMentionTrigger(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  // Walk backwards from caret until we hit a trigger `@` or a disqualifying char.
  let i = caret
  while (i > 0) {
    const ch = value[i - 1]
    if (ch === '@') {
      // `@` must be at start of string or preceded by whitespace/punctuation — else
      // it's part of an email or similar, not a mention trigger.
      const prev = i >= 2 ? value[i - 2] : ''
      if (i === 1 || /\s/.test(prev) || /[,.;:!?(\[]/.test(prev)) {
        return { start: i - 1, query: value.slice(i, caret) }
      }
      return null
    }
    if (/\s/.test(ch)) return null
    i--
  }
  return null
}
