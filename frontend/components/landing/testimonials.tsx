'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

const testimonials = [
  {
    quote:
      'Antes da Baisync, nossos consultores perdiam horas respondendo as mesmas dúvidas no WhatsApp. Agora o agente de IA qualifica os leads automaticamente e só encaminha os casos que realmente precisam de consultoria humana. Nossa taxa de conversão subiu 54% no primeiro mês.',
    name: 'Planejare Consultoria',
    role: 'Empresa de Consultoria',
    logo: '/clients/planejare.jpg',
  },
  {
    quote:
      'Integramos a Baisync ao nosso suporte e o resultado foi imediato: tempo de resposta caiu de 2 horas para 3 segundos. Nossos clientes recebem ajuda 24/7 sem precisar esperar o horário comercial. O churn reduziu 32% em 60 dias.',
    name: 'SeverinoPro',
    role: 'SaaS de Gestão Empresarial',
    logo: '/clients/severino-pro.jpg',
  },
  {
    quote:
      'Recebíamos centenas de mensagens por dia perguntando sobre disponibilidade de salas, preços e horários. O agente da Baisync responde tudo instantaneamente, faz reservas e envia confirmação. Liberamos a equipe para focar na experiência presencial dos nossos membros.',
    name: 'Hub FDS',
    role: 'Fábrica de Sonhos — Centro de Inovação',
    logo: '/clients/hub-fds.jpg',
  },
];

function StarRating() {
  return (
    <div className="mb-3 flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <svg
          key={i}
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="#ff6b2c"
          stroke="none"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26" />
        </svg>
      ))}
    </div>
  );
}

export function Testimonials() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [visibleCards, setVisibleCards] = useState<Set<number>>(new Set());

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const cards = section.querySelectorAll('[data-testimonial-index]');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const index = Number(
              (entry.target as HTMLElement).dataset.testimonialIndex
            );
            setTimeout(() => {
              setVisibleCards((prev) => new Set([...prev, index]));
            }, index * 150);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-24 px-6 font-[family-name:var(--font-jetbrains-mono)]"
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            O que nossos clientes dizem
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          {testimonials.map((t, i) => (
            <div
              key={i}
              data-testimonial-index={i}
              className="group relative rounded-xl border border-dim bg-app p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#ff6b2c]/30"
              style={{
                opacity: visibleCards.has(i) ? 1 : 0,
                transform: visibleCards.has(i)
                  ? 'translateY(0)'
                  : 'translateY(20px)',
                transition: 'opacity 0.5s ease, transform 0.5s ease',
              }}
            >
              {/* Glassmorphism glow on hover */}
              <div
                className="pointer-events-none absolute -inset-px rounded-xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{
                  background:
                    'radial-gradient(300px circle at 50% 50%, rgba(255,107,0,0.06), transparent 70%)',
                }}
              />

              <div className="relative">
                <StarRating />
                <p className="mb-6 text-sm italic leading-relaxed text-[#ccc]">
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 shrink-0 rounded-full overflow-hidden border border-[#222]">
                    <Image
                      src={t.logo}
                      alt={t.name}
                      width={36}
                      height={36}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{t.name}</p>
                    <p className="text-xs text-[#666]">{t.role}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
