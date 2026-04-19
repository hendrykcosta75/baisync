'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Assistant, WhatsAppProvider, IntegrationCommonSettings } from '@/types/assistant'
import { Card, Button, Input, Form, Select, ListBox, Label, Switch, TextField, FieldError, Modal, Spinner } from '@heroui/react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAssistantStore, mapIntegrationFromApi } from '@/store/useAssistantStore'
import { apiFetch } from '@/lib/api'
import type { AssistantIntegration } from '@/types/assistant'

interface ApplicationsTabProps {
  assistant: Assistant
  shareToken?: string
  isReadOnly?: boolean
}

// --- WhatsApp Section ---

const WHATSAPP_PROVIDERS: { id: WhatsAppProvider; label: string; disabled?: boolean }[] = [
  { id: 'baileys', label: 'Baileys (Auto-hospedado)' },
  { id: 'meta_official', label: 'API Oficial Meta (Em breve)', disabled: true },
]

// Baileys form
const baileysSchema = z.object({
  phoneNumber: z.string().min(1, 'Número de telefone é obrigatório').regex(/^\+\d{10,15}$/, 'Use formato internacional: +5511999999999'),
})
type BaileysFormData = z.infer<typeof baileysSchema>

function BaileysForm({ assistant, shareToken, isReadOnly }: { assistant: Assistant; shareToken?: string; isReadOnly?: boolean }) {
  const qs = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : ''
  const { updateIntegrationForAssistant } = useAssistantStore()
  const whatsapp = assistant.integrations?.find(i => i.provider === 'whatsapp' && i.whatsappProvider === 'baileys')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [qrModalOpen, setQrModalOpen] = useState(false)
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [phoneConflict, setPhoneConflict] = useState<{
    type: 'same_user' | 'other_user'
    assistantId?: string
    integrationId?: string
    assistantName?: string
    message: string
  } | null>(null)
  const [resolving, setResolving] = useState(false)
  const isConnected = whatsapp?.status === 'connected'

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current)
      pollingRef.current = null
    }
  }, [])

  const closeQrModal = useCallback(() => {
    setQrModalOpen(false)
    setQrCode(null)
    stopPolling()
  }, [stopPolling])

  const startPolling = useCallback((integrationId: string, phoneNumber: string) => {
    stopPolling()
    pollingRef.current = setInterval(async () => {
      try {
        const res = await apiFetch<{ status?: string; qr?: string }>(`/api/assistants/${assistant.id}/integrations/${integrationId}/status${qs}`)
        if (res.qr) {
          setQrCode(res.qr)
        }
        if (res.status === 'connected') {
          stopPolling()
          setQrModalOpen(false)
          setQrCode(null)
          updateIntegrationForAssistant(assistant.id, {
            id: integrationId,
            provider: 'whatsapp',
            whatsappProvider: 'baileys',
            phoneNumber,
            status: 'connected',
          })
        }
      } catch {
        // Ignore polling errors
      }
    }, 4000)
  }, [assistant.id, qs, stopPolling, updateIntegrationForAssistant])

  useEffect(() => {
    return () => stopPolling()
  }, [stopPolling])

  // Check actual connection status on mount
  useEffect(() => {
    if (!whatsapp?.id) return
    apiFetch<{ status?: string }>(`/api/assistants/${assistant.id}/integrations/${whatsapp.id}/status${qs}`)
      .then(res => {
        if (res.status === 'connected' && whatsapp.status !== 'connected') {
          updateIntegrationForAssistant(assistant.id, {
            ...whatsapp,
            status: 'connected',
          })
        }
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.id, whatsapp?.id])

  const resolveConflict = async () => {
    if (!phoneConflict || phoneConflict.type !== 'same_user' || !phoneConflict.assistantId || !phoneConflict.integrationId) return
    setResolving(true)
    try {
      // Disconnect the other integration
      await apiFetch(`/api/assistants/${phoneConflict.assistantId}/integrations/${phoneConflict.integrationId}/disconnect${qs}`, { method: 'POST' })
      setPhoneConflict(null)
      // Retry connect automatically
      handleSubmit(onConnect)()
    } catch (err) {
      console.error('Failed to resolve conflict:', err)
    } finally {
      setResolving(false)
    }
  }

  const { control, handleSubmit, formState: { errors } } = useForm<BaileysFormData>({
    resolver: zodResolver(baileysSchema),
    defaultValues: { phoneNumber: whatsapp?.phoneNumber || '' },
  })

  const onConnect = async (data: BaileysFormData) => {
    setConnecting(true)
    setQrCode(null)
    setQrModalOpen(true)
    try {
      let integrationId = whatsapp?.id
      if (!integrationId) {
        const created = await apiFetch<{ id: string }>(
          `/api/assistants/${assistant.id}/integrations${qs}`,
          { method: 'POST', body: JSON.stringify({ channel: 'whatsapp', provider: 'baileys', config_phone_number: data.phoneNumber }) }
        )
        integrationId = created.id
      }

      const res = await apiFetch<{ qr?: string; qrCode?: string; status?: string }>(
        `/api/assistants/${assistant.id}/integrations/${integrationId}/connect${qs}`,
        { method: 'POST' }
      )
      const qr = res.qr || res.qrCode
      if (qr) setQrCode(qr)

      if (res.status === 'connected') {
        setQrModalOpen(false)
        updateIntegrationForAssistant(assistant.id, {
          id: integrationId,
          provider: 'whatsapp',
          whatsappProvider: 'baileys',
          phoneNumber: data.phoneNumber,
          status: 'connected',
        })
      } else if (integrationId) {
        startPolling(integrationId, data.phoneNumber)
        updateIntegrationForAssistant(assistant.id, {
          id: integrationId,
          provider: 'whatsapp',
          whatsappProvider: 'baileys',
          phoneNumber: data.phoneNumber,
          status: 'disconnected',
        })
      }
    } catch (err: unknown) {
      console.error('Baileys connect failed:', err)
      setQrModalOpen(false)

      // Parse phone conflict errors
      const errorMsg = err instanceof Error ? err.message : String(err)
      if (errorMsg.startsWith('PHONE_CONFLICT_SAME_USER|')) {
        const parts = errorMsg.split('|')
        setPhoneConflict({
          type: 'same_user',
          assistantId: parts[1],
          integrationId: parts[2],
          assistantName: parts[3],
          message: parts[4] || 'Este número já está conectado a outro assistente.',
        })
      } else if (errorMsg.startsWith('PHONE_CONFLICT_OTHER_USER|')) {
        const parts = errorMsg.split('|')
        setPhoneConflict({
          type: 'other_user',
          message: parts[1] || 'Este número já está em uso por outro usuário.',
        })
      } else {
        setPhoneConflict(null)
      }
    } finally {
      setConnecting(false)
    }
  }

  const onDisconnect = async () => {
    setDisconnecting(true)
    stopPolling()
    try {
      if (whatsapp?.id) {
        await apiFetch(`/api/assistants/${assistant.id}/integrations/${whatsapp.id}/disconnect${qs}`, { method: 'POST' })
      }
    } catch (err) {
      console.error('Disconnect failed:', err)
    }
    updateIntegrationForAssistant(assistant.id, {
      provider: 'whatsapp',
      whatsappProvider: 'baileys',
      status: 'disconnected',
      phoneNumber: '',
      qrCode: undefined,
    })
    setDisconnecting(false)
    setDisconnectModalOpen(false)
  }

  return (
    <>
      <Form onSubmit={handleSubmit(onConnect)} className="flex flex-col gap-4">
        <Controller
          name="phoneNumber"
          control={control}
          render={({ field }) => (
            <TextField className="w-full" isInvalid={!!errors.phoneNumber} isDisabled={isConnected}>
              <Label>Número de telefone (internacional)</Label>
              <Input {...field} placeholder="+5511999999999" onChange={(e: React.ChangeEvent<HTMLInputElement>) => { field.onChange(e); setPhoneConflict(null) }} />
              {errors.phoneNumber && <FieldError>{errors.phoneNumber.message}</FieldError>}
            </TextField>
          )}
        />

        {/* Phone conflict warning */}
        {phoneConflict && (
          <div className={`rounded-xl border p-4 text-sm ${
            phoneConflict.type === 'other_user'
              ? 'bg-red-500/5 border-red-500/20 text-red-400'
              : 'bg-amber-500/5 border-amber-500/20 text-amber-400'
          }`}>
            <p className="font-medium mb-1">
              {phoneConflict.type === 'other_user' ? 'Numero indisponivel' : 'Numero em uso'}
            </p>
            <p className="text-xs opacity-80 mb-3">{phoneConflict.message}</p>
            {phoneConflict.type === 'same_user' && (
              <div className="flex gap-2">
                <button type="button" className="btn-neu-ghost text-sm" onClick={() => setPhoneConflict(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn-neu text-sm" onClick={resolveConflict} disabled={resolving}>
                  {resolving ? 'Desconectando...' : `Desconectar de "${phoneConflict.assistantName}" e conectar aqui`}
                </button>
              </div>
            )}
          </div>
        )}

        {!isReadOnly && (
          <div className="flex justify-end gap-2 mt-2">
            {isConnected ? (
              <Button variant="danger" onPress={() => setDisconnectModalOpen(true)}>
                Desconectar
              </Button>
            ) : (
              <button className="btn-neu text-sm" type="submit" disabled={connecting}>
                {connecting ? 'Conectando...' : 'Conectar'}
              </button>
            )}
          </div>
        )}
      </Form>

      {/* QR Code Modal */}
      <Modal isOpen={qrModalOpen} onOpenChange={(open) => { if (!open) closeQrModal() }}>
        <Modal.Backdrop variant="blur">
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-[400px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Conectar WhatsApp</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="flex flex-col items-center gap-4 py-4">
                  {qrCode ? (
                    <>
                      <p className="text-sm text-muted text-center">
                        Escaneie o QR Code abaixo com o WhatsApp no seu celular.
                      </p>
                      <div className="p-4 bg-white rounded-xl">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                          alt="WhatsApp QR Code"
                          className="w-56 h-56"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <Spinner size="lg" color="accent" />
                      <p className="text-sm text-muted text-center">
                        Aguardando QR Code...
                      </p>
                    </>
                  )}
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Disconnect Confirmation Modal */}
      <Modal isOpen={disconnectModalOpen} onOpenChange={setDisconnectModalOpen}>
        <Modal.Backdrop variant="blur">
          <Modal.Container placement="center">
            <Modal.Dialog className="sm:max-w-[400px]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Desconectar WhatsApp</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted">
                  Tem certeza que deseja desconectar este número do WhatsApp? O assistente vai parar de responder mensagens neste canal.
                </p>
              </Modal.Body>
              <Modal.Footer>
                <button type="button" className="btn-neu-ghost text-sm" onClick={() => setDisconnectModalOpen(false)}>
                  Cancelar
                </button>
                <button type="button" className="btn-neu text-sm !text-red-400 hover:!text-red-300" onClick={onDisconnect} disabled={disconnecting}>
                  {disconnecting ? 'Desconectando...' : 'Sim, desconectar'}
                </button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  )
}

// Meta Official form
const metaSchema = z.object({
  phoneNumberId: z.string().min(1, 'Phone Number ID é obrigatório'),
  accessToken: z.string().min(1, 'Access Token é obrigatório'),
  webhookVerifyToken: z.string().min(1, 'Webhook Verify Token é obrigatório'),
})
type MetaFormData = z.infer<typeof metaSchema>

function MetaOfficialForm({ assistant, shareToken, isReadOnly }: { assistant: Assistant; shareToken?: string; isReadOnly?: boolean }) {
  const qs = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : ''
  const { updateIntegrationForAssistant } = useAssistantStore()
  const whatsapp = assistant.integrations?.find(i => i.provider === 'whatsapp' && i.whatsappProvider === 'meta_official')
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isConnected = whatsapp?.status === 'connected'

  const { control, handleSubmit, formState: { errors } } = useForm<MetaFormData>({
    resolver: zodResolver(metaSchema),
    defaultValues: {
      phoneNumberId: whatsapp?.phoneNumberId || '',
      accessToken: whatsapp?.accessToken || '',
      webhookVerifyToken: whatsapp?.webhookVerifyToken || '',
    },
  })

  const onSave = async (data: MetaFormData) => {
    setSaving(true)
    setError(null)
    try {
      // Create or update integration with correct backend field mapping
      let integrationId = whatsapp?.id
      if (!integrationId) {
        const created = await apiFetch<{ id: string }>(
          `/api/assistants/${assistant.id}/integrations${qs}`,
          {
            method: 'POST',
            body: JSON.stringify({
              channel: 'whatsapp',
              provider: 'meta_official',
              config_phone_number: data.phoneNumberId,
              config_token: data.accessToken,
              config_webhook_verify_token: data.webhookVerifyToken,
            }),
          }
        )
        integrationId = created.id
      } else {
        await apiFetch(`/api/assistants/${assistant.id}/integrations/${integrationId}${qs}`, {
          method: 'PUT',
          body: JSON.stringify({
            config_phone_number: data.phoneNumberId,
            config_token: data.accessToken,
            config_webhook_verify_token: data.webhookVerifyToken,
          }),
        })
      }

      // Validate connection by calling connect
      setConnecting(true)
      try {
        const res = await apiFetch<{ status?: string; message?: string }>(
          `/api/assistants/${assistant.id}/integrations/${integrationId}/connect${qs}`,
          { method: 'POST' }
        )
        updateIntegrationForAssistant(assistant.id, {
          id: integrationId,
          provider: 'whatsapp',
          whatsappProvider: 'meta_official',
          phoneNumberId: data.phoneNumberId,
          accessToken: data.accessToken,
          webhookVerifyToken: data.webhookVerifyToken,
          status: res.status === 'connected' ? 'connected' : 'disconnected',
        })
      } catch {
        setError('Access Token ou Phone Number ID inválido. Verifique as credenciais no Meta Dashboard.')
        updateIntegrationForAssistant(assistant.id, {
          id: integrationId,
          provider: 'whatsapp',
          whatsappProvider: 'meta_official',
          phoneNumberId: data.phoneNumberId,
          accessToken: data.accessToken,
          webhookVerifyToken: data.webhookVerifyToken,
          status: 'disconnected',
        })
      } finally {
        setConnecting(false)
      }
    } catch (err) {
      console.error('Meta Official save failed:', err)
      setError('Falha ao salvar a integração.')
    } finally {
      setSaving(false)
    }
  }

  const onDisconnect = async () => {
    setDisconnecting(true)
    try {
      if (whatsapp?.id) {
        await apiFetch(`/api/assistants/${assistant.id}/integrations/${whatsapp.id}/disconnect${qs}`, { method: 'POST' })
      }
    } catch (err) {
      console.error('Disconnect failed:', err)
    }
    updateIntegrationForAssistant(assistant.id, {
      provider: 'whatsapp',
      whatsappProvider: 'meta_official',
      status: 'disconnected',
      phoneNumberId: whatsapp?.phoneNumberId,
      accessToken: whatsapp?.accessToken,
      webhookVerifyToken: whatsapp?.webhookVerifyToken,
    })
    setDisconnecting(false)
  }

  return (
    <Form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
      <Controller
        name="phoneNumberId"
        control={control}
        render={({ field }) => (
          <TextField className="w-full" isInvalid={!!errors.phoneNumberId} isDisabled={isConnected}>
            <Label>Phone Number ID</Label>
            <Input {...field} placeholder="Seu Phone Number ID da Meta" />
            {errors.phoneNumberId && <FieldError>{errors.phoneNumberId.message}</FieldError>}
          </TextField>
        )}
      />
      <Controller
        name="accessToken"
        control={control}
        render={({ field }) => (
          <TextField className="w-full" isInvalid={!!errors.accessToken} isDisabled={isConnected}>
            <Label>Access Token</Label>
            <Input {...field} type="password" placeholder="Seu access token da Meta" />
            {errors.accessToken && <FieldError>{errors.accessToken.message}</FieldError>}
          </TextField>
        )}
      />
      <Controller
        name="webhookVerifyToken"
        control={control}
        render={({ field }) => (
          <TextField className="w-full" isInvalid={!!errors.webhookVerifyToken} isDisabled={isConnected}>
            <Label>Webhook Verify Token</Label>
            <Input {...field} placeholder="Token personalizado para verificação do webhook" />
            {errors.webhookVerifyToken && <FieldError>{errors.webhookVerifyToken.message}</FieldError>}
          </TextField>
        )}
      />
      {isConnected && (
        <p className="text-xs text-muted">
          Configure a URL do webhook no Meta Dashboard: <code className="bg-raised px-1 py-0.5 rounded text-xs">{typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/meta</code>
        </p>
      )}
      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
      {!isReadOnly && (
        <div className="flex justify-end gap-2 mt-2">
          {isConnected ? (
            <Button variant="danger" onPress={onDisconnect} isDisabled={disconnecting}>
              {disconnecting ? 'Desconectando...' : 'Desconectar'}
            </Button>
          ) : (
            <button type="submit" className="btn-neu text-sm" disabled={saving || connecting}>
              {saving || connecting ? 'Conectando...' : 'Salvar e Conectar'}
            </button>
          )}
        </div>
      )}
    </Form>
  )
}

// --- Common Settings ---

const commonSettingsSchema = z.object({
  rateLimitPerDay: z.number().min(0).max(100000),
  maxMessageLength: z.number().min(1).max(100000),
  splitOnDoubleNewline: z.boolean(),
  typingIndicator: z.boolean(),
  interpretDocuments: z.boolean(),
  rateLimitMessage: z.string().max(1000),
  maxLengthMessage: z.string().max(1000),
  unsupportedMediaMessage: z.string().max(1000),
})
type CommonSettingsData = z.infer<typeof commonSettingsSchema>

function CommonSettingsSection({ assistant, shareToken, isReadOnly }: { assistant: Assistant; shareToken?: string; isReadOnly?: boolean }) {
  const qs = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : ''
  const { updateAssistant } = useAssistantStore()
  const [saved, setSaved] = useState(false)

  const defaults: IntegrationCommonSettings = assistant.integrationSettings || {
    rateLimitPerDay: 1000,
    maxMessageLength: 4096,
    splitOnDoubleNewline: true,
    typingIndicator: true,
    interpretDocuments: false,
    rateLimitMessage: '',
    maxLengthMessage: '',
    unsupportedMediaMessage: '',
  }

  const { control, handleSubmit, formState: { errors } } = useForm<CommonSettingsData>({
    resolver: zodResolver(commonSettingsSchema),
    defaultValues: defaults,
  })

  const watchInterpretDocuments = useWatch({ control, name: 'interpretDocuments' })

  const onSave = async (data: CommonSettingsData) => {
    try {
      await apiFetch(`/api/assistants/${assistant.id}${qs}`, {
        method: 'PUT',
        body: JSON.stringify({ integrationSettings: data }),
      })
    } catch (err) {
      console.error('Save settings failed:', err)
    }
    updateAssistant(assistant.id, { integrationSettings: data })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <Card className="p-6">
      <h4 className="font-semibold text-foreground mb-4">Configurações Comuns</h4>
      <Form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Controller
            name="rateLimitPerDay"
            control={control}
            render={({ field: { value, onChange, ...field } }) => (
              <TextField className="w-full" isInvalid={!!errors.rateLimitPerDay}>
                <Label>Limite de mensagens (por dia por número)</Label>
                <Input
                  {...field}
                  type="number"
                  value={value.toString()}
                  onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                />
                {errors.rateLimitPerDay && <FieldError>{errors.rateLimitPerDay.message}</FieldError>}
              </TextField>
            )}
          />
          <Controller
            name="maxMessageLength"
            control={control}
            render={({ field: { value, onChange, ...field } }) => (
              <TextField className="w-full" isInvalid={!!errors.maxMessageLength}>
                <Label>Tamanho máximo da mensagem (caracteres)</Label>
                <Input
                  {...field}
                  type="number"
                  value={value.toString()}
                  onChange={(e) => onChange(parseInt(e.target.value) || 0)}
                />
                {errors.maxMessageLength && <FieldError>{errors.maxMessageLength.message}</FieldError>}
              </TextField>
            )}
          />
        </div>

        <Controller
          name="rateLimitMessage"
          control={control}
          render={({ field }) => (
            <TextField className="w-full" isInvalid={!!errors.rateLimitMessage}>
              <Label>Mensagem de limite excedido</Label>
              <Input
                {...field}
                placeholder="Você atingiu o limite diário de mensagens. Tente novamente amanhã."
              />
              <p className="text-xs text-muted mt-1">Deixe vazio para usar a mensagem padrão do sistema.</p>
              {errors.rateLimitMessage && <FieldError>{errors.rateLimitMessage.message}</FieldError>}
            </TextField>
          )}
        />

        <Controller
          name="maxLengthMessage"
          control={control}
          render={({ field }) => (
            <TextField className="w-full" isInvalid={!!errors.maxLengthMessage}>
              <Label>Mensagem de tamanho excedido</Label>
              <Input
                {...field}
                placeholder="Sua mensagem excede o tamanho máximo permitido. Envie uma mensagem mais curta."
              />
              <p className="text-xs text-muted mt-1">Deixe vazio para usar a mensagem padrão do sistema.</p>
              {errors.maxLengthMessage && <FieldError>{errors.maxLengthMessage.message}</FieldError>}
            </TextField>
          )}
        />

        <div className="flex flex-col gap-3">
          <Controller
            name="splitOnDoubleNewline"
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
                  <span className="text-sm text-foreground">Dividir mensagens em quebra de linha dupla (\\n\\n)</span>
                </Switch.Content>
              </Switch>
            )}
          />
          <Controller
            name="typingIndicator"
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
                  <span className="text-sm text-foreground">Mostrar &quot;digitando...&quot; antes de responder</span>
                </Switch.Content>
              </Switch>
            )}
          />
          <Controller
            name="interpretDocuments"
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
                  <span className="text-sm text-foreground">Interpretar documentos recebidos</span>
                </Switch.Content>
              </Switch>
            )}
          />
        </div>

        <Controller
          name="unsupportedMediaMessage"
          control={control}
          render={({ field }) => (
            <TextField className="w-full" isInvalid={!!errors.unsupportedMediaMessage}>
              <Label>Mensagem para mídia não suportada</Label>
              <Input
                {...field}
                placeholder={
                  watchInterpretDocuments
                    ? 'Não consegui interpretar o arquivo enviado. Por favor, envie em outro formato ou descreva o conteúdo em texto.'
                    : 'Formato de mensagem não suportado. Por favor, envie sua mensagem em texto.'
                }
              />
              <p className="text-xs text-muted mt-1">
                {watchInterpretDocuments
                  ? 'Enviada quando o provedor do LLM não consegue ler o arquivo recebido (ex.: XLSX, DOCX ou outros formatos não suportados nativamente). Deixe vazio para usar a mensagem padrão.'
                  : 'Exibida quando o usuário envia imagem, documento ou vídeo e a interpretação está desligada. Deixe vazio para usar a mensagem padrão.'}
              </p>
              {errors.unsupportedMediaMessage && <FieldError>{errors.unsupportedMediaMessage.message}</FieldError>}
            </TextField>
          )}
        />
        {watchInterpretDocuments && (
          <p className="text-[11px] text-muted -mt-2">
            Formatos suportados nativamente: imagens (JPG, PNG, WebP), PDF e (no Gemini) vídeo. XLSX, DOCX e outros cairão nessa mensagem.
          </p>
        )}

        {!isReadOnly && (
          <div className="flex items-center gap-3 justify-end mt-2">
            {saved && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Salvo!</span>
            )}
            <button className="btn-neu text-sm" type="submit">Salvar Configurações</button>
          </div>
        )}
      </Form>
    </Card>
  )
}

// --- Shared Components ---

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <div className={`px-2 py-1 flex items-center rounded-full text-[10px] font-bold uppercase tracking-wider ${
      connected
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        : 'bg-raised text-subtle'
    }`}>
      {connected ? 'Conectado' : 'Desconectado'}
    </div>
  )
}

// --- Main Component ---

export function ApplicationsTab({ assistant, shareToken, isReadOnly }: ApplicationsTabProps) {
  const [sharedIntegrations, setSharedIntegrations] = useState<AssistantIntegration[]>([])
  const { refreshIntegrationsForAssistant } = useAssistantStore()

  useEffect(() => {
    const fetchIntegrations = async () => {
      if (shareToken) {
        try {
          const qs = `?share_token=${encodeURIComponent(shareToken)}`
          const data = await apiFetch<Record<string, unknown>[]>(
            `/api/assistants/${assistant.id}/integrations${qs}`
          )
          setSharedIntegrations(data.map(mapIntegrationFromApi))
        } catch { /* ignore */ }
      } else {
        refreshIntegrationsForAssistant(assistant.id)
      }
    }
    fetchIntegrations()
    const interval = setInterval(fetchIntegrations, 30_000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.id, shareToken])

  const effectiveAssistant = shareToken
    ? { ...assistant, integrations: sharedIntegrations }
    : assistant
  const whatsapp = effectiveAssistant.integrations?.find(i => i.provider === 'whatsapp')
  const [selectedProvider, setSelectedProvider] = useState<WhatsAppProvider>(whatsapp?.whatsappProvider || 'baileys')
  const isWhatsAppConnected = whatsapp?.status === 'connected'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold mb-1 text-foreground">Integrações</h3>
        <p className="text-sm text-muted mb-6">
          Conecte seu assistente a plataformas de mensagens.
        </p>
      </div>

      {/* WhatsApp Section */}
      <Card className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#25D366]/10 text-[#25D366] rounded-xl flex items-center justify-center text-lg font-bold">
              WA
            </div>
            <div>
              <h4 className="font-semibold text-foreground">WhatsApp</h4>
              <p className="text-xs text-muted">Escolha um provedor para conectar</p>
            </div>
          </div>
          <StatusBadge connected={isWhatsAppConnected} />
        </div>

        <div className="mb-4">
          <Select
            className="w-full max-w-sm"
            selectedKey={selectedProvider}
            onSelectionChange={(key) => {
              if (key) setSelectedProvider(key as WhatsAppProvider)
            }}
          >
            <Label>Provedor</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {WHATSAPP_PROVIDERS.map(p => (
                  <ListBox.Item key={p.id} id={p.id} textValue={p.label} isDisabled={p.disabled}>
                    <span className={p.disabled ? 'text-muted' : ''}>{p.label}</span>
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className="border-t border-dim pt-4">
          {selectedProvider === 'baileys' && <BaileysForm assistant={effectiveAssistant} shareToken={shareToken} isReadOnly={isReadOnly} />}
          {selectedProvider === 'meta_official' && <MetaOfficialForm assistant={effectiveAssistant} shareToken={shareToken} isReadOnly={isReadOnly} />}
        </div>
      </Card>

      {/* Telegram Section — disabled until fully implemented */}
      <Card className="p-6 opacity-60 pointer-events-none select-none">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#0088cc]/10 text-[#0088cc] rounded-xl flex items-center justify-center text-lg font-bold">
            TG
          </div>
          <div>
            <h4 className="font-semibold text-foreground">Bot do Telegram</h4>
            <p className="text-xs text-muted">Em breve</p>
          </div>
        </div>
      </Card>

      {/* Common Settings */}
      <CommonSettingsSection assistant={assistant} shareToken={shareToken} isReadOnly={isReadOnly} />
    </div>
  )
}
