'use client';

import { useEffect, useRef, useState } from 'react';

const headingLine1 = 'Sua receita está';
const headingLine2 = 'vazando.';

const mono = "'JetBrains Mono', 'Fira Code', monospace";

export function LeakingRevenueSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [headingVisible, setHeadingVisible] = useState(false);
  const [taglineVisible, setTaglineVisible] = useState(false);

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

    const taglineObs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTaglineVisible(true);
          taglineObs.disconnect();
        }
      },
      { threshold: 0.4 }
    );
    const tagline = section.querySelector('[data-tagline]');
    if (tagline) taglineObs.observe(tagline);

    return () => {
      headingObs.disconnect();
      taglineObs.disconnect();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative py-24 px-6 font-[family-name:var(--font-jetbrains-mono)] overflow-hidden"
    >
      {/* Red ambient glow — top center */}
      <div
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          width: 800,
          height: 800,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(239,68,68,0.07) 0%, rgba(239,68,68,0.02) 40%, transparent 70%)',
          filter: 'blur(60px)',
        }}
      />

      <div className="relative mx-auto max-w-5xl">
        <div data-heading className="mb-16 text-center">
          <span className="mb-4 inline-block text-xs font-semibold uppercase tracking-[0.2em] text-red-500">
            E tem mais
          </span>

          <h2 className="text-3xl font-bold text-white sm:text-4xl lg:text-5xl">
            {headingLine1.split('').map((char, i) => (
              <span
                key={`l1-${i}`}
                className="inline-block"
                style={{
                  opacity: headingVisible ? 1 : 0,
                  transform: headingVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
                  transition: `opacity 0.4s ease ${i * 25}ms, transform 0.4s ease ${i * 25}ms`,
                }}
              >
                {char === ' ' ? ' ' : char}
              </span>
            ))}
            {' '}
            <br className="hidden sm:block" />
            {headingLine2.split('').map((char, i) => (
              <span
                key={`l2-${i}`}
                className="inline-block"
                style={{
                  opacity: headingVisible ? 1 : 0,
                  transform: headingVisible ? 'translateY(0) scale(1)' : 'translateY(12px) scale(0.95)',
                  transition: `opacity 0.4s ease ${(headingLine1.length + i) * 25}ms, transform 0.4s ease ${(headingLine1.length + i) * 25}ms`,
                  color: '#ef4444',
                }}
              >
                {char === ' ' ? ' ' : char}
              </span>
            ))}
          </h2>
        </div>

        <svg
          viewBox="0 0 680 560"
          role="img"
          aria-label="Empresário desanimado vendo receita vazar com mensagens de clientes perdidos caindo"
          className="mx-auto block w-full max-w-[640px] h-auto"
        >
          <title>Empresário desanimado vendo receita vazar</title>
          <desc>Personagem triste no centro com mensagens de clientes perdidos caindo ao redor</desc>

          <defs>
            <radialGradient id="leakGlow5">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Cano / linha de receita no topo */}
          <g>
            <rect x="60" y="40" width="560" height="24" rx="2" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
            <text x="60" y="32" fontSize="10" fill="#666" fontFamily={mono}>
              RECEITA POTENCIAL
            </text>

            <circle cx="180" cy="64" r="3" fill="#0a0a0a" stroke="#ef4444" strokeWidth="0.5" />
            <circle cx="340" cy="64" r="3" fill="#0a0a0a" stroke="#ef4444" strokeWidth="0.5" />
            <circle cx="500" cy="64" r="3" fill="#0a0a0a" stroke="#ef4444" strokeWidth="0.5" />

            <circle cx="180" cy="64" r="12" fill="url(#leakGlow5)">
              <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="340" cy="64" r="12" fill="url(#leakGlow5)">
              <animate attributeName="r" values="8;14;8" dur="2s" begin="0.6s" repeatCount="indefinite" />
            </circle>
            <circle cx="500" cy="64" r="12" fill="url(#leakGlow5)">
              <animate attributeName="r" values="8;14;8" dur="2s" begin="1.2s" repeatCount="indefinite" />
            </circle>
          </g>

          {/* Vazamento esquerdo */}
          <g>
            <path d="M 180 64 Q 178 70 180 76 Q 182 70 180 64 Z" fill="#ef4444">
              <animate attributeName="opacity" values="0;1;1;0" dur="4s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,0; 0,40; 0,40" dur="4s" repeatCount="indefinite" />
            </path>
            <g opacity="0">
              <animate attributeName="opacity" values="0;0;1;1;0" dur="4s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,0; 0,30; 0,90; 0,90" dur="4s" repeatCount="indefinite" />
              <rect x="60" y="100" width="240" height="34" rx="3" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
              <text x="72" y="115" fontSize="10" fill="#ef4444" fontFamily={mono} fontWeight="bold">- R$ 340</text>
              <text x="72" y="128" fontSize="10" fill="#888" fontFamily={mono}>Queria comprar vestido, desistiu</text>
            </g>
          </g>

          {/* Vazamento centro */}
          <g>
            <path d="M 340 64 Q 338 70 340 76 Q 342 70 340 64 Z" fill="#ef4444">
              <animate attributeName="opacity" values="0;1;1;0" dur="4s" begin="1.3s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,0; 0,50; 0,50" dur="4s" begin="1.3s" repeatCount="indefinite" />
            </path>
            <g opacity="0">
              <animate attributeName="opacity" values="0;0;1;1;0" dur="4s" begin="1.3s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,0; 0,30; 0,100; 0,100" dur="4s" begin="1.3s" repeatCount="indefinite" />
              <rect x="220" y="100" width="240" height="34" rx="3" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
              <text x="232" y="115" fontSize="10" fill="#ef4444" fontFamily={mono} fontWeight="bold">- R$ 890</text>
              <text x="232" y="128" fontSize="10" fill="#888" fontFamily={mono}>Cansou de esperar, foi embora</text>
            </g>
          </g>

          {/* Vazamento direito */}
          <g>
            <path d="M 500 64 Q 498 70 500 76 Q 502 70 500 64 Z" fill="#ef4444">
              <animate attributeName="opacity" values="0;1;1;0" dur="4s" begin="2.6s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,0; 0,45; 0,45" dur="4s" begin="2.6s" repeatCount="indefinite" />
            </path>
            <g opacity="0">
              <animate attributeName="opacity" values="0;0;1;1;0" dur="4s" begin="2.6s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,0; 0,30; 0,95; 0,95" dur="4s" begin="2.6s" repeatCount="indefinite" />
              <rect x="380" y="100" width="240" height="34" rx="3" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
              <text x="392" y="115" fontSize="10" fill="#ef4444" fontFamily={mono} fontWeight="bold">- R$ ?</text>
              <text x="392" y="128" fontSize="10" fill="#888" fontFamily={mono}>Mandou mensagem, ninguém viu</text>
            </g>
          </g>

          {/* Cards adicionais que caem em ondas posteriores */}
          <g>
            <g opacity="0">
              <animate attributeName="opacity" values="0;0;1;1;0" dur="4s" begin="0.8s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,40; 0,80; 0,160; 0,160" dur="4s" begin="0.8s" repeatCount="indefinite" />
              <rect x="60" y="100" width="240" height="34" rx="3" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
              <text x="72" y="115" fontSize="10" fill="#ef4444" fontFamily={mono} fontWeight="bold">- R$ 1.200</text>
              <text x="72" y="128" fontSize="10" fill="#888" fontFamily={mono}>Ficou irritado, foi pro concorrente</text>
            </g>

            <g opacity="0">
              <animate attributeName="opacity" values="0;0;1;1;0" dur="4s" begin="2.1s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,40; 0,80; 0,170; 0,170" dur="4s" begin="2.1s" repeatCount="indefinite" />
              <rect x="220" y="100" width="240" height="34" rx="3" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
              <text x="232" y="115" fontSize="10" fill="#ef4444" fontFamily={mono} fontWeight="bold">- R$ 560</text>
              <text x="232" y="128" fontSize="10" fill="#888" fontFamily={mono}>Achou caro, ninguém explicou</text>
            </g>

            <g opacity="0">
              <animate attributeName="opacity" values="0;0;1;1;0" dur="4s" begin="3.4s" repeatCount="indefinite" />
              <animateTransform attributeName="transform" type="translate" values="0,40; 0,80; 0,165; 0,165" dur="4s" begin="3.4s" repeatCount="indefinite" />
              <rect x="380" y="100" width="240" height="34" rx="3" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
              <text x="392" y="115" fontSize="10" fill="#ef4444" fontFamily={mono} fontWeight="bold">- R$ ?</text>
              <text x="392" y="128" fontSize="10" fill="#888" fontFamily={mono}>Nunca soubemos quem era</text>
            </g>
          </g>

          {/* Personagem triste no centro */}
          <g transform="translate(340, 380)">
            <circle cx="0" cy="0" r="60" fill="url(#leakGlow5)" opacity="0.4">
              <animate attributeName="opacity" values="0.3;0.5;0.3" dur="3s" repeatCount="indefinite" />
            </circle>

            <g>
              <animateTransform attributeName="transform" type="translate" values="0,0; 0,2; 0,0" dur="3s" repeatCount="indefinite" />

              {/* Cabeça */}
              <circle cx="0" cy="-35" r="16" fill="#0a0a0a" stroke="#ef4444" strokeWidth="1.2" />
              {/* Olhos tristes */}
              <path d="M -8 -39 Q -5 -36 -2 -39" fill="none" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              <path d="M 2 -39 Q 5 -36 8 -39" fill="none" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              {/* Sobrancelhas caídas */}
              <line x1="-9" y1="-45" x2="-3" y2="-43" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              <line x1="3" y1="-43" x2="9" y2="-45" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              {/* Boca pra baixo */}
              <path d="M -5 -28 Q 0 -31 5 -28" fill="none" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" />
              {/* Lágrima */}
              <ellipse cx="-7" cy="-33" rx="1" ry="1.5" fill="#ef4444" opacity="0">
                <animate attributeName="opacity" values="0;0.7;0" dur="4s" repeatCount="indefinite" />
                <animate attributeName="cy" values="-33;-25;-25" dur="4s" repeatCount="indefinite" />
              </ellipse>

              {/* Corpo */}
              <rect x="-22" y="-18" width="44" height="50" rx="2" fill="#0a0a0a" stroke="#ef4444" strokeWidth="1.2" />

              {/* Braços caídos */}
              <line x1="-22" y1="-14" x2="-30" y2="20" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" />
              <line x1="22" y1="-14" x2="30" y2="20" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" />

              {/* Mãos */}
              <circle cx="-30" cy="24" r="3" fill="#0a0a0a" stroke="#ef4444" strokeWidth="1.2" />
              <circle cx="30" cy="24" r="3" fill="#0a0a0a" stroke="#ef4444" strokeWidth="1.2" />

              {/* Gravata */}
              <path d="M 0 -18 L -3 -8 L 0 2 L 3 -8 Z" fill="#ef4444" opacity="0.6" />
            </g>
          </g>

          {/* Indicação "você" */}
          <g opacity="0.55">
            <text x="500" y="395" fontSize="13" fill="#ef4444" fontFamily={mono} fontStyle="italic">você</text>
            <path d="M 495 395 Q 450 405 395 395" fill="none" stroke="#ef4444" strokeWidth="0.8" strokeLinecap="round" opacity="0.7" />
            <path d="M 400 391 L 393 395 L 400 399" fill="none" stroke="#ef4444" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
          </g>

          {/* Contador de receita perdida */}
          <g transform="translate(340, 480)">
            <line x1="-280" y1="-10" x2="280" y2="-10" stroke="#ef4444" strokeWidth="0.3" strokeDasharray="2 4" opacity="0.4" />
            <text textAnchor="middle" fontSize="10" fill="#666" fontFamily={mono} y="10">total perdido este mês</text>
            <text textAnchor="middle" fontSize="36" fill="#ef4444" fontFamily={mono} fontWeight="bold" y="48">
              <tspan>- R$ 12.847</tspan>
              <animate attributeName="opacity" values="1;0.6;1" dur="2s" repeatCount="indefinite" />
            </text>
          </g>
        </svg>

        {/* Tagline */}
        <div
          data-tagline
          className="mx-auto mt-12 max-w-[520px] text-center"
          style={{
            opacity: taglineVisible ? 1 : 0,
            transform: taglineVisible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}
        >
          <p className="text-sm leading-relaxed text-subtle" style={{ fontFamily: mono }}>
            Cada cliente sem resposta é dinheiro escorrendo
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-red-500" style={{ fontFamily: mono }}>
            pelo ralo da sua operação.
          </p>
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
