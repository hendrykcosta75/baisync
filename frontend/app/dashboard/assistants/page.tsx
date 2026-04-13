'use client'

import React, { useState, useEffect } from 'react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { AssistantCard } from '@/components/assistants/assistant-card'
import { AssistantModal } from '@/components/assistants/assistant-modal'
import { Assistant } from '@/types/assistant'
import { AssistantFormData } from '@/components/assistants/assistant-form'
import { v4 as uuidv4 } from 'uuid'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'

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
              <p className="text-[#8a8a8a] text-sm mt-1">Gerencie todos os seus assistentes de IA e ferramentas.</p>
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
              {/* Cat mascot silhouette */}
              <div className="mb-6" style={{ opacity: 0.22 }}>
                <svg viewBox="0 0 120 120" width={80} height={80} fill="none">
                  <defs>
                    <linearGradient id="emptyLogoGrad" x1="60" y1="20" x2="60" y2="112" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="#ff6b2c" />
                      <stop offset="100%" stopColor="#ff8533" />
                    </linearGradient>
                  </defs>
                  <path d="M18 72C18 44 34 24 60 24C86 24 102 44 102 72C102 92 88 108 60 108C32 108 18 92 18 72Z" fill="url(#emptyLogoGrad)" />
                  <path d="M26 52L16 18L46 38Z" fill="url(#emptyLogoGrad)" />
                  <path d="M94 52L104 18L74 38Z" fill="url(#emptyLogoGrad)" />
                  <path d="M28 49L20 24L42 38Z" fill="#cc5500" opacity=".5" />
                  <path d="M92 49L100 24L78 38Z" fill="#cc5500" opacity=".5" />
                  <ellipse cx="44" cy="68" rx="9" ry="7" fill="#0a0a0a" opacity=".92" />
                  <rect x="42" y="63" width="4" height="10" rx="2" fill="#ff6b2c" opacity=".9" />
                  <ellipse cx="46" cy="65" rx="1.8" ry="1.2" fill="rgba(255,255,255,0.5)" transform="rotate(-20,46,65)" />
                  <ellipse cx="76" cy="68" rx="9" ry="7" fill="#0a0a0a" opacity=".92" />
                  <rect x="74" y="63" width="4" height="10" rx="2" fill="#ff6b2c" opacity=".9" />
                  <ellipse cx="78" cy="65" rx="1.8" ry="1.2" fill="rgba(255,255,255,0.5)" transform="rotate(-20,78,65)" />
                  <path d="M56 84L60 80L64 84L60 88Z" fill="rgba(0,0,0,0.62)" />
                </svg>
              </div>
              <h3
                className="text-lg font-semibold"
                style={{ color: '#f0f0f0' }}
              >
                Crie seu primeiro assistente
              </h3>
              <p className="text-[#8a8a8a] text-sm mt-2 max-w-sm mb-6">
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
