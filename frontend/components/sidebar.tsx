'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAuthStore } from '@/store/useAuthStore'
import {
  LayoutDashboard, Bot, Banknote, CalendarDays, KeyRound, LogOut,
  MessageSquare, Users, Target, Map, Crosshair,
  ChevronDown,
} from 'lucide-react'
import { WorkspaceSwitcher } from '@/components/workspace/workspace-switcher'

const MIN_WIDTH = 72
const MAX_WIDTH = 320
const COLLAPSE_THRESHOLD = 140

interface NavLink {
  name: string
  href: string
  icon: React.ElementType
}

interface NavGroup {
  label: string
  links: NavLink[]
}

interface NavSection {
  label: string
  groups?: NavGroup[]
  links?: NavLink[]
}

const sections: NavSection[] = [
  {
    label: 'Workspace',
    groups: [
      {
        label: 'Planejamento',
        links: [
          { name: 'Objetivos e Resultados', href: '/dashboard/planning', icon: Target },
          { name: 'Mapa Estratégico', href: '/dashboard/strategy-map', icon: Map },
          { name: 'Análise SWOT', href: '/dashboard/swot', icon: Crosshair },
        ],
      },
      {
        label: 'Equipe',
        links: [
          { name: 'Grupos', href: '/dashboard/teams', icon: Users },
          { name: 'Canais', href: '/dashboard/chat', icon: MessageSquare },
        ],
      },
    ],
  },
  {
    label: 'Assistentes IA',
    links: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'Assistentes', href: '/dashboard/assistants', icon: Bot },
    ],
  },
  {
    label: 'Geral',
    links: [
      { name: 'Financeiro', href: '/dashboard/financeiro', icon: Banknote },
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

function NavItem({ link, collapsed, isActive }: { link: NavLink; collapsed: boolean; isActive: boolean }) {
  return (
    <li>
      <Link href={link.href} title={collapsed ? link.name : undefined}>
        <div
          className={`
            flex items-center gap-2.5 rounded-[10px] transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[#ff6b2c]/40 focus-visible:outline-none
            ${collapsed ? 'justify-center py-2.5 px-0' : 'py-2 px-3'}
            ${isActive
              ? 'sidebar-item-active'
              : 'text-[rgba(255,255,255,0.45)] hover:text-[rgba(255,255,255,0.88)] hover:bg-[rgba(255,255,255,0.03)]'}
          `}
          style={{
            fontFamily: "'Fira Code', 'JetBrains Mono', monospace",
            fontWeight: isActive ? 500 : 400,
            fontSize: 12,
          }}
        >
          <link.icon size={collapsed ? 18 : 14} className="shrink-0" style={{ opacity: isActive ? 1 : 0.6, color: isActive ? '#D4835A' : undefined }} />
          {!collapsed && (
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {link.name}
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}

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
  const [isDragging, setIsDragging] = useState(false)

  const collapsed = width <= COLLAPSE_THRESHOLD

  // Track which groups are expanded (by "sectionLabel/groupLabel" key)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => {
    // Default: all groups expanded
    const defaults: Record<string, boolean> = {}
    for (const section of sections) {
      if (section.groups) {
        for (const group of section.groups) {
          defaults[`${section.label}/${group.label}`] = false
        }
      }
    }
    return defaults
  })

  // Hover popover state for collapsed sidebar groups
  const [hoverPopover, setHoverPopover] = useState<{ key: string; top: number; left: number } | null>(null)
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openPopover = useCallback((key: string, top: number, left: number) => {
    if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null }
    setHoverPopover({ key, top, left })
  }, [])

  const closePopoverDelayed = useCallback(() => {
    hoverTimeoutRef.current = setTimeout(() => setHoverPopover(null), 120)
  }, [])

  const keepPopover = useCallback(() => {
    if (hoverTimeoutRef.current) { clearTimeout(hoverTimeoutRef.current); hoverTimeoutRef.current = null }
  }, [])

  // Auto-expand group containing active route
  useEffect(() => {
    for (const section of sections) {
      if (section.groups) {
        for (const group of section.groups) {
          if (group.links.some((l) => pathname === l.href)) {
            const key = `${section.label}/${group.label}`
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setExpandedGroups((prev) => ({ ...prev, [key]: true }))
          }
        }
      }
    }
  }, [pathname])

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startWidth: width }
    setIsDragging(true)
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
      setIsDragging(false)
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
          transition: isDragging ? 'none' : 'width 0.2s ease',
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

              {/* Flat links (no groups) */}
              {section.links && (
                <ul className="px-2.5 space-y-0.5">
                  {section.links.map((link) => (
                    <NavItem key={link.name} link={link} collapsed={collapsed} isActive={pathname === link.href} />
                  ))}
                </ul>
              )}

              {/* Grouped links with collapsible headers */}
              {section.groups && section.groups.map((group) => {
                const key = `${section.label}/${group.label}`
                const isExpanded = expandedGroups[key] ?? true
                const hasActiveChild = group.links.some((l) => pathname === l.href)

                if (collapsed) {
                  // Collapsed sidebar: one icon per group with hover popover
                  const groupIcons: Record<string, React.ElementType> = {
                    'Planejamento': Target,
                    'Equipe': Users,
                  }
                  const GroupIcon = groupIcons[group.label] || group.links[0]?.icon || Target

                  return (
                    <div key={key} className="relative px-2.5 mb-0.5">
                      <div
                        className="group/popover"
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect()
                          openPopover(key, rect.top, rect.right + 8)
                        }}
                        onMouseLeave={closePopoverDelayed}
                      >
                        <button
                          className={`w-full flex items-center justify-center py-2.5 rounded-[10px] transition-all duration-200
                            ${hasActiveChild ? 'sidebar-item-active' : 'text-[rgba(255,255,255,0.45)] hover:text-[rgba(255,255,255,0.88)] hover:bg-[rgba(255,255,255,0.03)]'}
                          `}
                          title={group.label}
                        >
                          <GroupIcon size={18} className="shrink-0" style={{ opacity: hasActiveChild ? 1 : 0.6, color: hasActiveChild ? '#D4835A' : undefined }} />
                        </button>

                        {/* Hover popover */}
                        {hoverPopover?.key === key && (
                          <div
                            className="fixed z-[80] rounded-xl border border-dim shadow-2xl py-2 min-w-[180px]"
                            style={{
                              top: hoverPopover.top,
                              left: hoverPopover.left,
                              background: '#1a1a1a',
                            }}
                            onMouseEnter={keepPopover}
                            onMouseLeave={closePopoverDelayed}
                          >
                            <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#4a4a4a]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>
                              {group.label}
                            </div>
                            {group.links.map((link) => {
                              const isActive = pathname === link.href
                              return (
                                <Link key={link.href} href={link.href} onClick={onClose}>
                                  <div className={`flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg transition-colors ${isActive ? 'text-[#D4835A] bg-[rgba(255,107,44,0.08)]' : 'text-[rgba(255,255,255,0.6)] hover:text-white hover:bg-[rgba(255,255,255,0.04)]'}`}
                                       style={{ fontFamily: "'Fira Code', 'JetBrains Mono', monospace", fontSize: 12 }}>
                                    <link.icon size={14} style={{ color: isActive ? '#D4835A' : undefined, opacity: isActive ? 1 : 0.6 }} />
                                    <span>{link.name}</span>
                                  </div>
                                </Link>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                }

                return (
                  <div key={key} className="mb-0.5">
                    <button
                      onClick={() => toggleGroup(key)}
                      className={`
                        w-full flex items-center gap-2 px-5 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors duration-150
                        ${hasActiveChild ? 'text-[#D4835A]/80' : 'text-[#4a4a4a] hover:text-[#6a6a6a]'}
                      `}
                      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                    >
                      <ChevronDown
                        size={10}
                        className={`transition-transform duration-200 ${isExpanded ? '' : '-rotate-90'}`}
                      />
                      {group.label}
                    </button>
                    {isExpanded && (
                      <ul className="px-2.5 space-y-0.5">
                        {group.links.map((link) => (
                          <NavItem key={link.name} link={link} collapsed={collapsed} isActive={pathname === link.href} />
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </nav>

        {/* Footer: Logout */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }} className="p-3">
          <div title={collapsed ? 'Sair' : undefined}>
            <button
              className={`
                flex items-center gap-2.5 w-full rounded-lg transition-colors duration-200
                text-subtle hover:text-red-400 hover:bg-[rgba(239,68,68,0.05)]
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
