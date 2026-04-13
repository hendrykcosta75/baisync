'use client';

import { useEffect, useRef, useState } from 'react';

interface PlanFeature {
  text: string;
}

interface Plan {
  name: string;
  badge?: string;
  monthlyPrice: string;
  annualPrice: string;
  period: string;
  description: string;
  features: PlanFeature[];
  cta: string;
  highlighted: boolean;
}

const plans: Plan[] = [
  {
    name: 'Free',
    monthlyPrice: 'R$0',
    annualPrice: 'R$0',
    period: '/mês',
    description: 'Perfeito para testar a plataforma',
    features: [
      { text: '1 agente de IA' },
      { text: '100 mensagens/mês' },
      { text: 'WhatsApp ou Telegram' },
      { text: 'Base de conhecimento básica' },
      { text: 'Suporte por email' },
    ],
    cta: 'Começar Grátis',
    highlighted: false,
  },
  {
    name: 'Pro',
    badge: 'MAIS POPULAR',
    monthlyPrice: 'R$97',
    annualPrice: 'R$77',
    period: '/mês',
    description: 'Para negócios que querem escalar',
    features: [
      { text: '5 agentes de IA' },
      { text: 'Mensagens ilimitadas' },
      { text: 'Todos os canais' },
      { text: 'Base de conhecimento avançada (RAG)' },
      { text: 'Analytics em tempo real' },
      { text: 'Suporte prioritário' },
    ],
    cta: 'Começar Agora',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    monthlyPrice: 'Sob consulta',
    annualPrice: 'Sob consulta',
    period: '',
    description: 'Para grandes operações',
    features: [
      { text: 'Agentes ilimitados' },
      { text: 'Mensagens ilimitadas' },
      { text: 'Todos os canais + API' },
      { text: 'IA personalizada e fine-tuning' },
      { text: 'SLA 99.99%' },
      { text: 'Gerente de conta dedicado' },
      { text: 'Integração customizada' },
    ],
    cta: 'Falar com Vendas',
    highlighted: false,
  },
];

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className="shrink-0 mt-0.5"
    >
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="#ff6b2c"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PricingSection() {
  const [annual, setAnnual] = useState(false);
  const [visible, setVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="planos" ref={sectionRef} className="w-full max-w-6xl mx-auto px-6 py-24">
      <style>{`
        @property --border-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }

        @keyframes rotate-border {
          to {
            --border-angle: 360deg;
          }
        }

        .pro-card-border {
          position: relative;
          background: #0a0a0a;
          border-radius: 16px;
        }

        .pro-card-border::before {
          content: "";
          position: absolute;
          inset: -1px;
          border-radius: 17px;
          background: conic-gradient(
            from var(--border-angle),
            transparent 40%,
            #ff6b2c 50%,
            transparent 60%
          );
          animation: rotate-border 3s linear infinite;
          z-index: -1;
          mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          mask-composite: exclude;
          padding: 1px;
        }

        .pro-card-border::after {
          content: "";
          position: absolute;
          inset: -1px;
          border-radius: 17px;
          background: conic-gradient(
            from var(--border-angle),
            transparent 40%,
            #ff6b2c 50%,
            transparent 60%
          );
          animation: rotate-border 3s linear infinite;
          z-index: -2;
          filter: blur(12px);
          opacity: 0.4;
        }

        .price-transition {
          transition: opacity 0.3s ease, transform 0.3s ease;
        }
      `}</style>

      {/* Header */}
      <div
        className="text-center mb-16"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(32px)',
          transition: 'opacity 0.7s ease-out, transform 0.7s ease-out',
        }}
      >
        <span className="inline-block text-[#ff6b2c] text-xs tracking-[0.25em] uppercase font-[family-name:var(--font-jetbrains-mono)] font-semibold mb-4">
          PLANOS
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-white font-[family-name:var(--font-jetbrains-mono)] mb-4">
          Escolha o plano ideal para seu negócio.
        </h2>
        <p className="text-[#888] max-w-xl mx-auto text-sm leading-relaxed font-[family-name:var(--font-jetbrains-mono)]">
          Comece gratuitamente e escale conforme seu negócio cresce.
          Sem surpresas, sem taxas escondidas.
        </p>
      </div>

      {/* Toggle */}
      <div
        className="flex justify-center items-center gap-4 mb-14"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(24px)',
          transition: 'opacity 0.7s ease-out 0.1s, transform 0.7s ease-out 0.1s',
        }}
      >
        <span
          className="text-sm font-[family-name:var(--font-jetbrains-mono)] transition-colors duration-300"
          style={{ color: !annual ? '#ff6b2c' : '#555' }}
        >
          Mensal
        </span>
        <button
          onClick={() => setAnnual(!annual)}
          className="relative w-12 h-6 rounded-full transition-colors duration-300 cursor-pointer"
          style={{ background: annual ? '#ff6b2c' : '#333' }}
          aria-label="Alternar entre mensal e anual"
        >
          <div
            className="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform duration-300"
            style={{ transform: annual ? 'translateX(28px)' : 'translateX(4px)' }}
          />
        </button>
        <span className="flex items-center gap-2">
          <span
            className="text-sm font-[family-name:var(--font-jetbrains-mono)] transition-colors duration-300"
            style={{ color: annual ? '#ff6b2c' : '#555' }}
          >
            Anual
          </span>
          <span className="text-[10px] font-bold font-[family-name:var(--font-jetbrains-mono)] px-2 py-0.5 rounded-full bg-[#ff6b2c]/15 text-[#ff6b2c] border border-[#ff6b2c]/30">
            -20%
          </span>
        </span>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans.map((plan, index) => {
          const price = annual ? plan.annualPrice : plan.monthlyPrice;
          const isPrice = price.startsWith('R$');
          const delay = index * 0.12;

          const card = (
            <div className="flex flex-col h-full p-6 md:p-8">
              {/* Badge */}
              {plan.badge && (
                <span className="inline-block self-start text-[10px] font-bold font-[family-name:var(--font-jetbrains-mono)] tracking-wider px-3 py-1 rounded-full bg-[#ff6b2c]/15 text-[#ff6b2c] border border-[#ff6b2c]/30 mb-4">
                  {plan.badge}
                </span>
              )}

              {/* Plan name */}
              <h3 className="text-lg font-bold text-white font-[family-name:var(--font-jetbrains-mono)] mb-2">
                {plan.name}
              </h3>

              {/* Price */}
              <div className="mb-1 price-transition">
                {isPrice ? (
                  <span className="text-4xl font-bold text-white font-[family-name:var(--font-jetbrains-mono)]">
                    {price}
                    <span className="text-sm font-normal text-[#666]">{plan.period}</span>
                  </span>
                ) : (
                  <span className="text-2xl font-bold text-white font-[family-name:var(--font-jetbrains-mono)]">
                    {price}
                  </span>
                )}
              </div>

              {/* Description */}
              <p className="text-[#666] text-sm font-[family-name:var(--font-jetbrains-mono)] mb-8">
                {plan.description}
              </p>

              {/* Features */}
              <ul className="flex flex-col gap-3 mb-8 flex-1">
                {plan.features.map((feat) => (
                  <li
                    key={feat.text}
                    className="flex items-start gap-3 text-sm text-[#aaa] font-[family-name:var(--font-jetbrains-mono)]"
                  >
                    <CheckIcon />
                    {feat.text}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              {plan.highlighted ? (
                <button
                  className="w-full py-3 rounded-xl text-sm font-semibold font-[family-name:var(--font-jetbrains-mono)] cursor-pointer transition-all duration-300 hover:brightness-110"
                  style={{
                    background: '#ff6b2c',
                    color: '#000',
                  }}
                >
                  {plan.cta}
                </button>
              ) : (
                <button
                  className="w-full py-3 rounded-xl text-sm font-semibold font-[family-name:var(--font-jetbrains-mono)] cursor-pointer transition-all duration-300 hover:bg-white/5"
                  style={{
                    background: 'transparent',
                    border: '1px solid #333',
                    color: '#ccc',
                  }}
                >
                  {plan.cta}
                </button>
              )}
            </div>
          );

          if (plan.highlighted) {
            return (
              <div
                key={plan.name}
                className="pro-card-border"
                style={{
                  opacity: visible ? 1 : 0,
                  transform: visible ? 'translateY(0)' : 'translateY(32px)',
                  transition: `opacity 0.7s ease-out ${delay}s, transform 0.7s ease-out ${delay}s`,
                }}
              >
                {card}
              </div>
            );
          }

          return (
            <div
              key={plan.name}
              className="rounded-2xl bg-app border border-dim"
              style={{
                opacity: visible ? 1 : 0,
                transform: visible ? 'translateY(0)' : 'translateY(32px)',
                transition: `opacity 0.7s ease-out ${delay}s, transform 0.7s ease-out ${delay}s`,
              }}
            >
              {card}
            </div>
          );
        })}
      </div>
    </section>
  );
}
