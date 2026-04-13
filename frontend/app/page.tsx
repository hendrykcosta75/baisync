import Link from 'next/link'
import { LandingNavbar } from '@/components/landing-navbar'
import { AgentChat } from '@/components/agent-chat'
import SolutionSection from '@/components/solution-section'
import { ParticleBackground } from '@/components/landing/particle-background'
import { SocialProof } from '@/components/landing/social-proof'
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
      <section className="relative overflow-hidden">
        <ParticleBackground />

        <div className="relative z-10 max-w-[1200px] mx-auto px-6 lg:px-12 pt-20 pb-16 lg:pt-24 lg:pb-20 flex flex-col lg:flex-row items-start gap-10 lg:gap-16">
          {/* Left — text */}
          <div className="flex-1 pt-5">
            {/* Badge */}
            <div
              className="inline-flex items-center gap-2 rounded-full mb-8"
              style={{
                border: '1px solid #222',
                padding: '6px 18px 6px 12px',
                animation: 'fadeSlideUp 0.6s ease',
              }}
            >
              <div
                className="animate-pulse-dot"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#ff6b2c',
                  boxShadow: '0 0 8px rgba(255,107,0,0.4)',
                }}
              />
              <span
                style={{
                  fontFamily: mono,
                  fontSize: 11,
                  color: '#aaa',
                  letterSpacing: 1.5,
                  textTransform: 'uppercase',
                }}
              >
                Agentes de IA + Consultoria Inteligente
              </span>
            </div>

            {/* Heading with gradient text */}
            <h1
              style={{
                fontFamily: mono,
                fontSize: 'clamp(32px, 4.5vw, 56px)',
                fontWeight: 800,
                color: '#fff',
                lineHeight: 1.15,
                marginBottom: 28,
                letterSpacing: -1,
                animation: 'fadeSlideUp 0.7s ease 0.1s both',
              }}
            >
              Impulsione seu
              <br />
              negócio{' '}
              <span className="gradient-text-orange">com</span>
              <br />
              Inteligência
              <br />
              Artificial
            </h1>

            {/* Subtitle */}
            <p
              style={{
                fontFamily: mono,
                fontSize: 14,
                color: '#777',
                lineHeight: 1.8,
                maxWidth: 460,
                marginBottom: 36,
                animation: 'fadeSlideUp 0.7s ease 0.25s both',
              }}
            >
              Crie agentes inteligentes para atendimento
              <br className="hidden sm:block" />
              {' '}e receba consultoria especializada para
              <br className="hidden sm:block" />
              {' '}transformar seu negócio com IA.
            </p>

            {/* CTAs */}
            <div
              className="flex flex-col sm:flex-row gap-3.5"
              style={{ animation: 'fadeSlideUp 0.7s ease 0.4s both' }}
            >
              <Link
                href="/dashboard"
                className="animated-border inline-block text-center transition-all duration-200 hover:opacity-90"
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#000',
                  background: '#ff6b2c',
                  padding: '12px 28px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                Começar Agora
              </Link>
              <Link
                href="/login"
                className="inline-block text-center transition-all duration-200 hover:border-[#ff6b2c] hover:text-[#ff6b2c]"
                style={{
                  fontFamily: mono,
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#aaa',
                  border: '1px solid #333',
                  padding: '12px 28px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                Ver Demo
              </Link>
            </div>

            {/* Social Proof */}
            <div className="mt-12">
              <SocialProof />
            </div>
          </div>

          {/* Right — chat (desktop only) */}
          <div
            className="hidden lg:block flex-shrink-0"
            style={{ animation: 'fadeSlideUp 0.8s ease 0.3s both' }}
          >
            <AgentChat />
          </div>
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
