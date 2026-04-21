'use client'

import React, { useState } from 'react'
import { Card, Input, Form, Label, TextField, FieldError, Switch } from '@heroui/react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Assistant } from '@/types/assistant'
import { useAssistantStore } from '@/store/useAssistantStore'
import { apiFetch } from '@/lib/api'

interface AdvancedTabProps {
  assistant: Assistant
  isReadOnly?: boolean
  shareToken?: string
}

// W1.2 — caps defaults applied on the backend when the columns are null.
// The UI surfaces them as placeholders so users know the effective value.
const DEFAULT_MAX_TOOL_ROUNDS = 5
const DEFAULT_MAX_DURATION_MS = 30_000

const advancedSchema = z.object({
  configMaxToolRounds: z
    .number()
    .int('Use um número inteiro.')
    .min(1, 'Mínimo 1 rodada.')
    .max(50, 'Máximo 50 rodadas.')
    .optional(),
  configMaxDurationMs: z
    .number()
    .int('Use um número inteiro.')
    .min(1_000, 'Mínimo 1000 ms (1 s).')
    .max(600_000, 'Máximo 600000 ms (10 min).')
    .optional(),
  configAutoCompact: z.boolean(),
  configEnableEvaluator: z.boolean(),
  configEvaluatorModel: z
    .string()
    .max(100, 'Máximo 100 caracteres.')
    .optional(),
})
type AdvancedFormData = z.infer<typeof advancedSchema>

export function AdvancedTab({ assistant, isReadOnly, shareToken }: AdvancedTabProps) {
  const { updateAssistant } = useAssistantStore()
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaults: AdvancedFormData = {
    configMaxToolRounds: assistant.configMaxToolRounds ?? undefined,
    configMaxDurationMs: assistant.configMaxDurationMs ?? undefined,
    configAutoCompact: assistant.configAutoCompact ?? false,
    configEnableEvaluator: assistant.configEnableEvaluator ?? false,
    configEvaluatorModel: assistant.configEvaluatorModel ?? '',
  }

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AdvancedFormData>({
    resolver: zodResolver(advancedSchema),
    defaultValues: defaults,
  })

  const evaluatorEnabled = watch('configEnableEvaluator')

  const onSave = async (data: AdvancedFormData) => {
    setSaving(true)
    setError(null)
    // Empty numeric input is persisted as NULL so the backend falls back to defaults.
    const rounds = data.configMaxToolRounds ?? null
    const duration = data.configMaxDurationMs ?? null
    const autoCompact = data.configAutoCompact
    const enableEvaluator = data.configEnableEvaluator
    const evaluatorModel = data.configEvaluatorModel?.trim() ? data.configEvaluatorModel.trim() : null
    const patch: Partial<Assistant> = {
      configMaxToolRounds: rounds,
      configMaxDurationMs: duration,
      configAutoCompact: autoCompact,
      configEnableEvaluator: enableEvaluator,
      configEvaluatorModel: evaluatorModel,
    }
    try {
      if (shareToken) {
        await apiFetch(
          `/api/assistants/${assistant.id}?share_token=${encodeURIComponent(shareToken)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              config_max_tool_rounds: rounds,
              config_max_duration_ms: duration,
              config_auto_compact: autoCompact,
              config_enable_evaluator: enableEvaluator,
              config_evaluator_model: evaluatorModel,
            }),
          },
        )
      } else {
        await updateAssistant(assistant.id, patch)
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      console.error('Save advanced settings failed:', err)
      setError('Não foi possível salvar. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <h3
          className="text-heading text-lg font-semibold"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          Avançado
        </h3>
        <p className="text-subtle text-sm mt-1 mb-6">
          Limites operacionais e recursos opt-in do loop de conversa. Compactação e revisor usam a chave
          do próprio workspace — não há cobrança extra fora dos tokens consumidos.
        </p>

        <Form
          onSubmit={handleSubmit(onSave)}
          className="flex flex-col gap-6 max-w-xl"
        >
          <div className="flex flex-col gap-5">
            <h4
              className="text-heading text-sm font-semibold"
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
            >
              Limites de ferramentas
            </h4>

            <Controller
              name="configMaxToolRounds"
              control={control}
              render={({ field }) => (
                <TextField
                  className="w-full"
                  isInvalid={!!errors.configMaxToolRounds}
                  isDisabled={isReadOnly}
                >
                  <Label
                    className="text-subtle text-xs font-medium mb-1.5 block"
                    style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                  >
                    Rodadas máximas de ferramentas (padrão {DEFAULT_MAX_TOOL_ROUNDS})
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={50}
                    placeholder={String(DEFAULT_MAX_TOOL_ROUNDS)}
                    value={field.value === undefined ? '' : String(field.value)}
                    onChange={(e) => {
                      const raw = (e.target as HTMLInputElement).value
                      if (raw === '') {
                        field.onChange(undefined)
                        return
                      }
                      const parsed = Number.parseInt(raw, 10)
                      field.onChange(Number.isNaN(parsed) ? undefined : parsed)
                    }}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
                  />
                  <p className="text-subtle text-xs mt-1">
                    Máximo de chamadas em cascata de ferramentas por turno. Valores muito altos podem
                    atrasar respostas ao usuário.
                  </p>
                  {errors.configMaxToolRounds && (
                    <FieldError className="text-red-400 text-xs mt-1">
                      {errors.configMaxToolRounds.message}
                    </FieldError>
                  )}
                </TextField>
              )}
            />

            <Controller
              name="configMaxDurationMs"
              control={control}
              render={({ field }) => (
                <TextField
                  className="w-full"
                  isInvalid={!!errors.configMaxDurationMs}
                  isDisabled={isReadOnly}
                >
                  <Label
                    className="text-subtle text-xs font-medium mb-1.5 block"
                    style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                  >
                    Duração máxima (ms) (padrão {DEFAULT_MAX_DURATION_MS})
                  </Label>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1000}
                    max={600000}
                    step={500}
                    placeholder={String(DEFAULT_MAX_DURATION_MS)}
                    value={field.value === undefined ? '' : String(field.value)}
                    onChange={(e) => {
                      const raw = (e.target as HTMLInputElement).value
                      if (raw === '') {
                        field.onChange(undefined)
                        return
                      }
                      const parsed = Number.parseInt(raw, 10)
                      field.onChange(Number.isNaN(parsed) ? undefined : parsed)
                    }}
                    onBlur={field.onBlur}
                    ref={field.ref}
                    className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
                  />
                  <p className="text-subtle text-xs mt-1">
                    Tempo total permitido para o loop de ferramentas (inclui todas as rodadas). Expirado
                    o limite, a chamada é interrompida com mensagem amigável.
                  </p>
                  {errors.configMaxDurationMs && (
                    <FieldError className="text-red-400 text-xs mt-1">
                      {errors.configMaxDurationMs.message}
                    </FieldError>
                  )}
                </TextField>
              )}
            />
          </div>

          <div className="border-t border-dim" />

          <div className="flex flex-col gap-5">
            <h4
              className="text-heading text-sm font-semibold"
              style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
            >
              Recursos opcionais
            </h4>

            <Controller
              name="configAutoCompact"
              control={control}
              render={({ field }) => (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p
                      className="text-heading text-sm font-medium"
                      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                    >
                      Compactação automática de conversas longas
                    </p>
                    <p className="text-subtle text-xs mt-1 leading-relaxed">
                      Quando a conversa ultrapassa 80% do contexto, o backend resume as mensagens
                      antigas usando a chave deste workspace. Mantém o agente dentro do limite sem
                      perder histórico relevante.
                    </p>
                  </div>
                  <Switch
                    isSelected={!!field.value}
                    isDisabled={isReadOnly}
                    onChange={(e: React.ChangeEvent<HTMLInputElement> | boolean) => {
                      const val = typeof e === 'boolean' ? e : e.target.checked
                      field.onChange(val)
                    }}
                  >
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </div>
              )}
            />

            <Controller
              name="configEnableEvaluator"
              control={control}
              render={({ field }) => (
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <p
                      className="text-heading text-sm font-medium"
                      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                    >
                      Revisor pós-resposta (evaluator)
                    </p>
                    <p className="text-subtle text-xs mt-1 leading-relaxed">
                      Após cada resposta, um LLM barato verifica vazamento de PII, promessas
                      impossíveis e contradições ao system prompt. Fire-and-forget (não atrasa o
                      usuário) e usa a chave deste workspace.
                    </p>
                  </div>
                  <Switch
                    isSelected={!!field.value}
                    isDisabled={isReadOnly}
                    onChange={(e: React.ChangeEvent<HTMLInputElement> | boolean) => {
                      const val = typeof e === 'boolean' ? e : e.target.checked
                      field.onChange(val)
                    }}
                  >
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </div>
              )}
            />

            {evaluatorEnabled && (
              <Controller
                name="configEvaluatorModel"
                control={control}
                render={({ field }) => (
                  <TextField
                    className="w-full"
                    isInvalid={!!errors.configEvaluatorModel}
                    isDisabled={isReadOnly}
                  >
                    <Label
                      className="text-subtle text-xs font-medium mb-1.5 block"
                      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                    >
                      Modelo do revisor (opcional)
                    </Label>
                    <Input
                      type="text"
                      placeholder="gpt-4o-mini, gemini-2.0-flash, claude-haiku-4-5..."
                      value={field.value ?? ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      ref={field.ref}
                      className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
                    />
                    <p className="text-subtle text-xs mt-1">
                      Deixe vazio para o backend escolher um modelo barato compatível com o provider
                      deste assistente.
                    </p>
                    {errors.configEvaluatorModel && (
                      <FieldError className="text-red-400 text-xs mt-1">
                        {errors.configEvaluatorModel.message}
                      </FieldError>
                    )}
                  </TextField>
                )}
              />
            )}
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {!isReadOnly && (
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                className="btn-neu text-sm"
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
              {saved && (
                <span className="text-xs font-medium text-emerald-500">Salvo!</span>
              )}
            </div>
          )}
        </Form>
      </Card>
    </div>
  )
}
