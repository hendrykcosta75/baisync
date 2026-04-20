'use client'

import React from 'react'
import { Modal } from '@heroui/react'
import { Assistant, IntegrationCommonSettings } from '@/types/assistant'
import { AssistantForm, AssistantFormData } from './assistant-form'
import type { TemplateTool } from '@/lib/assistantTemplates'

interface AssistantModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  initialData?: Assistant | null
  mode?: 'create' | 'edit'
  templatePreview?: {
    tools: TemplateTool[]
    integrationSettings: IntegrationCommonSettings
  }
  onSubmit: (data: AssistantFormData) => void
}

const monoFont = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const

export function AssistantModal({ isOpen, onOpenChange, initialData, mode, templatePreview, onSubmit }: AssistantModalProps) {
  const resolvedMode: 'create' | 'edit' = mode ?? (initialData ? 'edit' : 'create')

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[600px] w-full max-h-[90vh] overflow-y-auto">
            <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </Modal.CloseTrigger>
            <Modal.Header>
              <Modal.Heading className="text-xl font-semibold text-heading" style={monoFont}>
                {resolvedMode === 'edit' ? 'Editar Assistente' : 'Criar Assistente'}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="pb-6">
              {templatePreview && <TemplatePreview preview={templatePreview} />}
              <AssistantForm
                initialData={initialData}
                onSubmit={(data) => {
                  onSubmit(data)
                  onOpenChange(false)
                }}
                onCancel={() => onOpenChange(false)}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function TemplatePreview({ preview }: { preview: { tools: TemplateTool[]; integrationSettings: IntegrationCommonSettings } }) {
  const settingsActive = [
    preview.integrationSettings.splitOnDoubleNewline && 'split de mensagens',
    preview.integrationSettings.typingIndicator && 'mostrar digitando',
    preview.integrationSettings.interpretDocuments && 'interpretar documentos',
  ].filter(Boolean) as string[]

  return (
    <div className="mb-4 p-3 rounded-xl bg-surface border border-dim">
      <p className="text-[11px] uppercase tracking-wider text-subtle mb-2" style={monoFont}>
        Este template inclui
      </p>
      {preview.tools.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {preview.tools.map((t) => (
            <span
              key={t.toolType}
              className="text-[11px] px-2 py-0.5 rounded-md bg-raised text-body"
              style={monoFont}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
      {settingsActive.length > 0 && (
        <p className="text-xs text-subtle">
          {settingsActive.join(' · ')}
        </p>
      )}
    </div>
  )
}
