import Link from 'next/link'
import { LandingNavbar } from '@/components/landing-navbar'
import SolutionSection from '@/components/solution-section'
import { ParticleBackground } from '@/components/landing/particle-background'
import { ProblemSection } from '@/components/landing/problem-section'
import { IntegrationTabs } from '@/components/landing/integration-tabs'
import { MetricsCounter } from '@/components/landing/metrics-counter'
import { PricingSection } from '@/components/landing/pricing-section'
import { Testimonials } from '@/components/landing/testimonials'
import { FaqSection } from '@/components/landing/faq-section'
import { LandingFooter } from '@/components/landing/landing-footer'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export default function Home() {
  return (
    <div className="min-h-screen bg-black text-white font-[family-name:var(--font-jetbrains-mono)]">
      <LandingNavbar />

      {/* Hero Section */}
      <section
        className="relative overflow-hidden"
        style={{ background: '#0d0907', minHeight: 640 }}
      >
        <ParticleBackground />

        {/* Soft warm glow on the left */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse at 30% 50%, rgba(255,106,26,0.18) 0%, rgba(13,9,7,0) 55%)',
            zIndex: 1,
          }}
        />

        {/* Centered content */}
        <div
          className="relative z-10 flex flex-col items-center justify-center text-center px-6 py-20 sm:py-24"
          style={{ minHeight: 640 }}
        >
          {/* Heading */}
          <h1
            style={{
              fontFamily: mono,
              fontSize: 'clamp(32px, 5vw, 54px)',
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1.05,
              letterSpacing: -1,
              margin: 0,
              maxWidth: 780,
              animation: 'fadeSlideUp 0.7s ease 0.1s both',
            }}
          >
            Impulsione seu negócio
            <br />
            <span style={{ color: '#ff6a1a' }}>com</span> Inteligência Artificial
          </h1>

          {/* Subtitle */}
          <p
            style={{
              fontFamily: mono,
              marginTop: 20,
              fontSize: 14,
              color: 'rgba(255,220,200,0.65)',
              maxWidth: 480,
              lineHeight: 1.6,
              letterSpacing: 0.3,
              animation: 'fadeSlideUp 0.7s ease 0.25s both',
            }}
          >
            Crie agentes inteligentes para atendimento e receba consultoria
            especializada para transformar seu negócio com IA.
          </p>

          {/* CTAs */}
          <div
            className="flex flex-col sm:flex-row gap-3 mt-8"
            style={{ animation: 'fadeSlideUp 0.7s ease 0.4s both' }}
          >
            <Link
              href="/dashboard"
              className="group relative overflow-hidden inline-flex items-center justify-center transition-all duration-200 hover:brightness-110"
              style={{
                isolation: 'isolate',
                fontFamily: mono,
                background:
                  'linear-gradient(180deg, #ff7a2e 0%, #ff6a1a 55%, #e85a10 100%)',
                color: '#1a0e08',
                padding: '12px 22px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                textDecoration: 'none',
                boxShadow:
                  '6px 6px 14px rgba(0,0,0,0.55), -2px -2px 8px rgba(255,140,60,0.18), inset 0 1px 0 rgba(255,220,180,0.45), inset 0 -1px 0 rgba(120,40,0,0.35)',
              }}
            >
              <span
                aria-hidden
                className="btn-cta-shine"
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: '40%',
                  zIndex: -1,
                  pointerEvents: 'none',
                  background:
                    'linear-gradient(90deg, transparent 0%, rgba(255,220,180,0.18) 40%, rgba(255,240,215,0.5) 50%, rgba(255,220,180,0.18) 60%, transparent 100%)',
                  transform: 'translateX(-130%) skewX(-18deg)',
                }}
              />
              <span style={{ position: 'relative', zIndex: 1 }}>Começar Agora</span>
            </Link>
            <Link
              href="/login"
              className="text-center transition-all duration-200 hover:border-[#ff6b2c] hover:text-[#ff6b2c]"
              style={{
                fontFamily: mono,
                background: 'transparent',
                color: '#fff',
                border: '0.5px solid rgba(255,255,255,0.4)',
                padding: '12px 22px',
                borderRadius: 6,
                fontSize: 11,
                letterSpacing: 1.5,
                textTransform: 'uppercase',
                textDecoration: 'none',
              }}
            >
              Ver Demo
            </Link>
          </div>
        </div>

        {/* Bottom-right status */}
        <div
          className="absolute bottom-6 right-8 hidden sm:flex flex-col items-end gap-1.5"
          style={{
            zIndex: 4,
            fontFamily: mono,
            fontSize: 10,
            color: 'rgba(255,140,40,0.5)',
            letterSpacing: 1.5,
          }}
        >
          <div className="flex items-center gap-1.5">
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#ff6a1a',
                boxShadow: '0 0 8px #ff6a1a',
              }}
            />
            <span>SISTEMA ONLINE</span>
          </div>
          <div>v 2.4.0 · sync ativo</div>
        </div>

        {/* Bottom-left equalizer */}
        <div
          className="absolute bottom-6 left-8 hidden sm:flex items-center gap-2"
          style={{
            zIndex: 4,
            fontFamily: mono,
            fontSize: 10,
            color: 'rgba(255,255,255,0.4)',
            letterSpacing: 1.5,
          }}
        >
          <div className="flex gap-[3px] items-end">
            <div style={{ width: 2, height: 8, background: '#ff6a1a', opacity: 0.9 }} />
            <div style={{ width: 2, height: 12, background: '#ff6a1a', opacity: 0.7 }} />
            <div style={{ width: 2, height: 6, background: '#ff6a1a', opacity: 0.5 }} />
            <div style={{ width: 2, height: 10, background: '#ff6a1a', opacity: 0.8 }} />
          </div>
          <span>FLUXO ATIVO</span>
        </div>
      </section>

      {/* Glow Divider */}
      <div className="glow-divider my-4" />

      {/* Problem Section */}
      <ProblemSection />

      {/* Glow Divider */}
      <div className="glow-divider my-4" />

      {/* Solution Section */}
      <SolutionSection />

      {/* Feature Cards with Glow */}
      <section id="features" className="px-6 lg:px-12">
        <div
          className="max-w-[1200px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-5 pt-16 lg:pt-24"
          style={{ animation: 'fadeSlideUp 0.8s ease 0.5s both' }}
        >
          {[
            {
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6b2c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              ),
              title: 'Deploy Instantâneo',
              desc: 'Seu agente de IA ativo em minutos, sem necessidade de código ou configuração complexa.',
            },
            {
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6b2c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
              ),
              title: 'Multi-Canal',
              desc: 'WhatsApp, Instagram, Telegram, Web Chat — seu agente atende em todas as plataformas.',
            },
            {
              icon: (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6b2c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="20" x2="18" y2="10" />
                  <line x1="12" y1="20" x2="12" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="14" />
                </svg>
              ),
              title: 'Analytics em Tempo Real',
              desc: 'Métricas de atendimento, satisfação e performance do agente em dashboards ao vivo.',
            },
          ].map((f, i) => (
            <div
              key={i}
              className="glow-card group cursor-default transition-all duration-300 hover:-translate-y-1 bg-app border border-[#1a1a1a] hover:border-[#ff6b2c] rounded-2xl p-7 sm:p-8"
            >
              <div style={{ marginBottom: 16, width: 40, height: 40, borderRadius: 10, background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{f.icon}</div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 15,
                  fontWeight: 700,
                  color: '#fff',
                  marginBottom: 10,
                  letterSpacing: 0.3,
                }}
              >
                {f.title}
              </div>
              <div
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  color: '#666',
                  lineHeight: 1.7,
                }}
              >
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Metrics Counter */}
      <section className="px-6 lg:px-12 pt-20 lg:pt-28">
        <MetricsCounter />
      </section>

      {/* Glow Divider */}
      <div className="glow-divider mt-20" />

      {/* Integration Tabs */}
      <IntegrationTabs />

      {/* Glow Divider */}
      <div className="glow-divider my-4" />

      {/* Pricing Section */}
      <PricingSection />

      {/* Glow Divider */}
      <div className="glow-divider my-4" />

      {/* Testimonials */}
      <Testimonials />

      {/* Terminal CTA */}
      <section className="px-6 lg:px-12">
        <div
          className="max-w-[600px] mx-auto mt-8 lg:mt-12"
          style={{ animation: 'fadeSlideUp 0.8s ease 0.7s both' }}
        >
          <div
            style={{
              background: '#0a0a0a',
              border: '1px solid #1a1a1a',
              borderRadius: 14,
              overflow: 'hidden',
            }}
          >
            {/* Traffic lights + label */}
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid #1a1a1a',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff5f57' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#febc2e' }} />
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#28c840' }} />
              </div>
              <span style={{ fontFamily: mono, fontSize: 11, color: '#555', marginLeft: 8 }}>
                terminal
              </span>
            </div>
            {/* Command */}
            <div style={{ padding: '18px 22px' }}>
              <span style={{ fontFamily: mono, fontSize: 13, color: '#666' }}>{'>'} </span>
              <span style={{ fontFamily: mono, fontSize: 13, color: '#ccc' }}>Comece agora em </span>
              <span style={{ fontFamily: mono, fontSize: 13, color: '#ff6b2c', fontWeight: 700 }}>
                baisync.com/painel
              </span>
              <span
                className="animate-blink"
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 16,
                  background: '#ff6b2c',
                  marginLeft: 4,
                  verticalAlign: 'middle',
                }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Glow Divider */}
      <div className="glow-divider mt-20 mb-4" />

      {/* FAQ Section */}
      <FaqSection />

      {/* Footer */}
      <LandingFooter />
    </div>
  )
}
