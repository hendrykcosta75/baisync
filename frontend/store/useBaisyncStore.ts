import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiFetch } from '@/lib/api'

export interface BaisyncAttachment {
  name: string
  mime_type: string
  data_base64: string
}

export interface BaisyncMessage {
  id: string
  role: 'user' | 'assistant' | 'status'
  content: string
  timestamp: number
  uiBlocks?: BaisyncUIBlock[]
  actions?: BaisyncAction[]
  attachments?: BaisyncAttachment[]
  fileRefs?: { id: string; kind: 'image' | 'file' }[]
}

export interface BaisyncUIBlock {
  type: 'question_box' | 'qr_code' | 'assistant_card'
  data: Record<string, unknown>
}

export interface BaisyncAction {
  action: string
  data: Record<string, unknown>
}

interface RateLimit {
  used: number
  limit: number
  resetAt: string
  pct: number
  warning?: string
}

interface BaisyncState {
  isOpen: boolean
  messages: BaisyncMessage[]
  isStreaming: boolean
  streamingContent: string
  activeSkill: string | null
  rateLimit: RateLimit | null
  /**
   * True once `hydrate()` has attempted a server sync in this browser tab
   * session (success OR silent-fallback). Guards against repeated hydrations
   * when the panel is opened/closed multiple times.
   *
   * Not persisted (by omission from `partialize`): we want every fresh tab
   * to try the server once.
   */
  hydrated: boolean
  /**
   * Epoch ms set by `clearMessages()`. Persisted in localStorage so a page
   * reload doesn't re-populate the cleared chat from `session_events` on
   * Cassandra. `hydrate()` filters out any event whose `created_at` is at or
   * before this timestamp, so older turns stay cleared while anything sent
   * AFTER the user cleared (e.g. a new question in a different tab) still
   * shows up.
   */
  clearedAt: number | null

  toggle: () => void
  open: () => void
  close: () => void
  sendMessage: (text: string, attachments?: BaisyncAttachment[]) => Promise<void>
  sendActionResult: (result: string) => Promise<void>
  clearMessages: () => void
  fetchRateLimit: () => Promise<void>
  setActiveSkill: (skill: string | null) => void
  pushLocalMessage: (msg: Omit<BaisyncMessage, 'id' | 'timestamp'>) => void
  appendLiveTranscript: (role: 'user' | 'assistant', text: string) => void
  /**
   * S2.1 — Pull Sophie's latest session from the server and merge into
   * `messages` only when the local chat is empty. On any failure (offline,
   * 401, 500) we silently keep the localStorage cache that `persist` already
   * loaded — a warning is logged but the UI does not error.
   */
  hydrate: () => Promise<void>
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function tryParseJSON(str: string): unknown {
  try { return JSON.parse(str.trim()) } catch { return null }
}

function parseUIBlocks(content: string): { cleanContent: string; uiBlocks: BaisyncUIBlock[] } {
  const uiBlocks: BaisyncUIBlock[] = []
  // XML tags (primary): <baisync-ui>JSON</baisync-ui>
  let cleaned = content.replace(/<baisync-ui>([\s\S]*?)<\/baisync-ui>/g, (_match, json) => {
    const parsed = tryParseJSON(json) as Record<string, unknown> | null
    if (parsed && parsed.type) {
      const { type, ...rest } = parsed
      uiBlocks.push({ type: type as BaisyncUIBlock['type'], data: (parsed.data as Record<string, unknown>) || rest })
    }
    return ''
  })
  // Fallback: code fences ```baisync-ui
  if (uiBlocks.length === 0) {
    cleaned = cleaned.replace(/```baisync-ui\s*\n([\s\S]*?)```/g, (_match, json) => {
      const parsed = tryParseJSON(json) as Record<string, unknown> | null
      if (parsed && parsed.type) {
        const { type, ...rest } = parsed
        uiBlocks.push({ type: type as BaisyncUIBlock['type'], data: (parsed.data as Record<string, unknown>) || rest })
      }
      return ''
    })
  }
  // Fallback: raw JSON with "type" field
  if (uiBlocks.length === 0) {
    cleaned = cleaned.replace(/\{[\s]*"type"[\s]*:[\s]*"(question_box|qr_code|assistant_card)"[^}]*\}/g, (match) => {
      const parsed = tryParseJSON(match) as Record<string, unknown> | null
      if (parsed && parsed.type) {
        const { type, ...rest } = parsed
        uiBlocks.push({ type: type as BaisyncUIBlock['type'], data: (parsed.data as Record<string, unknown>) || rest })
        return ''
      }
      return match
    })
  }
  return { cleanContent: cleaned.trim(), uiBlocks }
}

function parseActions(content: string): { cleanContent: string; actions: BaisyncAction[] } {
  const actions: BaisyncAction[] = []
  // XML tags (primary): <baisync-action>JSON</baisync-action>
  let cleaned = content.replace(/<baisync-action>([\s\S]*?)<\/baisync-action>/g, (_match, json) => {
    const parsed = tryParseJSON(json) as Record<string, unknown> | null
    if (parsed && parsed.action) actions.push(parsed as unknown as BaisyncAction)
    return ''
  })
  // Fallback: code fences ```baisync-action
  if (actions.length === 0) {
    cleaned = cleaned.replace(/```baisync-action\s*\n([\s\S]*?)```/g, (_match, json) => {
      const parsed = tryParseJSON(json) as Record<string, unknown> | null
      if (parsed && parsed.action) actions.push(parsed as unknown as BaisyncAction)
      return ''
    })
  }
  // Fallback: raw JSON with "action" field
  if (actions.length === 0) {
    cleaned = cleaned.replace(/\{[\s]*"action"[\s]*:[\s]*"[^"]+?"[\s]*,[\s]*"data"[\s]*:\s*\{[^}]*\}\s*\}/g, (match) => {
      const parsed = tryParseJSON(match) as Record<string, unknown> | null
      if (parsed && parsed.action) { actions.push(parsed as unknown as BaisyncAction); return '' }
      return match
    })
  }
  return { cleanContent: cleaned.trim(), actions }
}

/**
 * Shape returned by `GET /api/baisync/sessions`. Kept private — the store
 * only exposes `hydrate()` which calls this endpoint internally.
 */
interface SophieSessionSummaryResponse {
  session_id: string
  status: string
  checkpoint_at: string | null
  created_at: string | null
}

interface ListSophieSessionsApiResponse {
  sessions: SophieSessionSummaryResponse[]
}

interface SessionEventApiDto {
  event_id: string
  event_type: string
  payload: string
  created_at: string | null
}

interface SophieSessionApiResponse {
  session_id: string
  events: SessionEventApiDto[]
}

/**
 * Product promise: Sophie history is visible for 30 days. The backend's
 * `session_events` table has a 90-day TTL, but we filter more aggressively
 * client-side so users see consistent behavior regardless of backend TTL
 * tuning.
 */
const HYDRATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Map a single server-side session event onto the UI's `BaisyncMessage`
 * shape. Returns `null` for event types the UI can't render (tool_call,
 * tool_result, evaluator_verdict, compaction, plan, wake) — those are
 * harness internals, not user-facing turns.
 */
function sessionEventToMessage(
  event: SessionEventApiDto,
  index: number,
): BaisyncMessage | null {
  let role: 'user' | 'assistant'
  if (event.event_type === 'user_msg') {
    role = 'user'
  } else if (event.event_type === 'llm_msg') {
    role = 'assistant'
  } else {
    return null
  }

  let content = ''
  try {
    const parsed = JSON.parse(event.payload) as { content?: unknown }
    if (typeof parsed.content === 'string') content = parsed.content
  } catch {
    // Malformed payload — drop rather than surface raw JSON to the user.
    return null
  }

  // Trust the server event_id (TIMEUUID string) for the message id so
  // subsequent hydrations don't produce duplicate keys if we ever re-merge.
  const timestamp = event.created_at ? Date.parse(event.created_at) : Date.now() + index
  return {
    id: event.event_id,
    role,
    content,
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now() + index,
  }
}

export const useBaisyncStore = create<BaisyncState>()(
  persist(
  (set, get) => ({
  isOpen: false,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  activeSkill: null,
  rateLimit: null,
  hydrated: false,
  clearedAt: null,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveSkill: (skill) => set({ activeSkill: skill }),

  clearMessages: () =>
    // `hydrated: true` stops any in-flight `hydrate()` call from the same tab
    // from clobbering the cleared state when its awaited `set(...)` resolves.
    // `clearedAt` persists so a reload (which resets `hydrated`) doesn't
    // re-populate from `session_events`.
    set({
      messages: [],
      streamingContent: '',
      activeSkill: null,
      hydrated: true,
      clearedAt: Date.now(),
    }),

  pushLocalMessage: (msg) => set((s) => ({
    messages: [...s.messages, { ...msg, id: generateId(), timestamp: Date.now() }],
  })),

  // Merge streaming voice transcript chunks into the conversation: append to
  // the last message if the role matches, otherwise start a new message.
  appendLiveTranscript: (role, text) => set((s) => {
    const msgs = s.messages
    const last = msgs[msgs.length - 1]
    if (last && last.role === role) {
      return {
        messages: [
          ...msgs.slice(0, -1),
          { ...last, content: last.content + text },
        ],
      }
    }
    return {
      messages: [
        ...msgs,
        { id: generateId(), role, content: text, timestamp: Date.now() },
      ],
    }
  }),

  fetchRateLimit: async () => {
    try {
      const data = await apiFetch<{ used: number; limit: number; reset_at: string }>('/api/baisync/rate-limit')
      set({
        rateLimit: {
          used: data.used,
          limit: data.limit,
          resetAt: data.reset_at,
          pct: Math.round((data.used / data.limit) * 100),
        },
      })
    } catch {
      // ignore
    }
  },

  hydrate: async () => {
    // Mark hydrated up-front: even if the server call fails we don't want to
    // retry on every panel open — the localStorage cache is already usable.
    if (get().hydrated) return
    set({ hydrated: true })

    try {
      const listRes = await apiFetch<ListSophieSessionsApiResponse>('/api/baisync/sessions')
      const latest = listRes.sessions?.[0]
      if (!latest) return

      // 30-day retention filter (product promise — see constant comment).
      if (latest.created_at) {
        const createdMs = Date.parse(latest.created_at)
        if (Number.isFinite(createdMs) && Date.now() - createdMs > HYDRATION_RETENTION_MS) {
          return
        }
      }

      const sessionRes = await apiFetch<SophieSessionApiResponse>(
        `/api/baisync/session/${encodeURIComponent(latest.session_id)}`,
      )

      const hydratedMessages: BaisyncMessage[] = []
      sessionRes.events.forEach((event, index) => {
        const msg = sessionEventToMessage(event, index)
        if (msg) hydratedMessages.push(msg)
      })

      if (hydratedMessages.length === 0) return

      // Only merge when local chat is empty. A non-empty `messages` array
      // means the user is mid-conversation (or localStorage already holds
      // the persisted copy of this same session) — clobbering would be
      // visibly wrong. `clearedAt` is re-read inside the setter so a clear
      // that races with this fetch wins (the awaited set() runs last).
      set((s) => {
        if (s.messages.length > 0) return s
        const cutoff = s.clearedAt
        const eligible = cutoff
          ? hydratedMessages.filter((m) => m.timestamp > cutoff)
          : hydratedMessages
        if (eligible.length === 0) return s
        return { messages: eligible }
      })
    } catch (err) {
      // Silent fallback: localStorage cache is already loaded via persist().
      console.warn('[baisync] hydrate failed; keeping local cache:', err)
    }
  },

  sendMessage: async (text: string, attachments?: BaisyncAttachment[]) => {
    const { messages, activeSkill, rateLimit } = get()

    if (rateLimit && rateLimit.pct >= 100) return

    // Add user message
    const userMsg: BaisyncMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    }

    set((s) => ({
      messages: [...s.messages, userMsg],
      isStreaming: true,
      streamingContent: '',
    }))

    // Build history from previous messages (exclude status messages)
    const history = messages
      .filter((m) => m.role !== 'status')
      .map((m) => ({ role: m.role, content: m.content, file_refs: m.fileRefs }))

    try {
      const response = await fetch('/api/baisync/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          message: text,
          history,
          skill: activeSkill,
          attachments: attachments && attachments.length > 0 ? attachments : undefined,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMsg = (errorData as { message?: string }).message || (errorData as { error?: string }).error || 'Erro ao processar mensagem'
        set((s) => ({
          messages: [
            ...s.messages,
            { id: generateId(), role: 'assistant', content: errorMsg, timestamp: Date.now() },
          ],
          isStreaming: false,
          streamingContent: '',
        }))
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        set({ isStreaming: false })
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let currentEvent = ''
      let streamDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()

          // Blank line = end of SSE event, dispatch it
          if (!trimmed) {
            currentEvent = ''
            continue
          }

          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim()
            continue
          }

          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()
            if (dataStr === '[DONE]') continue

            const eventType = currentEvent || 'message'

            try {
              const data = JSON.parse(dataStr)

              if (eventType === 'file_refs' && data.file_refs) {
                // Attach uploaded file refs to the last user message for history context
                set((s) => {
                  const msgs = [...s.messages]
                  for (let i = msgs.length - 1; i >= 0; i--) {
                    if (msgs[i].role === 'user') {
                      msgs[i] = { ...msgs[i], fileRefs: data.file_refs }
                      break
                    }
                  }
                  return { messages: msgs }
                })
              } else if (eventType === 'token' && data.text) {
                fullContent += data.text
                // Don't update streamingContent — accumulate silently to hide raw JSON/actions
              } else if (eventType === 'status' && data.text) {
                set((s) => {
                  const lastMsg = s.messages[s.messages.length - 1]
                  if (lastMsg?.role === 'status') {
                    return {
                      messages: [
                        ...s.messages.slice(0, -1),
                        { ...lastMsg, content: data.text },
                      ],
                    }
                  }
                  return {
                    messages: [
                      ...s.messages,
                      { id: generateId(), role: 'status', content: data.text, timestamp: Date.now() },
                    ],
                  }
                })
              } else if (eventType === 'rate_limit') {
                set({
                  rateLimit: {
                    used: data.used,
                    limit: data.limit,
                    resetAt: '',
                    pct: data.pct,
                    warning: data.warning,
                  },
                })
              } else if (eventType === 'error' && data.error) {
                set((s) => ({
                  messages: [
                    ...s.messages.filter((m) => m.role !== 'status'),
                    { id: generateId(), role: 'assistant', content: data.error, timestamp: Date.now() },
                  ],
                  isStreaming: false,
                  streamingContent: '',
                }))
                return
              } else if (eventType === 'done') {
                streamDone = true
              }
            } catch {
              // non-JSON data line, ignore
            }
          }
        }

        if (streamDone) break
      }

      // Finalize: parse UI blocks and actions from complete content
      const { cleanContent: c1, uiBlocks } = parseUIBlocks(fullContent)
      const { cleanContent: finalContent, actions } = parseActions(c1)

      // Remove status messages
      set((s) => ({
        messages: s.messages.filter((m) => m.role !== 'status'),
      }))

      // Mirrors `call_llm_with_tools_ctx` in backend/src/services/llm.rs:
      // intermediate tool-round prose is dropped, only the terminal turn's
      // text reaches the user. Without this, Sophie pre-writes a hallucinated
      // summary before each tool call, then re-emits an "updated" version
      // after the action returns — the user sees 3–5 near-duplicate bubbles
      // per question.
      if (actions.length > 0) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: generateId(),
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              uiBlocks: uiBlocks.length > 0 ? uiBlocks : undefined,
              actions,
            },
          ],
          streamingContent: '',
        }))
      } else {
        const paragraphs = finalContent
          ? finalContent.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
          : []

        for (let pi = 0; pi < paragraphs.length; pi++) {
          const para = paragraphs[pi]
          const words = para.split(/(\s+)/)
          let revealed = ''
          for (let i = 0; i < words.length; i++) {
            revealed += words[i]
            set({ streamingContent: revealed })
            await new Promise((r) => setTimeout(r, 18))
          }

          const isLast = pi === paragraphs.length - 1
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: generateId(),
                role: 'assistant',
                content: para,
                timestamp: Date.now() + pi,
                uiBlocks: isLast && uiBlocks.length > 0 ? uiBlocks : undefined,
              },
            ],
            streamingContent: '',
          }))

          if (!isLast) await new Promise((r) => setTimeout(r, 300))
        }

        if (paragraphs.length === 0 && uiBlocks.length > 0) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: generateId(),
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                uiBlocks,
              },
            ],
          }))
        }
      }

      set({ isStreaming: false, streamingContent: '' })
      // Backend only emits rate_limit SSE above 60% usage. Refresh explicitly
      // so /status and the rate-limit bar reflect reality after every message.
      void get().fetchRateLimit()
    } catch (err) {
      console.error('[baisync] stream error:', err)
      set((s) => ({
        messages: [
          ...s.messages.filter((m) => m.role !== 'status'),
          {
            id: generateId(),
            role: 'assistant',
            content: 'Não foi possível processar sua mensagem. Tente novamente.',
            timestamp: Date.now(),
          },
        ],
        isStreaming: false,
        streamingContent: '',
      }))
      void get().fetchRateLimit()
    }
  },

  sendActionResult: async (result: string) => {
    const { messages, activeSkill } = get()

    set({ isStreaming: true, streamingContent: '' })

    // Build history including the action result as a system context message
    const history = messages
      .filter((m) => m.role !== 'status')
      .map((m) => ({ role: m.role, content: m.content }))

    try {
      const response = await fetch('/api/baisync/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          message: `[Resultado de ação do sistema]\n${result}`,
          history,
          skill: activeSkill,
        }),
      })

      if (!response.ok) {
        set({ isStreaming: false, streamingContent: '' })
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        set({ isStreaming: false })
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullContent = ''
      let currentEvent = ''
      let streamDone = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) { currentEvent = ''; continue }
          if (trimmed.startsWith('event:')) { currentEvent = trimmed.slice(6).trim(); continue }
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim()
            if (dataStr === '[DONE]') continue
            const eventType = currentEvent || 'message'
            try {
              const data = JSON.parse(dataStr)
              if (eventType === 'token' && data.text) {
                fullContent += data.text
              } else if (eventType === 'rate_limit') {
                set({ rateLimit: { used: data.used, limit: data.limit, resetAt: '', pct: data.pct, warning: data.warning } })
              } else if (eventType === 'done') {
                streamDone = true
              }
            } catch { /* ignore */ }
          }
        }
        if (streamDone) break
      }

      const { cleanContent: c1, uiBlocks } = parseUIBlocks(fullContent)
      const { cleanContent: finalContent, actions } = parseActions(c1)

      // Same rule as `sendMessage` above — a turn that emits another action
      // is intermediate, so its prose is dropped. Otherwise Sophie chains
      // "Aqui estão os detalhes..." → action → "As informações foram
      // atualizadas..." → action → ... and the user sees every draft.
      if (actions.length > 0) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: generateId(),
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              uiBlocks: uiBlocks.length > 0 ? uiBlocks : undefined,
              actions,
            },
          ],
          streamingContent: '',
        }))
      } else {
        const paragraphs = finalContent
          ? finalContent.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
          : []

        for (let pi = 0; pi < paragraphs.length; pi++) {
          const para = paragraphs[pi]
          const words = para.split(/(\s+)/)
          let revealed = ''
          for (let i = 0; i < words.length; i++) {
            revealed += words[i]
            set({ streamingContent: revealed })
            await new Promise((r) => setTimeout(r, 18))
          }
          const isLast = pi === paragraphs.length - 1
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: generateId(),
                role: 'assistant',
                content: para,
                timestamp: Date.now() + pi,
                uiBlocks: isLast && uiBlocks.length > 0 ? uiBlocks : undefined,
              },
            ],
            streamingContent: '',
          }))
          if (!isLast) await new Promise((r) => setTimeout(r, 300))
        }

        if (paragraphs.length === 0 && uiBlocks.length > 0) {
          set((s) => ({
            messages: [
              ...s.messages,
              {
                id: generateId(),
                role: 'assistant',
                content: '',
                timestamp: Date.now(),
                uiBlocks,
              },
            ],
          }))
        }
      }

      set({ isStreaming: false, streamingContent: '' })
    } catch (err) {
      console.error('[baisync] action result stream error:', err)
      set({ isStreaming: false, streamingContent: '' })
    }
  },
}),
  {
    name: 'baisync-chat',
    partialize: (state) => ({
      messages: state.messages
        .filter((m) => m.role !== 'status')
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ actions, attachments, ...rest }) => ({
          ...rest,
          attachments: attachments?.map(({ name, mime_type }) => ({ name, mime_type, data_base64: '' })),
        })),
      activeSkill: state.activeSkill,
      clearedAt: state.clearedAt,
    }),
  }
))
