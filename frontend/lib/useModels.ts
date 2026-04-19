import { useState, useEffect } from 'react'
import { LLMProvider } from '@/types/assistant'
import { apiFetch } from '@/lib/api'
import { useApiKeysStore } from '@/store/useApiKeysStore'

interface ModelInfo {
  id: string
  name?: string
}

const FALLBACK_MODELS: Record<LLMProvider, string[]> = {
  openai: ['gpt-5', 'gpt-4o', 'gpt-4o-mini', 'o4-mini', 'o3-mini'],
  claude: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  grok: ['grok-4-1-fast-non-reasoning', 'grok-4-1-fast-reasoning', 'grok-4.20-0309-non-reasoning'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
}

const cache = new Map<LLMProvider, string[]>()

export function clearModelCache() {
  cache.clear()
}

export function useModels(provider: LLMProvider, opts?: { assistantId?: string; shareToken?: string }) {
  const [models, setModels] = useState<string[]>(cache.get(provider) || FALLBACK_MODELS[provider] || [])
  const [isLoading, setIsLoading] = useState(false)
  // Optimistic default: assume configured until the backend says otherwise,
  // so the form doesn't flash "chave não configurada" while api-keys status is loading.
  const [hasApiKey, setHasApiKey] = useState(true)
  // True once we have a real model list (from cache or a successful API fetch);
  // false while we're still showing the FALLBACK list. Consumers (e.g. assistant-form)
  // use this to avoid resetting the selected model to availableModels[0] based on stale fallback data.
  const [modelsReady, setModelsReady] = useState<boolean>(cache.has(provider))
  const keys = useApiKeysStore(s => s.keys)
  const configured = useApiKeysStore(s => s.configured)
  const hasFetchedKeys = useApiKeysStore(s => s.hasFetched)
  useEffect(() => {
    const isShared = !!(opts?.assistantId && opts?.shareToken)
    const keyConfigured = isShared || configured[provider] || !!keys?.[provider]
    // Only flip `hasApiKey` to false once we have authoritative data from the backend.
    // Before that, stay optimistic to avoid a false-positive warning on first render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasApiKey(keyConfigured || !hasFetchedKeys)

    if (!isShared && cache.has(provider)) {
      setModels(cache.get(provider)!)
      setModelsReady(true)
      return
    }

    if (!keyConfigured) {
      setModels(FALLBACK_MODELS[provider] || [])
      setModelsReady(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setModelsReady(false)

    const shareQs = opts?.assistantId && opts?.shareToken
      ? `?assistant_id=${opts.assistantId}&share_token=${encodeURIComponent(opts.shareToken)}`
      : ''
    apiFetch<{ models: ModelInfo[] }>(`/api/models/${provider}${shareQs}`)
      .then(res => {
        if (cancelled) return
        const ids = res.models.map(m => m.id)
        cache.set(provider, ids)
        setModels(ids)
        setModelsReady(true)
      })
      .catch(() => {
        if (cancelled) return
        setModels(FALLBACK_MODELS[provider] || [])
        // Fetch failed — keep modelsReady=false so consumers treat the list as untrusted.
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [provider, keys, configured, hasFetchedKeys, opts?.assistantId, opts?.shareToken])

  return { models, isLoading, hasApiKey, modelsReady }
}
