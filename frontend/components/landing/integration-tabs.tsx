'use client';

import { useEffect, useRef, useState } from 'react';

type TabKey = 'whatsapp' | 'telegram' | 'webchat' | 'instagram';

interface Message {
  from: 'user' | 'bot';
  text: string;
}

interface TabData {
  label: string;
  headerColor: string;
  headerName: string;
  headerStatus: string;
  messages: Message[];
  userBubble: string;
  botBubble: string;
  userText: string;
  botText: string;
}

const tabs: Record<TabKey, TabData> = {
  whatsapp: {
    label: 'WhatsApp',
    headerColor: '#075E54',
    headerName: 'Baisync IA',
    headerStatus: 'online',
    userBubble: '#005C4B',
    botBubble: '#1F2C34',
    userText: '#E9EDEF',
    botText: '#E9EDEF',
    messages: [
      { from: 'user', text: 'Olá, gostaria de saber o horário de funcionamento' },
      { from: 'bot', text: 'Olá! 👋 Nosso horário é de segunda a sexta, das 8h às 18h. Posso ajudar com mais alguma coisa?' },
      { from: 'user', text: 'Vocês fazem entrega?' },
      { from: 'bot', text: 'Sim! Fazemos entregas para toda a região. O prazo é de 2-3 dias úteis. Quer que eu calcule o frete para seu endereço?' },
    ],
  },
  telegram: {
    label: 'Telegram',
    headerColor: '#2AABEE',
    headerName: 'Baisync Bot',
    headerStatus: 'bot',
    userBubble: '#2B5278',
    botBubble: '#182533',
    userText: '#E4ECF2',
    botText: '#E4ECF2',
    messages: [
      { from: 'user', text: 'Quais produtos vocês têm disponíveis?' },
      { from: 'bot', text: 'Temos mais de 200 produtos em nosso catálogo! 📦 Qual categoria te interessa? Eletrônicos, Casa, ou Acessórios?' },
      { from: 'user', text: 'Eletrônicos, por favor' },
      { from: 'bot', text: 'Ótima escolha! Nossos mais vendidos são: iPhone 15, Galaxy S24 e AirPods Pro. Quer ver preços e detalhes de algum?' },
    ],
  },
  webchat: {
    label: 'Web Chat',
    headerColor: '#FF6B00',
    headerName: 'Suporte Baisync',
    headerStatus: 'Respondemos em segundos',
    userBubble: '#FF6B00',
    botBubble: '#1a1a1a',
    userText: '#ffffff',
    botText: '#e0e0e0',
    messages: [
      { from: 'bot', text: 'Olá! Como posso ajudar você hoje? 😊' },
      { from: 'user', text: 'Estou com problema no meu pedido #4521' },
      { from: 'bot', text: 'Encontrei seu pedido! Ele está em trânsito e a previsão de entrega é amanhã até às 18h. Quer receber atualizações por aqui?' },
      { from: 'user', text: 'Sim, por favor!' },
    ],
  },
  instagram: {
    label: 'Instagram',
    headerColor: '#C13584',
    headerName: 'baisync_oficial',
    headerStatus: 'Ativo agora',
    userBubble: '#3797F0',
    botBubble: '#262626',
    userText: '#ffffff',
    botText: '#e0e0e0',
    messages: [
      { from: 'user', text: 'Oi! Vi o produto no story, ainda tem?' },
      { from: 'bot', text: 'Oi! Sim, ainda temos em estoque! 🎉 Qual tamanho você usa?' },
      { from: 'user', text: 'Tamanho M. Quanto fica com frete?' },
      { from: 'bot', text: 'Tamanho M disponível! O valor é R$89,90 + R$12,50 de frete. Quer que eu gere o link de pagamento?' },
    ],
  },
};

const tabOrder: TabKey[] = ['whatsapp', 'telegram', 'webchat', 'instagram'];

export function IntegrationTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>('whatsapp');
  const [animating, setAnimating] = useState(false);
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
      { threshold: 0.15 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function switchTab(key: TabKey) {
    if (key === activeTab || animating) return;
    setAnimating(true);
    setTimeout(() => {
      setActiveTab(key);
      setTimeout(() => setAnimating(false), 50);
    }, 200);
  }

  const tab = tabs[activeTab];

  return (
    <section
      ref={sectionRef}
      className="w-full max-w-6xl mx-auto px-6 py-24"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(32px)',
        transition: 'opacity 0.7s ease-out, transform 0.7s ease-out',
      }}
    >
      {/* Header */}
      <div className="text-center mb-16">
        <span className="inline-block text-[#FF6B00] text-xs tracking-[0.25em] uppercase font-[family-name:var(--font-jetbrains-mono)] font-semibold mb-4">
          INTEGRAÇÕES
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-white font-[family-name:var(--font-jetbrains-mono)] mb-4">
          Seu agente, em todos os canais.
        </h2>
        <p className="text-[#888] max-w-xl mx-auto text-sm leading-relaxed font-[family-name:var(--font-jetbrains-mono)]">
          Conecte seu agente de IA ao WhatsApp, Telegram, Web Chat e Instagram.
          Uma única configuração, múltiplos canais de atendimento.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex justify-center gap-2 mb-12 flex-wrap">
        {tabOrder.map((key) => {
          const isActive = key === activeTab;
          return (
            <button
              key={key}
              onClick={() => switchTab(key)}
              className="px-5 py-2.5 rounded-full text-sm font-[family-name:var(--font-jetbrains-mono)] font-medium transition-all duration-300 cursor-pointer"
              style={{
                background: isActive ? 'rgba(255, 107, 0, 0.12)' : 'transparent',
                border: isActive ? '1px solid #FF6B00' : '1px solid #222',
                color: isActive ? '#FF6B00' : '#666',
              }}
            >
              {tabs[key].label}
            </button>
          );
        })}
      </div>

      {/* Phone mockup */}
      <div className="flex justify-center">
        <div
          className="w-full max-w-sm"
          style={{
            opacity: animating ? 0 : 1,
            transform: animating ? 'translateY(12px)' : 'translateY(0)',
            transition: 'opacity 0.2s ease-out, transform 0.2s ease-out',
          }}
        >
          {/* Phone frame */}
          <div
            className="rounded-3xl overflow-hidden border border-[#222] shadow-2xl"
            style={{ background: '#0c0c0c' }}
          >
            {/* Status bar */}
            <div className="flex items-center justify-between px-5 py-2 text-[10px] text-white/60 font-[family-name:var(--font-jetbrains-mono)]">
              <span>9:41</span>
              <div className="flex items-center gap-1">
                <svg width="14" height="10" viewBox="0 0 14 10" fill="currentColor"><rect x="0" y="6" width="2.5" height="4" rx="0.5" /><rect x="3.5" y="4" width="2.5" height="6" rx="0.5" /><rect x="7" y="2" width="2.5" height="8" rx="0.5" /><rect x="10.5" y="0" width="2.5" height="10" rx="0.5" /></svg>
                <svg width="20" height="10" viewBox="0 0 20 10" fill="currentColor"><rect x="0.5" y="0.5" width="17" height="9" rx="1.5" stroke="currentColor" strokeWidth="1" fill="none" /><rect x="18" y="3" width="2" height="4" rx="0.5" /><rect x="2" y="2" width="12" height="6" rx="1" /></svg>
              </div>
            </div>

            {/* Chat header */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ background: tab.headerColor }}
            >
              <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                <span className="text-white text-xs font-bold font-[family-name:var(--font-jetbrains-mono)]">
                  {tab.headerName.charAt(0)}
                </span>
              </div>
              <div>
                <p className="text-white text-sm font-semibold font-[family-name:var(--font-jetbrains-mono)]">
                  {tab.headerName}
                </p>
                <p className="text-white/70 text-[10px] font-[family-name:var(--font-jetbrains-mono)]">
                  {tab.headerStatus}
                </p>
              </div>
            </div>

            {/* Messages area */}
            <div
              className="flex flex-col gap-3 p-4 min-h-[320px]"
              style={{ background: activeTab === 'whatsapp' ? '#0B141A' : activeTab === 'telegram' ? '#0E1621' : '#0a0a0a' }}
            >
              {tab.messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.from === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className="max-w-[80%] px-3 py-2 rounded-xl text-[13px] leading-relaxed font-[family-name:var(--font-jetbrains-mono)]"
                    style={{
                      background: msg.from === 'user' ? tab.userBubble : tab.botBubble,
                      color: msg.from === 'user' ? tab.userText : tab.botText,
                      borderBottomRightRadius: msg.from === 'user' ? '4px' : undefined,
                      borderBottomLeftRadius: msg.from === 'bot' ? '4px' : undefined,
                    }}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Input bar */}
            <div className="flex items-center gap-2 px-3 py-3 border-t border-[#1a1a1a]" style={{ background: '#0c0c0c' }}>
              <div className="flex-1 h-9 rounded-full bg-[#1a1a1a] px-4 flex items-center">
                <span className="text-[#444] text-xs font-[family-name:var(--font-jetbrains-mono)]">
                  Digite uma mensagem...
                </span>
              </div>
              <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: tab.headerColor }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </div>
            </div>

            {/* Powered by footer */}
            <div className="py-2 text-center">
              <span className="text-[9px] text-[#333] font-[family-name:var(--font-jetbrains-mono)]">
                Powered by Baisync
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
