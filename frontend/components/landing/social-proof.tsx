'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

const clients = [
  { name: 'Planejare Consultoria', src: '/clients/planejare.jpg' },
  { name: 'Mãe Educa', src: '/clients/mae-educa.jpg' },
  { name: 'SeverinoPro', src: '/clients/severino-pro.jpg' },
  { name: 'Hub Fds', src: '/clients/hub-fds.jpg' },
];

export function SocialProof() {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="flex flex-col items-start gap-5"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
        transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
      }}
    >
      {/* Stacked avatars */}
      <div className="flex items-center">
        {clients.map((client, i) => (
          <div
            key={client.name}
            className="group/avatar relative w-10 h-10 rounded-full border-2 border-black overflow-visible"
            style={{
              marginLeft: i === 0 ? 0 : '-0.75rem',
              zIndex: clients.length - i,
            }}
          >
            <div className="w-full h-full rounded-full overflow-hidden">
              <Image
                src={client.src}
                alt={client.name}
                width={40}
                height={40}
                className="w-full h-full object-cover"
              />
            </div>
            {/* Tooltip */}
            <div className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 opacity-0 group-hover/avatar:opacity-100 transition-all duration-200 group-hover/avatar:-top-10 z-50">
              <div className="whitespace-nowrap px-2.5 py-1 rounded-md bg-[#111] border border-[#222] text-[10px] text-[#ccc] font-[family-name:var(--font-jetbrains-mono)]">
                {client.name}
              </div>
            </div>
          </div>
        ))}
        <div
          className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-black bg-[#0a0a0a] text-[#ff6b2c] text-xs font-bold font-[family-name:var(--font-jetbrains-mono)]"
          style={{ marginLeft: '-0.75rem', zIndex: 0 }}
        >
          +200
        </div>
      </div>

      <p className="text-sm text-[#666] font-[family-name:var(--font-jetbrains-mono)]">
        Mais de 200 empresas já automatizaram seu atendimento
      </p>
    </div>
  );
}
