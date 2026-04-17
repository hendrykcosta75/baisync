'use client'

import React, { useState, useEffect, useCallback, Component, type ErrorInfo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { Header } from '@/components/header'
import { useAuthStore } from '@/store/useAuthStore'
import { BaisyncBubble } from '@/components/baisync/baisync-bubble'
import { BaisyncPanel } from '@/components/baisync/baisync-panel'
import { useRealtimeEvents } from '@/lib/useRealtimeEvents'
import { ErrorModal } from '@/components/error-modal'
import { ToastContainer } from '@/components/toast-container'
import { GuestApprovalToast } from '@/components/meetings/GuestApprovalToast'
import { ActiveMeetingContainer } from '@/components/meetings/ActiveMeetingContainer'
import { useApiKeysStore } from '@/store/useApiKeysStore'

const DEFAULT_WIDTH = 220

class BaisyncErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[baisync] render error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed bottom-6 right-6 z-50 p-4 rounded-xl max-w-[350px] glass-card" style={{ border: '1px solid rgba(239,68,68,0.3)' }}>
          <p className="text-xs text-red-400 font-medium mb-1">Baisync Agent encontrou um erro</p>
          <p className="text-[10px] text-[#5a5a5a] break-all">{this.state.error}</p>
          <button
            className="mt-2 px-3 py-1 rounded-lg text-xs cursor-pointer"
            style={{ background: '#ff6b2c', color: '#fff' }}
            onClick={() => this.setState({ hasError: false, error: '' })}
          >
            Tentar novamente
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH)
  const [mounted, setMounted] = useState(false)
  const { isAuthenticated, fetchMe } = useAuthStore()
  const apiKeysHasFetched = useApiKeysStore(s => s.hasFetched)
  const fetchApiKeys = useApiKeysStore(s => s.fetchKeys)
  const router = useRouter()

  // SSE connection for realtime updates across all dashboard pages
  useRealtimeEvents()

  // Listen for workspace removal — auto-switch to personal workspace
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const wsName = detail?.workspace_name || 'workspace'
      localStorage.removeItem('active-workspace-id')
      localStorage.removeItem('assistant-storage')
      localStorage.removeItem('api-keys-storage')
      alert(`Você foi removido do workspace "${wsName}".`)
      window.location.reload()
    }
    window.addEventListener('sse:workspace_member_removed', handler)
    return () => window.removeEventListener('sse:workspace_member_removed', handler)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
    const saved = localStorage.getItem('sidebar-width')
    if (saved) {
      const w = parseInt(saved, 10)
      if (w >= 72 && w <= 320) setSidebarWidth(w)
    }
  }, [])

  const handleWidthChange = useCallback((wOrFn: number | ((prev: number) => number)) => {
    setSidebarWidth(prev => {
      const next = typeof wOrFn === 'function' ? wOrFn(prev) : wOrFn
      localStorage.setItem('sidebar-width', String(next))
      return next
    })
  }, [])

  useEffect(() => {
    if (!mounted) return
    if (!isAuthenticated) {
      router.replace('/login')
      return
    }
    fetchMe()
  }, [mounted, isAuthenticated, router, fetchMe])

  // Fetch configured API keys once per session so any dashboard page that reads
  // `configured[provider]` (model picker, assistant form, test panel) sees fresh
  // backend state instead of the persisted default (which can flash a false
  // "chave não configurada" warning until /dashboard/credentials is visited).
  useEffect(() => {
    if (!mounted || !isAuthenticated) return
    if (!apiKeysHasFetched) fetchApiKeys()
  }, [mounted, isAuthenticated, apiKeysHasFetched, fetchApiKeys])

  if (!mounted || !isAuthenticated) {
    return null
  }

  return (
    <div className="flex min-h-screen font-[family-name:var(--font-jetbrains-mono)] selection:bg-orange-500/20 overflow-x-hidden" style={{ background: 'var(--c-app)' }}>
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        width={sidebarWidth}
        onWidthChange={handleWidthChange}
      />

      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Decorative orbs — subtle */}
        <div className="decorative-orb pointer-events-none" style={{ width: 400, height: 400, top: -150, right: -150, opacity: 0.3, zIndex: 0 }} />
        <div className="decorative-orb pointer-events-none" style={{ width: 300, height: 300, top: -120, left: -120, opacity: 0.15, zIndex: 0 }} />
        <div className="decorative-orb pointer-events-none" style={{ width: 250, height: 250, bottom: 150, left: -100, opacity: 0.15, zIndex: 0 }} />

        <Header onMenuClick={() => setIsSidebarOpen(true)} />

        <main className="flex-1 overflow-y-auto p-5 lg:p-6 relative">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>

      <BaisyncBubble />
      <BaisyncErrorBoundary>
        <BaisyncPanel />
      </BaisyncErrorBoundary>
      <ErrorModal />
      <ToastContainer />
      <GuestApprovalToast />
      <ActiveMeetingContainer />
    </div>
  )
}
