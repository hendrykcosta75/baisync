'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  Mic, MessageSquare, Play, X, Send, Volume2,
} from 'lucide-react'
import * as THREE from 'three'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SpeechRecognitionType {
  new (): SpeechRecognitionType
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function getSpeechRecognition(): SpeechRecognitionType | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

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
    vec2 uv = (vUv * 2.0 - 1.0);
    uv.x *= u_resolution.x / u_resolution.y;
    float dist = length(uv);
    float circleRadius = 0.95;
    if (dist > circleRadius) { gl_FragColor = vec4(0.0); return; }

    vec2 q = vec2(fbm(uv + 0.1 * u_time), fbm(uv + vec2(1.0)));
    vec2 r = vec2(
      fbm(uv + 1.0 * q + vec2(1.7, 9.2) + 0.15 * u_time),
      fbm(uv + 1.0 * q + vec2(8.3, 2.8) + 0.126 * u_time)
    );
    float f = fbm(uv + r);

    vec3 color = mix(vec3(0.25, 0.06, 0.0), vec3(1.0, 0.55, 0.1), clamp(f * f * 4.0, 0.0, 1.0));
    color = mix(color, vec3(1.0, 0.78, 0.2), clamp(length(q) * length(r), 0.0, 1.0));
    color = color * (1.2 + 0.4 * sin(u_time * 2.0) * u_intensity);

    float sphereShading = sqrt(1.0 - dist * dist);
    color *= sphereShading * 1.5;
    float alpha = smoothstep(circleRadius, circleRadius - 0.05, dist);
    gl_FragColor = vec4(color, alpha);
  }
`

// ─── Orb Component ─────────────────────────────────────────────────────────

function InterviewOrb({
  active,
  onPress,
  size = 160,
}: {
  active: boolean
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
  const targetIntensity = useRef(1.0)
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
      const speed = targetIntensity.current > 1.5 ? 0.022 : 0.012
      uniforms.u_time.value += speed
      currentIntensity.current += (targetIntensity.current - currentIntensity.current) * 0.03
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
  }, [size])

  useEffect(() => {
    targetIntensity.current = active ? 2.0 : 1.0
  }, [active])

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
  const [isRecording, setIsRecording] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [audioStatus, setAudioStatus] = useState('Toque no orbe para falar')

  const chatBodyRef = useRef<HTMLDivElement>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const streamingContentRef = useRef('')
  // Use refs for latest values to avoid stale closures in callbacks
  const messagesRef = useRef<ChatMessage[]>([])
  const tabRef = useRef(tab)
  messagesRef.current = messages
  tabRef.current = tab

  const scrollToBottom = useCallback(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // ── TTS ──

  const speakText = useCallback(
    async (text: string) => {
      if (!wsId) return

      const cleanText = text.replace(/<[^>]+>/g, '').trim()
      if (!cleanText) return

      setIsSpeaking(true)
      setAudioStatus('IA respondendo...')

      try {
        const resp = await fetch(`/api/workspaces/${wsId}/swot/interview/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ text: cleanText }),
        })

        if (!resp.ok) {
          console.error('TTS error status:', resp.status)
          throw new Error('TTS request failed')
        }

        const blob = await resp.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        currentAudioRef.current = audio

        audio.onended = () => {
          setIsSpeaking(false)
          setAudioStatus('Toque no orbe para falar')
          URL.revokeObjectURL(url)
          currentAudioRef.current = null
        }

        audio.onerror = () => {
          setIsSpeaking(false)
          setAudioStatus('Toque no orbe para falar')
          URL.revokeObjectURL(url)
          currentAudioRef.current = null
        }

        await audio.play()
      } catch (err) {
        console.error('TTS error:', err)
        setIsSpeaking(false)
        setAudioStatus('Toque no orbe para falar')
      }
    },
    [wsId]
  )

  // ── Send message to backend SSE ──

  const sendToBackend = useCallback(
    async (text: string, history: ChatMessage[]) => {
      if (!wsId) return

      setIsStreaming(true)
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

        // Trigger TTS for audio tab — AI speaks immediately
        if (tabRef.current === 'audio' && fullContent) {
          speakText(fullContent)
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
      }
    },
    [wsId, speakText, onSwotCreated]
  )

  // ── STT via browser SpeechRecognition (free, no API call) ──

  const recognitionRef = useRef<SpeechRecognitionType | null>(null)

  const startRecording = useCallback(() => {
    // Stop any playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current = null
      setIsSpeaking(false)
    }

    const recognition = getSpeechRecognition()
    if (!recognition) {
      setAudioStatus('Reconhecimento de voz nao suportado neste navegador')
      return
    }

    recognition.lang = 'pt-BR'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = async (event: any) => {
      const text = event.results?.[0]?.[0]?.transcript?.trim()
      setIsRecording(false)
      recognitionRef.current = null

      if (text) {
        setAudioStatus('Processando...')
        const currentHistory = messagesRef.current
        setMessages((prev) => [...prev, { role: 'user' as const, content: text }])
        await sendToBackend(text, currentHistory)
      } else {
        setAudioStatus('Nao entendi. Toque no orbe para tentar novamente.')
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error)
      setIsRecording(false)
      recognitionRef.current = null
      if (event.error === 'not-allowed') {
        setAudioStatus('Permissao do microfone negada')
      } else {
        setAudioStatus('Erro ao ouvir. Toque no orbe para tentar novamente.')
      }
    }

    recognition.onend = () => {
      if (recognitionRef.current) {
        setIsRecording(false)
        recognitionRef.current = null
      }
    }

    recognition.start()
    recognitionRef.current = recognition
    setIsRecording(true)
    setAudioStatus('Ouvindo... fale sobre sua empresa')
  }, [sendToBackend])

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
      setIsRecording(false)
      setAudioStatus('Processando...')
    }
  }, [])

  const toggleRecording = useCallback(() => {
    if (isStreaming) return
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }, [isRecording, isStreaming, startRecording, stopRecording])

  // ── Start Interview — AI speaks immediately ──

  const handleStart = useCallback(async () => {
    setStarted(true)
    const initMsg = 'Iniciar entrevista SWOT'
    const userMsg: ChatMessage = { role: 'user', content: initMsg }
    setMessages([userMsg])
    await sendToBackend(initMsg, [])
  }, [sendToBackend])

  // ── Send text message ──

  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isStreaming) return

    setInputValue('')
    const currentHistory = messagesRef.current
    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    await sendToBackend(text, currentHistory)
  }, [inputValue, isStreaming, sendToBackend])

  // ── Handle question selection ──

  const handleQuestionSelect = useCallback(
    async (option: string) => {
      setQuestions(null)
      const currentHistory = messagesRef.current
      const userMsg: ChatMessage = { role: 'user', content: option }
      setMessages((prev) => [...prev, userMsg])
      await sendToBackend(option, currentHistory)
    },
    [sendToBackend]
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
                  active={isRecording || isSpeaking}
                  onPress={toggleRecording}
                  size={160}
                />
                <p className="text-sm text-subtle font-medium text-center">
                  {audioStatus}
                </p>
                {isSpeaking && (
                  <div className="flex items-center gap-1.5 text-xs text-subtle">
                    <Volume2 size={13} className="text-[#ff6b2c]" />
                    <span>IA falando...</span>
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
                              Nova
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
