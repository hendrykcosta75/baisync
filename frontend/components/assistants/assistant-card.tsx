'use client'

import { useState } from 'react'
import { Card, Button, Modal } from '@heroui/react'
import { Assistant } from '@/types/assistant'
import Link from 'next/link'

interface AssistantCardProps {
  assistant: Assistant
  onEdit: (assistant: Assistant) => void
  onDelete: (assistant: Assistant) => void
}

const providerStyles: Record<string, { bg: string; text: string }> = {
  openai: { bg: 'rgba(6, 78, 59, 0.3)', text: '#34d399' },
  claude: { bg: 'rgba(255, 107, 44, 0.1)', text: '#ff6b2c' },
  gemini: { bg: 'rgba(30, 58, 138, 0.3)', text: '#60a5fa' },
}

export function AssistantCard({ assistant, onEdit, onDelete }: AssistantCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  const provider = providerStyles[assistant.llmProvider] || providerStyles.claude

  return (
    <>
      <Card
        className="glass-card w-full h-full flex flex-col overflow-hidden"
        style={{
          border: '1px solid rgba(255, 255, 255, 0.06)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <div className="flex-1 flex flex-col w-full relative">
          <Link
            href={`/dashboard/assistants/${assistant.id}`}
            className="absolute inset-0 z-0"
            aria-label={`View details for ${assistant.name}`}
          />
          <div className="p-5 flex-1 z-1 pointer-events-none">
            <div className="flex justify-between items-start gap-4 flex-row w-full text-left">
              <div className="flex-1">
                <h4
                  className="text-lg font-bold"
                  style={{
                    color: '#f0f0f0',
                    fontFamily: "var(--font-jetbrains-mono, 'JetBrains Mono', monospace)",
                    fontWeight: 700,
                  }}
                >
                  {assistant.name}
                </h4>
                <p className="text-sm line-clamp-2 mt-1" style={{ color: '#8a8a8a' }}>
                  {assistant.description || 'Sem descricao.'}
                </p>
              </div>
              <div
                className="px-2.5 py-1 flex shrink-0 items-center rounded-md text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: provider.bg,
                  color: provider.text,
                  boxShadow: `0 0 12px ${provider.text}15`,
                }}
              >
                {assistant.llmProvider.toUpperCase()}
              </div>
            </div>

            <div
              className="grid grid-cols-2 gap-4 text-sm mt-4 pt-4"
              style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
            >
              <div>
                <p
                  className="text-[10px] uppercase font-bold mb-1"
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    letterSpacing: '0.05em',
                    color: '#8a8a8a',
                  }}
                >
                  MODELO
                </p>
                <p className="truncate font-medium" style={{ color: '#f0f0f0' }}>
                  {assistant.model}
                </p>
              </div>
              <div>
                <p
                  className="text-[10px] uppercase font-bold mb-1"
                  style={{
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    letterSpacing: '0.05em',
                    color: '#8a8a8a',
                  }}
                >
                  TEMPERATURA
                </p>
                <p className="font-medium" style={{ color: '#f0f0f0' }}>
                  {assistant.temperature}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div
          className="p-4 flex justify-end gap-2 z-10"
          style={{ borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}
        >
          <Button
            variant="ghost"
            size="sm"
            className="text-red-400 hover:text-red-300"
            onPress={() => setDeleteOpen(true)}
          >
            Excluir
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="hover:!text-[#ff6b2c]"
            style={{ color: '#8a8a8a' }}
            onPress={() => onEdit(assistant)}
          >
            Edicao Rapida
          </Button>
        </div>
      </Card>

      <Modal isOpen={deleteOpen} onOpenChange={(open) => { if (!open) setDeleteOpen(false) }}>
        <Modal.Backdrop variant="blur">
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-[400px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Excluir Assistente</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted">
                  Tem certeza que deseja excluir <strong className="text-heading">{assistant.name}</strong>? Esta acao nao pode ser desfeita.
                </p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" slot="close">
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    onDelete(assistant)
                    setDeleteOpen(false)
                  }}
                >
                  Sim, excluir
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  )
}
