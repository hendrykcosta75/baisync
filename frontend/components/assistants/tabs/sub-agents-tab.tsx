'use client'

import React, { useState } from 'react'
import { Assistant, SubAgent, LLMProvider } from '@/types/assistant'
import { Card, Button, Switch, Modal, Input, TextArea, Form, Select, ListBox, Label, TextField, FieldError } from '@heroui/react'
import { Bot } from 'lucide-react'
import { useAssistantStore } from '@/store/useAssistantStore'
import { useModels } from '@/lib/useModels'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'

interface SubAgentsTabProps {
  assistant: Assistant
}

const subAgentSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  description: z.string().min(1, 'Descrição é obrigatória'),
  inheritPrompt: z.boolean(),
  customPrompt: z.string(),
  inheritKnowledge: z.boolean(),
  inheritTools: z.boolean(),
  llmProvider: z.enum(['openai', 'claude', 'gemini', 'inherit']),
  model: z.string(),
})

type SubAgentFormData = z.infer<typeof subAgentSchema>

const defaultValues: SubAgentFormData = {
  name: '',
  description: '',
  inheritPrompt: true,
  customPrompt: '',
  inheritKnowledge: true,
  inheritTools: true,
  llmProvider: 'inherit',
  model: '',
}

export function SubAgentsTab({ assistant }: SubAgentsTabProps) {
  const { updateAssistant, addSubAgent, updateSubAgent, removeSubAgent } = useAssistantStore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingSubAgent, setEditingSubAgent] = useState<SubAgent | null>(null)

  const isTeamLead = assistant.isTeamLead || false
  const subAgents = assistant.subAgents || []

  const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<SubAgentFormData>({
    resolver: zodResolver(subAgentSchema),
    defaultValues,
  })

  const watchInheritPrompt = watch('inheritPrompt')
  const watchLlmProvider = watch('llmProvider')

  const selectedProvider = watchLlmProvider && watchLlmProvider !== 'inherit'
    ? watchLlmProvider as LLMProvider
    : 'openai'
  const { models: fetchedModels, isLoading: modelsLoading } = useModels(selectedProvider)
  const availableModels = watchLlmProvider && watchLlmProvider !== 'inherit'
    ? fetchedModels
    : []

  const openAddModal = () => {
    setEditingSubAgent(null)
    reset(defaultValues)
    setIsModalOpen(true)
  }

  const openEditModal = (subAgent: SubAgent) => {
    setEditingSubAgent(subAgent)
    reset({
      name: subAgent.name,
      description: subAgent.description,
      inheritPrompt: subAgent.inheritPrompt,
      customPrompt: subAgent.customPrompt,
      inheritKnowledge: subAgent.inheritKnowledge,
      inheritTools: subAgent.inheritTools,
      llmProvider: subAgent.llmProvider,
      model: subAgent.model,
    })
    setIsModalOpen(true)
  }

  const onSubmit = (data: SubAgentFormData) => {
    if (editingSubAgent) {
      updateSubAgent(assistant.id, editingSubAgent.id, data)
    } else {
      addSubAgent(assistant.id, {
        id: uuidv4(),
        ...data,
      })
    }
    setIsModalOpen(false)
    reset(defaultValues)
  }

  const handleToggleTeamLead = (checked: boolean) => {
    updateAssistant(assistant.id, { isTeamLead: checked })
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold mb-1 text-foreground">Sub-Agentes</h3>
        <p className="text-sm text-muted mb-4">
          Configure este assistente como Líder de Equipe para gerenciar sub-agentes que lidam com tarefas especializadas.
        </p>
      </div>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-semibold text-foreground">Modo Líder de Equipe</h4>
            <p className="text-sm text-muted mt-1">
              Ative para permitir que este assistente coordene sub-agentes para tarefas complexas.
            </p>
          </div>
          <Switch
            isSelected={isTeamLead}
            onChange={(isChecked: any) => {
              const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
              handleToggleTeamLead(val)
            }}
          />
        </div>
      </Card>

      {isTeamLead && (
        <>
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-foreground">
              Sub-Agentes ({subAgents.length})
            </h4>
            <Button variant="primary" onPress={openAddModal}>
              + Adicionar Sub-Agente
            </Button>
          </div>

          {subAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-dim-hover rounded-xl">
              <div className="mb-3 text-muted"><Bot size={36} strokeWidth={1.5} /></div>
              <h4 className="font-semibold text-foreground mb-1">Nenhum sub-agente ainda</h4>
              <p className="text-sm text-muted max-w-sm">
                Adicione sub-agentes para delegar tarefas especializadas. Cada sub-agente pode ter seu próprio prompt, conhecimento e ferramentas.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {subAgents.map((sa) => (
                <Card key={sa.id} className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h5 className="font-semibold text-foreground">{sa.name}</h5>
                      <p className="text-xs text-muted mt-0.5">{sa.description}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" className="text-xs border-none px-2" onPress={() => openEditModal(sa)}>
                        Editar
                      </Button>
                      <Button variant="ghost" className="text-xs text-red-500 border-none px-2" onPress={() => removeSubAgent(assistant.id, sa.id)}>
                        Remover
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      sa.inheritPrompt
                        ? 'bg-[#ff6b2c]/10 text-[#ff6b2c] dark:bg-[#ff6b2c]/10 dark:text-[#ff8533]'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {sa.inheritPrompt ? 'Herda prompt' : 'Prompt personalizado'}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      sa.inheritKnowledge
                        ? 'bg-[#ff6b2c]/10 text-[#ff6b2c] dark:bg-[#ff6b2c]/10 dark:text-[#ff8533]'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {sa.inheritKnowledge ? 'Herda conhecimento' : 'Conhecimento próprio'}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      sa.inheritTools
                        ? 'bg-[#ff6b2c]/10 text-[#ff6b2c] dark:bg-[#ff6b2c]/10 dark:text-[#ff8533]'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    }`}>
                      {sa.inheritTools ? 'Herda ferramentas' : 'Ferramentas próprias'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-raised text-subtle">
                      {sa.llmProvider === 'inherit' ? `Herda LLM` : `${sa.llmProvider} / ${sa.model}`}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      <Modal>
        <Modal.Backdrop isOpen={isModalOpen} onOpenChange={setIsModalOpen}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[600px] w-full bg-overlay p-6 rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
              <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised/80 transition-colors cursor-pointer text-subtle hover:text-heading">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
              </Modal.CloseTrigger>
              <Modal.Header>
                <Modal.Heading className="text-xl font-semibold mb-4 text-foreground">
                  {editingSubAgent ? 'Editar Sub-Agente' : 'Adicionar Sub-Agente'}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="pb-6">
                <Form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
                  <Controller
                    name="name"
                    control={control}
                    render={({ field }) => (
                      <TextField className="w-full" isInvalid={!!errors.name}>
                        <Label className="text-sm font-semibold mb-1 text-body">Nome</Label>
                        <Input placeholder="ex: Agente de Pesquisa" {...field} />
                        {errors.name && <FieldError>{errors.name.message}</FieldError>}
                      </TextField>
                    )}
                  />

                  <Controller
                    name="description"
                    control={control}
                    render={({ field }) => (
                      <TextField className="w-full" isInvalid={!!errors.description}>
                        <Label className="text-sm font-semibold mb-1 text-body">Descrição</Label>
                        <TextArea placeholder="O que este sub-agente faz?" {...field} />
                        {errors.description && <FieldError>{errors.description.message}</FieldError>}
                      </TextField>
                    )}
                  />

                  <div className="border-t border-dim pt-4 flex flex-col gap-4">
                    <Controller
                      name="inheritPrompt"
                      control={control}
                      render={({ field }) => (
                        <div className="flex items-center justify-between">
                          <Label>Herdar prompt do principal</Label>
                          <Switch
                            isSelected={field.value}
                            onChange={(isChecked: any) => {
                              const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                              field.onChange(val)
                            }}
                          />
                        </div>
                      )}
                    />

                    {!watchInheritPrompt && (
                      <Controller
                        name="customPrompt"
                        control={control}
                        render={({ field }) => (
                          <TextField className="w-full">
                            <Label className="text-sm font-semibold mb-1 text-body">Prompt do Sistema Personalizado</Label>
                            <TextArea placeholder="Digite um prompt do sistema personalizado..." className="min-h-[80px]" {...field} />
                          </TextField>
                        )}
                      />
                    )}

                    <Controller
                      name="inheritKnowledge"
                      control={control}
                      render={({ field }) => (
                        <div className="flex items-center justify-between">
                          <Label>Herdar conhecimento do principal</Label>
                          <Switch
                            isSelected={field.value}
                            onChange={(isChecked: any) => {
                              const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                              field.onChange(val)
                            }}
                          />
                        </div>
                      )}
                    />

                    <Controller
                      name="inheritTools"
                      control={control}
                      render={({ field }) => (
                        <div className="flex items-center justify-between">
                          <Label>Herdar ferramentas do principal</Label>
                          <Switch
                            isSelected={field.value}
                            onChange={(isChecked: any) => {
                              const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                              field.onChange(val)
                            }}
                          />
                        </div>
                      )}
                    />
                  </div>

                  <div className="border-t border-dim pt-4 flex flex-col gap-4">
                    <Controller
                      name="llmProvider"
                      control={control}
                      render={({ field: { onChange, value } }) => (
                        <Select
                          className="w-full"
                          selectedKey={value}
                          onSelectionChange={(key) => {
                            const selected = key as string
                            if (selected) onChange(selected)
                          }}
                        >
                          <Label>Provedor LLM</Label>
                          <Select.Trigger>
                            <Select.Value />
                            <Select.Indicator />
                          </Select.Trigger>
                          <Select.Popover>
                            <ListBox>
                              <ListBox.Item id="inherit" textValue="Herdar do principal">Herdar do principal</ListBox.Item>
                              <ListBox.Item id="openai" textValue="OpenAI">OpenAI</ListBox.Item>
                              <ListBox.Item id="claude" textValue="Claude">Claude</ListBox.Item>
                              <ListBox.Item id="gemini" textValue="Gemini">Gemini</ListBox.Item>
                            </ListBox>
                          </Select.Popover>
                        </Select>
                      )}
                    />

                    {watchLlmProvider !== 'inherit' && availableModels.length > 0 && (
                      <Controller
                        name="model"
                        control={control}
                        render={({ field: { onChange, value } }) => (
                          <Select
                            className="w-full"
                            selectedKey={value}
                            onSelectionChange={(key) => {
                              const selected = key as string
                              if (selected) onChange(selected)
                            }}
                          >
                            <Label>Modelo</Label>
                            <Select.Trigger>
                              <Select.Value />
                              <Select.Indicator />
                            </Select.Trigger>
                            <Select.Popover>
                              <ListBox>
                                {availableModels.map((m) => (
                                  <ListBox.Item key={m} id={m} textValue={m}>{m}</ListBox.Item>
                                ))}
                              </ListBox>
                            </Select.Popover>
                          </Select>
                        )}
                      />
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="ghost" className="border-none" onPress={() => setIsModalOpen(false)}>
                      Cancelar
                    </Button>
                    <Button variant="primary" type="submit">
                      {editingSubAgent ? 'Atualizar' : 'Adicionar'} Sub-Agente
                    </Button>
                  </div>
                </Form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
