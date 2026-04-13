'use client';

import { useEffect, useRef, useState } from 'react';

const problems = [
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
    title: 'Atendimento Lento',
    desc: 'Clientes esperam horas — ou dias — por uma resposta. 60% desistem antes de serem atendidos.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    title: 'Equipe Sobrecarregada',
    desc: 'Sua equipe gasta 80% do tempo respondendo as mesmas perguntas repetitivas.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <line x1="9" y1="10" x2="15" y2="10" />
        <line x1="12" y1="7" x2="12" y2="13" />
        <line x1="4" y1="4" x2="20" y2="20" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
    title: 'Leads Perdidos',
    desc: 'Mensagens não respondidas no WhatsApp significam vendas que nunca acontecem.',
  },
  {
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="14" />
        <line x1="6" y1="20" x2="6" y2="16" />
        <path d="M4 8l4-2 4 3 4-4 4 2" />
      </svg>
    ),
    title: 'Zero Visibilidade',
    desc: 'Sem métricas, sem dados. Decisões baseadas em achismo, não em números.',
  },
];

const headingLine1 = 'Seu atendimento está';
const headingLine2 = 'perdendo clientes.';

export function ProblemSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visibleCards, setVisibleCards] = useState<Set<number>>(new Set());
  const [headingVisible, setHeadingVisible] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const headingObs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setHeadingVisible(true);
          headingObs.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    const heading = section.querySelector('[data-heading]');
    if (heading) headingObs.observe(heading);

    const cards = section.querySelectorAll('[data-card-index]');
    const cardObs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(
              (entry.target as HTMLElement).dataset.cardIndex
            );
            setTimeout(() => {
              setVisibleCards((prev) => new Set([...prev, index]));
            }, index * 150);
            cardObs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    cards.forEach((card) => cardObs.observe(card));
    return () => {
      headingObs.disconnect();
      cardObs.disconnect();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-24 px-6 font-[family-name:var(--font-jetbrains-mono)] overflow-hidden"
    >
      {/* Red ambient glow — top center (Solflow-style) */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 800,
          height: 800,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.03) 40%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      {/* Red glow line divider at top */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2"
        style={{
          width: 600,
          height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(239,68,68,0.4), transparent)',
        }}
      />

      <div className="relative mx-auto max-w-5xl">
        <div data-heading className="mb-16 text-center">
          <span className="mb-4 inline-block text-xs font-semibold uppercase tracking-[0.2em] text-red-500">
            Por que existimos
          </span>

          {/* Animated heading — each character fades in sequentially */}
          <h2 className="text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
            {headingLine1.split('').map((char, i) => (
              <span
                key={`l1-${i}`}
                className="inline-block problem-heading-char"
                style={{
                  opacity: headingVisible ? 1 : 0,
                  transform: headingVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
                  transition: `opacity 0.4s ease ${i * 25}ms, transform 0.4s ease ${i * 25}ms`,
                }}
              >
                {char === ' ' ? '\u00A0' : char}
              </span>
            ))}
            {' '}
            <br className="hidden sm:block" />
            {headingLine2.split('').map((char, i) => (
              <span
                key={`l2-${i}`}
                className="inline-block problem-heading-char-red"
                style={{
                  opacity: headingVisible ? 1 : 0,
                  transform: headingVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
                  transition: `opacity 0.4s ease ${(headingLine1.length + i) * 25}ms, transform 0.4s ease ${(headingLine1.length + i) * 25}ms`,
                  color: '#ef4444',
                }}
              >
                {char === ' ' ? '\u00A0' : char}
              </span>
            ))}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {problems.map((problem, i) => (
            <div
              key={i}
              data-card-index={i}
              className="group relative rounded-xl border border-dim bg-app p-6 transition-all duration-300 hover:-translate-y-1 hover:border-red-500/40"
              style={{
                opacity: visibleCards.has(i) ? 1 : 0,
                transform: visibleCards.has(i)
                  ? 'translateY(0)'
                  : 'translateY(20px)',
                transition: 'opacity 0.5s ease, transform 0.5s ease',
              }}
            >
              {/* Red glow halo on hover */}
              <div
                className="pointer-events-none absolute -inset-1 rounded-xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                style={{
                  background: 'radial-gradient(300px circle at 50% 50%, rgba(239,68,68,0.1), transparent 70%)',
                  filter: 'blur(20px)',
                  zIndex: -1,
                }}
              />

              {/* Inner red glow border effect */}
              <div
                className="pointer-events-none absolute inset-0 rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  boxShadow: 'inset 0 0 30px rgba(239,68,68,0.05), 0 0 40px rgba(239,68,68,0.08)',
                }}
              />

              <div className="relative">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/10 text-red-400 transition-all duration-300 group-hover:bg-red-500/15 group-hover:border-red-500/40 group-hover:shadow-[0_0_20px_rgba(239,68,68,0.15)]">
                  {problem.icon}
                </div>
                <h3 className="mb-2 text-base font-semibold text-white">
                  {problem.title}
                </h3>
                <p className="text-sm leading-relaxed text-[#888]">
                  {problem.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Red glow at bottom */}
      <div
        className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2"
        style={{
          width: 600,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(239,68,68,0.05) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
    </section>
  );
}
