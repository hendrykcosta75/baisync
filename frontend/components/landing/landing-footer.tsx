'use client';

import Link from 'next/link';

const footerLinks = {
  produto: [
    { label: 'Recursos', href: '#recursos' },
    { label: 'Planos', href: '/pricing' },
    { label: 'Demo', href: '#demo' },
    { label: 'Integrações', href: '#integracoes' },
    { label: 'Changelog', href: '#changelog' },
  ],
  empresa: [
    { label: 'Sobre', href: '#sobre' },
    { label: 'Blog', href: '/blog' },
    { label: 'Carreiras', href: '#carreiras' },
    { label: 'Contato', href: '#contato' },
  ],
  legal: [
    { label: 'Privacidade', href: '#privacidade' },
    { label: 'Termos de Uso', href: '#termos' },
    { label: 'Cookies', href: '#cookies' },
  ],
};

function LinkedInIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

function TwitterIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
      <path d="M4 20l6.768 -6.768" />
      <path d="M20 4l-6.768 6.768" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  );
}

function BaisyncLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <rect width="28" height="28" rx="6" fill="#FF6B00" />
      <path
        d="M8 8h4.5a3.5 3.5 0 0 1 0 7H8V8zm0 7h5a3.5 3.5 0 0 1 0 7H8v-7z"
        fill="#000"
        fillOpacity="0.9"
      />
    </svg>
  );
}

function FooterLinkColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h4 className="text-white font-bold text-xs uppercase tracking-[2px] mb-4">
        {title}
      </h4>
      <ul className="flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="nav-link-underline text-[#666] hover:text-white transition text-[13px]"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingFooter() {
  const socialIcons = [
    { icon: <LinkedInIcon />, href: '#', label: 'LinkedIn' },
    { icon: <InstagramIcon />, href: '#', label: 'Instagram' },
    { icon: <TwitterIcon />, href: '#', label: 'X (Twitter)' },
    { icon: <GitHubIcon />, href: '#', label: 'GitHub' },
  ];

  return (
    <footer className="mx-6 lg:mx-12 mb-8">
      <div className="bg-[#0a0a0a] rounded-3xl border border-[#1a1a1a] overflow-hidden min-h-[400px] flex flex-col">
        {/* Top section */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8 px-8 lg:px-12 pt-12 pb-10">
          {/* Brand column — spans 2 on desktop */}
          <div className="md:col-span-2 lg:col-span-1 flex flex-col gap-5">
            <div className="flex items-center gap-3">
              <BaisyncLogo />
              <span
                className="text-white text-lg font-bold tracking-wider font-[family-name:var(--font-jetbrains-mono)]"
              >
                BAISYNC
              </span>
            </div>
            <p className="text-[#666] text-[13px] leading-relaxed max-w-[280px]">
              Impulsionando negocios com Inteligencia Artificial
            </p>
            <div className="flex items-center gap-4 mt-1">
              {socialIcons.map((social) => (
                <a
                  key={social.label}
                  href={social.href}
                  aria-label={social.label}
                  className="text-[#666] hover:text-[#FF6B00] transition-colors duration-200"
                >
                  {social.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <FooterLinkColumn title="Produto" links={footerLinks.produto} />
          <FooterLinkColumn title="Empresa" links={footerLinks.empresa} />
          <FooterLinkColumn title="Legal" links={footerLinks.legal} />
        </div>

        {/* Bottom bar */}
        <div className="border-t border-[#1a1a1a] py-6 px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <span className="text-[#555] text-xs">
            &copy; 2026 Baisync. Todos os direitos reservados.
          </span>
          <span className="flex items-center gap-2 text-xs text-[#555]">
            Feito com IA
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#FF6B00] opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#FF6B00]" />
            </span>
          </span>
        </div>
      </div>
    </footer>
  );
}
