'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Menu, X } from 'lucide-react'
import { BaisyncLogo } from '@/components/baisync-logo'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

/* Reveal spans: each hidden letter-group expands from max-width:0 to its natural size */
function Reveal({ children, delay }: { children: React.ReactNode; delay: number }) {
  return (
    <span
      className="inline-block max-w-0 overflow-hidden opacity-0 transition-all duration-500 ease-out group-hover/logo:max-w-[80px] group-hover/logo:opacity-100"
      style={{ transitionDelay: `${delay}ms`, color: '#888', fontWeight: 400 }}
    >
      {children}
    </span>
  )
}

function LogoExpand() {
  // BAISYNC → Business, AI, sync
  // The accent letters (B, A, I, sync) are always visible.
  // On hover, the hidden parts ("usiness", commas, spaces) expand in sequence.
  return (
    <Link href="/" className="flex items-center gap-2.5 group/logo">
      {/* Icon — full 360° sync spin on hover */}
      <div className="group-hover/logo:rotate-[360deg] transition-transform duration-700 ease-in-out shrink-0">
        <BaisyncLogo size={46} />
      </div>

      {/* Text — single row, accent letters always visible, hidden parts expand */}
      <span
        className="inline-flex items-center whitespace-nowrap"
        style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, letterSpacing: 1, color: '#fff' }}
      >
        {/* B + usiness */}
        <span className="logo-shimmer-orange">B</span>
        <Reveal delay={0}>usiness</Reveal>

        {/* , (space) */}
        <Reveal delay={80}>,&nbsp;</Reveal>

        {/* AI */}
        <span className="logo-shimmer-orange">AI</span>

        {/* , (space) */}
        <Reveal delay={160}>,&nbsp;</Reveal>

        {/* sync — always visible, but lowercase only on hover via CSS */}
        <span className="transition-colors duration-300 group-hover/logo:text-[#ff6b2c]" style={{ color: '#fff' }}>
          <span className="inline group-hover/logo:hidden">SYNC</span>
          <span className="hidden group-hover/logo:inline">sync</span>
        </span>
      </span>
    </Link>
  )
}

export function LandingNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: 'rgba(10,7,5,0.30)',
        backdropFilter: 'blur(8px) saturate(150%)',
        WebkitBackdropFilter: 'blur(8px) saturate(150%)',
        borderBottom: '1px solid rgba(255,140,40,0.10)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)',
      }}
    >
      <div className="max-w-[1200px] mx-auto px-6 lg:px-12 h-16 flex items-center justify-between">
        {/* Logo */}
        <div className="relative">
          <LogoExpand />
        </div>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-8">
          {[
            { label: 'A SOLUÇÃO', href: '/#solution' },
            { label: 'RECURSOS', href: '/#features' },
            { label: 'PLANOS', href: '/#planos' },
            { label: 'BLOG', href: '/blog' },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="nav-link-underline transition-colors duration-200 hover:text-white"
              style={{
                fontFamily: mono,
                fontSize: 11,
                color: '#888',
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                textDecoration: 'none',
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        {/* Desktop CTAs */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="transition-colors duration-200 hover:text-white"
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: '#aaa',
              letterSpacing: 1,
              textTransform: 'uppercase',
              textDecoration: 'none',
            }}
          >
            ENTRAR
          </Link>
          <Link
            href="/dashboard"
            className="transition-all duration-200 hover:border-[#ff6b2c] hover:text-[#ff6b2c]"
            style={{
              fontFamily: mono,
              fontSize: 11,
              color: '#fff',
              letterSpacing: 1,
              textTransform: 'uppercase',
              textDecoration: 'none',
              border: '1px solid #333',
              padding: '8px 18px',
              borderRadius: 6,
            }}
          >
            IR PARA O PAINEL
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden flex items-center justify-center w-11 h-11 rounded-lg transition-colors"
          style={{ color: '#888' }}
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div
          className="md:hidden px-6 py-4 space-y-1"
          style={{
            borderTop: '1px solid rgba(255,140,40,0.08)',
            background: 'rgba(13,9,7,0.55)',
            backdropFilter: 'blur(20px) saturate(160%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%)',
          }}
        >
          {[
            { label: 'A SOLUÇÃO', href: '/#solution' },
            { label: 'RECURSOS', href: '/#features' },
            { label: 'PLANOS', href: '/#planos' },
            { label: 'BLOG', href: '/blog' },
          ].map((link) => (
            <Link
              key={link.label}
              href={link.href}
              className="block py-3 transition-colors duration-200 hover:text-white"
              style={{ fontFamily: mono, fontSize: 12, color: '#888', letterSpacing: 1.5, textDecoration: 'none' }}
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="flex flex-col gap-3 pt-3" style={{ borderTop: '1px solid #111' }}>
            <Link
              href="/login"
              className="block py-2 text-center transition-colors hover:text-white"
              style={{ fontFamily: mono, fontSize: 12, color: '#aaa', letterSpacing: 1, textDecoration: 'none' }}
              onClick={() => setMobileOpen(false)}
            >
              ENTRAR
            </Link>
            <Link
              href="/dashboard"
              className="block py-2.5 text-center rounded-md transition-all hover:border-[#ff6b2c] hover:text-[#ff6b2c]"
              style={{ fontFamily: mono, fontSize: 12, color: '#fff', letterSpacing: 1, border: '1px solid #333', textDecoration: 'none' }}
              onClick={() => setMobileOpen(false)}
            >
              IR PARA O PAINEL
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
