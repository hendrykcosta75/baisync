'use client'

import { useEffect, useRef } from 'react'

/**
 * SSE hook that connects to /api/events and dispatches CustomEvents on the window.
 * Components listen via window.addEventListener('sse:<event_type>', handler).
 *
 * Features:
 * - Auto-reconnect with exponential backoff (1s → 30s max)
 * - Pauses when tab is hidden, reconnects when visible
 * - Cleans up on unmount
 */
export function useRealtimeEvents() {
  const controllerRef = useRef<AbortController | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const backoffRef = useRef(1000)

  useEffect(() => {
    let mounted = true

    const connect = async () => {
      if (!mounted) return

      // Clean up previous connection
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller

      try {
        const res = await fetch('/api/events', {
          signal: controller.signal,
          headers: { Accept: 'text/event-stream' },
        })

        if (!res.ok || !res.body) {
          throw new Error(`SSE connection failed: ${res.status}`)
        }

        // Connected successfully — reset backoff
        backoffRef.current = 1000

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (mounted) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          let currentEvent = ''
          let currentData = ''

          for (const line of lines) {
            if (line.startsWith('event:')) {
              currentEvent = line.slice(6).trim()
            } else if (line.startsWith('data:')) {
              currentData = line.slice(5).trim()
            } else if (line === '') {
              // Empty line = end of event
              if (currentEvent && currentData) {
                try {
                  const parsed = JSON.parse(currentData)
                  window.dispatchEvent(
                    new CustomEvent(`sse:${currentEvent}`, { detail: parsed })
                  )
                } catch {
                  // Non-JSON data (keep-alive), ignore
                }
              }
              currentEvent = ''
              currentData = ''
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Connection lost — schedule reconnect
      }

      // Reconnect with backoff
      if (mounted && !document.hidden) {
        reconnectTimeoutRef.current = setTimeout(() => {
          backoffRef.current = Math.min(backoffRef.current * 2, 30000)
          connect()
        }, backoffRef.current)
      }
    }

    // Start connection
    connect()

    // Reconnect when tab becomes visible
    const handleVisibility = () => {
      if (!document.hidden) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        backoffRef.current = 1000
        connect()
      } else {
        // Pause: abort connection when tab is hidden
        controllerRef.current?.abort()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      mounted = false
      controllerRef.current?.abort()
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])
}
