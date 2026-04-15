'use client'

import React from 'react'
import { X, AlertCircle, CheckCircle, Info } from 'lucide-react'
import { useToastStore } from '@/store/useToastStore'
import type { ToastType } from '@/store/useToastStore'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const ICON: Record<ToastType, React.ElementType> = {
  error: AlertCircle,
  success: CheckCircle,
  info: Info,
}

const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  error: { bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)', icon: '#ef4444' },
  success: { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', icon: '#22c55e' },
  info: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.25)', icon: '#3b82f6' },
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = ICON[toast.type]
        const colors = COLORS[toast.type]
        return (
          <div
            key={toast.id}
            className="flex items-start gap-2.5 px-4 py-3 rounded-xl border shadow-lg"
            style={{
              background: '#1a1a1a',
              borderColor: colors.border,
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              animation: 'toast-in 0.2s ease-out',
            }}
          >
            <Icon size={16} style={{ color: colors.icon, flexShrink: 0, marginTop: 1 }} />
            <p
              className="flex-1 text-[12px] leading-relaxed"
              style={{ color: '#c0c0c0', fontFamily: mono }}
            >
              {toast.message}
            </p>
            <button
              className="text-[#555] hover:text-white transition-colors shrink-0"
              onClick={() => removeToast(toast.id)}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
