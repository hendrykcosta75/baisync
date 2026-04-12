'use client';

import { useState } from 'react';

const faqs = [
  {
    question: 'O que é a Baisync?',
    answer:
      'A Baisync é uma plataforma que permite criar agentes de IA para atendimento ao cliente em canais como WhatsApp e Telegram. Seus agentes respondem automaticamente, qualificam leads e escalam vendas 24/7.',
  },
  {
    question: 'Preciso saber programar?',
    answer:
      'Não. A plataforma foi desenhada para ser usada por qualquer pessoa. Basta configurar seu agente, conectar seus canais e ativar. Sem código, sem complicação.',
  },
  {
    question: 'Quais canais são suportados?',
    answer:
      'Atualmente suportamos WhatsApp (via Baileys), Telegram e Web Chat. Instagram e Facebook Messenger estão no roadmap para os próximos meses.',
  },
  {
    question: 'Como funciona a cobrança?',
    answer:
      'Oferecemos planos mensais e anuais. O plano gratuito inclui 1 agente e 100 mensagens/mês. Planos pagos começam em R$97/mês com mensagens ilimitadas.',
  },
  {
    question: 'Meus dados estão seguros?',
    answer:
      'Sim. Usamos criptografia AES-GCM para chaves de API, isolamento por tenant no banco de dados, e toda comunicação é via HTTPS. Seus dados nunca são compartilhados.',
  },
  {
    question: 'Posso testar antes de pagar?',
    answer:
      'Sim! O plano Free permite criar 1 agente com até 100 mensagens por mês, sem cartão de crédito. Perfeito para testar a plataforma.',
  },
];

export function FaqSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  return (
    <section id="faq" className="relative py-24 px-6 font-[family-name:var(--font-jetbrains-mono)]">
      <div className="mx-auto max-w-3xl">
        <div className="mb-16 text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Perguntas Frequentes
          </h2>
          <p className="mt-4 text-sm text-[#888]">
            Tudo que você precisa saber antes de começar.
          </p>
        </div>

        <div className="divide-y divide-[#1a1a1a]">
          {faqs.map((faq, i) => {
            const isOpen = openIndex === i;
            return (
              <div key={i} className="border-b border-[#1a1a1a]">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between py-5 text-left transition-colors duration-200 hover:text-[#FF6B00]"
                >
                  <span className="pr-4 text-sm font-medium text-white">
                    {faq.question}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0 text-[#666] transition-transform duration-300"
                    style={{
                      transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <div
                  className="overflow-hidden transition-all duration-300 ease-in-out"
                  style={{
                    maxHeight: isOpen ? '500px' : '0px',
                    opacity: isOpen ? 1 : 0,
                  }}
                >
                  <p className="pb-5 text-sm leading-relaxed text-[#888]">
                    {faq.answer}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
