'use client'

import React, { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Form, Input, Label, TextArea, Select, ListBox, Slider, TextField, FieldError, Spinner, Modal } from '@heroui/react'
import { Maximize2 } from 'lucide-react'
import { Assistant, LLMProvider } from '@/types/assistant'
import { useModels } from '@/lib/useModels'
import { getModelLimitations } from '@/lib/modelLimitations'
import Link from 'next/link'

const assistantSchema = z.object({
  name: z.string().min(1, 'Nome é obrigatório'),
  description: z.string(),
  llmProvider: z.enum(['openai', 'claude', 'gemini']),
  model: z.string().min(1, 'Modelo é obrigatório'),
  temperature: z.number().min(0).max(1),
  maxTokens: z.number().min(1).max(32000),
  systemPrompt: z.string()
})

export type AssistantFormData = z.infer<typeof assistantSchema>

interface AssistantFormProps {
  initialData?: Assistant | null
  onSubmit: (data: AssistantFormData) => void
  onCancel: () => void
  assistantId?: string
  shareToken?: string
}

export function AssistantForm({ initialData, onSubmit, onCancel, assistantId, shareToken }: AssistantFormProps) {
  const [isPromptModalOpen, setIsPromptModalOpen] = useState(false)
  const [modalPrompt, setModalPrompt] = useState('')
  const { control, handleSubmit, watch, setValue, formState: { errors } } = useForm<AssistantFormData>({
    resolver: zodResolver(assistantSchema),
    defaultValues: initialData ? {
      name: initialData.name,
      description: initialData.description,
      llmProvider: initialData.llmProvider,
      model: initialData.model,
      temperature: initialData.temperature,
      maxTokens: initialData.maxTokens,
      systemPrompt: initialData.systemPrompt,
    } : {
      name: '',
      description: '',
      llmProvider: 'openai',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxTokens: 2048,
      systemPrompt: 'Você é um assistente útil.'
    }
  })

  // eslint-disable-next-line react-hooks/incompatible-library
  const selectedProvider = watch('llmProvider') as LLMProvider
  const selectedModel = watch('model')
  const { models: availableModels, isLoading: modelsLoading, hasApiKey, modelsReady } = useModels(
    selectedProvider,
    assistantId && shareToken ? { assistantId, shareToken } : undefined
  )

  useEffect(() => {
    // Don't "fix" the selected model until we have the real (non-fallback) list.
    // Otherwise, opening the form with a saved model that isn't in the FALLBACK
    // list (e.g. gemini-3-flash-preview) would clobber it before the API responds.
    if (!modelsReady) return
    if (availableModels.length > 0 && !availableModels.includes(selectedModel)) {
      setValue('model', availableModels[0])
    }
  }, [selectedProvider, availableModels, selectedModel, setValue, modelsReady])

  const limitations = getModelLimitations(selectedProvider, selectedModel)

  return (
    <Form className="flex w-full flex-col gap-4 px-1" onSubmit={handleSubmit(onSubmit)}>
      <Controller
        name="name"
        control={control}
        render={({ field }) => (
          <TextField className="w-full" isInvalid={!!errors.name}>
            <Label>Nome</Label>
            <Input {...field} placeholder="Nome do assistente" />
            {errors.name && <FieldError>{errors.name.message}</FieldError>}
          </TextField>
        )}
      />

      <Controller
        name="description"
        control={control}
        render={({ field }) => (
          <TextField className="w-full" isInvalid={!!errors.description}>
            <Label>Descrição</Label>
            <TextArea {...field} placeholder="Breve resumo do que este assistente faz" />
            {errors.description && <FieldError>{errors.description.message}</FieldError>}
          </TextField>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
        <Controller
          name="llmProvider"
          control={control}
          render={({ field: { onChange, value } }) => (
            <Select
              className="w-full"
              isInvalid={!!errors.llmProvider}
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
                  <ListBox.Item id="openai" textValue="OpenAI">OpenAI</ListBox.Item>
                  <ListBox.Item id="claude" textValue="Claude">Claude</ListBox.Item>
                  <ListBox.Item id="gemini" textValue="Gemini">Gemini</ListBox.Item>
                </ListBox>
              </Select.Popover>
              {errors.llmProvider && <FieldError>{errors.llmProvider.message}</FieldError>}
            </Select>
          )}
        />

        <Controller
          name="model"
          control={control}
          render={({ field: { onChange, value } }) => (
            <div className="flex flex-col gap-1 w-full">
              <Select
                className="w-full"
                isInvalid={!!errors.model}
                selectedKey={value}
                onSelectionChange={(key) => {
                  const selected = key as string
                  if (selected) onChange(selected)
                }}
              >
                <Label className="flex items-center gap-2">
                  Modelo
                  {modelsLoading && <Spinner size="sm" />}
                </Label>
                <Select.Trigger>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {availableModels.map(m => (
                      <ListBox.Item key={m} id={m} textValue={m}>{m}</ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
                {errors.model && <FieldError>{errors.model.message}</FieldError>}
              </Select>
              {!hasApiKey && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Nenhuma chave de API configurada para {selectedProvider}.{' '}
                  <Link href="/dashboard/api-keys" className="underline font-medium">Configurar em Chaves de API</Link>
                </p>
              )}
            </div>
          )}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full items-center">
        <Controller
          name="temperature"
          control={control}
          render={({ field: { value, onChange } }) => (
            <div className="w-full flex-col gap-2">
              <Label className="text-sm">Temperatura: {!limitations.supportsTemperature ? 'N/A' : value}</Label>
              <Slider
                className="max-w-md"
                maxValue={1}
                minValue={0}
                step={0.1}
                value={value}
                onChange={(val) => onChange(val as number)}
                isDisabled={!limitations.supportsTemperature}
              >
                <Slider.Track>
                  <Slider.Fill />
                  <Slider.Thumb />
                </Slider.Track>
              </Slider>
              {limitations.temperatureNote && (
                <p className={`text-xs mt-1 ${!limitations.supportsTemperature ? 'text-muted' : 'text-amber-600 dark:text-amber-400'}`}>
                  {limitations.temperatureNote}
                </p>
              )}
              {errors.temperature && <span className="text-danger text-xs mt-1">{errors.temperature.message}</span>}
            </div>
          )}
        />

        <Controller
          name="maxTokens"
          control={control}
          render={({ field: { value, onChange } }) => (
            <TextField className="w-full" isInvalid={!!errors.maxTokens}>
              <Label>Máx. Tokens</Label>
              <Input
                type="number"
                value={value.toString()}
                onChange={(e) => onChange(parseInt(e.target.value) || 0)}
              />
              {errors.maxTokens && <FieldError>{errors.maxTokens.message}</FieldError>}
            </TextField>
          )}
        />
      </div>

      <Controller
        name="systemPrompt"
        control={control}
        render={({ field }) => (
          <>
            <TextField className="w-full" isInvalid={!!errors.systemPrompt}>
              <div className="flex items-center justify-between">
                <Label>Prompt do Sistema</Label>
                <button
                  type="button"
                  className="flex items-center gap-1.5 text-xs text-subtle hover:text-heading transition-colors cursor-pointer"
                  onClick={() => {
                    setModalPrompt(field.value || '')
                    setIsPromptModalOpen(true)
                  }}
                >
                  <Maximize2 size={14} />
                  Expandir
                </button>
              </div>
              <TextArea
                {...field}
                className="min-h-[120px]"
                placeholder="Você é um assistente útil que..."
              />
              {errors.systemPrompt && <FieldError>{errors.systemPrompt.message}</FieldError>}
            </TextField>

            <Modal>
              <Modal.Backdrop isOpen={isPromptModalOpen} onOpenChange={setIsPromptModalOpen}>
                <Modal.Container>
                  <Modal.Dialog className="sm:max-w-[800px] w-full max-h-[90vh] overflow-y-auto">
                    <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-raised transition-colors cursor-pointer text-subtle hover:text-heading">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    </Modal.CloseTrigger>
                    <Modal.Header>
                      <Modal.Heading className="text-xl font-semibold">Prompt do Sistema</Modal.Heading>
                    </Modal.Header>
                    <Modal.Body className="pb-4">
                      <textarea
                        className="w-full min-h-[400px] p-3 rounded-xl bg-raised text-body text-sm resize-y focus:outline-none focus:ring-2 focus:ring-[#ff6b2c]/40"
                        value={modalPrompt}
                        onChange={(e) => setModalPrompt(e.target.value)}
                        placeholder="Você é um assistente útil que..."
                      />
                    </Modal.Body>
                    <div className="flex justify-end gap-2 px-6 pb-6">
                      <button type="button" className="btn-neu-ghost text-sm" onClick={() => setIsPromptModalOpen(false)}>Cancelar</button>
                      <button type="button" className="btn-neu text-sm" onClick={() => {
                        field.onChange(modalPrompt)
                        setIsPromptModalOpen(false)
                      }}>Aplicar</button>
                    </div>
                  </Modal.Dialog>
                </Modal.Container>
              </Modal.Backdrop>
            </Modal>
          </>
        )}
      />

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-dim w-full">
        <button type="button" className="btn-neu-ghost text-sm" onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-neu text-sm">Salvar Assistente</button>
      </div>
    </Form>
  )
}
