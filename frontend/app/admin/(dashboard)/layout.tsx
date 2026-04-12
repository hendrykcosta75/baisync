'use client'

import React, { useState } from 'react'
import { AdminSidebar } from '@/components/admin-sidebar'
import { Menu } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen bg-black font-[family-name:var(--font-jetbrains-mono)] selection:bg-orange-500/20 overflow-x-hidden">
      <AdminSidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 flex items-center justify-between px-4 lg:px-6 border-b border-[#1a1a1a]" style={{ background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(12px)' }}>
          <button
            className="lg:hidden p-2 rounded-lg text-[#888] hover:text-white hover:bg-[#111] transition-colors"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span style={{ fontFamily: mono, fontSize: 12, color: '#555', letterSpacing: 1, textTransform: 'uppercase' }}>
            Painel Administrativo
          </span>
          <div />
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <div className="mx-auto max-w-7xl">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
