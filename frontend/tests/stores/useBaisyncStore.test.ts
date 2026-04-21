import { describe, it, expect, beforeEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { useBaisyncStore } from '@/store/useBaisyncStore'
import { server } from '../mocks/server'

describe('useBaisyncStore', () => {
  beforeEach(() => {
    useBaisyncStore.setState({
      isOpen: false, messages: [], isStreaming: false,
      streamingContent: '', activeSkill: null, rateLimit: null,
      hydrated: false,
    })
  })

  it('starts closed with empty messages', () => {
    const state = useBaisyncStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.messages).toEqual([])
    expect(state.isStreaming).toBe(false)
  })

  it('toggle flips isOpen', () => {
    useBaisyncStore.getState().toggle()
    expect(useBaisyncStore.getState().isOpen).toBe(true)
    useBaisyncStore.getState().toggle()
    expect(useBaisyncStore.getState().isOpen).toBe(false)
  })

  it('open sets isOpen to true', () => {
    useBaisyncStore.getState().open()
    expect(useBaisyncStore.getState().isOpen).toBe(true)
  })

  it('close sets isOpen to false', () => {
    useBaisyncStore.setState({ isOpen: true })
    useBaisyncStore.getState().close()
    expect(useBaisyncStore.getState().isOpen).toBe(false)
  })

  it('setActiveSkill updates skill', () => {
    useBaisyncStore.getState().setActiveSkill('calendar')
    expect(useBaisyncStore.getState().activeSkill).toBe('calendar')
    useBaisyncStore.getState().setActiveSkill(null)
    expect(useBaisyncStore.getState().activeSkill).toBeNull()
  })

  it('clearMessages resets messages and skill', () => {
    useBaisyncStore.setState({
      messages: [{ id: '1', role: 'user', content: 'hi', timestamp: Date.now() }],
      streamingContent: 'partial',
      activeSkill: 'test',
    })
    useBaisyncStore.getState().clearMessages()
    const state = useBaisyncStore.getState()
    expect(state.messages).toEqual([])
    expect(state.streamingContent).toBe('')
    expect(state.activeSkill).toBeNull()
  })

  it('sendMessage does nothing when rate limit is at 100%', async () => {
    useBaisyncStore.setState({
      rateLimit: { used: 100, limit: 100, resetAt: '', pct: 100 },
    })
    await useBaisyncStore.getState().sendMessage('Hello')
    // No user message should be added since rate limit blocks it
    expect(useBaisyncStore.getState().messages).toHaveLength(0)
  })

  // ─── S2.1 — Server-side hydration ────────────────────────────────────

  describe('hydrate', () => {
    it('populates messages from server when local chat is empty', async () => {
      const sessionId = '11111111-1111-1111-1111-111111111111'
      const recent = new Date().toISOString()
      server.use(
        http.get('/api/baisync/sessions', () =>
          HttpResponse.json({
            sessions: [
              { session_id: sessionId, status: 'completed', checkpoint_at: null, created_at: recent },
            ],
          }),
        ),
        http.get(`/api/baisync/session/${sessionId}`, () =>
          HttpResponse.json({
            session_id: sessionId,
            events: [
              { event_id: 'ev-1', event_type: 'user_msg', payload: '{"content":"oi"}', created_at: recent },
              { event_id: 'ev-2', event_type: 'llm_msg', payload: '{"content":"olá!"}', created_at: recent },
              { event_id: 'ev-3', event_type: 'tool_call', payload: '{"tool":"x"}', created_at: recent },
            ],
          }),
        ),
      )

      await useBaisyncStore.getState().hydrate()

      const state = useBaisyncStore.getState()
      expect(state.hydrated).toBe(true)
      // tool_call events are skipped; only user_msg + llm_msg surface.
      expect(state.messages).toHaveLength(2)
      expect(state.messages[0]).toMatchObject({ role: 'user', content: 'oi', id: 'ev-1' })
      expect(state.messages[1]).toMatchObject({ role: 'assistant', content: 'olá!', id: 'ev-2' })
    })

    it('skips hydration when local chat already has messages', async () => {
      const existingMsg = { id: 'local-1', role: 'user' as const, content: 'mid-chat', timestamp: Date.now() }
      useBaisyncStore.setState({ messages: [existingMsg] })

      const sessionId = '22222222-2222-2222-2222-222222222222'
      const recent = new Date().toISOString()
      server.use(
        http.get('/api/baisync/sessions', () =>
          HttpResponse.json({
            sessions: [{ session_id: sessionId, status: 'completed', checkpoint_at: null, created_at: recent }],
          }),
        ),
        http.get(`/api/baisync/session/${sessionId}`, () =>
          HttpResponse.json({
            session_id: sessionId,
            events: [
              { event_id: 'ev-1', event_type: 'user_msg', payload: '{"content":"server-msg"}', created_at: recent },
            ],
          }),
        ),
      )

      await useBaisyncStore.getState().hydrate()

      const state = useBaisyncStore.getState()
      expect(state.hydrated).toBe(true)
      // Local in-progress messages must NOT be clobbered.
      expect(state.messages).toEqual([existingMsg])
    })

    it('silently falls back on network / server error', async () => {
      const existingMsg = { id: 'cached-1', role: 'assistant' as const, content: 'cached', timestamp: Date.now() }
      useBaisyncStore.setState({ messages: [existingMsg] })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      server.use(
        http.get('/api/baisync/sessions', () => HttpResponse.json({ error: 'boom' }, { status: 500 })),
      )

      await useBaisyncStore.getState().hydrate()

      const state = useBaisyncStore.getState()
      expect(state.hydrated).toBe(true)
      expect(state.messages).toEqual([existingMsg])
      expect(warnSpy).toHaveBeenCalled()
      warnSpy.mockRestore()
    })

    it('skips events older than 30 days', async () => {
      const sessionId = '33333333-3333-3333-3333-333333333333'
      const oldIso = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
      server.use(
        http.get('/api/baisync/sessions', () =>
          HttpResponse.json({
            sessions: [{ session_id: sessionId, status: 'completed', checkpoint_at: null, created_at: oldIso }],
          }),
        ),
      )

      await useBaisyncStore.getState().hydrate()

      const state = useBaisyncStore.getState()
      expect(state.hydrated).toBe(true)
      // Session existed but was too old → no merge, no crash.
      expect(state.messages).toEqual([])
    })

    it('is a no-op on a second call', async () => {
      useBaisyncStore.setState({ hydrated: true })
      // No MSW handler installed — if the store actually called the server
      // it would hit the default 404 and log a warning. We just assert it
      // returns without changing state.
      await useBaisyncStore.getState().hydrate()
      expect(useBaisyncStore.getState().messages).toEqual([])
    })
  })
})
