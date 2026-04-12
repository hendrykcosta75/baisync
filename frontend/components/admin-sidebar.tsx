'use client'

import React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Button } from '@heroui/react'
import { useAdminStore } from '@/store/useAdminStore'
import { LayoutDashboard, Users, Plug, Cpu } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function AdminSidebar({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { adminLogout } = useAdminStore()

  const links = [
    { name: 'Visao Geral', href: '/admin', icon: LayoutDashboard },
    { name: 'Usuarios', href: '/admin/users', icon: Users },
    { name: 'Integracoes', href: '/admin/integrations', icon: Plug },
    { name: 'Uso', href: '/admin/usage', icon: Cpu },
  ]

  const handleLogout = async () => {
    await adminLogout()
    router.replace('/admin/login')
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 border-r border-[#1a1a1a]
          transform transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static flex flex-col
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
        style={{ background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-[#1a1a1a]">
          <Link href="/admin" className="flex items-center gap-2.5">
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #FF6B00, #ff8533)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: mono,
                fontSize: 13,
                fontWeight: 800,
                color: '#000',
              }}
            >
              B
            </div>
            <span
              style={{
                fontFamily: mono,
                fontSize: 14,
                fontWeight: 700,
                color: '#fff',
                letterSpacing: 1,
              }}
            >
              BAISYNC ADMIN
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
          {links.map((link) => {
            const isActive = pathname === link.href
            return (
              <Link key={link.name} href={link.href}>
                <div
                  className={`
                    flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-sm
                    ${isActive
                      ? 'text-[#FF6B00]'
                      : 'text-[#888] hover:text-white hover:bg-[#111]'}
                  `}
                  style={{
                    fontFamily: mono,
                    fontWeight: isActive ? 700 : 500,
                    background: isActive ? 'rgba(255,107,0,0.1)' : undefined,
                  }}
                >
                  <link.icon size={16} className="shrink-0" />
                  {link.name}
                </div>
              </Link>
            )
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-[#1a1a1a]">
          <Button variant="ghost" className="w-full justify-start font-medium px-3 text-red-500 border-none" onPress={handleLogout}>
            Sair
          </Button>
        </div>
      </aside>
    </>
  )
}
