'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Dropdown } from '@heroui/react'
import { useAuthStore } from '@/store/useAuthStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { WorkspaceModal } from '@/components/workspace/workspace-modal'
import { Users } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { user, logout } = useAuthStore()
  const { activeWorkspace } = useWorkspaceStore()
  const router = useRouter()
  const [wsModalOpen, setWsModalOpen] = useState(false)

  const isPersonal = activeWorkspace?.workspace_type === 'personal'

  return (
    <>
      <header
        className="h-14 flex items-center justify-between px-4 lg:px-6 border-b border-[#2a2a2a] sticky top-0 z-30"
        style={{ background: '#0d0d0d' }}
      >
        <div className="flex items-center gap-3">
          {/* Mobile menu toggle */}
          <Button
            isIconOnly
            variant="ghost"
            className="lg:hidden text-[#8a8a8a] min-w-[40px] min-h-[40px] border-none"
            onPress={onMenuClick}
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25H12" />
            </svg>
          </Button>

          {/* PAINEL title with shimmer */}
          <span
            className="hidden sm:inline-block text-[13px] font-bold tracking-[2px] uppercase"
            style={{
              fontFamily: mono,
              background: 'linear-gradient(90deg, #ff6b2c, #ff8533, #ff6b2c)',
              backgroundSize: '200% 100%',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'baisync-text-shimmer 4s linear infinite',
            }}
          >
            PAINEL
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Workspace members button */}
          <button
            onClick={() => setWsModalOpen(true)}
            className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[#8a8a8a] hover:text-white hover:bg-[#252525] transition-colors relative"
            title="Membros do workspace"
          >
            <Users size={17} />
          </button>

          <NotificationBell />

          <Dropdown>
            <Dropdown.Trigger>
              <div
                role="button"
                tabIndex={0}
                className="w-[34px] h-[34px] rounded-full flex items-center justify-center text-[13px] font-semibold text-white cursor-pointer transition-opacity hover:opacity-80"
                style={{ background: '#ff6b2c' }}
              >
                {user?.name?.slice(0, 1).toUpperCase() || 'U'}
              </div>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Profile Actions" onAction={(key) => {
                if (key === 'settings') router.push('/dashboard/settings')
                if (key === 'logout') logout()
              }}>
                <Dropdown.Item id="profile" className="h-14 gap-2">
                  <p className="font-semibold">Conectado como</p>
                  <p className="font-semibold">{user?.email || 'Unknown'}</p>
                </Dropdown.Item>
                <Dropdown.Item id="settings">Minhas Configurações</Dropdown.Item>
                <Dropdown.Item id="help_and_feedback">Ajuda e Feedback</Dropdown.Item>
                <Dropdown.Item id="logout" variant="danger">
                  Sair
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </header>

      <WorkspaceModal isOpen={wsModalOpen} onClose={() => setWsModalOpen(false)} />
    </>
  )
}
