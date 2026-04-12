'use client'

import React, { useState, useEffect } from 'react'
import { Button } from '@heroui/react'
import { Bot } from 'lucide-react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { AssistantCard } from '@/components/assistants/assistant-card'
import { AssistantModal } from '@/components/assistants/assistant-modal'
import { Assistant } from '@/types/assistant'
import { AssistantFormData } from '@/components/assistants/assistant-form'
import { v4 as uuidv4 } from 'uuid'

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
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-center justify-between w-full">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Assistentes de IA</h1>
          <p className="text-muted text-sm mt-1">Gerencie todos os seus assistentes de IA e ferramentas.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onPress={handleCreate}>
            Criar Assistente
          </Button>
        </div>
      </div>

      {assistants.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 mt-8 border border-dashed border-dim rounded-2xl bg-raised/50 w-full text-center">
          <div className="mb-4 text-muted"><Bot size={44} strokeWidth={1.5} /></div>
          <h3 className="text-lg font-semibold text-foreground">Nenhum Assistente Ainda</h3>
          <p className="text-muted text-sm mt-2 max-w-sm mb-6">
            Você ainda não tem nenhum assistente configurado. Crie seu primeiro assistente para começar a usar ferramentas de IA.
          </p>
          <Button variant="primary" onPress={handleCreate}>
            Criar Assistente
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 w-full">
          {assistants.map((assistant) => (
            <AssistantCard
              key={assistant.id}
              assistant={assistant}
              onEdit={handleEdit}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <AssistantModal
        isOpen={isModalOpen}
        onOpenChange={setIsModalOpen}
        initialData={editingAssistant}
        onSubmit={handleSubmitAssistant}
      />
    </div>
  )
}
