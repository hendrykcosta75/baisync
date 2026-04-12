'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface Metric {
  value: number;
  prefix?: string;
  suffix?: string;
  label: string;
  format?: (n: number) => string;
}

const metrics: Metric[] = [
  { value: 200, suffix: '+', label: 'Empresas ativas' },
  {
    value: 50000,
    suffix: '+',
    label: 'Mensagens/dia',
    format: (n: number) => {
      if (n >= 1000) return `${Math.round(n / 1000)}K`;
      return String(Math.round(n));
    },
  },
  { value: 3, prefix: '<', suffix: 's', label: 'Tempo de resposta' },
  { value: 99.9, suffix: '%', label: 'Uptime garantido' },
];

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function AnimatedNumber({
  metric,
  active,
  delay,
}: {
  metric: Metric;
  active: boolean;
  delay: number;
}) {
  const [display, setDisplay] = useState('0');
  const rafRef = useRef<number>(0);

  const animate = useCallback(() => {
    const duration = 2000;
    let start: number | null = null;

    function step(timestamp: number) {
      if (start === null) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);
      const current = eased * metric.value;

      if (metric.format) {
        setDisplay(metric.format(current));
      } else if (metric.value % 1 !== 0) {
        setDisplay(current.toFixed(1));
      } else {
        setDisplay(String(Math.round(current)));
      }

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      }
    }

    rafRef.current = requestAnimationFrame(step);
  }, [metric]);

  useEffect(() => {
    if (!active) return;

    const timeout = setTimeout(animate, delay);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(rafRef.current);
    };
  }, [active, delay, animate]);

  return (
    <span>
      {metric.prefix ?? ''}
      {display}
      {metric.suffix ?? ''}
    </span>
  );
}

export function MetricsCounter() {
  const [active, setActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActive(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="grid grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-4xl mx-auto"
    >
      {metrics.map((metric, i) => (
        <div
          key={metric.label}
          className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-xl p-6 text-center"
          style={{
            opacity: active ? 1 : 0,
            transform: active ? 'translateY(0)' : 'translateY(12px)',
            transition: `opacity 0.5s ease-out ${i * 150}ms, transform 0.5s ease-out ${i * 150}ms`,
          }}
        >
          <div className="text-3xl font-bold text-white font-[family-name:var(--font-jetbrains-mono)]">
            <AnimatedNumber
              metric={metric}
              active={active}
              delay={i * 150}
            />
          </div>
          <div className="mt-2 text-xs uppercase tracking-wider text-[#666] font-[family-name:var(--font-jetbrains-mono)]">
            {metric.label}
          </div>
        </div>
      ))}
    </div>
  );
}
