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

export function AssistantCard({ assistant, onEdit, onDelete }: AssistantCardProps) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      <Card className="w-full h-full flex flex-col overflow-hidden transition-all hover:shadow-md hover:border-[#ff6b2c]/30">
        <div className="flex-1 flex flex-col w-full relative">
          <Link
            href={`/dashboard/assistants/${assistant.id}`}
            className="absolute inset-0 z-0"
            aria-label={`View details for ${assistant.name}`}
          />
          <div className="p-5 flex-1 z-1 pointer-events-none">
            <div className="flex justify-between items-start gap-4 flex-row w-full text-left">
              <div className="flex-1">
                <h4 className="text-lg font-semibold text-foreground">{assistant.name}</h4>
                <p className="text-muted text-sm line-clamp-2 mt-1">
                  {assistant.description || 'Sem descrição.'}
                </p>
              </div>
              <div className={`px-2 py-1 flex shrink-0 items-center rounded-md text-[10px] font-bold uppercase tracking-wider ${
                assistant.llmProvider === 'openai' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400' :
                assistant.llmProvider === 'claude' ? 'bg-[#ff6b2c]/10 text-[#ff6b2c]' :
                'bg-[#ff6b2c]/10 text-[#ff6b2c] dark:bg-[#ff6b2c]/10 dark:text-[#ff6b2c]'
              }`}>
                {assistant.llmProvider.toUpperCase()}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm mt-4 pt-4 border-t border-dim">
              <div>
                <p className="text-muted text-[10px] uppercase font-bold mb-1">Modelo</p>
                <p className="text-foreground truncate font-medium">{assistant.model}</p>
              </div>
              <div>
                <p className="text-muted text-[10px] uppercase font-bold mb-1">Temperatura</p>
                <p className="text-foreground font-medium">{assistant.temperature}</p>
              </div>
            </div>
          </div>
        </div>
        <div className="p-4 flex justify-end gap-2 border-t border-dim z-10">
          <Button variant="ghost" size="sm" className="text-red-500" onPress={() => setDeleteOpen(true)}>
            Excluir
          </Button>
          <Button variant="ghost" size="sm" onPress={() => onEdit(assistant)}>
            Edição Rápida
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
                  Tem certeza que deseja excluir <strong className="text-heading">{assistant.name}</strong>? Esta ação não pode ser desfeita.
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
