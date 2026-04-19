import { describe, it, expect, beforeEach } from 'vitest'
import { useApiKeysStore } from '@/store/useApiKeysStore'

const emptyKeys = {
  openai: '', claude: '', gemini: '', elevenlabs: '',
  grok: '', deepseek: '',
  mercadopago: '', stripe: '', stripe_public_key: '', mp_public_key: '',
}

const emptyConfigured = {
  openai: false, claude: false, gemini: false, elevenlabs: false,
  grok: false, deepseek: false,
  mercadopago: false, stripe: false,
}

describe('useApiKeysStore', () => {
  beforeEach(() => {
    useApiKeysStore.setState({
      keys: { ...emptyKeys },
      configured: { ...emptyConfigured },
      hasFetched: false,
    })
    localStorage.clear()
  })

  it('has empty keys by default', () => {
    const { keys } = useApiKeysStore.getState()
    expect(keys.openai).toBe('')
    expect(keys.claude).toBe('')
    expect(keys.gemini).toBe('')
  })

  it('setKey updates a single key', () => {
    useApiKeysStore.getState().setKey('openai', 'sk-test-123')
    expect(useApiKeysStore.getState().keys.openai).toBe('sk-test-123')
    expect(useApiKeysStore.getState().keys.claude).toBe('')
  })

  it('setAllKeys replaces all keys', () => {
    const newKeys = {
      openai: 'sk-1', claude: 'sk-2', gemini: 'sk-3', elevenlabs: 'sk-4',
      grok: 'xai-1', deepseek: 'sk-ds-1',
      mercadopago: 'mp-1', stripe: 'st-1', stripe_public_key: 'pk-1', mp_public_key: 'mpk-1',
    }
    useApiKeysStore.getState().setAllKeys(newKeys)
    expect(useApiKeysStore.getState().keys).toEqual(newKeys)
  })

  it('fetchKeys updates configured state from API', async () => {
    await useApiKeysStore.getState().fetchKeys()
    const state = useApiKeysStore.getState()
    expect(state.hasFetched).toBe(true)
    expect(state.configured.openai).toBe(false)
    expect(state.configured.claude).toBe(false)
  })

  it('saveKeys clears input fields after success', async () => {
    const keys = {
      openai: 'sk-test', claude: '', gemini: '', elevenlabs: '',
      grok: '', deepseek: '',
      mercadopago: '', stripe: '', stripe_public_key: '', mp_public_key: '',
    }
    await useApiKeysStore.getState().saveKeys(keys)
    const state = useApiKeysStore.getState()
    // Keys should be cleared after save
    expect(state.keys.openai).toBe('')
    expect(state.keys.claude).toBe('')
  })
})
