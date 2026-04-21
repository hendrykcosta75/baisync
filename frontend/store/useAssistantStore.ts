import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Assistant, AssistantFile, AssistantTool, AssistantIntegration, SubAgent, AudioConfig, AudioMode, AudioProvider } from '@/types/assistant'
import { apiFetch } from '@/lib/api'
import type { AssistantTemplate } from '@/lib/assistantTemplates'

export type TemplateFormInput = Pick<Assistant, 'name' | 'description' | 'llmProvider' | 'model' | 'temperature' | 'maxTokens' | 'systemPrompt'>

function mapAssistantFromApi(a: Record<string, unknown>): Assistant {
  return {
    id: a.id as string,
    name: a.name as string,
    description: (a.description ?? '') as string,
    llmProvider: (a.llm_provider ?? a.llmProvider) as Assistant['llmProvider'],
    model: a.model as string,
    temperature: (a.temperature ?? 0.7) as number,
    maxTokens: (a.max_tokens ?? a.maxTokens ?? 2048) as number,
    systemPrompt: (a.system_prompt ?? a.systemPrompt ?? '') as string,
    isTeamLead: (a.is_team_lead ?? a.isTeamLead ?? false) as boolean,
    parentAssistantId: (a.parent_assistant_id ?? a.parentAssistantId) as string | undefined,
    files: (a.files ?? []) as AssistantFile[],
    tools: (a.tools ?? []) as AssistantTool[],
    integrations: (a.integrations ?? []) as AssistantIntegration[],
    integrationSettings: {
      rateLimitPerDay: (a.config_rate_limit_per_day ?? 1000) as number,
      maxMessageLength: (a.config_max_message_length ?? 4096) as number,
      splitOnDoubleNewline: (a.config_split_messages ?? false) as boolean,
      typingIndicator: (a.config_typing_indicator ?? true) as boolean,
      interpretDocuments: (a.config_interpret_documents ?? false) as boolean,
      rateLimitMessage: (a.config_rate_limit_message ?? '') as string,
      maxLengthMessage: (a.config_max_length_message ?? '') as string,
      unsupportedMediaMessage: (a.config_unsupported_media_message ?? '') as string,
    },
    audioConfig: {
      provider: ((a.config_audio_provider ?? null) as AudioProvider | null),
      mode: ((a.config_audio_mode ?? 'disabled') as AudioMode),
      transcribe: (a.config_audio_transcribe ?? false) as boolean,
      fallbackToText: (a.config_audio_fallback_to_text ?? true) as boolean,
      transcriptionFailureMessage: (a.config_audio_transcription_failure_message ?? '') as string,
      voiceId: ((a.config_audio_voice_id ?? null) as string | null),
    } satisfies AudioConfig,
    subAgents: (a.sub_agents ?? a.subAgents ?? []) as SubAgent[],
    configMaxToolRounds: (a.config_max_tool_rounds ?? null) as number | null,
    configMaxDurationMs: (a.config_max_duration_ms ?? null) as number | null,
    configAutoCompact: (a.config_auto_compact ?? null) as boolean | null,
    configEnableEvaluator: (a.config_enable_evaluator ?? null) as boolean | null,
    configEvaluatorModel: (a.config_evaluator_model ?? null) as string | null,
  }
}

export function mapIntegrationFromApi(r: Record<string, unknown>): AssistantIntegration {
  const channel = r.channel as string
  const provider = r.provider as string
  const status = r.status === 'connected' ? 'connected' : 'disconnected'

  if (channel === 'whatsapp' || provider === 'baileys' || provider === 'meta_official') {
    if (provider === 'meta_official') {
      return {
        id: r.id as string,
        provider: 'whatsapp',
        whatsappProvider: 'meta_official',
        status,
        phoneNumberId: r.config_phone_number as string | undefined,
        accessToken: r.config_token as string | undefined,
        webhookVerifyToken: r.config_webhook_verify_token as string | undefined,
      }
    }
    return {
      id: r.id as string,
      provider: 'whatsapp',
      whatsappProvider: 'baileys',
      status,
      phoneNumber: r.config_phone_number as string | undefined,
    }
  }

  // telegram
  return {
    id: r.id as string,
    provider: 'telegram',
    status,
    token: r.config_token as string | undefined,
  }
}

function toolToSchemaJson(tool: Partial<AssistantTool>): string | null {
  // Built-in tool types don't need schema
  if (tool.toolType === 'send_document' || tool.toolType === 'notify_human' || tool.toolType === 'pix_payment') return null

  const hasExtended = tool.auth || tool.queryParams?.length || tool.bodyContentType || tool.bodyContent || tool.settings
  if (!hasExtended && !tool.schema) return null
  if (!hasExtended) return tool.schema || null

  return JSON.stringify({
    __extended: true,
    schema: tool.schema || undefined,
    auth: tool.auth,
    queryParams: tool.queryParams,
    bodyContentType: tool.bodyContentType,
    bodyContent: tool.bodyContent,
    settings: tool.settings,
  })
}

function assistantToApiPayload(a: Partial<Assistant>): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  if (a.name !== undefined) payload.name = a.name
  if (a.description !== undefined) payload.description = a.description
  if (a.llmProvider !== undefined) payload.llm_provider = a.llmProvider
  if (a.model !== undefined) payload.model = a.model
  if (a.temperature !== undefined) payload.temperature = a.temperature
  if (a.maxTokens !== undefined) payload.max_tokens = a.maxTokens
  if (a.systemPrompt !== undefined) payload.system_prompt = a.systemPrompt
  if (a.isTeamLead !== undefined) payload.is_team_lead = a.isTeamLead
  if (a.parentAssistantId !== undefined) payload.parent_assistant_id = a.parentAssistantId
  // W1.2 thresholds
  if (a.configMaxToolRounds !== undefined) payload.config_max_tool_rounds = a.configMaxToolRounds
  if (a.configMaxDurationMs !== undefined) payload.config_max_duration_ms = a.configMaxDurationMs
  // T2.3 / W2.1 toggles
  if (a.configAutoCompact !== undefined) payload.config_auto_compact = a.configAutoCompact
  if (a.configEnableEvaluator !== undefined) payload.config_enable_evaluator = a.configEnableEvaluator
  if (a.configEvaluatorModel !== undefined) payload.config_evaluator_model = a.configEvaluatorModel
  return payload
}

interface AssistantState {
  assistants: Assistant[]
  isLoading: boolean
  hasFetched: boolean
  fetchAssistants: () => Promise<void>
  fetchAssistantFiles: (assistantId: string) => Promise<void>
  fetchAssistantTools: (assistantId: string) => Promise<void>
  addAssistant: (assistant: Omit<Assistant, 'files' | 'tools' | 'integrations' | 'isTeamLead' | 'subAgents'> & Partial<Assistant>) => Promise<void>
  importAssistantFromTemplate: (formData: TemplateFormInput, template: AssistantTemplate) => Promise<Assistant | null>
  updateAssistant: (id: string, updatedAssistant: Partial<Assistant>) => Promise<void>
  deleteAssistant: (id: string) => Promise<void>
  addFileToAssistant: (id: string, file: AssistantFile, rawFile?: File) => Promise<void>
  removeFileFromAssistant: (id: string, fileId: string) => Promise<void>
  addToolToAssistant: (id: string, tool: AssistantTool) => Promise<void>
  removeToolFromAssistant: (id: string, toolId: string) => Promise<void>
  updateToolForAssistant: (id: string, toolId: string, tool: Partial<AssistantTool>) => Promise<void>
  toggleToolForAssistant: (id: string, toolId: string, isEnabled: boolean) => Promise<void>
  updateIntegrationForAssistant: (id: string, integration: AssistantIntegration) => Promise<void>
  refreshIntegrationsForAssistant: (id: string) => Promise<void>
  addSubAgent: (assistantId: string, subAgent: SubAgent) => Promise<void>
  updateSubAgent: (assistantId: string, subAgentId: string, data: Partial<SubAgent>) => Promise<void>
  removeSubAgent: (assistantId: string, subAgentId: string) => Promise<void>
}

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set, get) => ({
      assistants: [],
      isLoading: false,
      hasFetched: false,

      fetchAssistants: async () => {
        set({ isLoading: true })
        try {
          const data = await apiFetch<Record<string, unknown>[]>('/api/assistants')
          const assistants = data.map(mapAssistantFromApi)
          // Preserve files that were already loaded (backend doesn't include files in assistant response)
          const current = get().assistants
          const merged = assistants.map(a => {
            const existing = current.find(c => c.id === a.id)
            return {
              ...a,
              files: existing?.files?.length ? existing.files : a.files,
              tools: existing?.tools?.length ? existing.tools : a.tools,
              integrations: existing?.integrations?.length ? existing.integrations : a.integrations,
            }
          })
          set({ assistants: merged, hasFetched: true, isLoading: false })
        } catch (err) {
          console.error('Failed to fetch assistants:', err)
          set({ isLoading: false, hasFetched: true })
        }
      },

      fetchAssistantFiles: async (assistantId: string) => {
        try {
          const data = await apiFetch<{ id: string; name: string; size: number; type: string; uploadedAt: string }[]>(
            `/api/assistants/${assistantId}/files`
          )
          const files: AssistantFile[] = data.map(f => ({
            id: f.id,
            name: f.name,
            size: f.size,
            type: f.type,
            uploadedAt: f.uploadedAt,
          }))
          set((state) => ({
            assistants: state.assistants.map(a =>
              a.id === assistantId ? { ...a, files } : a
            ),
          }))
        } catch (err) {
          console.error('Failed to fetch assistant files:', err)
        }
      },

      fetchAssistantTools: async (assistantId: string) => {
        try {
          const data = await apiFetch<{ id: string; name: string; description: string | null; endpoint: string; method: string; schema_json: string | null; headers_json: string | null; is_enabled: boolean; tool_type: string | null }[]>(
            `/api/assistants/${assistantId}/tools`
          )
          const tools: AssistantTool[] = data.map(t => {
            // Extended config is stored as JSON in schema_json alongside the schema
            let schema: string | undefined
            let auth: AssistantTool['auth']
            let queryParams: AssistantTool['queryParams']
            let bodyContentType: AssistantTool['bodyContentType']
            let bodyContent: AssistantTool['bodyContent']
            let settings: AssistantTool['settings']

            if (t.schema_json) {
              try {
                const parsed = JSON.parse(t.schema_json)
                if (parsed.__extended) {
                  schema = parsed.schema || undefined
                  auth = parsed.auth
                  queryParams = parsed.queryParams
                  bodyContentType = parsed.bodyContentType
                  bodyContent = parsed.bodyContent
                  settings = parsed.settings
                } else {
                  schema = t.schema_json
                }
              } catch {
                schema = t.schema_json
              }
            }

            return {
              id: t.id,
              name: t.name,
              description: t.description ?? '',
              endpoint: t.endpoint,
              method: (t.method || 'POST') as AssistantTool['method'],
              schema,
              headers: t.headers_json ?? undefined,
              isEnabled: t.is_enabled,
              auth,
              queryParams,
              bodyContentType,
              bodyContent,
              settings,
              toolType: (t.tool_type || 'http_request') as AssistantTool['toolType'],
            }
          })
          set((state) => ({
            assistants: state.assistants.map(a =>
              a.id === assistantId ? { ...a, tools } : a
            ),
          }))
        } catch (err) {
          console.error('Failed to fetch assistant tools:', err)
        }
      },

      addAssistant: async (assistant) => {
        const full: Assistant = {
          ...assistant,
          files: assistant.files || [],
          tools: assistant.tools || [],
          integrations: assistant.integrations || [],
          isTeamLead: assistant.isTeamLead || false,
          subAgents: assistant.subAgents || [],
        } as Assistant

        // Optimistic update
        set((state) => ({ assistants: [...state.assistants, full] }))

        try {
          const payload = assistantToApiPayload(full)
          const created = await apiFetch<Record<string, unknown>>('/api/assistants', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
          const mapped = mapAssistantFromApi(created)
          // Replace optimistic with server response
          set((state) => ({
            assistants: state.assistants.map(a => a.id === full.id ? { ...full, ...mapped } : a),
          }))
        } catch (err) {
          console.error('Failed to create assistant on backend:', err)
          // Rollback - remove optimistic entry
          set((state) => ({
            assistants: state.assistants.filter(a => a.id !== full.id),
          }))
        }
      },

      importAssistantFromTemplate: async (formData, template) => {
        const optimisticId = `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const optimistic: Assistant = {
          id: optimisticId,
          name: formData.name,
          description: formData.description,
          llmProvider: formData.llmProvider,
          model: formData.model,
          temperature: formData.temperature,
          maxTokens: formData.maxTokens,
          systemPrompt: formData.systemPrompt,
          files: [],
          tools: [],
          integrations: [],
          isTeamLead: false,
          subAgents: [],
          integrationSettings: template.integrationSettings,
        }

        set((state) => ({ assistants: [...state.assistants, optimistic] }))

        let realId: string
        let mapped: Assistant
        try {
          const created = await apiFetch<Record<string, unknown>>('/api/assistants', {
            method: 'POST',
            body: JSON.stringify(assistantToApiPayload(optimistic)),
          })
          realId = created.id as string
          mapped = mapAssistantFromApi(created)
        } catch (err) {
          console.error('Template import — failed to create assistant:', err)
          set((state) => ({ assistants: state.assistants.filter(a => a.id !== optimisticId) }))
          return null
        }

        try {
          await apiFetch(`/api/assistants/${realId}`, {
            method: 'PUT',
            body: JSON.stringify({ integrationSettings: template.integrationSettings }),
          })
        } catch (err) {
          console.error('Template import — failed to apply integrationSettings:', err)
        }

        const createdTools: AssistantTool[] = []
        for (const t of template.tools) {
          try {
            const resp = await apiFetch<Record<string, unknown>>(`/api/assistants/${realId}/tools`, {
              method: 'POST',
              body: JSON.stringify({
                name: t.name,
                description: t.description,
                endpoint: '',
                method: 'POST',
                schema_json: null,
                headers_json: null,
                is_enabled: true,
                tool_type: t.toolType,
              }),
            })
            const toolId = typeof resp.id === 'string' ? resp.id : `tpl_tool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            createdTools.push({
              id: toolId,
              name: t.name,
              description: t.description,
              endpoint: '',
              method: 'POST',
              isEnabled: true,
              toolType: t.toolType,
            })
          } catch (err) {
            console.error(`Template import — failed to add tool ${t.toolType}:`, err)
          }
        }

        const final: Assistant = {
          ...mapped,
          tools: createdTools,
          integrationSettings: template.integrationSettings,
          files: mapped.files ?? [],
          integrations: mapped.integrations ?? [],
          subAgents: mapped.subAgents ?? [],
        }
        set((state) => ({
          assistants: state.assistants.map(a => a.id === optimisticId ? final : a),
        }))
        return final
      },

      updateAssistant: async (id, updatedAssistant) => {
        // Optimistic update
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === id ? { ...a, ...updatedAssistant } : a
          ),
        }))

        try {
          const payload = assistantToApiPayload(updatedAssistant)
          await apiFetch(`/api/assistants/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          })
        } catch (err) {
          console.error('Failed to update assistant on backend:', err)
        }
      },

      deleteAssistant: async (id) => {
        const prev = get().assistants
        set((state) => ({
          assistants: state.assistants.filter((a) => a.id !== id),
        }))

        try {
          await apiFetch(`/api/assistants/${id}`, { method: 'DELETE' })
        } catch (err) {
          console.error('Failed to delete assistant on backend:', err)
          // Rollback
          set({ assistants: prev })
        }
      },

      addFileToAssistant: async (id, file, rawFile) => {
        // Optimistic local update
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === id ? { ...a, files: [...a.files, file] } : a
          ),
        }))

        if (rawFile) {
          try {
            const formData = new FormData()
            formData.append('file', rawFile)
            const resp = await fetch(`/api/assistants/${id}/files`, {
              method: 'POST',
              credentials: 'same-origin',
              body: formData,
            })
            if (resp.ok) {
              const data = await resp.json()
              const serverFile = data.file as { id: string; name: string; size: number; type: string; uploadedAt: string }
              // Replace optimistic file with server response
              set((state) => ({
                assistants: state.assistants.map((a) =>
                  a.id === id
                    ? { ...a, files: a.files.map(f => f.id === file.id ? { ...f, id: serverFile.id, name: serverFile.name, size: serverFile.size, type: serverFile.type, uploadedAt: serverFile.uploadedAt } : f) }
                    : a
                ),
              }))
            }
          } catch (err) {
            console.error('File upload to backend failed (kept locally):', err)
          }
        }
      },

      removeFileFromAssistant: async (id, fileId) => {
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === id ? { ...a, files: a.files.filter(f => f.id !== fileId) } : a
          ),
        }))

        try {
          await apiFetch(`/api/assistants/${id}/files/${fileId}`, { method: 'DELETE' })
        } catch (err) {
          console.error('Failed to delete file on backend:', err)
        }
      },

      addToolToAssistant: async (id, tool) => {
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === id ? { ...a, tools: [...(a.tools || []), tool] } : a
          ),
        }))

        try {
          await apiFetch(`/api/assistants/${id}/tools`, {
            method: 'POST',
            body: JSON.stringify({
              name: tool.name,
              description: tool.description || null,
              endpoint: tool.endpoint || '',
              method: tool.method || 'POST',
              schema_json: toolToSchemaJson(tool),
              headers_json: tool.headers || null,
              is_enabled: tool.isEnabled,
              tool_type: tool.toolType || 'http_request',
            }),
          })
        } catch (err) {
          console.error('Failed to create tool on backend:', err)
        }
      },

      removeToolFromAssistant: async (id, toolId) => {
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === id ? { ...a, tools: (a.tools || []).filter(t => t.id !== toolId) } : a
          ),
        }))

        try {
          await apiFetch(`/api/assistants/${id}/tools/${toolId}`, { method: 'DELETE' })
        } catch (err) {
          console.error('Failed to delete tool on backend:', err)
        }
      },

      updateToolForAssistant: async (id, toolId, tool) => {
        set((state) => ({
          assistants: state.assistants.map((a) => {
            if (a.id !== id) return a
            return { ...a, tools: a.tools.map(t => t.id === toolId ? { ...t, ...tool } : t) }
          }),
        }))

        try {
          await apiFetch(`/api/assistants/${id}/tools/${toolId}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: tool.name,
              description: tool.description,
              endpoint: tool.endpoint,
              method: tool.method,
              schema_json: toolToSchemaJson(tool),
              headers_json: tool.headers,
              tool_type: tool.toolType,
            }),
          })
        } catch (err) {
          console.error('Failed to update tool on backend:', err)
        }
      },

      toggleToolForAssistant: async (id, toolId, isEnabled) => {
        // Optimistic update
        set((state) => ({
          assistants: state.assistants.map((a) => {
            if (a.id !== id) return a
            const toolExists = a.tools.find(t => t.id === toolId)
            let newTools = [...a.tools]
            if (toolExists) {
              newTools = newTools.map(t => t.id === toolId ? { ...t, isEnabled } : t)
            }
            return { ...a, tools: newTools }
          }),
        }))

        try {
          await apiFetch(`/api/assistants/${id}/tools/${toolId}`, {
            method: 'PUT',
            body: JSON.stringify({ is_enabled: isEnabled }),
          })
        } catch (err) {
          console.error('Failed to toggle tool on backend:', err)
        }
      },

      updateIntegrationForAssistant: async (id, integration) => {
        // Optimistic update
        set((state) => ({
          assistants: state.assistants.map((a) => {
            if (a.id !== id) return a
            const otherIntegrations = a.integrations.filter(i => i.provider !== integration.provider || i.whatsappProvider !== integration.whatsappProvider)
            return { ...a, integrations: [...otherIntegrations, integration] }
          }),
        }))

        if (integration.id) {
          try {
            await apiFetch(`/api/assistants/${id}/integrations/${integration.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                status: integration.status,
                config_phone_number: integration.phoneNumber,
                config_token: integration.token,
              }),
            })
          } catch (err) {
            console.error('Failed to update integration on backend:', err)
          }
        }
      },

      refreshIntegrationsForAssistant: async (id) => {
        try {
          const data = await apiFetch<Record<string, unknown>[]>(`/api/assistants/${id}/integrations`)
          const integrations: AssistantIntegration[] = data.map(mapIntegrationFromApi)
          set((state) => ({
            assistants: state.assistants.map((a) =>
              a.id === id ? { ...a, integrations } : a
            ),
          }))
        } catch {
          // ignore
        }
      },

      addSubAgent: async (assistantId, subAgent) => {
        // Optimistic update
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === assistantId ? { ...a, subAgents: [...(a.subAgents || []), subAgent] } : a
          ),
        }))

        try {
          const created = await apiFetch<{ id: string }>('/api/assistants', {
            method: 'POST',
            body: JSON.stringify({
              name: subAgent.name,
              description: subAgent.description,
              llm_provider: subAgent.llmProvider === 'inherit' ? undefined : subAgent.llmProvider,
              model: subAgent.model,
              system_prompt: subAgent.customPrompt || undefined,
              parent_assistant_id: assistantId,
            }),
          })
          // Update the sub-agent with server-assigned ID
          set((state) => ({
            assistants: state.assistants.map((a) =>
              a.id === assistantId
                ? { ...a, subAgents: (a.subAgents || []).map((s) => s.id === subAgent.id ? { ...s, id: created.id } : s) }
                : a
            ),
          }))
        } catch (err) {
          console.error('Failed to create sub-agent on backend:', err)
        }
      },

      updateSubAgent: async (assistantId, subAgentId, data) => {
        // Optimistic update
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === assistantId
              ? { ...a, subAgents: (a.subAgents || []).map((s) => s.id === subAgentId ? { ...s, ...data } : s) }
              : a
          ),
        }))

        try {
          await apiFetch(`/api/assistants/${subAgentId}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: data.name,
              description: data.description,
              llm_provider: data.llmProvider === 'inherit' ? undefined : data.llmProvider,
              model: data.model,
              system_prompt: data.customPrompt || undefined,
            }),
          })
        } catch (err) {
          console.error('Failed to update sub-agent on backend:', err)
        }
      },

      removeSubAgent: async (assistantId, subAgentId) => {
        // Optimistic update
        set((state) => ({
          assistants: state.assistants.map((a) =>
            a.id === assistantId
              ? { ...a, subAgents: (a.subAgents || []).filter((s) => s.id !== subAgentId) }
              : a
          ),
        }))

        try {
          await apiFetch(`/api/assistants/${subAgentId}`, { method: 'DELETE' })
        } catch (err) {
          console.error('Failed to delete sub-agent on backend:', err)
        }
      },
    }),
    {
      name: 'assistant-storage',
      partialize: (state) => ({ assistants: state.assistants }),
    }
  )
)
