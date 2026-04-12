'use client'

import React from 'react'
import Link from 'next/link'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function AuthLayout({
  children,
  footerContent,
}: {
  children: React.ReactNode
  footerContent?: React.ReactNode
}) {
  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row font-[family-name:var(--font-jetbrains-mono)]"
      style={{ background: '#000' }}
    >
      {/* Left Panel — Branding (hidden on mobile) */}
      <div
        className="hidden lg:flex lg:w-[45%] flex-col justify-between p-12 xl:p-16 relative overflow-hidden"
        style={{ background: '#000' }}
      >
        {/* Orange glow orbs */}
        <div className="absolute -top-40 -right-40 w-96 h-96 blur-[120px] rounded-full pointer-events-none" style={{ background: 'rgba(255,107,0,0.06)' }} />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 blur-[120px] rounded-full pointer-events-none" style={{ background: 'rgba(255,107,0,0.04)' }} />

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 relative z-10">
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #FF6B00, #ff8533)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: mono,
              fontSize: 15,
              fontWeight: 800,
              color: '#000',
            }}
          >
            B
          </div>
          <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: 1 }}>
            BAISYNC
          </span>
        </Link>

        {/* Tagline */}
        <div className="relative z-10 flex-1 flex flex-col justify-center max-w-md">
          <h1
            style={{
              fontFamily: mono,
              fontSize: 'clamp(28px, 3vw, 40px)',
              fontWeight: 800,
              color: '#fff',
              lineHeight: 1.2,
              letterSpacing: -0.5,
            }}
          >
            Automatize seu{' '}
            <span style={{ color: '#FF6B00' }}>atendimento</span>{' '}
            com IA.
          </h1>
          <p
            className="mt-4"
            style={{
              fontFamily: mono,
              fontSize: 14,
              color: '#666',
              lineHeight: 1.8,
            }}
          >
            Crie assistentes inteligentes e conecte ao WhatsApp, Telegram e mais canais em minutos.
          </p>
        </div>

        {/* Footer */}
        <p className="relative z-10" style={{ fontFamily: mono, fontSize: 12, color: '#333' }}>
          &copy; 2026 Baisync. Todos os direitos reservados.
        </p>
      </div>

      {/* Right Panel — Form */}
      <div
        className="w-full lg:w-[55%] min-h-screen flex flex-col justify-center px-6 sm:px-12 lg:px-16 xl:px-24 py-12 relative overflow-hidden"
        style={{ background: '#0a0a0a' }}
      >
        {/* Mobile glow orbs */}
        <div className="lg:hidden absolute -top-40 -right-40 w-64 h-64 blur-[100px] rounded-full pointer-events-none" style={{ background: 'rgba(255,107,0,0.08)' }} />

        {/* Mobile logo */}
        <div className="lg:hidden flex justify-center mb-10">
          <Link href="/" className="flex items-center gap-2.5">
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #FF6B00, #ff8533)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: mono,
                fontSize: 15,
                fontWeight: 800,
                color: '#000',
              }}
            >
              B
            </div>
            <span style={{ fontFamily: mono, fontSize: 20, fontWeight: 700, color: '#fff', letterSpacing: 1 }}>
              BAISYNC
            </span>
          </Link>
        </div>

        <div className="w-full max-w-md mx-auto">
          {children}

          {footerContent && (
            <div className="mt-8 text-center">
              {footerContent}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
