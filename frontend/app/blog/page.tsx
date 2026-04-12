'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LandingNavbar } from '@/components/landing-navbar'
import { LandingFooter } from '@/components/landing/landing-footer'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const categories = ['Todos', 'IA & Automação', 'Atendimento', 'Produto', 'Cases']

const posts = [
  {
    slug: 'como-ia-transforma-atendimento',
    category: 'IA & Automação',
    tag: 'NOVO',
    title: 'Como a IA está transformando o atendimento ao cliente em 2026',
    excerpt: 'Descubra como empresas estão usando agentes de IA para responder clientes em segundos, qualificar leads automaticamente e escalar operações sem aumentar equipe.',
    date: '2 Abr 2026',
    readTime: '8 min',
    featured: true,
  },
  {
    slug: 'whatsapp-business-guia-completo',
    category: 'Atendimento',
    title: 'Guia Completo: WhatsApp Business com IA em 2026',
    excerpt: 'Tudo que você precisa saber para automatizar seu atendimento no WhatsApp usando agentes inteligentes. Do setup à primeira venda.',
    date: '28 Mar 2026',
    readTime: '12 min',
  },
  {
    slug: 'roi-agentes-ia-atendimento',
    category: 'Cases',
    title: 'ROI de agentes de IA: números reais de 50 empresas brasileiras',
    excerpt: 'Analisamos dados de 50 empresas que implementaram atendimento com IA. Os resultados: 68% mais conversão, 90% menos tempo de resposta.',
    date: '20 Mar 2026',
    readTime: '10 min',
  },
  {
    slug: 'chatbot-vs-agente-ia',
    category: 'IA & Automação',
    title: 'Chatbot vs Agente de IA: qual a diferença e por que importa',
    excerpt: 'Chatbots seguem scripts rígidos. Agentes de IA entendem contexto, aprendem e tomam decisões. Entenda por que a diferença muda tudo.',
    date: '15 Mar 2026',
    readTime: '6 min',
  },
  {
    slug: 'rag-base-conhecimento',
    category: 'Produto',
    title: 'Base de conhecimento com RAG: como seu agente aprende sobre seu negócio',
    excerpt: 'Explicamos como a tecnologia RAG permite que seu agente de IA acesse documentos, FAQs e dados internos para dar respostas precisas.',
    date: '10 Mar 2026',
    readTime: '7 min',
  },
  {
    slug: 'multi-canal-atendimento-ia',
    category: 'Atendimento',
    title: 'Atendimento multi-canal: WhatsApp, Telegram e Web Chat com um único agente',
    excerpt: 'Configure uma vez, atenda em todos os canais. Veja como unificar seu atendimento sem multiplicar a complexidade.',
    date: '5 Mar 2026',
    readTime: '5 min',
  },
]

function CategoryPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-full text-xs font-medium transition-all duration-300 cursor-pointer"
      style={{
        fontFamily: mono,
        background: active ? 'rgba(255, 107, 0, 0.12)' : 'transparent',
        border: active ? '1px solid #FF6B00' : '1px solid #222',
        color: active ? '#FF6B00' : '#666',
        letterSpacing: 0.5,
      }}
    >
      {label}
    </button>
  )
}

function BlogCard({ post, index }: { post: typeof posts[number]; index: number }) {
  return (
    <Link href={`/blog/${post.slug}`}>
      <article
        className="group glow-card rounded-xl border border-[#1a1a1a] bg-[#0a0a0a] overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-[#FF6B00]/30 h-full"
        style={{
          animation: `fadeSlideUp 0.6s ease ${index * 0.08}s both`,
        }}
      >
        <div
          className="h-1 w-full"
          style={{
            background: post.featured
              ? 'linear-gradient(90deg, #FF6B00, #ff8533, #FFB366)'
              : 'linear-gradient(90deg, #1a1a1a, #222, #1a1a1a)',
            transition: 'background 0.3s',
          }}
        />

        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full"
              style={{
                fontFamily: mono,
                background: 'rgba(255,107,0,0.08)',
                color: '#FF6B00',
                border: '1px solid rgba(255,107,0,0.15)',
              }}
            >
              {post.category}
            </span>
            {post.tag && (
              <span
                className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{
                  fontFamily: mono,
                  background: 'rgba(239,68,68,0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239,68,68,0.2)',
                }}
              >
                {post.tag}
              </span>
            )}
          </div>

          <h3
            className="mb-3 text-base font-bold text-white leading-snug group-hover:text-[#FF6B00] transition-colors duration-200"
            style={{ fontFamily: mono }}
          >
            {post.title}
          </h3>

          <p
            className="text-sm leading-relaxed text-[#666] mb-6"
            style={{ fontFamily: mono }}
          >
            {post.excerpt}
          </p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-[#555]" style={{ fontFamily: mono }}>
                {post.date}
              </span>
              <span className="text-[#333]">·</span>
              <span className="text-[11px] text-[#555]" style={{ fontFamily: mono }}>
                {post.readTime} leitura
              </span>
            </div>
            <span className="text-xs text-[#555] group-hover:text-[#FF6B00] transition-colors duration-200" style={{ fontFamily: mono }}>
              Ler →
            </span>
          </div>
        </div>
      </article>
    </Link>
  )
}

function FeaturedPost({ post }: { post: typeof posts[number] }) {
  return (
    <Link href={`/blog/${post.slug}`}>
      <article
        className="group glow-card rounded-2xl border border-[#1a1a1a] bg-[#0a0a0a] overflow-hidden transition-all duration-300 hover:border-[#FF6B00]/30 mb-12"
        style={{ animation: 'fadeSlideUp 0.6s ease both' }}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2">
          <div
            className="relative min-h-[200px] lg:min-h-[320px] flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #0a0a0a, #111)' }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="w-64 h-64 rounded-full opacity-20"
                style={{
                  background: 'radial-gradient(circle, #FF6B00 0%, transparent 70%)',
                  filter: 'blur(60px)',
                }}
              />
            </div>
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center"
                style={{
                  background: 'rgba(255,107,0,0.12)',
                  border: '1px solid rgba(255,107,0,0.25)',
                }}
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF6B00" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-[3px] text-[#FF6B00]" style={{ fontFamily: mono }}>
                ARTIGO EM DESTAQUE
              </span>
            </div>
          </div>

          <div className="p-8 lg:p-10 flex flex-col justify-center">
            <div className="flex items-center gap-3 mb-4">
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full"
                style={{
                  fontFamily: mono,
                  background: 'rgba(255,107,0,0.08)',
                  color: '#FF6B00',
                  border: '1px solid rgba(255,107,0,0.15)',
                }}
              >
                {post.category}
              </span>
              <span className="text-[11px] text-[#555]" style={{ fontFamily: mono }}>
                {post.date}
              </span>
            </div>

            <h2
              className="text-xl lg:text-2xl font-bold text-white leading-tight mb-4 group-hover:text-[#FF6B00] transition-colors duration-200"
              style={{ fontFamily: mono }}
            >
              {post.title}
            </h2>

            <p
              className="text-sm leading-relaxed text-[#777] mb-6"
              style={{ fontFamily: mono }}
            >
              {post.excerpt}
            </p>

            <div className="flex items-center gap-4">
              <span
                className="inline-flex items-center gap-2 text-xs font-semibold text-[#FF6B00] group-hover:gap-3 transition-all duration-200"
                style={{ fontFamily: mono }}
              >
                Ler artigo completo
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M12 5l7 7-7 7" />
                </svg>
              </span>
              <span className="text-[11px] text-[#444]" style={{ fontFamily: mono }}>
                {post.readTime} leitura
              </span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  )
}

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState('Todos')

  const filtered = activeCategory === 'Todos'
    ? posts
    : posts.filter((p) => p.category === activeCategory)

  const featured = filtered.find((p) => p.featured)
  const rest = filtered.filter((p) => !p.featured)

  return (
    <div className="min-h-screen bg-black text-white font-[family-name:var(--font-jetbrains-mono)]">
      <LandingNavbar />

      <div className="max-w-[1200px] mx-auto px-6 lg:px-12 pt-24 pb-16">
        <div className="mb-12" style={{ animation: 'fadeSlideUp 0.6s ease both' }}>
          <span
            className="inline-block text-[#FF6B00] text-xs tracking-[0.25em] uppercase font-semibold mb-4"
            style={{ fontFamily: mono }}
          >
            BLOG
          </span>
          <h1
            className="text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-4"
            style={{ fontFamily: mono, letterSpacing: -1 }}
          >
            Insights sobre IA e atendimento
          </h1>
          <p
            className="text-[#777] text-sm max-w-xl leading-relaxed"
            style={{ fontFamily: mono }}
          >
            Artigos, guias e cases sobre inteligência artificial aplicada a atendimento ao cliente, vendas e operações.
          </p>
        </div>

        {/* Category filters */}
        <div
          className="flex flex-wrap gap-2 mb-12"
          style={{ animation: 'fadeSlideUp 0.6s ease 0.1s both' }}
        >
          {categories.map((cat) => (
            <CategoryPill
              key={cat}
              label={cat}
              active={activeCategory === cat}
              onClick={() => setActiveCategory(cat)}
            />
          ))}
        </div>

        {/* Featured post */}
        {featured && <FeaturedPost post={featured} />}

        {/* Post grid */}
        {rest.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {rest.map((post, i) => (
              <BlogCard key={post.slug} post={post} index={i} />
            ))}
          </div>
        ) : !featured ? (
          <div className="text-center py-20">
            <p className="text-[#555] text-sm" style={{ fontFamily: mono }}>
              Nenhum artigo encontrado nessa categoria.
            </p>
          </div>
        ) : null}

        <div className="flex justify-center mt-16">
          <button
            className="px-8 py-3 rounded-xl text-sm font-medium transition-all duration-300 hover:border-[#FF6B00] hover:text-[#FF6B00] cursor-pointer"
            style={{
              fontFamily: mono,
              color: '#aaa',
              border: '1px solid #333',
              letterSpacing: 0.5,
            }}
          >
            Carregar mais artigos
          </button>
        </div>
      </div>

      <LandingFooter />
    </div>
  )
}
