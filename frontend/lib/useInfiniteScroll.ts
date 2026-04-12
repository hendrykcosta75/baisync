import { useState, useCallback, useRef, useEffect } from 'react'

interface PaginatedResult<T> {
  items: T[]
  cursor?: string | null
  nextOffset?: number | null
}

interface UseInfiniteScrollOptions<T> {
  fetchFn: (cursor?: string) => Promise<PaginatedResult<T>>
  enabled?: boolean
  pageSize?: number
  /** Change this value to force a reset + refetch (avoids stale closure issues) */
  resetKey?: string | number
}

export function useInfiniteScroll<T>({
  fetchFn,
  enabled = true,
  pageSize = 30,
  resetKey,
}: UseInfiniteScrollOptions<T>) {
  const [items, setItems] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const cursorRef = useRef<string | undefined>(undefined)
  const observerRef = useRef<IntersectionObserver | null>(null)
  const sentinelNodeRef = useRef<HTMLElement | null>(null)
  const fetchFnRef = useRef(fetchFn)
  fetchFnRef.current = fetchFn

  const loadPage = useCallback(async (isFirstPage: boolean) => {
    if (isFirstPage) {
      setIsLoading(true)
    } else {
      setIsLoadingMore(true)
    }

    try {
      const result = await fetchFnRef.current(isFirstPage ? undefined : cursorRef.current)
      const nextCursor = result.cursor ?? (result.nextOffset != null ? String(result.nextOffset) : undefined)

      if (isFirstPage) {
        setItems(result.items)
      } else {
        setItems(prev => [...prev, ...result.items])
      }

      cursorRef.current = nextCursor ?? undefined
      setHasMore(!!nextCursor && result.items.length > 0)
    } catch (err) {
      console.error('useInfiniteScroll fetch error:', err)
      setHasMore(false)
    } finally {
      setIsLoading(false)
      setIsLoadingMore(false)
    }
  }, [])

  const reset = useCallback(() => {
    cursorRef.current = undefined
    setItems([])
    setHasMore(true)
    loadPage(true)
  }, [loadPage])

  // Initial load + re-fetch when resetKey changes
  useEffect(() => {
    if (enabled) {
      cursorRef.current = undefined
      setItems([])
      setHasMore(true)
      loadPage(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loadPage, resetKey])

  // IntersectionObserver for sentinel
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    sentinelNodeRef.current = node

    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    if (!node) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isLoading && !isLoadingMore) {
          loadPage(false)
        }
      },
      { threshold: 0.1 }
    )

    observerRef.current.observe(node)
  }, [hasMore, isLoading, isLoadingMore, loadPage])

  // Cleanup observer on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [])

  return {
    items,
    setItems,
    isLoading,
    isLoadingMore,
    hasMore,
    sentinelRef,
    reset,
  }
}
