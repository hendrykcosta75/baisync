'use client'

import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

function generateCycles(): string[] {
  const now = new Date()
  const year = now.getFullYear()
  const cycles: string[] = []
  for (let y = year - 1; y <= year + 1; y++) {
    for (let q = 1; q <= 4; q++) {
      cycles.push(`${y}-Q${q}`)
    }
  }
  return cycles
}

function formatCycle(cycle: string): string {
  const [year, quarter] = cycle.split('-')
  return `${quarter} ${year}`
}

export function CycleSelector({ value, onChange }: { value: string; onChange: (cycle: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const cycles = generateCycles()

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        className="flex items-center gap-2 px-3 py-2 rounded-[10px] text-sm font-medium transition-all duration-200 hover:bg-dim/50"
        style={{
          background: '#1a1a1a',
          border: '1px solid #1e1e1e',
          color: '#e2e0da',
          fontFamily: mono,
        }}
        onClick={() => setOpen(!open)}
      >
        {formatCycle(value)}
        <ChevronDown size={14} className="text-subtle" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-40 rounded-xl overflow-hidden z-30 max-h-[300px] overflow-y-auto"
          style={{ background: '#141414', border: '1px solid #1e1e1e', boxShadow: '0 12px 32px rgba(0,0,0,0.5)' }}
        >
          {cycles.map((cycle) => (
            <button
              key={cycle}
              className="w-full px-3 py-2 text-left text-sm transition-colors hover:bg-dim/50"
              style={{
                color: cycle === value ? '#ff6b2c' : '#c0c0c0',
                background: cycle === value ? 'rgba(255,107,44,0.08)' : 'transparent',
                fontFamily: mono,
              }}
              onClick={() => { onChange(cycle); setOpen(false) }}
            >
              {formatCycle(cycle)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
