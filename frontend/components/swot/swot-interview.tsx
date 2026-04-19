'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  Mic, MessageSquare, Play, X, Send, Volume2,
} from 'lucide-react'
import * as THREE from 'three'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'assistant' | 'user'
  content: string
}

interface QuestionBox {
  question: string
  options: string[]
}

// ─── Three.js Orb Shaders ──────────────────────────────────────────────────

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_intensity;
  varying vec2 vUv;

  float random(in vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  float noise(in vec2 st) {
    vec2 i = floor(st);
    vec2 f = fract(st);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = random(i);
    float b = random(i + vec2(1.0, 0.0));
    float c = random(i + vec2(0.0, 1.0));
    float d = random(i + vec2(1.0, 1.0));
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(in vec2 st) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(st);
      st = rot * st * 2.0;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    // Normalize intensity: u_intensity is already >= 1.0; map to [0,1] energy.
    float energy = clamp((u_intensity - 1.0) / 3.0, 0.0, 1.0);

    vec2 uv = (vUv * 2.0 - 1.0);
    uv.x *= u_resolution.x / u_resolution.y;

    // Breathing: orb visibly expands with audio energy.
    float breath = 1.0 + 0.10 * energy;
    uv /= breath;

    float dist = length(uv);
    float circleRadius = 0.95;
    if (dist > circleRadius) { gl_FragColor = vec4(0.0); return; }

    // Audio-driven turbulence warps the noise field.
    float timeBoost = u_time * (1.0 + 0.8 * energy);
    float warp = 0.12 * energy;
    vec2 q = vec2(
      fbm(uv + 0.1 * timeBoost + vec2(warp * sin(u_time * 3.0), 0.0)),
      fbm(uv + vec2(1.0) + vec2(0.0, warp * cos(u_time * 2.4)))
    );
    vec2 r = vec2(
      fbm(uv + 1.0 * q + vec2(1.7, 9.2) + 0.15 * timeBoost),
      fbm(uv + 1.0 * q + vec2(8.3, 2.8) + 0.126 * timeBoost)
    );
    float f = fbm(uv + r + warp * q);

    vec3 baseLow  = vec3(0.25, 0.06, 0.0);
    vec3 baseMid  = vec3(1.0, 0.55, 0.1);
    vec3 baseHigh = vec3(1.0, 0.85, 0.35);

    vec3 color = mix(baseLow, baseMid, clamp(f * f * 4.0, 0.0, 1.0));
    color = mix(color, baseHigh, clamp(length(q) * length(r), 0.0, 1.0));

    // Overall brightness responds strongly to energy; sin pulse stays subtle.
    float pulse = 1.0 + 0.15 * sin(u_time * 2.0);
    color *= pulse * (1.0 + 1.3 * energy);

    float sphereShading = sqrt(1.0 - dist * dist);
    color *= sphereShading * 1.5;

    // Rim glow intensifies with energy.
    float rim = smoothstep(circleRadius - 0.22, circleRadius, dist);
    color += rim * vec3(1.0, 0.45, 0.1) * (0.45 * energy);

    float alpha = smoothstep(circleRadius, circleRadius - 0.05, dist);
    gl_FragColor = vec4(color, alpha);
  }
`

// ─── Orb Component ─────────────────────────────────────────────────────────

function InterviewOrb({
  active,
  intensityRef,
  onPress,
  size = 160,
}: {
  active: boolean
  intensityRef: React.RefObject<number>
  onPress: () => void
  size?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const uniformsRef = useRef<{
    u_time: { value: number }
    u_resolution: { value: THREE.Vector2 }
    u_intensity: { value: number }
  } | null>(null)
  const animRef = useRef<number>(0)
  const currentIntensity = useRef(1.0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = Math.min(window.devicePixelRatio, 2)
    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.setSize(size, size)
    renderer.setPixelRatio(dpr)
    rendererRef.current = renderer

    const uniforms = {
      u_time: { value: 0.0 },
      u_resolution: { value: new THREE.Vector2(size * dpr, size * dpr) },
      u_intensity: { value: 1.0 },
    }
    uniformsRef.current = uniforms

    const geometry = new THREE.PlaneGeometry(2, 2)
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms,
      transparent: true,
    })
    scene.add(new THREE.Mesh(geometry, material))

    const animate = () => {
      animRef.current = requestAnimationFrame(animate)
      const target = intensityRef.current
      const speed = target > 1.5 ? 0.028 : 0.012
      uniforms.u_time.value += speed
      // Fast attack, slow release so the orb reacts snappily to peaks
      // but decays smoothly between syllables.
      const attack = target > currentIntensity.current ? 0.45 : 0.12
      currentIntensity.current += (target - currentIntensity.current) * attack
      uniforms.u_intensity.value = currentIntensity.current
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(animRef.current)
      renderer.dispose()
      geometry.dispose()
      material.dispose()
    }
  }, [size, intensityRef])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      onClick={onPress}
      className="cursor-pointer rounded-full transition-all duration-500"
      style={{
        filter: active
          ? 'drop-shadow(0 0 36px rgba(255,107,44,0.55)) drop-shadow(0 0 70px rgba(200,100,30,0.25))'
          : 'drop-shadow(0 0 24px rgba(255,107,44,0.35)) drop-shadow(0 0 50px rgba(200,100,30,0.15))',
      }}
    />
  )
}

// ─── Question Panel ─────────────────────────────────────────────────────────

function QuestionPanel({
  questions,
  onSelect,
}: {
  questions: QuestionBox
  onSelect: (option: string) => void
}) {
  return (
    <div
      className="flex flex-col gap-3 p-4 rounded-xl h-full overflow-y-auto"
      style={{
        background: '#111111',
        border: '1px solid #1e1e1e',
        animation: 'baisync-panel-in 0.3s cubic-bezier(0.16,1,0.3,1)',
        minWidth: 260,
        maxWidth: 320,
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{
            background: 'rgba(255,107,44,0.08)',
            boxShadow: '2px 2px 6px rgba(0,0,0,0.5), -1px -1px 4px rgba(255,255,255,0.035)',
          }}
        >
          <MessageSquare size={13} style={{ color: '#ff6b2c' }} />
        </div>
        <span
          className="text-[11px] font-semibold tracking-wider uppercase text-subtle"
          style={{ fontFamily: mono }}
        >
          Perguntas
        </span>
      </div>

      <p className="text-body text-sm leading-relaxed">{questions.question}</p>

      <div className="flex flex-col gap-2 mt-1">
        {questions.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onSelect(opt)}
            className="text-left px-3 py-2.5 rounded-[10px] text-sm text-body transition-all duration-200 hover:text-heading"
            style={{
              background: '#161616',
              border: '1px solid #1e1e1e',
              boxShadow: '3px 3px 8px rgba(0,0,0,0.5), -2px -2px 6px rgba(255,255,255,0.035)',
              animationDelay: `${i * 60}ms`,
              animationFillMode: 'forwards',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,107,44,0.25)'
              e.currentTarget.style.boxShadow =
                '2px 2px 6px rgba(0,0,0,0.6), -1px -1px 4px rgba(255,255,255,0.06)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#1e1e1e'
              e.currentTarget.style.boxShadow =
                '3px 3px 8px rgba(0,0,0,0.5), -2px -2px 6px rgba(255,255,255,0.035)'
            }}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Main Interview Component ───────────────────────────────────────────────

export default function SwotInterview({
  onClose,
  onSwotCreated,
}: {
  onClose: () => void
  onSwotCreated?: (data: { title: string; items: { quadrant: string; content: string }[] }) => void
}) {
  const { activeWorkspace } = useWorkspaceStore()
  const wsId = activeWorkspace?.workspace_id || ''

  const [started, setStarted] = useState(false)
  const [tab, setTab] = useState<'audio' | 'texto'>('audio')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [questions, setQuestions] = useState<QuestionBox | null>(null)
  const [isSpeaking, setIsSpeaking] = useState(false)
  // Mic starts muted so Sophie's opening turn isn't interrupted by silence
  // being captured while she speaks (Gemini VAD treats any audio as a
  // user interruption). Auto-unmutes after her first turnComplete.
  const [micMuted, setMicMuted] = useState(true)
  const firstTurnDoneRef = useRef(false)
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'closed'>('idle')
  const [audioStatus, setAudioStatus] = useState('Fale com a Sophie')
  const [sophieReady, setSophieReady] = useState(false)
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0)

  const chatBodyRef = useRef<HTMLDivElement>(null)
  const streamingContentRef = useRef('')
  // Use refs for latest values to avoid stale closures in callbacks
  const messagesRef = useRef<ChatMessage[]>([])
  const tabRef = useRef(tab)
  const isStreamingRef = useRef(false)
  const micMutedRef = useRef(false)
  messagesRef.current = messages
  tabRef.current = tab
  micMutedRef.current = micMuted

  // Audio analysis (orb reactivity)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const orbIntensityRef = useRef(1.0)
  const orbRafRef = useRef(0)

  // Live session
  const wsRef = useRef<WebSocket | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const playbackEndRef = useRef(0)

  const startAnalysis = useCallback(() => {
    cancelAnimationFrame(orbRafRef.current)
    const data = new Uint8Array(512)

    const tick = () => {
      const analyser = analyserRef.current
      if (!analyser) {
        orbIntensityRef.current = 1.0
        return
      }

      analyser.getByteTimeDomainData(data)
      let sum = 0
      let peak = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
        const abs = v < 0 ? -v : v
        if (abs > peak) peak = abs
      }
      const rms = Math.sqrt(sum / data.length)
      // Blend RMS (body/volume) with peak (attack/transients) for a lively
      // response. Non-linear curve gives big swings for loud audio without
      // collapsing quiet parts to zero.
      const mix = rms * 0.6 + peak * 0.4
      const shaped = Math.pow(mix, 0.7) * 6.0
      orbIntensityRef.current = 1.0 + Math.min(shaped, 3.5)
      orbRafRef.current = requestAnimationFrame(tick)
    }
    tick()
  }, [])

  const scrollToBottom = useCallback(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // ── Live session (Google AI Studio Live API via backend WS proxy) ──

  const cleanupLiveSession = useCallback(() => {
    try { wsRef.current?.close() } catch { /* ignore */ }
    wsRef.current = null
    try {
      workletNodeRef.current?.disconnect()
      workletNodeRef.current?.port.close()
    } catch { /* ignore */ }
    workletNodeRef.current = null
    try {
      micStreamRef.current?.getTracks().forEach((t) => t.stop())
    } catch { /* ignore */ }
    micStreamRef.current = null
    try { audioCtxRef.current?.close() } catch { /* ignore */ }
    audioCtxRef.current = null
    analyserRef.current = null
    cancelAnimationFrame(orbRafRef.current)
    orbIntensityRef.current = 1.0
    playbackEndRef.current = 0
    firstTurnDoneRef.current = false
    setIsSpeaking(false)
    setSophieReady(false)
    setMicMuted(true)
  }, [])

  const enqueueAudio = useCallback((b64: string, mimeType?: string) => {
    const ctx = audioCtxRef.current
    const analyser = analyserRef.current
    if (!ctx || !analyser) return

    // Parse sample rate from mimeType (e.g. "audio/pcm;rate=24000"). Google
    // returns 24 kHz for native-audio models and 16 kHz for cascaded Live
    // models — decoding at the wrong rate pitches/mutes the playback.
    let outRate = 24000
    if (mimeType) {
      const m = mimeType.match(/rate=(\d+)/)
      if (m) outRate = parseInt(m[1], 10) || 24000
    }

    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)

    const view = new DataView(bytes.buffer)
    const sampleCount = Math.floor(bytes.byteLength / 2)
    if (sampleCount === 0) return
    const floats = new Float32Array(sampleCount)
    for (let i = 0; i < sampleCount; i++) {
      floats[i] = view.getInt16(i * 2, true) / 32768
    }

    const audioBuf = ctx.createBuffer(1, sampleCount, outRate)
    audioBuf.copyToChannel(floats, 0)

    const source = ctx.createBufferSource()
    source.buffer = audioBuf
    source.connect(analyser)

    const startAt = Math.max(ctx.currentTime, playbackEndRef.current)
    source.start(startAt)
    playbackEndRef.current = startAt + audioBuf.duration
    setIsSpeaking(true)
    setSophieReady(true)
    source.onended = () => {
      if (ctx.currentTime >= playbackEndRef.current - 0.02) {
        setIsSpeaking(false)
      }
    }
  }, [])

  const handleLiveMessage = useCallback((raw: string) => {
    let msg: { type: string; data?: string; mimeType?: string; role?: string; text?: string; message?: string; payload?: unknown }
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    switch (msg.type) {
      case 'ready':
        // Backend auto-primes Sophie's greeting right after setupComplete.
        setIsStreaming(true)
        isStreamingRef.current = true
        break
      case 'audio':
        if (msg.data) enqueueAudio(msg.data, msg.mimeType)
        break
      case 'transcript': {
        const role = msg.role as 'assistant' | 'user' | undefined
        const text = msg.text
        if (!role || !text) break
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last && last.role === role) {
            updated[updated.length - 1] = { ...last, content: last.content + text }
          } else {
            updated.push({ role, content: text })
          }
          return updated
        })
        break
      }
      case 'questions':
        if (msg.payload && typeof msg.payload === 'object') {
          setQuestions(msg.payload as QuestionBox)
        }
        break
      case 'swot_create':
        if (msg.payload && typeof msg.payload === 'object') {
          onSwotCreated?.(msg.payload as { title: string; items: { quadrant: string; content: string }[] })
        }
        break
      case 'turn_complete':
        setIsStreaming(false)
        isStreamingRef.current = false
        // Auto-unmute mic after Sophie's first complete turn so the user
        // can start the conversation. Keep starting muted to stop VAD from
        // interrupting the greeting.
        if (!firstTurnDoneRef.current) {
          firstTurnDoneRef.current = true
          setMicMuted(false)
        }
        break
      case 'interrupted': {
        const ctx = audioCtxRef.current
        if (ctx) playbackEndRef.current = ctx.currentTime
        setIsSpeaking(false)
        break
      }
      case 'error': {
        const detail = msg.message || 'Erro desconhecido da API'
        console.error('Live API error:', detail)
        setAudioStatus(`Erro: ${detail.slice(0, 120)}`)
        setIsStreaming(false)
        isStreamingRef.current = false
        break
      }
    }
  }, [enqueueAudio, onSwotCreated])

  const startLiveSession = useCallback(async () => {
    if (!wsId) return
    if (wsRef.current) return

    setLiveStatus('connecting')
    setAudioStatus('Conectando...')

    try {
      // 1. Audio setup — must happen while the user-gesture context is still
      // fresh so the AudioContext starts in "running" state. Creating the
      // AudioWorkletNode on a suspended context throws "No execution context
      // available", hence the explicit resume() before instantiation.
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      await ctx.audioWorklet.addModule('/worklets/pcm-downsample.js')
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream

      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.2
      analyser.connect(ctx.destination)
      analyserRef.current = analyser
      startAnalysis()

      const micSource = ctx.createMediaStreamSource(stream)
      const workletNode = new AudioWorkletNode(ctx, 'pcm-downsample')
      workletNodeRef.current = workletNode
      micSource.connect(workletNode)
      // Silent sink keeps the worklet scheduled without audible feedback.
      const silent = ctx.createGain()
      silent.gain.value = 0
      workletNode.connect(silent)
      silent.connect(ctx.destination)

      // 2. Ticket + WebSocket.
      const ticketRes = await fetch(`/api/workspaces/${wsId}/swot/interview/live-ticket`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!ticketRes.ok) throw new Error('ticket request failed')
      const { ticket } = await ticketRes.json() as { ticket: string }

      // Same-origin: next.config.ts rewrites forward the WS upgrade to the
      // Rust backend in dev and prod.
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const wsUrl = origin.replace(/^http/, 'ws') +
        `/api/workspaces/${wsId}/swot/interview/live?ticket=${encodeURIComponent(ticket)}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      workletNode.port.onmessage = (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const buf = ev.data as ArrayBuffer
        // Keep streaming even when muted: Google Live API closes the
        // connection (Policy: "client failed to close") if audio stops
        // mid-session. Silence is ignored by VAD, so zero-filled frames
        // are safe and preserve user privacy.
        const bytes = micMutedRef.current
          ? new Uint8Array(buf.byteLength)
          : new Uint8Array(buf)
        let bin = ''
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        ws.send(JSON.stringify({ type: 'audio', data: btoa(bin) }))
      }

      ws.onopen = () => {
        setLiveStatus('connected')
        setAudioStatus('Fale com a Sophie')
      }
      ws.onmessage = (ev) => handleLiveMessage(ev.data)
      ws.onerror = () => {
        setAudioStatus('Erro de conexão')
      }
      ws.onclose = () => {
        setLiveStatus('closed')
        cleanupLiveSession()
      }
    } catch (err) {
      console.error('Failed to start live session:', err)
      const msg = err instanceof Error && err.name === 'NotAllowedError'
        ? 'Permissão do microfone negada'
        : 'Falha ao conectar. Tente novamente.'
      setAudioStatus(msg)
      setLiveStatus('closed')
      cleanupLiveSession()
    }
  }, [wsId, startAnalysis, handleLiveMessage, cleanupLiveSession])

  useEffect(() => () => cleanupLiveSession(), [cleanupLiveSession])

  // Rotate through loading messages while waiting for Sophie's first audio.
  useEffect(() => {
    const loading = !sophieReady && liveStatus !== 'closed' && liveStatus !== 'idle'
    if (!loading) {
      setLoadingMsgIndex(0)
      return
    }
    const id = setInterval(() => {
      setLoadingMsgIndex((i) => i + 1)
    }, 2200)
    return () => clearInterval(id)
  }, [sophieReady, liveStatus])

  const LOADING_MESSAGES = [
    'Iniciando entrevista...',
    'Sophie está se preparando...',
    'Quase lá...',
    'Aquecendo os microfones...',
    'Organizando as perguntas...',
  ]

  const sendTextToLive = useCallback((text: string) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return false
    ws.send(JSON.stringify({ type: 'text', text }))
    setIsStreaming(true)
    isStreamingRef.current = true
    return true
  }, [])

  // ── Send message to backend SSE ──

  const sendToBackend = useCallback(
    async (text: string, history: ChatMessage[]) => {
      if (!wsId) return

      setIsStreaming(true)
      isStreamingRef.current = true
      streamingContentRef.current = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      try {
        const resp = await fetch(`/api/workspaces/${wsId}/swot/interview/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ message: text, history }),
        })

        if (!resp.ok) {
          const errBody = await resp.text().catch(() => '')
          console.error('Chat error:', resp.status, errBody)
          // Try to extract error message
          let errorMsg = 'Erro ao conectar. Tente novamente.'
          try {
            const errJson = JSON.parse(errBody)
            if (errJson.error?.includes('quota')) {
              errorMsg = 'Limite da API atingido. Verifique a chave BAISYNC_API_KEY no .env.'
            } else if (errJson.error) {
              errorMsg = errJson.error
            }
          } catch { /* ignore */ }
          throw new Error(errorMsg)
        }

        const reader = resp.body?.getReader()
        if (!reader) throw new Error('No reader')

        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
        let currentEvent = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed === '') {
              currentEvent = ''
              continue
            }

            if (trimmed.startsWith('event:')) {
              currentEvent = trimmed.slice(6).trim()
              continue
            }

            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '{}' || data === '' || data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data)

              if (currentEvent === 'token' && parsed.text !== undefined) {
                fullContent += parsed.text
                streamingContentRef.current = fullContent
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: fullContent }
                  }
                  return updated
                })
              } else if (currentEvent === 'questions' && parsed.question !== undefined) {
                setQuestions(parsed)
              } else if (currentEvent === 'swot_create' && parsed.title !== undefined) {
                onSwotCreated?.(parsed)
              } else if (currentEvent === 'error' && parsed.error) {
                setMessages((prev) => {
                  const updated = [...prev]
                  const last = updated[updated.length - 1]
                  if (last?.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, content: parsed.error }
                  }
                  return updated
                })
              }
            } catch {
              // ignore parse errors
            }
          }
        }

      } catch (err) {
        console.error('Interview chat error:', err)
        const errMsg = err instanceof Error ? err.message : 'Erro ao conectar. Tente novamente.'
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: errMsg }
          }
          return updated
        })
      } finally {
        setIsStreaming(false)
        isStreamingRef.current = false
      }
    },
    [wsId, onSwotCreated]
  )

  // ── Mic toggle (audio mode) ──

  const toggleMic = useCallback(() => {
    setMicMuted((m) => !m)
  }, [])

  // ── Start Interview — branches on selected mode ──

  const handleStart = useCallback(async () => {
    setStarted(true)
    if (tab === 'audio') {
      await startLiveSession()
    } else {
      const initMsg = 'Iniciar entrevista SWOT'
      const userMsg: ChatMessage = { role: 'user', content: initMsg }
      setMessages([userMsg])
      await sendToBackend(initMsg, [])
    }
  }, [tab, startLiveSession, sendToBackend])

  // ── Send text message ──

  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isStreaming) return

    setInputValue('')
    const currentHistory = messagesRef.current
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])

    if (sendTextToLive(text)) return
    await sendToBackend(text, currentHistory)
  }, [inputValue, isStreaming, sendTextToLive, sendToBackend])

  // ── Handle question selection ──

  const handleQuestionSelect = useCallback(
    async (option: string) => {
      setQuestions(null)
      const currentHistory = messagesRef.current
      setMessages((prev) => [...prev, { role: 'user' as const, content: option }])

      if (sendTextToLive(option)) return
      await sendToBackend(option, currentHistory)
    },
    [sendTextToLive, sendToBackend]
  )

  // ── Clean display text (strip XML tags) ──

  const cleanContent = (text: string) => {
    return text
      .replace(/<swot-questions>[\s\S]*?<\/swot-questions>/g, '')
      .replace(/<swot-create>[\s\S]*?<\/swot-create>/g, '')
      .trim()
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 rounded-xl overflow-hidden"
      style={{
        background: '#111111',
        boxShadow:
          '6px 6px 16px rgba(0,0,0,0.5), -4px -4px 10px rgba(255,255,255,0.035)',
        animation: 'baisync-panel-in 0.45s cubic-bezier(0.16,1,0.3,1)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 shrink-0"
        style={{ borderBottom: '1px solid #1e1e1e' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: '#161616',
              boxShadow:
                '2px 2px 6px rgba(0,0,0,0.5), -1px -1px 4px rgba(255,255,255,0.035)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={14}
              height={14}
              stroke="#ff6b2c"
              fill="none"
              strokeWidth={2}
            >
              <path d="M12 2L9 9H2l6 4.5L5.5 21 12 16l6.5 5-2.5-7.5L22 9h-7z" />
            </svg>
          </div>
          <div>
            <h4
              className="text-heading text-[13px] font-bold"
              style={{ fontFamily: mono }}
            >
              Entrevista SWOT com IA
            </h4>
            {started && (
              <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-green-500"
                  style={{ animation: 'blink 1.5s ease-in-out infinite' }}
                />
                Entrevista em andamento
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-subtle hover:text-heading transition-colors p-1"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex shrink-0" style={{ borderBottom: '1px solid #1e1e1e' }}>
        <button
          onClick={() => setTab('audio')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors duration-200 ${
            tab === 'audio'
              ? 'text-[#ff6b2c]'
              : 'text-subtle hover:text-heading'
          }`}
          style={{
            borderBottom: tab === 'audio' ? '2px solid #ff6b2c' : '2px solid transparent',
          }}
        >
          <Mic size={13} />
          Audio
          <span
            className="px-1.5 py-0 rounded text-[8px] font-bold uppercase tracking-wider"
            style={{
              background: 'rgba(255,107,44,0.12)',
              color: '#ff6b2c',
            }}
          >
            padrao
          </span>
        </button>
        <button
          onClick={() => setTab('texto')}
          className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-colors duration-200 ${
            tab === 'texto'
              ? 'text-[#ff6b2c]'
              : 'text-subtle hover:text-heading'
          }`}
          style={{
            borderBottom: tab === 'texto' ? '2px solid #ff6b2c' : '2px solid transparent',
          }}
        >
          <MessageSquare size={13} />
          Texto
        </button>
      </div>

      {/* Content Area */}
      {!started ? (
        /* Start Screen */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-10">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: '#161616',
              boxShadow:
                '4px 4px 12px rgba(0,0,0,0.5), -3px -3px 8px rgba(255,255,255,0.035)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={26}
              height={26}
              stroke="#ff6b2c"
              fill="none"
              strokeWidth={1.5}
            >
              <path d="M12 2L9 9H2l6 4.5L5.5 21 12 16l6.5 5-2.5-7.5L22 9h-7z" />
            </svg>
          </div>
          <h3
            className="text-heading text-base font-bold"
            style={{ fontFamily: mono }}
          >
            Pronto para comecar
          </h3>
          <p className="text-subtle text-sm text-center max-w-sm leading-relaxed">
            A IA conduzira perguntas estrategicas para mapear forcas, fraquezas,
            oportunidades e ameacas da sua empresa.
          </p>
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-6 py-2.5 rounded-[10px] font-bold text-sm mt-2 transition-all duration-200"
            style={{
              color: '#ff6b2c',
              background: '#161616',
              fontFamily: mono,
              boxShadow:
                '4px 4px 10px rgba(0,0,0,0.5), -3px -3px 7px rgba(255,255,255,0.035)',
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.boxShadow =
                'inset 2px 2px 6px rgba(0,0,0,0.5), inset -2px -2px 4px rgba(255,255,255,0.035)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.boxShadow =
                '4px 4px 10px rgba(0,0,0,0.5), -3px -3px 7px rgba(255,255,255,0.035)'
            }}
          >
            <Play size={15} />
            Iniciar Entrevista
          </button>
        </div>
      ) : (
        /* Active Interview */
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Question Panel (left side) */}
          {questions && (
            <div className="shrink-0 p-3" style={{ borderRight: '1px solid #1e1e1e' }}>
              <QuestionPanel questions={questions} onSelect={handleQuestionSelect} />
            </div>
          )}

          {/* Main content (right side) */}
          <div className="flex flex-col flex-1 min-h-0">
            {tab === 'audio' ? (
              /* Audio View */
              <div className="flex-1 flex flex-col items-center justify-center gap-5 px-6 py-6">
                <InterviewOrb
                  active={liveStatus === 'connected' && !micMuted}
                  intensityRef={orbIntensityRef}
                  onPress={toggleMic}
                  size={160}
                />
                <p
                  key={`status-${loadingMsgIndex}-${sophieReady}`}
                  className="text-sm text-subtle font-medium text-center"
                  style={{ animation: 'baisync-msg-in 0.35s ease-out' }}
                >
                  {!sophieReady && liveStatus !== 'closed'
                    ? LOADING_MESSAGES[loadingMsgIndex % LOADING_MESSAGES.length]
                    : audioStatus}
                </p>
                {isSpeaking && (
                  <div className="flex items-center gap-1.5 text-xs text-subtle">
                    <Volume2 size={13} className="text-[#ff6b2c]" />
                    <span>Sophie está falando...</span>
                  </div>
                )}
                {liveStatus === 'connected' && sophieReady && micMuted && (
                  <div className="flex items-center gap-1.5 text-xs text-subtle">
                    <Mic size={13} className="text-red-500" />
                    <span>Microfone silenciado</span>
                  </div>
                )}

                {/* Show last messages in audio mode as subtitle */}
                {messages.length > 0 && (
                  <div className="w-full max-w-md mt-2 max-h-24 overflow-y-auto">
                    {messages.filter(m => m.role === 'assistant').slice(-1).map((msg, i) => {
                      const clean = cleanContent(msg.content)
                      if (!clean) return null
                      return (
                        <p
                          key={i}
                          className="text-xs text-subtle text-center leading-relaxed px-4"
                          style={{ opacity: 0.7 }}
                        >
                          {clean.length > 200 ? clean.slice(0, 200) + '...' : clean}
                        </p>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              /* Text View */
              <>
                <div
                  ref={chatBodyRef}
                  className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3 min-h-0"
                  style={{
                    scrollbarWidth: 'thin',
                    scrollbarColor: 'rgba(255,255,255,0.06) transparent',
                  }}
                >
                  {messages.map((msg, i) => {
                    if (msg.role === 'user' && msg.content === 'Iniciar entrevista SWOT') return null
                    const displayContent = msg.role === 'assistant' ? cleanContent(msg.content) : msg.content
                    if (!displayContent) return null

                    return (
                      <div
                        key={i}
                        className={`max-w-[78%] px-4 py-3 rounded-xl text-sm leading-relaxed ${
                          msg.role === 'assistant' ? 'self-start' : 'self-end'
                        }`}
                        style={{
                          background:
                            msg.role === 'assistant' ? '#161616' : '#0f0f0f',
                          boxShadow:
                            msg.role === 'assistant'
                              ? '2px 2px 6px rgba(0,0,0,0.5), -1px -1px 4px rgba(255,255,255,0.035)'
                              : 'inset 1px 1px 4px rgba(0,0,0,0.5), inset -1px -1px 3px rgba(255,255,255,0.035)',
                          borderRadius:
                            msg.role === 'assistant'
                              ? '12px 12px 12px 3px'
                              : '12px 12px 3px 12px',
                          animation: 'baisync-msg-in 0.2s ease-out',
                        }}
                      >
                        {msg.role === 'assistant' && (
                          <div className="flex items-center gap-1 mb-1">
                            <svg
                              viewBox="0 0 24 24"
                              width={11}
                              height={11}
                              stroke="#ff6b2c"
                              fill="none"
                              strokeWidth={2}
                            >
                              <path d="M12 2L9 9H2l6 4.5L5.5 21 12 16l6.5 5-2.5-7.5L22 9h-7z" />
                            </svg>
                            <span
                              className="text-[10px] font-bold"
                              style={{ color: '#ff6b2c' }}
                            >
                              Sophie
                            </span>
                          </div>
                        )}
                        <span className="text-body whitespace-pre-wrap">{displayContent}</span>
                      </div>
                    )
                  })}

                  {isStreaming && (
                    <div className="flex gap-1 items-center p-2 self-start">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            background: '#ff6b2c',
                            opacity: 0.3,
                            animation: `typing-dot 1.4s ease-in-out infinite ${i * 0.2}s`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Text Input */}
                <div
                  className="flex gap-2.5 items-center px-5 py-3 shrink-0"
                  style={{ borderTop: '1px solid #1e1e1e' }}
                >
                  <input
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSend()
                      }
                    }}
                    placeholder="Digite sua resposta..."
                    disabled={isStreaming}
                    className="flex-1 px-3.5 py-2.5 rounded-[10px] text-sm text-body placeholder:text-subtle/50 outline-none transition-all duration-200"
                    style={{
                      background: '#0f0f0f',
                      boxShadow:
                        'inset 2px 2px 5px rgba(0,0,0,0.5), inset -1px -1px 3px rgba(255,255,255,0.035)',
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.boxShadow =
                        'inset 2px 2px 5px rgba(0,0,0,0.5), inset -1px -1px 3px rgba(255,255,255,0.035), 0 0 0 1px rgba(255,107,44,0.15)'
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.boxShadow =
                        'inset 2px 2px 5px rgba(0,0,0,0.5), inset -1px -1px 3px rgba(255,255,255,0.035)'
                    }}
                  />
                  <button
                    onClick={handleSend}
                    disabled={isStreaming || !inputValue.trim()}
                    className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-200"
                    style={{
                      background: '#161616',
                      boxShadow:
                        '3px 3px 8px rgba(0,0,0,0.5), -2px -2px 5px rgba(255,255,255,0.035)',
                      opacity: isStreaming || !inputValue.trim() ? 0.4 : 1,
                    }}
                  >
                    <Send size={14} style={{ color: '#ff6b2c' }} />
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
