'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { useChannelStore } from '@/store/useChannelStore'
import '@excalidraw/excalidraw/index.css'

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  { ssr: false },
)

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function ChannelCanvas({ channelId, canvasId }: { channelId: string; canvasId: string }) {
  const { getCanvas, updateCanvas } = useChannelStore()
  const [initialData, setInitialData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  const lastSavedRef = useRef('')
  const currentDataRef = useRef('')
  const channelIdRef = useRef(channelId)
  const canvasIdRef = useRef(canvasId)

  useEffect(() => {
    channelIdRef.current = channelId
    canvasIdRef.current = canvasId
  }, [channelId, canvasId])

  // Load canvas data
  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    currentDataRef.current = ''
    lastSavedRef.current = ''
    getCanvas(channelId, canvasId).then((canvas) => {
      if (cancelled) return
      if (canvas.canvas_data) {
        try {
          const parsed = JSON.parse(canvas.canvas_data)
          setInitialData(parsed)
          lastSavedRef.current = canvas.canvas_data
          currentDataRef.current = canvas.canvas_data
        } catch {
          setInitialData({ elements: [], appState: {} })
        }
      } else {
        setInitialData({ elements: [], appState: {} })
      }
      setLoading(false)
    }).catch(() => {
      if (!cancelled) {
        setInitialData({ elements: [], appState: {} })
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [channelId, canvasId, getCanvas])

  // Flush to backend if there are unsaved changes
  const flush = useCallback(() => {
    const data = currentDataRef.current
    if (data && data !== lastSavedRef.current) {
      lastSavedRef.current = data
      updateCanvas(channelIdRef.current, canvasIdRef.current, undefined, data)
    }
  }, [updateCanvas])

  // Auto-save every 3s + flush on unmount
  useEffect(() => {
    const timer = setInterval(flush, 3000)
    return () => {
      clearInterval(timer)
      flush()
    }
  }, [flush])

  // Capture every change into the ref (cheap, no network)
  const handleChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (elements: readonly any[], appState: any) => {
      const data = JSON.stringify({
        elements: elements.filter((e: { isDeleted?: boolean }) => !e.isDeleted),
        appState: {
          viewBackgroundColor: appState?.viewBackgroundColor,
        },
      })
      currentDataRef.current = data
    },
    [],
  )

  if (loading || !initialData) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-subtle text-xs" style={{ fontFamily: mono }}>Carregando canvas...</span>
      </div>
    )
  }

  return (
    <div className="h-full w-full" style={{ background: '#0a0a0a' }}>
      <style>{`
        .channel-canvas .HintViewer { display: none !important; }
      `}</style>
      <div className="channel-canvas h-full w-full">
        <Excalidraw
          initialData={initialData as never}
          onChange={handleChange}
          theme="dark"
          UIOptions={{
            canvasActions: {
              saveToActiveFile: false,
              loadScene: false,
              export: false,
            },
            tools: { image: false },
          }}
        />
      </div>
    </div>
  )
}
