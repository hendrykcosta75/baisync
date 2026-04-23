'use client'

import React, { useState } from 'react'
import { Modal } from '@heroui/react'
import { ChevronDown, HelpCircle, Copy, Check, Mail } from 'lucide-react'

interface HelpModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const

interface FaqEntry {
  id: string
  question: string
  platforms?: string[]
  body: React.ReactNode
}

const LINUX_BT_SCRIPT = `mkdir -p ~/.config/wireplumber/policy.lua.d
cat > ~/.config/wireplumber/policy.lua.d/51-bluetooth-no-autoswitch.lua << 'EOF'
bluetooth_policy = bluetooth_policy or {}
bluetooth_policy.policy = bluetooth_policy.policy or {}
bluetooth_policy.policy["media-role.use-headset-profile"] = false
EOF
systemctl --user restart wireplumber pipewire pipewire-pulse`

const FAQ: FaqEntry[] = [
  {
    id: 'linux-bt-audio',
    question: 'Áudio do Sophie / SWOT não sai no fone Bluetooth (Linux)',
    platforms: ['Linux'],
    body: (
      <div className="space-y-3 text-sm text-body leading-relaxed">
        <p>
          Em Linux com PipeWire + WirePlumber, sempre que o navegador abre o
          microfone, o sistema troca automaticamente o perfil do fone Bluetooth
          de <b>A2DP</b> (alta qualidade) para <b>HSP/HFP</b> (modo chamada).
          Nesse perfil, a playback de mídia não sai no fone — e é por isso que o
          YouTube funciona no fone (não usa mic) mas o Sophie / SWOT não.
        </p>
        <p>
          <b>Solução:</b> desligar esse auto-switch. Cola o comando abaixo no
          terminal (reconecta o fone depois):
        </p>
        <CodeBlock code={LINUX_BT_SCRIPT} />
        <p className="text-xs text-subtle">
          Trade-off: você deixa de usar o mic do fone BT (A2DP não tem canal de
          entrada). Use o mic do notebook. Pra reverter, apague o arquivo{' '}
          <code className="text-heading bg-raised px-1 rounded">
            ~/.config/wireplumber/policy.lua.d/51-bluetooth-no-autoswitch.lua
          </code>{' '}
          e reinicie o WirePlumber.
        </p>
        <p className="text-xs text-subtle">
          Em distros com WirePlumber 0.5+ o comando oficial é{' '}
          <code className="text-heading bg-raised px-1 rounded">
            wpctl settings --save bluetooth.autoswitch-to-headset-profile false
          </code>.
        </p>
      </div>
    ),
  },
  {
    id: 'mic-permission',
    question: 'Navegador pede permissão do microfone toda vez',
    body: (
      <div className="space-y-2 text-sm text-body leading-relaxed">
        <p>
          Se a permissão não está ficando salva, verifique em{' '}
          <code className="text-heading bg-raised px-1 rounded">chrome://settings/content/microphone</code>{' '}
          se o site não está na lista de bloqueados. Abas anônimas sempre pedem
          permissão a cada nova sessão — é comportamento padrão.
        </p>
      </div>
    ),
  },
  {
    id: 'sophie-text-vs-voice',
    question: 'Sophie tem as mesmas ações no modo texto e no modo voz?',
    body: (
      <div className="space-y-2 text-sm text-body leading-relaxed">
        <p>
          Sim. No modo voz o Gemini Live usa uma ferramenta unificada{' '}
          <code className="text-heading bg-raised px-1 rounded">executar_acao</code>{' '}
          que executa qualquer ação documentada no system prompt (criar
          atendente, listar conversas, tirar print, conectar WhatsApp, etc.) —
          paridade total com o modo texto.
        </p>
      </div>
    ),
  },
  {
    id: 'swot-live',
    question: 'Entrevista SWOT por voz não mostra perguntas no sidebar',
    body: (
      <div className="space-y-2 text-sm text-body leading-relaxed">
        <p>
          No modo live de SWOT as perguntas são feitas por voz (áudio). O
          sidebar com lista de perguntas só aparece no modo texto. Ao final da
          entrevista por voz, a IA gera a análise SWOT automaticamente via
          ferramenta dedicada.
        </p>
      </div>
    ),
  },
]

export function HelpModal({ isOpen, onOpenChange }: HelpModalProps) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[680px] w-full max-h-[85vh] overflow-y-auto">
            <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Modal.CloseTrigger>
            <Modal.Header>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center">
                  <HelpCircle size={18} className="text-[#ff6b2c]" />
                </div>
                <div>
                  <Modal.Heading className="text-lg font-bold text-heading" style={mono}>
                    Ajuda e Feedback
                  </Modal.Heading>
                  <p className="text-subtle text-xs">Problemas comuns e como resolver</p>
                </div>
              </div>
            </Modal.Header>
            <Modal.Body className="pb-5">
              <h3
                className="text-[11px] font-semibold tracking-wider uppercase text-subtle mt-2 mb-3"
                style={mono}
              >
                FAQ
              </h3>
              <div className="space-y-2">
                {FAQ.map((entry) => (
                  <FaqItem key={entry.id} entry={entry} />
                ))}
              </div>

              <h3
                className="text-[11px] font-semibold tracking-wider uppercase text-subtle mt-6 mb-3"
                style={mono}
              >
                Feedback
              </h3>
              <a
                href="mailto:suporte@baisync.com.br?subject=Feedback%20%E2%80%94%20Painel"
                className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[10px] bg-raised border border-dim hover:border-[#ff6b2c]/25 text-body hover:text-heading transition-all duration-200 text-sm"
                style={mono}
              >
                <Mail size={14} className="text-[#ff6b2c]" />
                <span className="flex-1">Enviar feedback ou reportar bug</span>
                <span className="text-subtle text-xs">suporte@baisync.com.br</span>
              </a>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function FaqItem({ entry }: { entry: FaqEntry }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[10px] border border-dim bg-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-dim/40 transition-colors"
        aria-expanded={open}
      >
        <span className="flex-1 text-sm font-semibold text-heading" style={mono}>
          {entry.question}
        </span>
        {entry.platforms?.length ? (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded bg-[#ff6b2c]/10 text-[#ff6b2c] border border-[#ff6b2c]/30"
            style={mono}
          >
            {entry.platforms.join(' / ')}
          </span>
        ) : null}
        <ChevronDown
          size={15}
          className={`text-subtle shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="px-3.5 pb-3.5 pt-1 border-t border-dim">{entry.body}</div>
      )}
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="relative rounded-lg border border-dim bg-app overflow-hidden">
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-2 top-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-raised border border-dim text-subtle hover:text-heading transition-colors text-[10px]"
        style={mono}
      >
        {copied ? <Check size={11} className="text-[#22c55e]" /> : <Copy size={11} />}
        {copied ? 'copiado' : 'copiar'}
      </button>
      <pre
        className="px-3 py-2.5 pr-16 overflow-x-auto text-[11px] text-body leading-relaxed"
        style={mono}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
