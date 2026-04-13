'use client'

import React, { useCallback, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import { LayoutDashboard, Bot, Banknote, CalendarDays, KeyRound, LogOut, MessageSquare } from 'lucide-react'
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher'

const MIN_WIDTH = 72
const MAX_WIDTH = 320
const COLLAPSE_THRESHOLD = 140

const sections = [
  {
    label: 'Geral',
    links: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Financeiro', href: '/dashboard/financeiro', icon: Banknote },
    ],
  },
  {
    label: 'Ferramentas',
    links: [
      { name: 'Assistentes', href: '/dashboard/assistants', icon: Bot },
      { name: 'Canais', href: '/dashboard/chat', icon: MessageSquare },
      { name: 'Agenda', href: '/dashboard/calendar', icon: CalendarDays },
    ],
  },
  {
    label: 'Configuração',
    links: [
      { name: 'Credenciais', href: '/dashboard/credentials', icon: KeyRound },
    ],
  },
]

export function Sidebar({
  isOpen,
  onClose,
  width,
  onWidthChange,
}: {
  isOpen: boolean
  onClose: () => void
  width: number
  onWidthChange: (w: number | ((prev: number) => number)) => void
}) {
  const pathname = usePathname()
  const { logout } = useAuthStore()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)

  const collapsed = width <= COLLAPSE_THRESHOLD

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [width])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const delta = e.clientX - dragRef.current.startX
      const newWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragRef.current.startWidth + delta))
      onWidthChange(newWidth)
    }
    const handleMouseUp = (e: MouseEvent) => {
      if (!dragRef.current) return
      const movedDelta = Math.abs(e.clientX - dragRef.current.startX)
      dragRef.current = null
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (movedDelta < 5) {
        onWidthChange(prev => {
          const w = typeof prev === 'number' ? prev : width
          return w <= COLLAPSE_THRESHOLD ? 220 : MIN_WIDTH
        })
      } else {
        onWidthChange(prev => {
          const w = typeof prev === 'number' ? prev : width
          if (w <= COLLAPSE_THRESHOLD) return MIN_WIDTH
          if (w < 180) return 220
          return w
        })
      }
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [onWidthChange, width])

  return (
    <>
      {/* Mobile Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50
          transform lg:translate-x-0 lg:static flex flex-col
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{
          background: 'rgba(14, 14, 14, 0.85)',
          backdropFilter: 'blur(40px)',
          WebkitBackdropFilter: 'blur(40px)',
          boxShadow: '4px 0 24px rgba(0,0,0,0.4), 1px 0 0 rgba(255,255,255,0.02)',
          width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? width : 240,
          transition: dragRef.current ? 'none' : 'width 0.2s ease',
        }}
      >
        {/* Workspace Switcher (primary element) */}
        <WorkspaceSwitcher collapsed={collapsed} />

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2">
          {sections.map((section) => (
            <div key={section.label}>
              {!collapsed && (
                <div
                  className="px-5 pt-5 pb-1.5 text-[11px] font-semibold tracking-wider uppercase"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: '#5a5a5a', letterSpacing: '0.3px' }}
                >
                  {section.label}
                </div>
              )}
              {collapsed && <div className="h-3" />}
              <ul className="px-2.5 space-y-0.5">
                {section.links.map((link) => {
                  const isActive = pathname === link.href
                  return (
                    <li key={link.name}>
                      <Link href={link.href} title={collapsed ? link.name : undefined}>
                        <div
                          className={`
                            flex items-center gap-2.5 rounded-lg transition-all duration-200
                            ${collapsed ? 'justify-center py-2.5 px-0' : 'py-2 px-3'}
                            ${isActive
                              ? 'sidebar-item-active'
                              : 'text-[#8a8a8a] hover:text-[#f0f0f0] hover:bg-[#252525]'}
                          `}
                          style={{
                            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                            fontWeight: isActive ? 600 : 500,
                            fontSize: 13.5,
                          }}
                        >
                          <link.icon size={collapsed ? 20 : 18} className="shrink-0" style={{ opacity: isActive ? 1 : 0.7 }} />
                          {!collapsed && (
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
                              {link.name}
                            </span>
                          )}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Footer: Logout */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }} className="p-3">
          <div title={collapsed ? 'Sair' : undefined}>
            <button
              className={`
                flex items-center gap-2.5 w-full rounded-lg transition-colors duration-200
                text-[#8a8a8a] hover:text-red-400 hover:bg-[rgba(239,68,68,0.05)]
                ${collapsed ? 'justify-center py-2.5 px-0' : 'py-2 px-3'}
              `}
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontSize: 13, fontWeight: 500 }}
              onClick={logout}
            >
              <LogOut size={18} className="shrink-0" />
              {!collapsed && <span>Sair</span>}
            </button>
          </div>
        </div>

        {/* Drag handle */}
        <div
          className="hidden lg:block absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[#ff6b2c]/30 active:bg-[#ff6b2c]/50 transition-colors z-10"
          onMouseDown={handleMouseDown}
        />
      </aside>
    </>
  )
}
