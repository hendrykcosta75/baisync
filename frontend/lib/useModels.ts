import { useState, useEffect, useRef } from 'react'
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
}

const cache = new Map<LLMProvider, string[]>()

export function clearModelCache() {
  cache.clear()
}

export function useModels(provider: LLMProvider, opts?: { assistantId?: string; shareToken?: string }) {
  const [models, setModels] = useState<string[]>(cache.get(provider) || FALLBACK_MODELS[provider] || [])
  const [isLoading, setIsLoading] = useState(false)
  const [hasApiKey, setHasApiKey] = useState(true)
  const keys = useApiKeysStore(s => s.keys)
  const configured = useApiKeysStore(s => s.configured)
  const prevProvider = useRef(provider)

  useEffect(() => {
    const isShared = !!(opts?.assistantId && opts?.shareToken)
    const keyConfigured = isShared || configured[provider] || !!keys?.[provider]
    setHasApiKey(keyConfigured)

    if (!isShared && cache.has(provider)) {
      setModels(cache.get(provider)!)
      return
    }

    if (!keyConfigured) {
      setModels(FALLBACK_MODELS[provider] || [])
      return
    }

    let cancelled = false
    setIsLoading(true)

    const shareQs = opts?.assistantId && opts?.shareToken
      ? `?assistant_id=${opts.assistantId}&share_token=${encodeURIComponent(opts.shareToken)}`
      : ''
    apiFetch<{ models: ModelInfo[] }>(`/api/models/${provider}${shareQs}`)
      .then(res => {
        if (cancelled) return
        const ids = res.models.map(m => m.id)
        cache.set(provider, ids)
        setModels(ids)
      })
      .catch(() => {
        if (cancelled) return
        setModels(FALLBACK_MODELS[provider] || [])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [provider, keys, configured, opts?.assistantId, opts?.shareToken])

  return { models, isLoading, hasApiKey }
}
