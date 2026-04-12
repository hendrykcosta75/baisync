import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiFetch } from '@/lib/api'
import { clearModelCache } from '@/lib/useModels'

export interface ApiKeys {
  openai: string
  claude: string
  gemini: string
  elevenlabs: string
  mercadopago: string
  stripe: string
  stripe_public_key: string
  mp_public_key: string
}

interface ConfiguredState {
  openai: boolean
  claude: boolean
  gemini: boolean
  elevenlabs: boolean
  mercadopago: boolean
  stripe: boolean
}

interface ApiKeysState {
  keys: ApiKeys
  configured: ConfiguredState
  hasFetched: boolean
  setKey: (provider: keyof ApiKeys, value: string) => void
  setAllKeys: (keys: ApiKeys) => void
  fetchKeys: () => Promise<void>
  saveKeys: (keys: ApiKeys) => Promise<void>
}

export const useApiKeysStore = create<ApiKeysState>()(
  persist(
    (set) => ({
      keys: { openai: '', claude: '', gemini: '', elevenlabs: '', mercadopago: '', stripe: '', stripe_public_key: '', mp_public_key: '' },
      configured: { openai: false, claude: false, gemini: false, elevenlabs: false, mercadopago: false, stripe: false },
      hasFetched: false,

      setKey: (provider, value) =>
        set((state) => ({
          keys: { ...state.keys, [provider]: value },
        })),

      setAllKeys: (keys) => set({ keys }),

      fetchKeys: async () => {
        try {
          const data = await apiFetch<{ openai_configured: boolean; claude_configured: boolean; gemini_configured: boolean; elevenlabs_configured: boolean; mercadopago_configured: boolean; stripe_configured: boolean }>('/api/user/api-keys')
          set({
            configured: {
              openai: data.openai_configured,
              claude: data.claude_configured,
              gemini: data.gemini_configured,
              elevenlabs: data.elevenlabs_configured,
              mercadopago: data.mercadopago_configured,
              stripe: data.stripe_configured,
            },
            hasFetched: true,
          })
        } catch (err) {
          console.error('Failed to fetch API keys:', err)
          set({ hasFetched: true })
        }
      },

      saveKeys: async (keys) => {
        try {
          await apiFetch('/api/user/api-keys', {
            method: 'PUT',
            body: JSON.stringify({
              openai: keys.openai || null,
              claude: keys.claude || null,
              gemini: keys.gemini || null,
              elevenlabs: keys.elevenlabs || null,
              mercadopago: keys.mercadopago || null,
              stripe: keys.stripe || null,
              stripe_public_key: keys.stripe_public_key || null,
              mp_public_key: keys.mp_public_key || null,
            }),
          })
          // Clear input fields
          set({ keys: { openai: '', claude: '', gemini: '', elevenlabs: '', mercadopago: '', stripe: '', stripe_public_key: '', mp_public_key: '' } })
          clearModelCache()
          // Re-fetch actual configured state from backend
          try {
            const data = await apiFetch<{ openai_configured: boolean; claude_configured: boolean; gemini_configured: boolean; elevenlabs_configured: boolean; mercadopago_configured: boolean; stripe_configured: boolean }>('/api/user/api-keys')
            set({
              configured: {
                openai: data.openai_configured,
                claude: data.claude_configured,
                gemini: data.gemini_configured,
                elevenlabs: data.elevenlabs_configured,
                mercadopago: data.mercadopago_configured,
                stripe: data.stripe_configured,
              },
            })
          } catch { /* configured state will update on next fetchKeys */ }
        } catch (err) {
          console.error('Failed to save API keys to backend:', err)
        }
      },
    }),
    {
      name: 'api-keys-storage',
      partialize: (state) => ({ configured: state.configured }),
    }
  )
)
