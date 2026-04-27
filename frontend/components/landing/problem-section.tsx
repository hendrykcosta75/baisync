'use client';

import { useEffect, useRef, useState } from 'react';

const headingLine1 = 'Seu atendimento está';
const headingLine2 = 'perdendo clientes.';

const mono = "'JetBrains Mono', 'Fira Code', monospace";

// Each entry pairs an arrow (line pointing at the center) with the
// corresponding question card so they reveal together as the user scrolls.
const QUESTIONS = [
  { arrow: { x1: 120, y1: 80,  x2: 305, y2: 218 }, card: { x: 20,  y: 60,  w: 180, time: '14:23', text: '"Qual o horário?"' } },
  { arrow: { x1: 340, y1: 60,  x2: 340, y2: 190 }, card: { x: 245, y: 20,  w: 190, time: '14:24', text: '"Vocês entregam?"' } },
  { arrow: { x1: 560, y1: 80,  x2: 375, y2: 218 }, card: { x: 480, y: 60,  w: 180, time: '14:25', text: '"Qual o preço?"' } },
  { arrow: { x1: 100, y1: 240, x2: 290, y2: 240 }, card: { x: 20,  y: 220, w: 180, time: '14:26', text: '"Como funciona?"' } },
  { arrow: { x1: 580, y1: 240, x2: 390, y2: 240 }, card: { x: 480, y: 220, w: 180, time: '14:27', text: '"Tem desconto?"' } },
  { arrow: { x1: 120, y1: 400, x2: 305, y2: 265 }, card: { x: 20,  y: 380, w: 180, time: '14:28', text: '"Aceita Pix?"' } },
  { arrow: { x1: 560, y1: 400, x2: 375, y2: 265 }, card: { x: 480, y: 380, w: 180, time: '14:29', text: '"Tem em estoque?"' } },
];

const PERSON_DELAY_MS = 350;
const DRAW_MS = 450;

export function ProblemSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [headingVisible, setHeadingVisible] = useState(false);
  const [personVisible, setPersonVisible] = useState(false);
  const [linesDrawn, setLinesDrawn] = useState(0);
  const [cardsVisible, setCardsVisible] = useState(0);
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

    return () => {
      headingObs.disconnect();
    };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const timeouts: ReturnType<typeof setTimeout>[] = [];
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        obs.disconnect();

        // Person appears first.
        timeouts.push(setTimeout(() => setPersonVisible(true), 0));

        // Each pair plays in sequence: line draws, then card fades in.
        QUESTIONS.forEach((_, i) => {
          const lineStart = PERSON_DELAY_MS + i * DRAW_MS;
          const cardShow  = lineStart + DRAW_MS;
          timeouts.push(setTimeout(() => setLinesDrawn(c => Math.max(c, i + 1)), lineStart));
          timeouts.push(setTimeout(() => setCardsVisible(c => Math.max(c, i + 1)), cardShow));
        });

        // Tagline closes the sequence.
        const taglineDelay = PERSON_DELAY_MS + QUESTIONS.length * DRAW_MS + 200;
        timeouts.push(setTimeout(() => setTaglineVisible(true), taglineDelay));
      },
      { threshold: 0.25 }
    );
    obs.observe(svg);

    return () => {
      obs.disconnect();
      timeouts.forEach(clearTimeout);
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

        <svg
          ref={svgRef}
          viewBox="0 0 680 480"
          role="img"
          aria-label="Atendente cercado por perguntas repetitivas vindas de todos os lados"
          className="mx-auto block w-full max-w-[640px] h-auto"
        >
          <title>Pessoa cercada por perguntas repetitivas</title>
          <desc>Atendente no centro recebendo perguntas de todas as direções</desc>

          <defs>
            <marker
              id="problemArrowRed"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="5"
              markerHeight="5"
              orient="auto-start-reverse"
            >
              <path d="M2 1 L8 5 L2 9" fill="none" stroke="#ef4444" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
            </marker>
            <radialGradient id="problemPulseGlow">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#ef4444" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Pessoa central — fades in first, before any line is drawn. */}
          <g
            style={{
              opacity: personVisible ? 1 : 0,
              transition: 'opacity 0.6s ease',
            }}
          >
            {/* Glow pulsante atrás da pessoa */}
            <circle cx="340" cy="240" r="80" fill="url(#problemPulseGlow)">
              <animate attributeName="r" values="70;95;70" dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.6;1;0.6" dur="2.5s" repeatCount="indefinite" />
            </circle>

            {/* Pessoa no centro */}
            <g transform="translate(340, 240)">
              <circle cx="0" cy="0" r="42" fill="#0a0a0a" stroke="#ef4444" strokeWidth="1" />
              <circle cx="0" cy="-10" r="12" fill="none" stroke="#ef4444" strokeWidth="1.2" />
              <path d="M -20 22 Q -20 5 0 5 Q 20 5 20 22" fill="none" stroke="#ef4444" strokeWidth="1.2" />
              <path d="M -5 -12 Q -3 -10 -1 -12" fill="none" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              <path d="M 1 -12 Q 3 -10 5 -12" fill="none" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              <line x1="-3" y1="-5" x2="3" y2="-5" stroke="#ef4444" strokeWidth="1" strokeLinecap="round" />
              <ellipse cx="12" cy="-15" rx="2" ry="3" fill="#ef4444" opacity="0.7">
                <animate attributeName="cy" values="-15;-8;-15" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0;0.7" dur="2s" repeatCount="indefinite" />
              </ellipse>
            </g>
          </g>

          {/* For each pair: line draws progressively (stroke-dashoffset goes
              from full length to 0), THEN the card fades in. */}
          {QUESTIONS.map(({ arrow, card }, i) => {
            const lineDrawn = linesDrawn > i;
            const cardVisible = cardsVisible > i;
            const length = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1);
            return (
              <g key={i}>
                <line
                  x1={arrow.x1}
                  y1={arrow.y1}
                  x2={arrow.x2}
                  y2={arrow.y2}
                  stroke="#ef4444"
                  strokeWidth="0.6"
                  opacity={lineDrawn ? 0.65 : 0}
                  markerEnd="url(#problemArrowRed)"
                  style={{
                    strokeDasharray: length,
                    strokeDashoffset: lineDrawn ? 0 : length,
                    transition: `stroke-dashoffset ${DRAW_MS}ms ease-out, opacity 0.2s ease`,
                  }}
                />
                <g
                  style={{
                    opacity: cardVisible ? 0.85 : 0,
                    transform: cardVisible ? 'translate(0,0)' : 'translate(0, 6px)',
                    transformOrigin: 'center',
                    transition: 'opacity 0.35s ease, transform 0.35s ease',
                  }}
                >
                  <rect x={card.x} y={card.y} width={card.w} height="40" rx="4" fill="#1a1a1a" stroke="#ef4444" strokeWidth="0.5" />
                  <text x={card.x + 12} y={card.y + 18} fontSize="10" fill="#666" fontFamily={mono}>
                    {`Cliente · ${card.time}`}
                  </text>
                  <text x={card.x + 12} y={card.y + 33} fontSize="11" fill="#ccc" fontFamily={mono}>
                    {card.text}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>

        {/* Tagline — fades up after the last card lands. */}
        <div
          className="mx-auto mt-12 max-w-[520px] text-center"
          style={{
            opacity: taglineVisible ? 1 : 0,
            transform: taglineVisible ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity 0.6s ease, transform 0.6s ease',
          }}
        >
          <p className="text-sm leading-relaxed text-subtle" style={{ fontFamily: mono }}>
            80% do tempo da sua equipe vai para
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-red-500" style={{ fontFamily: mono }}>
            as mesmas perguntas, todos os dias.
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
