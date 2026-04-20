'use client'

import React from 'react'
import { Modal } from '@heroui/react'
import { ASSISTANT_TEMPLATES, type AssistantTemplate } from '@/lib/assistantTemplates'

interface AssistantTemplatesModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  onSelect: (template: AssistantTemplate) => void
}

const monoFont = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" } as const

export function AssistantTemplatesModal({ isOpen, onOpenChange, onSelect }: AssistantTemplatesModalProps) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[960px] w-full max-h-[90vh] overflow-y-auto">
            <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </Modal.CloseTrigger>
            <Modal.Header>
              <Modal.Heading className="text-xl font-semibold text-heading" style={monoFont}>
                Templates de Assistente
              </Modal.Heading>
              <p className="text-subtle text-sm mt-1">
                Escolha um modelo para começar rapidamente — ferramentas e configurações incluídas.
              </p>
            </Modal.Header>
            <Modal.Body className="pb-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {ASSISTANT_TEMPLATES.map((t, i) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    index={i}
                    onSelect={() => onSelect(t)}
                  />
                ))}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function TemplateCard({
  template,
  index,
  onSelect,
}: {
  template: AssistantTemplate
  index: number
  onSelect: () => void
}) {
  const Icon = template.icon
  const visibleTools = template.tools.slice(0, 3)
  const extraTools = template.tools.length - visibleTools.length

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Usar template ${template.name}`}
      className="flex flex-col gap-3 p-4 rounded-xl bg-surface border border-dim hover:border-[#ff6b2c]/25 hover:bg-raised transition-all duration-200 text-left cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#ff6b2c]/20 animate-fade-in-up opacity-0"
      style={{ animationDelay: `${index * 60}ms`, animationFillMode: 'forwards' }}
    >
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-lg bg-raised flex items-center justify-center text-[#ff6b2c]">
          <Icon size={18} />
        </div>
        <span
          className="text-[10px] uppercase tracking-wider text-subtle px-2 py-0.5 rounded-md bg-raised"
          style={monoFont}
        >
          {template.category}
        </span>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-heading" style={monoFont}>
          {template.name}
        </h3>
        <p className="text-body text-xs mt-1 leading-relaxed line-clamp-2">
          {template.description}
        </p>
      </div>

      {visibleTools.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {visibleTools.map((tool) => (
            <span
              key={tool.toolType}
              className="text-[10px] px-1.5 py-0.5 rounded-md bg-raised text-subtle"
              style={monoFont}
            >
              {tool.toolType}
            </span>
          ))}
          {extraTools > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md bg-raised text-subtle"
              style={monoFont}
            >
              +{extraTools}
            </span>
          )}
        </div>
      )}

      <div className="text-[10px] text-subtle mt-auto" style={monoFont}>
        {template.llmProvider} · {template.model}
      </div>
    </button>
  )
}
