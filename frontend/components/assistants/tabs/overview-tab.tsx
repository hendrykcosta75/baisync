'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Assistant, AudioConfig, AudioMode, AudioProvider } from '@/types/assistant'
import { Card, Button, Input, Form, Select, ListBox, Label, Switch, TextField, FieldError } from '@heroui/react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAssistantStore } from '@/store/useAssistantStore'
import { getModelLimitations } from '@/lib/modelLimitations'
import { AssistantForm, AssistantFormData } from '@/components/assistants/assistant-form'
import { apiFetch } from '@/lib/api'

interface ElevenLabsVoice {
  voice_id: string
  name: string
  category: string | null
  preview_url: string | null
}

interface OverviewTabProps {
  assistant: Assistant
  isReadOnly?: boolean
  shareToken?: string
}

// ─── Audio Config Section ─────────────────────────────────────────────────────

const audioSchema = z.object({
  provider: z.string().nullable(),
  mode: z.enum(['disabled', 'always', 'audio_to_audio']),
  transcribe: z.boolean(),
  fallbackToText: z.boolean(),
  transcriptionFailureMessage: z.string().max(500),
  voiceId: z.string().nullable(),
})
type AudioFormData = z.infer<typeof audioSchema>

const AUDIO_MODES: { id: AudioMode; label: string; description: string }[] = [
  { id: 'disabled', label: 'Desativado', description: 'Não usar respostas em áudio' },
  { id: 'always', label: 'Sempre em áudio', description: 'Converter todas as respostas para áudio (Mensagem → Áudio)' },
  { id: 'audio_to_audio', label: 'Áudio quando receber áudio', description: 'Responder em áudio apenas quando o usuário enviar áudio (Áudio → Áudio)' },
]

const AUDIO_PROVIDERS: { id: AudioProvider; label: string }[] = [
  { id: 'elevenlabs', label: 'ElevenLabs' },
  { id: 'openai', label: 'OpenAI' },
]

const VOICES_ENDPOINT: Record<AudioProvider, string> = {
  elevenlabs: '/api/elevenlabs/voices',
  openai: '/api/openai/voices',
}

const PREVIEW_ENDPOINT: Record<AudioProvider, string> = {
  elevenlabs: '/api/elevenlabs/preview',
  openai: '/api/openai/preview',
}

function AudioConfigSection({ assistant, shareToken }: { assistant: Assistant; shareToken?: string }) {
  const { updateAssistant } = useAssistantStore()
  const [saved, setSaved] = useState(false)
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const defaults: AudioFormData = {
    provider: assistant.audioConfig?.provider ?? null,
    mode: assistant.audioConfig?.mode ?? 'disabled',
    transcribe: assistant.audioConfig?.transcribe ?? false,
    fallbackToText: assistant.audioConfig?.fallbackToText ?? true,
    transcriptionFailureMessage: assistant.audioConfig?.transcriptionFailureMessage ?? '',
    voiceId: assistant.audioConfig?.voiceId ?? null,
  }

  const { control, handleSubmit, watch, formState: { errors } } = useForm<AudioFormData>({
    resolver: zodResolver(audioSchema),
    defaultValues: defaults,
  })

  const mode = watch('mode')
  const provider = watch('provider')
  const voiceId = watch('voiceId')
  const transcribe = watch('transcribe')
  const audioEnabled = mode !== 'disabled'

  const shareQs = shareToken
    ? `?assistant_id=${assistant.id}&share_token=${encodeURIComponent(shareToken)}`
    : ''

  const fetchVoices = useCallback(async (p: string) => {
    setLoadingVoices(true)
    try {
      const endpoint = (VOICES_ENDPOINT[p as AudioProvider] ?? '/api/elevenlabs/voices') + shareQs
      const data = await apiFetch<{ voices: ElevenLabsVoice[] }>(endpoint)
      setVoices(data.voices ?? [])
    } catch {
      setVoices([])
    } finally {
      setLoadingVoices(false)
    }
  }, [shareQs])

  useEffect(() => {
    if (audioEnabled && provider && voices.length === 0) {
      fetchVoices(provider)
    }
  }, [audioEnabled, provider, voices.length, fetchVoices])

  // Reload voices when provider changes
  const prevProviderRef = useRef<string | null>(null)
  useEffect(() => {
    if (provider && provider !== prevProviderRef.current) {
      prevProviderRef.current = provider
      if (audioEnabled) {
        setVoices([])
        fetchVoices(provider)
      }
    }
  }, [provider, audioEnabled, fetchVoices])

  const handlePreview = async (id: string | null) => {
    if (!id || previewing) return
    setPreviewing(true)
    try {
      const endpoint = (PREVIEW_ENDPOINT[(provider as AudioProvider) ?? 'elevenlabs'] ?? '/api/elevenlabs/preview') + shareQs
      const data = await apiFetch<{ audio_base64: string; content_type: string }>(
        endpoint,
        { method: 'POST', body: JSON.stringify({ voice_id: id }) }
      )
      const binary = atob(data.audio_base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const blob = new Blob([bytes], { type: data.content_type })
      const url = URL.createObjectURL(blob)
      if (audioRef.current) {
        audioRef.current.pause()
        URL.revokeObjectURL(audioRef.current.src)
      }
      const audio = new Audio(url)
      audioRef.current = audio
      audio.play()
      audio.onended = () => URL.revokeObjectURL(url)
    } catch {
      // silently ignore preview errors
    } finally {
      setPreviewing(false)
    }
  }

  const onSave = async (data: AudioFormData) => {
    try {
      const url = shareToken
        ? `/api/assistants/${assistant.id}?share_token=${encodeURIComponent(shareToken)}`
        : `/api/assistants/${assistant.id}`
      await apiFetch(url, {
        method: 'PUT',
        body: JSON.stringify({ audioSettings: data }),
      })
    } catch (err) {
      console.error('Save audio config failed:', err)
    }
    const audioConfig: AudioConfig = {
      provider: data.provider as AudioProvider | null,
      mode: data.mode,
      transcribe: data.transcribe,
      fallbackToText: data.fallbackToText,
      transcriptionFailureMessage: data.transcriptionFailureMessage,
      voiceId: data.voiceId ?? null,
    }
    updateAssistant(assistant.id, { audioConfig })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold text-foreground mb-1">Configuração de Áudio</h3>
      <p className="text-sm text-muted mb-5">Configure como o assistente envia e recebe mensagens de voz.</p>

      <Form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-5">
        {/* Mode */}
        <div>
          <p className="text-sm font-medium text-foreground mb-2">Modo de resposta em áudio</p>
          <div className="flex flex-col gap-2">
            {AUDIO_MODES.map((m) => (
              <Controller
                key={m.id}
                name="mode"
                control={control}
                render={({ field: { value, onChange } }) => (
                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                      value === m.id
                        ? 'border-[#ff6b2c] bg-[#ff6b2c]/5'
                        : 'border-dim hover:border-[#ff6b2c]/40'
                    }`}
                    onClick={() => onChange(m.id)}
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      value === m.id ? 'border-[#ff6b2c]' : 'border-muted'
                    }`}>
                      {value === m.id && <span className="w-2 h-2 rounded-full bg-[#ff6b2c]" />}
                    </span>
                    <span>
                      <span className={`block text-sm font-medium ${value === m.id ? 'text-[#ff6b2c]' : 'text-foreground'}`}>{m.label}</span>
                      <span className="block text-xs text-muted mt-0.5">{m.description}</span>
                    </span>
                  </label>
                )}
              />
            ))}
          </div>
        </div>

        {/* Provider (only shown when audio is enabled) */}
        {audioEnabled && (
          <Controller
            name="provider"
            control={control}
            render={({ field: { value, onChange } }) => (
              <div className="flex flex-col gap-1">
                <Select
                  className="w-full max-w-sm"
                  selectedKey={value ?? ''}
                  onSelectionChange={(key) => onChange(key || null)}
                >
                  <Label>Provedor de áudio</Label>
                  <Select.Trigger>
                    <Select.Value />
                    <Select.Indicator />
                  </Select.Trigger>
                  <Select.Popover>
                    <ListBox>
                      {AUDIO_PROVIDERS.map((p) => (
                        <ListBox.Item key={p.id} id={p.id} textValue={p.label}>{p.label}</ListBox.Item>
                      ))}
                    </ListBox>
                  </Select.Popover>
                </Select>
                {errors.provider && <FieldError>{errors.provider.message}</FieldError>}
              </div>
            )}
          />
        )}

        {/* Voice selector (only when a provider is selected) */}
        {audioEnabled && provider && (
          <Controller
            name="voiceId"
            control={control}
            render={({ field: { value, onChange } }) => (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-foreground">Voz</p>
                {loadingVoices ? (
                  <p className="text-sm text-muted">Carregando vozes...</p>
                ) : voices.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nenhuma voz disponível. Verifique se a chave de API está configurada nas credenciais.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
                    {voices.map((v) => (
                      <label
                        key={v.voice_id}
                        className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                          value === v.voice_id
                            ? 'border-[#ff6b2c] bg-[#ff6b2c]/10 dark:bg-[#ff6b2c]/15'
                            : 'border-dim hover:border-[#ff6b2c]/40'
                        }`}
                        onClick={() => onChange(v.voice_id)}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                            value === v.voice_id ? 'border-[#ff6b2c]' : 'border-muted'
                          }`}>
                            {value === v.voice_id && <span className="w-2 h-2 rounded-full bg-[#ff6b2c]" />}
                          </span>
                          <div className="min-w-0">
                            <span className={`block text-sm font-medium truncate ${value === v.voice_id ? 'text-[#ff6b2c] dark:text-[#ff6b2c]' : 'text-foreground'}`}>{v.name}</span>
                            {v.category && (
                              <span className="block text-xs text-muted capitalize">{v.category}</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="flex-shrink-0 text-xs text-primary hover:text-primary/70 transition-colors disabled:opacity-50 px-2 py-1 rounded-lg border border-primary/30 hover:bg-primary/5"
                          disabled={previewing}
                          onClick={(e) => {
                            e.stopPropagation()
                            handlePreview(v.voice_id)
                          }}
                        >
                          {previewing ? '...' : 'Ouvir'}
                        </button>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}
          />
        )}

        {/* Transcribe incoming audio */}
        <div className="flex flex-col gap-3">
          <Controller
            name="transcribe"
            control={control}
            render={({ field: { value, onChange } }) => (
              <Switch
                isSelected={value}
                onChange={(isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                  const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                  onChange(val)
                }}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Switch.Content>
                  <span className="text-sm text-foreground">Transcrever áudios recebidos do usuário</span>
                  <span className="block text-xs text-muted">O áudio enviado pelo usuário será convertido em texto antes de ser processado</span>
                </Switch.Content>
              </Switch>
            )}
          />

          {/* Fallback to text (only relevant when audio mode is enabled) */}
          {audioEnabled && (
            <Controller
              name="fallbackToText"
              control={control}
              render={({ field: { value, onChange } }) => (
                <Switch
                  isSelected={value}
                  onChange={(isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                    const val = typeof isChecked === 'boolean' ? isChecked : isChecked.target.checked
                    onChange(val)
                  }}
                >
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>
                    <span className="text-sm text-foreground">Enviar texto como fallback se o áudio falhar</span>
                    <span className="block text-xs text-muted">Se a geração de áudio falhar, envia a resposta em texto</span>
                  </Switch.Content>
                </Switch>
              )}
            />
          )}
        </div>

        {/* Transcription failure message (only when transcription is enabled) */}
        {transcribe && (
          <Controller
            name="transcriptionFailureMessage"
            control={control}
            render={({ field }) => (
              <TextField className="w-full" isInvalid={!!errors.transcriptionFailureMessage}>
                <Label>Mensagem de falha na transcrição</Label>
                <Input
                  {...field}
                  placeholder="Não consegui entender o áudio. Pode enviar sua mensagem em texto?"
                />
                <p className="text-xs text-muted mt-1">
                  Enviada ao usuário quando não for possível transcrever o áudio. Deixe vazio para usar a mensagem padrão.
                </p>
                {errors.transcriptionFailureMessage && (
                  <FieldError>{errors.transcriptionFailureMessage.message}</FieldError>
                )}
              </TextField>
            )}
          />
        )}

        <div className="flex items-center gap-3 pt-1">
          <button type="submit" className="btn-neu text-sm">
            Salvar configurações de áudio
          </button>
          {saved && <span className="text-xs font-medium text-emerald-500">Salvo!</span>}
        </div>
      </Form>
    </Card>
  )
}

// ─── Overview Tab ─────────────────────────────────────────────────────────────

export function OverviewTab({ assistant, isReadOnly, shareToken }: OverviewTabProps) {
  const [isEditing, setIsEditing] = useState(false)
  const { updateAssistant } = useAssistantStore()

  const handleSave = async (data: AssistantFormData) => {
    if (shareToken) {
      // Shared user: call API directly with share_token
      try {
        const payload: Record<string, unknown> = {}
        if (data.name !== undefined) payload.name = data.name
        if (data.description !== undefined) payload.description = data.description
        if (data.llmProvider !== undefined) payload.llm_provider = data.llmProvider
        if (data.model !== undefined) payload.model = data.model
        if (data.temperature !== undefined) payload.temperature = data.temperature
        if (data.maxTokens !== undefined) payload.max_tokens = data.maxTokens
        if (data.systemPrompt !== undefined) payload.system_prompt = data.systemPrompt
        await apiFetch(
          `/api/assistants/${assistant.id}?share_token=${encodeURIComponent(shareToken)}`,
          { method: 'PUT', body: JSON.stringify(payload) }
        )
      } catch (err) {
        console.error('Failed to update shared assistant:', err)
      }
    } else {
      updateAssistant(assistant.id, data)
    }
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6 border-b border-dim pb-4">
          <h3 className="text-lg font-semibold text-foreground">Editar Configurações</h3>
          <Button variant="ghost" size="sm" onPress={() => setIsEditing(false)}>
            Fechar
          </Button>
        </div>
        <AssistantForm
          initialData={assistant}
          onSubmit={handleSave}
          onCancel={() => setIsEditing(false)}
          assistantId={assistant.id}
          shareToken={shareToken}
        />
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Identidade do Assistente</h3>
          {!isReadOnly && (
            <button className="btn-neu text-sm" onClick={() => setIsEditing(true)}>
              Editar Configurações
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <p className="text-sm font-medium text-muted mb-1">Nome</p>
            <p className="text-foreground">{assistant.name}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted mb-1">Descrição</p>
            <p className="text-foreground">{assistant.description || 'Sem descrição'}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4 text-foreground">Configuração do Modelo</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          <div>
            <p className="text-sm font-medium text-muted mb-1">Provedor</p>
            <p className="text-foreground capitalize">{assistant.llmProvider}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted mb-1">Modelo</p>
            <p className="text-foreground">{assistant.model}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-muted mb-1">Temperatura</p>
            {(() => {
              const lim = getModelLimitations(assistant.llmProvider, assistant.model)
              return (
                <>
                  <p className="text-foreground">{!lim.supportsTemperature ? 'N/A' : assistant.temperature}</p>
                  {lim.temperatureNote && (
                    <p className={`text-xs mt-0.5 ${!lim.supportsTemperature ? 'text-muted' : 'text-amber-600 dark:text-amber-400'}`}>
                      {lim.temperatureNote}
                    </p>
                  )}
                </>
              )
            })()}
          </div>
          <div>
            <p className="text-sm font-medium text-muted mb-1">Máx. Tokens</p>
            <p className="text-foreground">{assistant.maxTokens}</p>
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-muted mb-2">Prompt do Sistema</p>
          <div className="bg-raised/50 p-4 rounded-xl text-sm font-mono whitespace-pre-wrap">
            {assistant.systemPrompt || 'Você é um assistente útil.'}
          </div>
        </div>
      </Card>

      {!isReadOnly && <AudioConfigSection assistant={assistant} shareToken={shareToken} />}
    </div>
  )
}
