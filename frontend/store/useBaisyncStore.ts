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

  toggle: () => void
  open: () => void
  close: () => void
  sendMessage: (text: string, attachments?: BaisyncAttachment[]) => Promise<void>
  sendActionResult: (result: string) => Promise<void>
  clearMessages: () => void
  fetchRateLimit: () => Promise<void>
  setActiveSkill: (skill: string | null) => void
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

export const useBaisyncStore = create<BaisyncState>()(
  persist(
  (set, get) => ({
  isOpen: false,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  activeSkill: null,
  rateLimit: null,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  setActiveSkill: (skill) => set({ activeSkill: skill }),

  clearMessages: () => set({ messages: [], streamingContent: '', activeSkill: null }),

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

      // Split text on double newlines into separate message bubbles
      const paragraphs = finalContent
        ? finalContent.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
        : []

      // Typing animation: reveal each paragraph as a separate message
      for (let pi = 0; pi < paragraphs.length; pi++) {
        const para = paragraphs[pi]
        const words = para.split(/(\s+)/)
        let revealed = ''
        for (let i = 0; i < words.length; i++) {
          revealed += words[i]
          set({ streamingContent: revealed })
          await new Promise((r) => setTimeout(r, 18))
        }

        // Commit this paragraph as a message (attach blocks/actions only to last paragraph)
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
              actions: isLast && actions.length > 0 ? actions : undefined,
            },
          ],
          streamingContent: '',
        }))

        // Small pause between bubbles
        if (!isLast) await new Promise((r) => setTimeout(r, 300))
      }

      // If no text paragraphs but there are blocks/actions, add an empty message for them
      if (paragraphs.length === 0 && (uiBlocks.length > 0 || actions.length > 0)) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: generateId(),
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              uiBlocks: uiBlocks.length > 0 ? uiBlocks : undefined,
              actions: actions.length > 0 ? actions : undefined,
            },
          ],
        }))
      }

      set({ isStreaming: false, streamingContent: '' })
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
              actions: isLast && actions.length > 0 ? actions : undefined,
            },
          ],
          streamingContent: '',
        }))
        if (!isLast) await new Promise((r) => setTimeout(r, 300))
      }

      if (paragraphs.length === 0 && (uiBlocks.length > 0 || actions.length > 0)) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: generateId(),
              role: 'assistant',
              content: '',
              timestamp: Date.now(),
              uiBlocks: uiBlocks.length > 0 ? uiBlocks : undefined,
              actions: actions.length > 0 ? actions : undefined,
            },
          ],
        }))
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
        .map(({ actions, attachments, ...rest }) => ({
          ...rest,
          attachments: attachments?.map(({ name, mime_type }) => ({ name, mime_type, data_base64: '' })),
        })),
      activeSkill: state.activeSkill,
    }),
  }
))
