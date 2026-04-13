'use client'

import React, { useState, useEffect } from 'react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { AssistantCard } from '@/components/assistants/assistant-card'
import { AssistantModal } from '@/components/assistants/assistant-modal'
import { Assistant } from '@/types/assistant'
import { AssistantFormData } from '@/components/assistants/assistant-form'
import { v4 as uuidv4 } from 'uuid'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'
import { Bot } from 'lucide-react'

export default function AssistantsPage() {
  const { assistants, addAssistant, updateAssistant, deleteAssistant, fetchAssistants, hasFetched } = useAssistantStore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingAssistant, setEditingAssistant] = useState<Assistant | null>(null)

  useEffect(() => {
    if (!hasFetched) fetchAssistants()
  }, [hasFetched, fetchAssistants])

  const handleCreate = () => {
    setEditingAssistant(null)
    setIsModalOpen(true)
  }

  const handleEdit = (assistant: Assistant) => {
    setEditingAssistant(assistant)
    setIsModalOpen(true)
  }

  const handleDelete = (assistant: Assistant) => {
    deleteAssistant(assistant.id)
  }

  const handleSubmitAssistant = (data: AssistantFormData) => {
    if (editingAssistant) {
      updateAssistant(editingAssistant.id, data)
    } else {
      addAssistant({ ...data, id: uuidv4() })
    }
  }

  return (
    <PageTransition>
      <StaggerContainer className="flex flex-col gap-6 w-full">
        <StaggerItem>
          <div className="flex items-center justify-between w-full">
            <div>
              <h1
                className="text-2xl font-light tracking-tight text-foreground"
                style={{ fontFamily: "'Fira Code', 'JetBrains Mono', monospace" }}
              >
                Assistentes de IA
              </h1>
              <p className="text-subtle text-sm mt-1">Gerencie todos os seus assistentes de IA e ferramentas.</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium" onMouseDown={undefined} onClick={handleCreate}>
                Criar Assistente
              </button>
            </div>
          </div>
        </StaggerItem>

        {assistants.length === 0 ? (
          <StaggerItem>
            <div
              className="flex flex-col items-center justify-center p-16 mt-8 rounded-2xl w-full text-center"
              style={{
                background: 'rgba(255, 107, 44, 0.02)',
                border: '1px dashed rgba(255, 107, 44, 0.12)',
              }}
            >
              <div className="w-16 h-16 rounded-xl bg-raised flex items-center justify-center mb-6">
                <Bot size={28} className="text-subtle" />
              </div>
              <h3
                className="text-lg font-semibold"
                style={{ color: '#f0f0f0' }}
              >
                Crie seu primeiro assistente
              </h3>
              <p className="text-subtle text-sm mt-2 max-w-sm mb-6">
                Configure um assistente de IA para atendimento ao cliente via WhatsApp ou Telegram.
              </p>
              <button className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium" onClick={handleCreate}>
                Criar Assistente
              </button>
            </div>
          </StaggerItem>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 w-full">
            {assistants.map((assistant) => (
              <StaggerItem key={assistant.id}>
                <AssistantCard
                  assistant={assistant}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </StaggerItem>
            ))}
          </div>
        )}

        <AssistantModal
          isOpen={isModalOpen}
          onOpenChange={setIsModalOpen}
          initialData={editingAssistant}
          onSubmit={handleSubmitAssistant}
        />
      </StaggerContainer>
    </PageTransition>
  )
}
