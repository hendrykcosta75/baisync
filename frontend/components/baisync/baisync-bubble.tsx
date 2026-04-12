'use client'

import { useEffect, useRef, useState } from 'react'
import { useBaisyncStore } from '@/store/useBaisyncStore'
import { Sparkles } from 'lucide-react'

const PARTICLES = [
  { anim: 'baisync-p0', delay: 0, dur: 3.2 },
  { anim: 'baisync-p1', delay: 0.8, dur: 2.8 },
  { anim: 'baisync-p2', delay: 1.6, dur: 3.5 },
  { anim: 'baisync-p3', delay: 2.2, dur: 3.0 },
  { anim: 'baisync-p4', delay: 0.4, dur: 3.4 },
  { anim: 'baisync-p5', delay: 1.2, dur: 2.6 },
]

export function BaisyncBubble() {
  const { isOpen, toggle, messages, rateLimit } = useBaisyncStore()

  const [pos, setPos] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('baisync-bubble-pos')
        if (saved) return JSON.parse(saved) as { right: number; bottom: number }
      } catch {}
    }
    return { right: 24, bottom: 24 }
  })

  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, right: 0, bottom: 0 })
  const hasMoved = useRef(false)

  useEffect(() => {
    if (!dragging) return

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStart.current.x
      const dy = e.clientY - dragStart.current.y
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) hasMoved.current = true

      setPos({
        right: Math.max(0, Math.min(dragStart.current.right - dx, window.innerWidth - 56)),
        bottom: Math.max(0, Math.min(dragStart.current.bottom - dy, window.innerHeight - 56)),
      })
    }

    const onMouseUp = () => {
      setDragging(false)
      if (!hasMoved.current) {
        toggle()
      } else {
        setPos((p) => {
          localStorage.setItem('baisync-bubble-pos', JSON.stringify(p))
          return p
        })
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging, toggle])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(true)
    hasMoved.current = false
    dragStart.current = { x: e.clientX, y: e.clientY, right: pos.right, bottom: pos.bottom }
  }

  if (isOpen) return null

  const showWarning = rateLimit && rateLimit.pct >= 80
  const unreadCount = messages.filter((m) => m.role === 'assistant').length

  return (
    <div style={{ position: 'fixed', right: pos.right, bottom: pos.bottom, zIndex: 9999, width: 56, height: 56, overflow: 'visible' }}>
      <button
        onMouseDown={handleMouseDown}
        className="relative w-14 h-14 rounded-full flex items-center justify-center group transition-all duration-300 hover:scale-110 active:scale-95"
        style={{
          cursor: dragging ? 'grabbing' : 'grab',
          background: '#0a0a0a',
          boxShadow: '0 4px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.06)',
        }}
      >
        <Sparkles size={22} className="text-[#ff6b2c] transition-transform duration-300 group-hover:scale-110" />

        {/* Unread / warning badge */}
        {(showWarning || unreadCount > 0) && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center px-1"
            style={{
              background: showWarning ? (rateLimit!.pct >= 90 ? '#ef4444' : '#f59e0b') : '#ff6b2c',
              borderColor: 'rgba(10,10,14,0.9)',
            }}
          >
            <span className="text-[9px] text-white font-bold leading-none">
              {showWarning ? '!' : unreadCount > 9 ? '9+' : unreadCount}
            </span>
          </span>
        )}

        {/* Tooltip */}
        <span
          className="absolute bottom-full right-0 mb-2 px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl"
          style={{
            background: 'rgba(20,20,24,0.9)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#EDF0F7',
          }}
        >
          Baisync Agent
        </span>
      </button>

      {/* Particles — rendered after button so they layer on top */}
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="pointer-events-none rounded-full"
          style={{
            position: 'absolute',
            zIndex: 1,
            width: 3,
            height: 3,
            left: '50%',
            top: '50%',
            background: '#ff6b2c',
            animation: `${p.anim} ${p.dur}s ease-in-out ${p.delay}s infinite`,
          }}
        />
      ))}
    </div>
  )
}
