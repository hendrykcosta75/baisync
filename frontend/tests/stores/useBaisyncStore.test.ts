import { describe, it, expect, beforeEach } from 'vitest'
import { useBaisyncStore } from '@/store/useBaisyncStore'

describe('useBaisyncStore', () => {
  beforeEach(() => {
    useBaisyncStore.setState({
      isOpen: false, messages: [], isStreaming: false,
      streamingContent: '', activeSkill: null, rateLimit: null,
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
})
