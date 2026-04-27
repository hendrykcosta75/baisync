"use client";

import { useState, useEffect, useRef } from "react";

const tags = ["Atendimento 24/7", "WhatsApp", "Telegram", "Vendas com IA"];

const comparisonData = [
  { feature: "Respostas instantâneas", before: false, after: true },
  { feature: "Atendimento 24h", before: false, after: true },
  { feature: "Qualificação de leads", before: false, after: true },
  { feature: "Integração WhatsApp", before: true, after: true },
  { feature: "Escala ilimitada", before: false, after: true },
];

const steps = [
  {
    number: "01",
    label: "CONECTE",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    title: "Integre sua IA em minutos.",
    description:
      "Conecte seus canais — WhatsApp, Telegram, Instagram — e configure seu atendente de IA sem código. Ele aprende sobre seu negócio e começa a responder clientes imediatamente.",
  },
  {
    number: "02",
    label: "AUTOMATIZE",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 3 21 3 21 8" />
        <line x1="4" y1="20" x2="21" y2="3" />
        <polyline points="21 16 21 21 16 21" />
        <line x1="15" y1="15" x2="21" y2="21" />
        <line x1="4" y1="4" x2="9" y2="9" />
      </svg>
    ),
    title: "Veja o antes e depois, ao vivo.",
    description:
      "Compare seu atendimento manual com a IA lado a lado. Tempo de resposta, conversão, satisfação — os números falam por si.",
  },
  {
    number: "03",
    label: "ESCALE",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    ),
    title: "Resultados reais, sem achismo.",
    description:
      "Dashboards em tempo real com métricas de conversão, leads qualificados e receita gerada. Sua IA trabalha 24/7 enquanto você foca no que importa.",
  },
];

/* ── Terminal Shell ──────────────────────────────── */

function TerminalShell({ children, visible }: { children: React.ReactNode; visible: boolean }) {
  return (
    <div
      style={{
        background: "#0a0a0a",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        overflow: "hidden",
        transition: "all 0.5s cubic-bezier(0.16,1,0.3,1)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ display: "flex", gap: 7 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#ff5f57" }} />
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#febc2e" }} />
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28c840" }} />
        </div>
        <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(240,236,228,0.35)" }}>
          ~/painel
        </span>
      </div>
      <div className="p-5 md:px-7 md:py-7 min-h-[240px] md:min-h-[320px]">{children}</div>
    </div>
  );
}

/* ── Sync Animation ──────────────────────────────── */

function SyncAnimation({ visible }: { visible: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        height: 160,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.9)",
        transition: "all 0.6s cubic-bezier(0.16,1,0.3,1)",
        marginTop: 20,
        overflow: "hidden",
      }}
    >
      <style>{`
        @keyframes particleLeft {
          0% { transform: translateX(0) scale(1); opacity: 0.8; }
          50% { opacity: 1; }
          100% { transform: translateX(120px) scale(0.3); opacity: 0; }
        }
        @keyframes particleRight {
          0% { transform: translateX(0) scale(1); opacity: 0.8; }
          50% { opacity: 1; }
          100% { transform: translateX(-120px) scale(0.3); opacity: 0; }
        }
        @keyframes centerPulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 20px rgba(232,122,42,0.3); }
          50% { transform: translate(-50%, -50%) scale(1.15); box-shadow: 0 0 40px rgba(232,122,42,0.6), 0 0 80px rgba(232,122,42,0.2); }
        }
        @keyframes iconFloat {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes ringExpand {
          0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
        }
        @keyframes beamLeft {
          0% { width: 0; opacity: 0; }
          30% { opacity: 0.6; }
          100% { width: 90px; opacity: 0; }
        }
        @keyframes beamRight {
          0% { width: 0; opacity: 0; }
          30% { opacity: 0.6; }
          100% { width: 90px; opacity: 0; }
        }
      `}</style>

      {/* — Left: Empresa — */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          zIndex: 2,
          animation: "iconFloat 3s ease-in-out infinite",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "linear-gradient(135deg, rgba(240,236,228,0.1), rgba(240,236,228,0.04))",
            border: "1px solid rgba(240,236,228,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f0ece4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 7V5a4 4 0 0 0-8 0v2" />
            <line x1="12" y1="12" x2="12" y2="16" />
          </svg>
        </div>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "rgba(240,236,228,0.5)",
            letterSpacing: 1,
          }}
        >
          SUA EMPRESA
        </span>
      </div>

      {/* — Energy particles left→center — */}
      <div className="w-[60px] sm:w-[90px] md:w-[120px]" style={{ position: "relative", height: 60, flexShrink: 0 }}>
        {[0, 0.5, 1, 1.5, 2].map((delay, i) => (
          <div
            key={`pl-${i}`}
            style={{
              position: "absolute",
              left: 10,
              top: 26 + (i % 3 - 1) * 8,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#e87a2a",
              boxShadow: "0 0 8px rgba(232,122,42,0.6)",
              animation: `particleLeft 2s ${delay}s ease-in-out infinite`,
            }}
          />
        ))}
        {/* Beam left */}
        <div
          style={{
            position: "absolute",
            left: 10,
            top: 28,
            height: 2,
            borderRadius: 1,
            background: "linear-gradient(90deg, rgba(232,122,42,0.4), transparent)",
            animation: "beamLeft 2s 0.3s ease-out infinite",
          }}
        />
      </div>

      {/* — Center: Sync — */}
      <div style={{ position: "relative", width: 60, height: 60, flexShrink: 0 }}>
        {/* Expanding rings */}
        {[0, 0.8, 1.6].map((delay, i) => (
          <div
            key={`ring-${i}`}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "1px solid rgba(232,122,42,0.3)",
              animation: `ringExpand 2.4s ${delay}s ease-out infinite`,
            }}
          />
        ))}
        {/* Core */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(232,122,42,0.25), rgba(232,122,42,0.05))",
            border: "1.5px solid rgba(232,122,42,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "centerPulse 2s ease-in-out infinite",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e87a2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
            <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
          </svg>
        </div>
      </div>

      {/* — Energy particles right→center — */}
      <div className="w-[60px] sm:w-[90px] md:w-[120px]" style={{ position: "relative", height: 60, flexShrink: 0 }}>
        {[0, 0.4, 0.9, 1.3, 1.8].map((delay, i) => (
          <div
            key={`pr-${i}`}
            style={{
              position: "absolute",
              right: 10,
              top: 26 + (i % 3 - 1) * 8,
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#e87a2a",
              boxShadow: "0 0 8px rgba(232,122,42,0.6)",
              animation: `particleRight 2s ${delay}s ease-in-out infinite`,
            }}
          />
        ))}
        {/* Beam right */}
        <div
          style={{
            position: "absolute",
            right: 10,
            top: 28,
            height: 2,
            borderRadius: 1,
            background: "linear-gradient(270deg, rgba(232,122,42,0.4), transparent)",
            animation: "beamRight 2s 0.3s ease-out infinite",
          }}
        />
      </div>

      {/* — Right: IA — */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          zIndex: 2,
          animation: "iconFloat 3s 0.5s ease-in-out infinite",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "linear-gradient(135deg, rgba(232,122,42,0.15), rgba(232,122,42,0.04))",
            border: "1px solid rgba(232,122,42,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#e87a2a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="9" cy="16" r="1.5" fill="#e87a2a" stroke="none" />
            <circle cx="15" cy="16" r="1.5" fill="#e87a2a" stroke="none" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            <line x1="12" y1="3" x2="12" y2="4" />
            <line x1="18" y1="5" x2="17" y2="6" />
            <line x1="6" y1="5" x2="7" y2="6" />
          </svg>
        </div>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            color: "#e87a2a",
            letterSpacing: 1,
          }}
        >
          ATENDENTE IA
        </span>
      </div>

      {/* Sync label */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "var(--mono)",
          fontSize: 10,
          letterSpacing: 2,
          color: "rgba(232,122,42,0.6)",
        }}
      >
        SINCRONIZANDO
      </div>
    </div>
  );
}

/* ── Screen 1: Conecte ───────────────────────────── */

function ScreenConecte({ active }: { active: boolean }) {
  const [typedText, setTypedText] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [showSync, setShowSync] = useState(false);
  const fullText = "Configurar atendente IA para WhatsApp";

  useEffect(() => {
    if (!active) {
      setTypedText("");
      setShowTags(false);
      setShowSync(false);
      return;
    }
    let i = 0;
    const interval = setInterval(() => {
      if (i <= fullText.length) {
        setTypedText(fullText.slice(0, i));
        i++;
      } else {
        clearInterval(interval);
        setTimeout(() => setShowTags(true), 200);
        setTimeout(() => setShowSync(true), 700);
      }
    }, 35);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "rgba(255,255,255,0.05)",
          borderRadius: 10,
          padding: "14px 16px",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <span style={{ flex: 1, fontFamily: "var(--mono)", fontSize: 13, color: "#f0ece4" }}>
          {typedText}
          <span
            style={{
              display: "inline-block",
              width: 2,
              height: 16,
              background: "var(--accent)",
              marginLeft: 1,
              verticalAlign: "text-bottom",
              animation: "blink 1s step-end infinite",
            }}
          />
        </span>
        <span style={{ color: "rgba(240,236,228,0.3)", fontSize: 16, marginLeft: 8 }}>&#9655;</span>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 14,
          opacity: showTags ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      >
        {tags.map((tag, i) => (
          <span
            key={tag}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 6,
              background: "rgba(232,122,42,0.12)",
              border: "1px solid rgba(232,122,42,0.3)",
              color: "var(--accent)",
              fontSize: 12,
              fontFamily: "var(--mono)",
              fontWeight: 500,
              transition: "transform 0.3s ease",
              transitionDelay: `${i * 60}ms`,
              transform: showTags ? "scale(1)" : "scale(0.8)",
            }}
          >
            &#10005; {tag}
          </span>
        ))}
      </div>

      <SyncAnimation visible={showSync} />
    </>
  );
}

/* ── Screen 2: Automatize ────────────────────────── */

function ScreenAutomatize({ active }: { active: boolean }) {
  const [rowsVisible, setRowsVisible] = useState(0);

  useEffect(() => {
    if (!active) {
      setRowsVisible(0);
      return;
    }
    let count = 0;
    const interval = setInterval(() => {
      count++;
      setRowsVisible(count);
      if (count >= comparisonData.length) clearInterval(interval);
    }, 180);
    return () => clearInterval(interval);
  }, [active]);

  const Check = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e87a2a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
  const Cross = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(240,236,228,0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 80px 80px",
          textAlign: "center",
          marginBottom: 12,
          paddingBottom: 12,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div />
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 600, color: "rgba(240,236,228,0.45)" }}>
            Antes
          </div>
        </div>
        <div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
            Com IA
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--accent)", opacity: 0.6 }}>
            Ativo agora
          </div>
        </div>
      </div>

      {comparisonData.map((row, i) => (
        <div
          key={row.feature}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 80px 80px",
            alignItems: "center",
            textAlign: "center",
            padding: "10px 0",
            borderBottom: i < comparisonData.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
            opacity: i < rowsVisible ? 1 : 0,
            transform: i < rowsVisible ? "translateX(0)" : "translateX(-10px)",
            transition: "all 0.35s ease",
          }}
        >
          <span style={{ fontFamily: "var(--mono)", fontSize: 12, color: "rgba(240,236,228,0.7)", textAlign: "left" }}>
            {row.feature}
          </span>
          <span style={{ display: "flex", justifyContent: "center" }}>
            {row.before ? <Check /> : <Cross />}
          </span>
          <span style={{ display: "flex", justifyContent: "center" }}>
            {row.after ? <Check /> : <Cross />}
          </span>
        </div>
      ))}

      <div
        style={{
          marginTop: 16,
          background: "rgba(232,122,42,0.12)",
          border: "1px solid rgba(232,122,42,0.3)",
          borderRadius: 10,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          opacity: rowsVisible >= comparisonData.length ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      >
        <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
          Ativar atendente IA
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e87a2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="M12 5l7 7-7 7" />
        </svg>
      </div>
    </>
  );
}

/* ── Screen 3: Escale ────────────────────────────── */

function ScreenEscale({ active }: { active: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 200);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <>
      <div
        style={{
          background: "rgba(232,122,42,0.08)",
          border: "1px solid rgba(232,122,42,0.25)",
          borderRadius: 10,
          padding: "24px 20px",
          textAlign: "center",
          transition: "all 0.5s ease",
          opacity: show ? 1 : 0,
          transform: show ? "scale(1)" : "scale(0.95)",
        }}
      >
        <div style={{ marginBottom: 6, display: "flex", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e87a2a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 18, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>
          Seu negócio escalando
        </div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "rgba(240,236,228,0.45)", marginBottom: 18, letterSpacing: 1 }}>
          RESULTADOS DOS ÚLTIMOS 30 DIAS
        </div>

        <div className="flex flex-wrap justify-center gap-4 md:gap-6 mb-1">
          {[
            { label: "Leads captados", value: "1.247" },
            { label: "Tempo resposta", value: "<3s" },
            { label: "Conversão", value: "+68%" },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 16, fontWeight: 700, color: "#f0ece4" }}>
                {s.value}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "rgba(240,236,228,0.35)", marginTop: 2 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          marginTop: 14,
          background: "rgba(232,122,42,0.12)",
          border: "1px solid rgba(232,122,42,0.3)",
          borderRadius: 10,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          transition: "all 0.5s ease 0.2s",
          opacity: show ? 1 : 0,
          transform: show ? "translateY(0)" : "translateY(10px)",
        }}
      >
        <span style={{ fontFamily: "var(--mono)", fontSize: 13, fontWeight: 600, color: "var(--accent)" }}>
          Ver dashboard completo
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e87a2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </div>
    </>
  );
}

/* ── Main Section ─────────────────────────────────── */

export default function SolutionSection() {
  const [activeStep, setActiveStep] = useState(0);
  const [sectionVisible, setSectionVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setSectionVisible(true);
      },
      { threshold: 0.1 }
    );
    if (sectionRef.current) obs.observe(sectionRef.current);
    return () => obs.disconnect();
  }, []);

  const screens = [ScreenConecte, ScreenAutomatize, ScreenEscale];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap');
        :root { --mono: 'JetBrains Mono', monospace; --accent: #e87a2a; --bg: #000000; --fg: #f0ece4; }
        @keyframes blink { 50% { opacity: 0; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      <section
        id="solution"
        ref={sectionRef}
        className="py-12 px-5 md:py-16 lg:py-[100px] lg:px-6"
        style={{
          background: "var(--bg)",
          color: "var(--fg)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          {/* Header */}
          <div className="mb-8 md:mb-14">
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: 12,
                letterSpacing: 3,
                color: "var(--accent)",
                fontWeight: 500,
                display: "block",
                marginBottom: 16,
                opacity: sectionVisible ? 1 : 0,
                transform: sectionVisible ? "translateY(0)" : "translateY(20px)",
                transition: "all 0.5s ease",
              }}
            >
              A SOLUÇÃO
            </span>
            <h2
              style={{
                fontSize: "clamp(32px, 5vw, 52px)",
                fontWeight: 800,
                margin: "0 0 16px",
                lineHeight: 1.1,
                letterSpacing: -1.5,
                opacity: sectionVisible ? 1 : 0,
                transform: sectionVisible ? "translateY(0)" : "translateY(20px)",
                transition: "all 0.6s ease 0.1s",
              }}
            >
              IA que atende, vende e escala seu negócio.
            </h2>
            <p
              style={{
                fontSize: 17,
                lineHeight: 1.6,
                color: "rgba(240,236,228,0.55)",
                maxWidth: 560,
                margin: 0,
                opacity: sectionVisible ? 1 : 0,
                transform: sectionVisible ? "translateY(0)" : "translateY(20px)",
                transition: "all 0.6s ease 0.2s",
              }}
            >
              Três passos simples. Conecte seus canais, ative atendentes inteligentes no WhatsApp e
              Telegram, e veja seus resultados decolarem.
            </p>
          </div>

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8 items-start">
            {/* Steps */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {steps.map((step, i) => {
                const isActive = activeStep === i;
                return (
                  <div
                    key={step.number}
                    onClick={() => setActiveStep(i)}
                    style={{
                      background: isActive ? "rgba(232,122,42,0.04)" : "rgba(255,255,255,0.02)",
                      border: isActive
                        ? "1px solid var(--accent)"
                        : "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 12,
                      padding: "24px 24px 28px",
                      cursor: "pointer",
                      transition: "all 0.35s ease",
                      opacity: sectionVisible ? 1 : 0,
                      transform: sectionVisible ? "translateY(0)" : "translateY(25px)",
                      transitionDelay: `${i * 100}ms`,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <span
                        style={{
                          color: "var(--accent)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 30,
                          height: 30,
                          borderRadius: 7,
                          background: "rgba(232,122,42,0.1)",
                        }}
                      >
                        {step.icon}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: 11,
                          letterSpacing: 2.5,
                          color: "var(--accent)",
                          fontWeight: 500,
                        }}
                      >
                        STEP {step.number} — {step.label}
                      </span>
                    </div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--fg)", margin: "0 0 6px", lineHeight: 1.4 }}>
                      {step.title}
                    </h3>
                    <div
                      style={{
                        maxHeight: isActive ? 150 : 0,
                        opacity: isActive ? 1 : 0,
                        overflow: "hidden",
                        transition: "all 0.4s ease",
                      }}
                    >
                      <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "rgba(240,236,228,0.45)", margin: 0 }}>
                        {step.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Terminal */}
            <div className="md:sticky md:top-10">
              <TerminalShell visible={sectionVisible}>
                {screens.map((Screen, i) => (
                  <div key={i} style={{ display: activeStep === i ? "block" : "none" }}>
                    <Screen active={activeStep === i} />
                  </div>
                ))}
              </TerminalShell>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
