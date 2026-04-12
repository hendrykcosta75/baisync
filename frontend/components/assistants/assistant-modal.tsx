'use client'

import React from 'react'
import { Modal } from '@heroui/react'
import { Assistant } from '@/types/assistant'
import { AssistantForm, AssistantFormData } from './assistant-form'

interface AssistantModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
  initialData?: Assistant | null
  onSubmit: (data: AssistantFormData) => void
}

export function AssistantModal({ isOpen, onOpenChange, initialData, onSubmit }: AssistantModalProps) {
  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[600px] w-full max-h-[90vh] overflow-y-auto">
            <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
            </Modal.CloseTrigger>
            <Modal.Header>
              <Modal.Heading className="text-xl font-semibold">
                {initialData ? 'Editar Assistente' : 'Criar Assistente'}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body className="pb-6">
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
