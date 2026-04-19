'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

export type UsePixelAudio = {
  levels: number[]
  peak: number
  source: 'mic' | 'simulated'
  error: string | null
}

export function usePixelAudio({ enabled }: { enabled: boolean }): UsePixelAudio {
  const [levels, setLevels] = useState<number[]>(() => new Array(32).fill(0))
  const [peak, setPeak] = useState(0)
  const [source, setSource] = useState<'mic' | 'simulated'>('simulated')
  const [error, setError] = useState<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false

    const tickMic = () => {
      const a = analyserRef.current
      if (!a) return
      const arr = new Uint8Array(a.frequencyBinCount)
      a.getByteFrequencyData(arr)
      const bars = 32
      const out = new Array<number>(bars)
      const useBins = Math.floor(arr.length * 0.7)
      const step = useBins / bars
      let p = 0
      for (let i = 0; i < bars; i++) {
        let sum = 0
        const from = Math.floor(i * step)
        const to = Math.floor((i + 1) * step)
        for (let j = from; j < to; j++) sum += arr[j]
        const v = (sum / (to - from || 1)) / 255
        out[i] = v
        if (v > p) p = v
      }
      setLevels(out)
      setPeak(p)
      rafRef.current = requestAnimationFrame(tickMic)
    }

    const tickSim = () => {
      const t0 = performance.now()
      const loop = (t: number) => {
        const dt = (t - t0) / 1000
        const bars = 32
        const out = new Array<number>(bars)
        let p = 0
        for (let i = 0; i < bars; i++) {
          const x = i / bars
          const env = Math.sin(dt * 1.6 + x * 4) * 0.5 + 0.5
          const noise = Math.sin(dt * 6 + i * 1.3) * 0.25 + Math.sin(dt * 11 + i) * 0.15
          const v = Math.max(0, Math.min(1, env * 0.55 + noise * 0.5 + 0.1 * Math.random()))
          out[i] = v
          if (v > p) p = v
        }
        setLevels(out)
        setPeak(p)
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    }

    const boot = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AC()
        const src = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 128
        analyser.smoothingTimeConstant = 0.72
        src.connect(analyser)
        ctxRef.current = ctx
        analyserRef.current = analyser
        streamRef.current = stream
        setSource('mic')
        setError(null)
        tickMic()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'microfone negado')
        setSource('simulated')
        tickSim()
      }
    }

    boot()

    return () => {
      cancelled = true
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      if (ctxRef.current) void ctxRef.current.close()
      rafRef.current = null
      analyserRef.current = null
      streamRef.current = null
      ctxRef.current = null
      setLevels(new Array(32).fill(0))
      setPeak(0)
    }
  }, [enabled])

  return { levels, peak, source, error }
}

export type PixelVisualizerProps = {
  levels: number[]
  peak: number
  pixelSize?: number
  width?: number
  height?: number
  color?: string
  active?: boolean
}

export function PixelVisualizer({
  levels,
  peak,
  pixelSize = 5,
  width = 320,
  height = 60,
  color = '#ff6b2c',
  active = true,
}: PixelVisualizerProps) {
  const cols = Math.floor(width / pixelSize)
  const rows = Math.floor(height / pixelSize)
  const downsampled = useMemo(() => {
    const out = new Array<number>(cols)
    for (let i = 0; i < cols; i++) {
      const srcIdx = Math.floor((i / cols) * levels.length)
      out[i] = levels[srcIdx] || 0
    }
    return out
  }, [levels, cols])

  const glow = `0 0 ${4 + peak * 24}px rgba(255,107,44,${0.15 + peak * 0.35})`

  const cells: React.ReactNode[] = []
  for (let x = 0; x < cols; x++) {
    const v = active ? downsampled[x] : 0
    const filled = Math.round(v * rows)
    for (let y = 0; y < rows; y++) {
      const isOn = rows - 1 - y < filled
      if (!isOn) continue
      const heat = (rows - 1 - y) / rows
      const bright = 0.45 + heat * 0.55
      cells.push(
        <div
          key={`${x}-${y}`}
          style={{
            position: 'absolute',
            left: x * pixelSize,
            top: y * pixelSize,
            width: pixelSize - 1,
            height: pixelSize - 1,
            background: color,
            opacity: bright,
            boxShadow: heat > 0.7 ? `0 0 ${pixelSize}px ${color}` : 'none',
          }}
        />,
      )
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        width: cols * pixelSize,
        height: rows * pixelSize,
        boxShadow: active ? glow : 'none',
        transition: 'box-shadow 120ms linear',
      }}
      aria-hidden="true"
    >
      <div
        style={{
          position: 'absolute', inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 3px)',
          pointerEvents: 'none',
        }}
      />
      {cells}
    </div>
  )
}
