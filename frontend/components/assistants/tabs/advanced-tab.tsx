'use client'

import React, { useState } from 'react'
import { Card, Input, Form, Label, TextField, FieldError } from '@heroui/react'
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
  }

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AdvancedFormData>({
    resolver: zodResolver(advancedSchema),
    defaultValues: defaults,
  })

  const onSave = async (data: AdvancedFormData) => {
    setSaving(true)
    setError(null)
    // Empty input is persisted as NULL so the backend falls back to defaults.
    const rounds = data.configMaxToolRounds ?? null
    const duration = data.configMaxDurationMs ?? null
    const patch: Partial<Assistant> = {
      configMaxToolRounds: rounds,
      configMaxDurationMs: duration,
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
          Limites operacionais do loop de ferramentas. Quando vazio, o backend usa os padrões seguros
          ({DEFAULT_MAX_TOOL_ROUNDS} rodadas / {DEFAULT_MAX_DURATION_MS} ms).
        </p>

        <Form
          onSubmit={handleSubmit(onSave)}
          className="flex flex-col gap-5 max-w-xl"
        >
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

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {!isReadOnly && (
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                className="btn-neu text-sm"
                disabled={saving}
              >
                {saving ? 'Salvando...' : 'Salvar limites'}
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
