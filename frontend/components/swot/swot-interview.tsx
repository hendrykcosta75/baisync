'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  Mic, MicOff, MessageSquare, Play, X, Send, Volume2, MonitorUp, Camera, PhoneOff,
} from 'lucide-react'
import * as THREE from 'three'
import { toJpeg } from 'html-to-image'

const mono = "'JetBrains Mono', 'Fira Code', monospace"
const NEU_SHADOW = '4px 4px 10px rgba(0,0,0,0.5), -2px -2px 8px rgba(255,255,255,0.04)'

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
    float energy = clamp((u_intensity - 1.0) / 3.0, 0.0, 1.0);

    vec2 uv = (vUv * 2.0 - 1.0);
    uv.x *= u_resolution.x / u_resolution.y;

    float breath = 1.0 + 0.10 * energy;
    uv /= breath;

    float dist = length(uv);
    float circleRadius = 0.95;
    if (dist > circleRadius) { gl_FragColor = vec4(0.0); return; }

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

    float pulse = 1.0 + 0.15 * sin(u_time * 2.0);
    color *= pulse * (1.0 + 1.3 * energy);

    float sphereShading = sqrt(1.0 - dist * dist);
    color *= sphereShading * 1.5;

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

    // preserveDrawingBuffer allows html-to-image to capture the canvas for screenshots
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
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
    <div className="flex flex-col gap-3 p-4 h-full overflow-y-auto">
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
        {(questions.options ?? []).map((opt, i) => (
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
  const [micMuted, setMicMuted] = useState(true)
  const firstTurnDoneRef = useRef(false)
  // After Sophie's `criar_analise_swot` tool fires, we keep the overlay open
  // until she finishes her closing sentence. We can't rely on `turn_complete`
  // for this — Gemini Live can fire it before the post-tool audio chunks
  // arrive, which led to "pront[cut]" when closing on that signal. Instead a
  // silence-detection watchdog polls `playbackEndRef` and closes only after
  // the audio pipeline has been idle for a stable window.
  const pendingCloseRef = useRef(false)
  const closeWatchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const safetyCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [liveStatus, setLiveStatus] = useState<'idle' | 'connecting' | 'connected' | 'closed'>('idle')
  const [audioStatus, setAudioStatus] = useState('Fale com a Sophie')
  const [sophieReady, setSophieReady] = useState(false)
  const [loadingMsgIndex, setLoadingMsgIndex] = useState(0)

  // Video-call UI state
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const chatBodyRef = useRef<HTMLDivElement>(null)
  const streamingContentRef = useRef('')
  const messagesRef = useRef<ChatMessage[]>([])
  const tabRef = useRef(tab)
  const isStreamingRef = useRef(false)
  const micMutedRef = useRef(false)
  messagesRef.current = messages
  tabRef.current = tab
  micMutedRef.current = micMuted

  // Video-call refs
  const containerRef = useRef<HTMLDivElement>(null)
  const pipVideoRef = useRef<HTMLVideoElement>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)

  // Audio analysis
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const orbIntensityRef = useRef(1.0)
  const orbRafRef = useRef(0)

  // Live session
  const wsRef = useRef<WebSocket | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const playbackEndRef = useRef(0)

  // ── Timer ──

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0')
    const s = (secs % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  useEffect(() => {
    if (!started) { setElapsed(0); return }
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [started])

  // ── Auto-open sidebar when questions arrive ──

  useEffect(() => {
    if (questions) setChatOpen(true)
  }, [questions])

  // ── PiP video source ──

  useEffect(() => {
    if (pipVideoRef.current && screenStream) {
      pipVideoRef.current.srcObject = screenStream
    }
  }, [screenStream])

  // ── Screen stream cleanup on unmount ──

  useEffect(() => {
    return () => {
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

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

  const cleanupLiveSession = useCallback(() => {
    if (closeWatchdogRef.current) {
      clearInterval(closeWatchdogRef.current)
      closeWatchdogRef.current = null
    }
    if (safetyCloseTimerRef.current) {
      clearTimeout(safetyCloseTimerRef.current)
      safetyCloseTimerRef.current = null
    }
    pendingCloseRef.current = false
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
          // Gemini tool schema uses pt-BR field names (`titulo`, `itens`,
          // `quadrante`, `conteudo`); the backend API and `handleSwotCreated`
          // expect English. Translate here — and accept either form so legacy
          // text-mode payloads still work.
          const p = msg.payload as Record<string, unknown>
          const title = typeof p.title === 'string' ? p.title : typeof p.titulo === 'string' ? p.titulo : ''
          const rawItems = (Array.isArray(p.items) ? p.items : Array.isArray(p.itens) ? p.itens : []) as Record<string, unknown>[]
          const items = rawItems
            .map((it) => {
              const quadrant = typeof it.quadrant === 'string' ? it.quadrant : typeof it.quadrante === 'string' ? it.quadrante : ''
              const content = typeof it.content === 'string' ? it.content : typeof it.conteudo === 'string' ? it.conteudo : ''
              return { quadrant, content }
            })
            .filter((it) => it.quadrant && it.content)
          if (title && items.length > 0) {
            onSwotCreated?.({ title, items })
            // Wait for Sophie's closing sentence to finish playing before
            // unmounting. Silence-detection watchdog: poll `playbackEndRef`
            // every 200ms, and close once the audio queue has been idle
            // (currentTime >= playbackEndRef) for 1.5 s AND at least 2 s
            // have passed since the tool fired (grace for chunks still in
            // flight). Safety cap at 25 s.
            pendingCloseRef.current = true
            if (closeWatchdogRef.current) clearInterval(closeWatchdogRef.current)
            if (safetyCloseTimerRef.current) clearTimeout(safetyCloseTimerRef.current)
            const startedAt = Date.now()
            let quietSince: number | null = null
            closeWatchdogRef.current = setInterval(() => {
              if (!pendingCloseRef.current) {
                if (closeWatchdogRef.current) { clearInterval(closeWatchdogRef.current); closeWatchdogRef.current = null }
                return
              }
              const ctx = audioCtxRef.current
              if (!ctx) return
              const idle = ctx.currentTime >= playbackEndRef.current - 0.05
              if (!idle) {
                quietSince = null
                return
              }
              const now = Date.now()
              if (quietSince === null) quietSince = now
              const quietFor = now - quietSince
              const totalWait = now - startedAt
              if (quietFor >= 1500 && totalWait >= 2000) {
                if (closeWatchdogRef.current) { clearInterval(closeWatchdogRef.current); closeWatchdogRef.current = null }
                if (safetyCloseTimerRef.current) { clearTimeout(safetyCloseTimerRef.current); safetyCloseTimerRef.current = null }
                pendingCloseRef.current = false
                onClose?.()
              }
            }, 200)
            safetyCloseTimerRef.current = setTimeout(() => {
              if (closeWatchdogRef.current) { clearInterval(closeWatchdogRef.current); closeWatchdogRef.current = null }
              if (pendingCloseRef.current) {
                pendingCloseRef.current = false
                onClose?.()
              }
            }, 25000)
          } else {
            console.error('[swot] malformed swot_create payload', p)
          }
        }
        break
      case 'turn_complete':
        setIsStreaming(false)
        isStreamingRef.current = false
        if (!firstTurnDoneRef.current) {
          firstTurnDoneRef.current = true
          setMicMuted(false)
        }
        // Pending close is handled by the silence-detection watchdog set up
        // in `swot_create` — don't close here. `turn_complete` fires when
        // Gemini finishes GENERATING, which can be seconds before the last
        // post-tool audio chunks arrive in the AudioContext queue.
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
  }, [enqueueAudio, onSwotCreated, onClose])

  const startLiveSession = useCallback(async () => {
    if (!wsId) return
    if (wsRef.current) return

    setLiveStatus('connecting')
    setAudioStatus('Conectando...')

    try {
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      await ctx.audioWorklet.addModule('/worklets/pcm-downsample.js')
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }

      // AudioContext.setSinkId('') asks Chrome to follow the OS default output
      // device dynamically instead of locking onto whatever was default at
      // creation time. Requires Chrome 110+. No-op if unsupported.
      const ctxWithSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> }
      if (typeof ctxWithSink.setSinkId === 'function') {
        try { await ctxWithSink.setSinkId('') } catch { /* ignore */ }
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
      const silent = ctx.createGain()
      silent.gain.value = 0
      workletNode.connect(silent)
      silent.connect(ctx.destination)

      const ticketRes = await fetch(`/api/workspaces/${wsId}/swot/interview/live-ticket`, {
        method: 'POST',
        credentials: 'same-origin',
      })
      if (!ticketRes.ok) throw new Error('ticket request failed')
      const { ticket } = await ticketRes.json() as { ticket: string }

      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const wsUrl = origin.replace(/^http/, 'ws') +
        `/api/workspaces/${wsId}/swot/interview/live?ticket=${encodeURIComponent(ticket)}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      workletNode.port.onmessage = (ev) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const buf = ev.data as ArrayBuffer
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

  const toggleMic = useCallback(() => {
    setMicMuted((m) => !m)
  }, [])

  const handleStart = useCallback(async () => {
    setStarted(true)
    if (tab === 'audio') {
      await startLiveSession()
    } else {
      setChatOpen(true)
      const initMsg = 'Iniciar entrevista SWOT'
      const userMsg: ChatMessage = { role: 'user', content: initMsg }
      setMessages([userMsg])
      await sendToBackend(initMsg, [])
    }
  }, [tab, startLiveSession, sendToBackend])

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

  const cleanContent = (text: string) => {
    return text
      .replace(/<swot-questions>[\s\S]*?<\/swot-questions>/g, '')
      .replace(/<swot-create>[\s\S]*?<\/swot-create>/g, '')
      .trim()
  }

  // ── Screen share ──

  const toggleScreenShare = useCallback(async () => {
    if (screenStream) {
      screenStream.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      setScreenStream(null)
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        stream.getVideoTracks()[0].onended = () => {
          screenStreamRef.current = null
          setScreenStream(null)
        }
        screenStreamRef.current = stream
        setScreenStream(stream)
      } catch (err) {
        if (err instanceof Error && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
          console.error('Screen share failed:', err)
        }
      }
    }
  }, [screenStream])

  // ── Screenshot ──

  const takeScreenshot = useCallback(async () => {
    if (!containerRef.current) return
    try {
      const dataUrl = await toJpeg(containerRef.current, {
        quality: 0.9,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      })
      const link = document.createElement('a')
      link.download = `entrevista-swot-${Date.now()}.jpg`
      link.href = dataUrl
      link.click()
    } catch (err) {
      console.error('Screenshot failed:', err)
    }
  }, [])

  const sidebarOpen = chatOpen || questions !== null

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] flex flex-col"
      style={{ background: '#080808' }}
    >
      {/* ── Top bar ── */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ background: '#0f0f0f', borderBottom: '1px solid #1e1e1e' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full bg-red-500"
              style={{
                animation: started ? 'blink 1.5s ease-in-out infinite' : 'none',
                opacity: started ? 1 : 0.3,
              }}
            />
            <span className="text-subtle text-xs tabular-nums" style={{ fontFamily: mono }}>
              {formatTime(elapsed)}
            </span>
          </div>
          <div className="w-px h-4" style={{ background: '#1e1e1e' }} />
          <span className="text-heading text-[13px] font-bold" style={{ fontFamily: mono }}>
            Entrevista SWOT
          </span>
          {started && liveStatus === 'connected' && (
            <span
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
              style={{
                background: 'rgba(34,197,94,0.1)',
                color: '#22c55e',
                fontFamily: mono,
                border: '1px solid rgba(34,197,94,0.2)',
              }}
            >
              <span className="w-1 h-1 rounded-full bg-green-500" />
              Ao vivo
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-subtle hover:text-heading transition-colors"
          style={{
            background: '#161616',
            boxShadow: '2px 2px 6px rgba(0,0,0,0.5), -1px -1px 4px rgba(255,255,255,0.035)',
          }}
          aria-label="Fechar"
        >
          <X size={14} />
        </button>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 min-h-0 relative overflow-hidden">

        {/* Sophie's main area */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6 relative">

          {!started ? (
            /* Pre-call state */
            <>
              {/* Sophie tile (pre-call) */}
              <div
                className="relative rounded-2xl overflow-hidden flex items-center justify-center"
                style={{
                  width: 420,
                  height: 280,
                  background: '#0d0d0d',
                  border: '1px solid #1e1e1e',
                  boxShadow: '0 0 60px rgba(255,107,44,0.05)',
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: 'radial-gradient(rgba(255,107,44,0.03) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                  }}
                />
                <InterviewOrb
                  active={false}
                  intensityRef={orbIntensityRef}
                  onPress={() => {}}
                  size={140}
                />
                <div
                  className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md"
                  style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#555' }} />
                  <span className="text-white text-[11px] font-semibold" style={{ fontFamily: mono }}>
                    Sophie · Entrevistadora de IA
                  </span>
                </div>
              </div>

              {/* Mode selector */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setTab('audio')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200"
                  style={{
                    background: tab === 'audio' ? 'rgba(255,107,44,0.12)' : '#161616',
                    border: tab === 'audio' ? '1px solid rgba(255,107,44,0.3)' : '1px solid #1e1e1e',
                    color: tab === 'audio' ? '#ff6b2c' : '#888',
                    boxShadow: NEU_SHADOW,
                    fontFamily: mono,
                  }}
                >
                  <Mic size={12} />
                  Voz
                  <span
                    className="px-1 rounded text-[8px] font-bold uppercase"
                    style={{ background: 'rgba(255,107,44,0.15)', color: '#ff6b2c' }}
                  >
                    padrão
                  </span>
                </button>
                <button
                  onClick={() => setTab('texto')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all duration-200"
                  style={{
                    background: tab === 'texto' ? 'rgba(255,107,44,0.12)' : '#161616',
                    border: tab === 'texto' ? '1px solid rgba(255,107,44,0.3)' : '1px solid #1e1e1e',
                    color: tab === 'texto' ? '#ff6b2c' : '#888',
                    boxShadow: NEU_SHADOW,
                    fontFamily: mono,
                  }}
                >
                  <MessageSquare size={12} />
                  Texto
                </button>
              </div>

              {/* Start button */}
              <button
                onClick={handleStart}
                className="flex items-center gap-2 px-8 py-3 rounded-full font-bold text-sm text-white transition-all duration-200 active:scale-[0.97]"
                style={{
                  background: '#ff6b2c',
                  boxShadow: '0 0 24px rgba(255,107,44,0.4), 4px 4px 10px rgba(0,0,0,0.5)',
                  fontFamily: mono,
                }}
              >
                <Play size={15} />
                Iniciar Entrevista
              </button>
            </>
          ) : (
            /* Active interview state */
            <>
              {/* Sophie tile */}
              <div
                className="relative rounded-2xl overflow-hidden"
                style={{
                  width: 420,
                  height: 300,
                  background: '#0d0d0d',
                  border: '1px solid #1e1e1e',
                  boxShadow: isSpeaking
                    ? '0 0 40px rgba(255,107,44,0.2), 0 0 80px rgba(255,107,44,0.08)'
                    : '0 0 20px rgba(0,0,0,0.5)',
                  transition: 'box-shadow 0.4s ease',
                }}
              >
                {/* Subtle dot grid */}
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: 'radial-gradient(rgba(255,107,44,0.03) 1px, transparent 1px)',
                    backgroundSize: '24px 24px',
                  }}
                />

                {/* Orb */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <InterviewOrb
                    active={liveStatus === 'connected' && !micMuted}
                    intensityRef={orbIntensityRef}
                    onPress={tab === 'audio' ? toggleMic : () => {}}
                    size={200}
                  />
                </div>

                {/* Loading overlay */}
                {!sophieReady && liveStatus !== 'idle' && liveStatus !== 'closed' && tab === 'audio' && (
                  <div
                    className="absolute inset-0 flex items-center justify-center"
                    style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
                  >
                    <p
                      key={loadingMsgIndex}
                      className="text-subtle text-sm text-center px-8"
                      style={{ animation: 'baisync-msg-in 0.35s ease-out', fontFamily: mono }}
                    >
                      {LOADING_MESSAGES[loadingMsgIndex % LOADING_MESSAGES.length]}
                    </p>
                  </div>
                )}

                {/* Name label */}
                <div
                  className="absolute bottom-3 left-3 flex items-center gap-1.5 px-2 py-1 rounded-md"
                  style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)' }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full transition-colors duration-300"
                    style={{ background: isSpeaking ? '#22c55e' : '#555' }}
                  />
                  <span className="text-white text-[11px] font-semibold" style={{ fontFamily: mono }}>
                    Sophie · Entrevistadora
                  </span>
                </div>

                {/* Speaking badge */}
                {isSpeaking && (
                  <div
                    className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-md"
                    style={{
                      background: 'rgba(34,197,94,0.12)',
                      border: '1px solid rgba(34,197,94,0.25)',
                      animation: 'baisync-msg-in 0.2s ease-out',
                    }}
                  >
                    <Volume2 size={11} className="text-green-400" />
                    <span className="text-green-400 text-[10px] font-bold uppercase" style={{ fontFamily: mono }}>
                      falando
                    </span>
                  </div>
                )}
              </div>

              {/* Subtitle (audio mode) */}
              {tab === 'audio' && (
                <div className="max-w-[420px] text-center px-4 min-h-[40px] flex flex-col items-center gap-2">
                  {messages.filter(m => m.role === 'assistant').slice(-1).map((msg, i) => {
                    const clean = cleanContent(msg.content)
                    if (!clean) return null
                    return (
                      <p
                        key={i}
                        className="text-body text-sm leading-relaxed"
                        style={{ opacity: 0.8 }}
                      >
                        {clean.length > 240 ? clean.slice(0, 240) + '...' : clean}
                      </p>
                    )
                  })}
                  {micMuted && liveStatus === 'connected' && sophieReady && (
                    <div className="flex items-center gap-1.5 text-xs" style={{ color: '#ef4444' }}>
                      <MicOff size={12} />
                      <span>Microfone silenciado — clique no orb para ativar</span>
                    </div>
                  )}
                  {audioStatus && !sophieReady && liveStatus === 'closed' && (
                    <p className="text-xs text-subtle">{audioStatus}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Right sidebar (questions + chat) ── */}
        {sidebarOpen && (
          <div
            className="flex flex-col shrink-0 overflow-hidden"
            style={{
              width: 300,
              background: '#111111',
              borderLeft: '1px solid #1e1e1e',
              animation: 'baisync-panel-in 0.25s cubic-bezier(0.16,1,0.3,1)',
            }}
          >
            {/* Sidebar header */}
            <div
              className="flex items-center justify-between px-4 py-3 shrink-0"
              style={{ borderBottom: '1px solid #1e1e1e' }}
            >
              <span
                className="text-[11px] font-semibold uppercase tracking-wider text-subtle"
                style={{ fontFamily: mono }}
              >
                {questions ? 'Perguntas' : 'Chat'}
              </span>
              <button
                onClick={() => { setChatOpen(false); setQuestions(null) }}
                className="text-subtle hover:text-heading transition-colors"
                aria-label="Fechar painel"
              >
                <X size={13} />
              </button>
            </div>

            {/* Sidebar body */}
            {questions ? (
              <QuestionPanel questions={questions} onSelect={handleQuestionSelect} />
            ) : (
              <>
                <div
                  ref={chatBodyRef}
                  className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-3 min-h-0"
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
                        className={`max-w-[90%] px-3 py-2.5 text-sm leading-relaxed ${
                          msg.role === 'assistant' ? 'self-start' : 'self-end'
                        }`}
                        style={{
                          background: msg.role === 'assistant' ? '#161616' : '#0f0f0f',
                          boxShadow:
                            msg.role === 'assistant'
                              ? '2px 2px 6px rgba(0,0,0,0.5), -1px -1px 4px rgba(255,255,255,0.035)'
                              : 'inset 1px 1px 4px rgba(0,0,0,0.5)',
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
                              width={10}
                              height={10}
                              stroke="#ff6b2c"
                              fill="none"
                              strokeWidth={2}
                            >
                              <path d="M12 2L9 9H2l6 4.5L5.5 21 12 16l6.5 5-2.5-7.5L22 9h-7z" />
                            </svg>
                            <span
                              className="text-[10px] font-bold"
                              style={{ color: '#ff6b2c', fontFamily: mono }}
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

                <div
                  className="flex gap-2 items-center px-4 py-3 shrink-0"
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
                    className="flex-1 px-3 py-2 rounded-[10px] text-sm text-body placeholder:text-subtle/50 outline-none transition-all duration-200"
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
                    className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 transition-all duration-200"
                    style={{
                      background: '#161616',
                      boxShadow: '3px 3px 8px rgba(0,0,0,0.5), -2px -2px 5px rgba(255,255,255,0.035)',
                      opacity: isStreaming || !inputValue.trim() ? 0.4 : 1,
                    }}
                    aria-label="Enviar"
                  >
                    <Send size={13} style={{ color: '#ff6b2c' }} />
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── User PiP tile ── */}
        <div
          className="absolute rounded-xl overflow-hidden transition-all duration-300"
          style={{
            bottom: 16,
            right: sidebarOpen ? 316 : 16,
            width: 160,
            height: 100,
            background: '#0d0d0d',
            border: '1px solid #1e1e1e',
            boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          }}
        >
          {screenStream ? (
            <video
              ref={pipVideoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-1">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: '#1e1e1e' }}
              >
                <span className="text-subtle text-sm font-bold" style={{ fontFamily: mono }}>EU</span>
              </div>
            </div>
          )}
          <div
            className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
          >
            <span className="text-white text-[10px]" style={{ fontFamily: mono }}>Você</span>
          </div>
        </div>
      </div>

      {/* ── Control bar ── */}
      {started && (
        <div
          className="flex items-center justify-center gap-3 px-6 py-4 shrink-0"
          style={{ background: '#0f0f0f', borderTop: '1px solid #1e1e1e' }}
        >
          {/* Mic */}
          <button
            onClick={toggleMic}
            disabled={tab !== 'audio' || liveStatus !== 'connected'}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 active:scale-[0.97] ${
              micMuted ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-raised text-body hover:text-heading'
            }`}
            style={{ boxShadow: NEU_SHADOW }}
            aria-label={micMuted ? 'Ativar microfone' : 'Silenciar microfone'}
            title={micMuted ? 'Ativar microfone' : 'Silenciar microfone'}
          >
            {micMuted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          {/* Screen share */}
          <button
            onClick={toggleScreenShare}
            className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 active:scale-[0.97]"
            style={{
              background: screenStream ? '#ff6b2c' : 'var(--c-raised, #161616)',
              color: screenStream ? '#fff' : undefined,
              boxShadow: NEU_SHADOW,
            }}
            aria-label="Compartilhar tela"
            title="Compartilhar tela"
          >
            <MonitorUp size={18} />
          </button>

          {/* Screenshot */}
          <button
            onClick={takeScreenshot}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-raised text-body hover:text-heading transition-all duration-200 active:scale-[0.97]"
            style={{ boxShadow: NEU_SHADOW }}
            aria-label="Tirar print"
            title="Tirar print da entrevista"
          >
            <Camera size={18} />
          </button>

          {/* Chat toggle */}
          <button
            onClick={() => setChatOpen(!chatOpen)}
            className="w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 active:scale-[0.97]"
            style={{
              background: chatOpen ? '#ff6b2c' : 'var(--c-raised, #161616)',
              color: chatOpen ? '#fff' : undefined,
              boxShadow: NEU_SHADOW,
            }}
            aria-label="Chat"
            title="Abrir chat / transcrição"
          >
            <MessageSquare size={18} />
          </button>

          <div className="w-px h-8 mx-2" style={{ background: '#1e1e1e' }} />

          {/* End call */}
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-all duration-200 active:scale-[0.97]"
            style={{ boxShadow: NEU_SHADOW }}
            aria-label="Encerrar entrevista"
            title="Encerrar entrevista"
          >
            <PhoneOff size={18} />
          </button>
        </div>
      )}
    </div>
  )
}
