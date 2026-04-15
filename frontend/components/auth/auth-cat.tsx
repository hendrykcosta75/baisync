'use client'

import React, { useState, useRef, useCallback, useEffect } from 'react'

type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

const ORIGINS: Record<Corner, string> = {
  'bottom-right': 'bottom right',
  'bottom-left': 'bottom left',
  'top-right': 'top right',
  'top-left': 'top left',
}

const POSITIONS: Record<Corner, React.CSSProperties> = {
  'bottom-right': { bottom: 8, right: 8 },
  'bottom-left': { bottom: 8, left: 8 },
  'top-right': { top: 8, right: 8 },
  'top-left': { top: 8, left: 8 },
}

// Pupil offset to "look at" the password input (roughly center of form)
const PUPIL_DIR: Record<Corner, { x: number; y: number }> = {
  'bottom-right': { x: -3, y: -4 },
  'bottom-left': { x: 3, y: -4 },
  'top-right': { x: -3, y: 4 },
  'top-left': { x: 3, y: 4 },
}

const PARTICLE_COLORS = ['#e85a00', '#f07020', '#d04000', '#f59060', '#c03500', '#f57830', '#e06010']

const IDLE_THOUGHTS = [
  'Miau~',
  'Zzz...',
  '*ronron*',
  'Sou fofo?',
  'Pssst!',
  'Nya~',
  '...',
  '*bocejo*',
  'Oi!',
  'Cadê meu atum?',
  '*lambe a pata*',
  'Tô entediado...',
  'Me faz carinho?',
  '*estica e boceja*',
  'Hehe~',
  'Quer brincar?',
  '*cochilar...*',
  'Miau miau miau!',
  'Sabia que gatos dormem 16h por dia?',
  '*olha pro nada*',
  'Tô te observando.',
  '*rabo balançando*',
  'Senta aqui do lado~',
  'Hoje tô carente.',
  '*pula na mesa*',
  'Cade o laser?',
]

const PEEKING_THOUGHTS = [
  'Tô vendo tudo!',
  'Hmm... 👀',
  'Senha forte hein!',
  'Eita!',
  'Ui, vi nada!',
  'Ops... 👀',
  'Isso é sua senha mesmo?',
  'Juro que não conto!',
  'Opa, não vi nada...',
  'Tá digitando o quê? 👀',
  'Segredo seguro comigo~',
  '1-2-3-4? Sério?',
  'Prometo que fecho o olho!',
  'Anotando... brincadeira!',
  'Miau! Senha exposta!',
  'Hmmm interessante...',
  '*olhos arregalados*',
  'Eu não sei ler, relaxa.',
]

function randomCornerExcept(current: Corner): Corner {
  const all: Corner[] = ['bottom-right', 'bottom-left', 'top-right', 'top-left']
  const others = all.filter((c) => c !== current)
  return others[Math.floor(Math.random() * others.length)]
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const SCALE = 0.45
const INV_SCALE = 1 / SCALE // ~2.22 — counter-scale for the bubble

export function AuthCat({
  passwordVisible = false,
  passwordFocused = false,
}: {
  passwordVisible?: boolean
  passwordFocused?: boolean
}) {
  const [corner, setCorner] = useState<Corner>('bottom-right')
  const [progress, setProgress] = useState(0)
  const [pressing, setPressing] = useState(false)
  const [exploded, setExploded] = useState(false)
  const [reviving, setReviving] = useState(false)
  const [particles, setParticles] = useState<{ id: number; style: React.CSSProperties }[]>([])
  const [blinking, setBlinking] = useState(false)
  const [thought, setThought] = useState<string | null>(null)
  const [earTwitch, setEarTwitch] = useState(false)
  const pressInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const decayInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef(0)
  const pressingRef = useRef(false)
  const particleId = useRef(0)
  const thoughtTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blinkTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  // --- Idle blink ---
  useEffect(() => {
    blinkTimer.current = setInterval(() => {
      if (pressingRef.current) return
      setBlinking(true)
      setTimeout(() => setBlinking(false), 150)
    }, 3000 + Math.random() * 2000)
    return () => { if (blinkTimer.current) clearInterval(blinkTimer.current) }
  }, [])

  // --- Thought bubbles ---
  const showThought = useCallback((text: string) => {
    setThought(text)
    setEarTwitch(true)
    setTimeout(() => setEarTwitch(false), 300)
    if (thoughtTimer.current) clearTimeout(thoughtTimer.current)
    thoughtTimer.current = setTimeout(() => setThought(null), 3000)
  }, [])

  // Periodic idle thoughts
  useEffect(() => {
    const schedule = () => setTimeout(() => {
      if (!pressingRef.current) {
        const peeking = passwordVisible && passwordFocused
        showThought(pick(peeking ? PEEKING_THOUGHTS : IDLE_THOUGHTS))
      }
      timer = schedule()
    }, 6000 + Math.random() * 5000)
    let timer = schedule()
    return () => clearTimeout(timer)
  }, [passwordVisible, passwordFocused, showThought])

  // React when user starts typing visible password
  const prevPeeking = useRef(false)
  const isPeeking = passwordVisible && passwordFocused
  useEffect(() => {
    if (isPeeking && !prevPeeking.current) {
      showThought(pick(PEEKING_THOUGHTS))
    }
    prevPeeking.current = isPeeking
  }, [isPeeking, showThought])

  // --- Press/explode logic ---
  const clearIntervals = useCallback(() => {
    if (pressInterval.current) { clearInterval(pressInterval.current); pressInterval.current = null }
    if (decayInterval.current) { clearInterval(decayInterval.current); decayInterval.current = null }
  }, [])

  const explode = useCallback(() => {
    clearIntervals()
    setExploded(true)
    setPressing(false)
    pressingRef.current = false
    setThought(null)

    const items: { id: number; style: React.CSSProperties }[] = []
    for (let i = 0; i < 30; i++) {
      const size = 4 + Math.random() * 10
      const angle = Math.random() * Math.PI * 2
      const dist = 40 + Math.random() * 80
      const tx = Math.cos(angle) * dist
      const ty = Math.sin(angle) * dist
      items.push({
        id: particleId.current++,
        style: {
          position: 'absolute',
          width: size, height: size,
          borderRadius: '50%',
          background: PARTICLE_COLORS[i % PARTICLE_COLORS.length],
          left: 140, top: 150,
          marginLeft: -size / 2, marginTop: -size / 2,
          opacity: 0, pointerEvents: 'none',
          '--tx': `${tx}px`,
          '--ty': `${ty}px`,
          animation: `authCatFlyOut ${0.5 + Math.random() * 0.4}s cubic-bezier(.2,.8,.3,1) ${Math.random() * 0.1}s forwards`,
        } as React.CSSProperties,
      })
    }
    setParticles(items)

    setTimeout(() => {
      setParticles([])
      setExploded(false)
      setReviving(true)
      setProgress(0)
      progressRef.current = 0
      setCorner((prev) => randomCornerExcept(prev))
      setTimeout(() => setReviving(false), 500)
    }, 1500)
  }, [clearIntervals])

  const startPress = useCallback(() => {
    if (exploded || reviving) return
    setPressing(true)
    pressingRef.current = true
    if (decayInterval.current) { clearInterval(decayInterval.current); decayInterval.current = null }
    if (pressInterval.current) clearInterval(pressInterval.current)
    pressInterval.current = setInterval(() => {
      if (!pressingRef.current) return
      progressRef.current = Math.min(100, progressRef.current + 2)
      setProgress(progressRef.current)
      if (progressRef.current >= 100) explode()
    }, 50)
  }, [exploded, reviving, explode])

  const endPress = useCallback(() => {
    if (exploded) return
    setPressing(false)
    pressingRef.current = false
    if (pressInterval.current) { clearInterval(pressInterval.current); pressInterval.current = null }
    if (decayInterval.current) clearInterval(decayInterval.current)
    decayInterval.current = setInterval(() => {
      if (pressingRef.current) return
      progressRef.current = Math.max(0, progressRef.current - 1)
      setProgress(progressRef.current)
      if (progressRef.current <= 0 && decayInterval.current) {
        clearInterval(decayInterval.current)
        decayInterval.current = null
      }
    }, 50)
  }, [exploded])

  useEffect(() => {
    const up = () => { if (pressingRef.current) endPress() }
    document.addEventListener('mouseup', up)
    document.addEventListener('touchend', up)
    return () => {
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchend', up)
      clearIntervals()
    }
  }, [endPress, clearIntervals])

  // --- Derived states ---
  const sq = pressing && !exploded
  const shaking = pressing && progress > 70 && !exploded
  const vis = exploded ? 0 : 1
  const revAnim = reviving ? 'authCatReveal .5s cubic-bezier(.34,1.56,.64,1) forwards' : undefined
  const peeking = isPeeking && !sq && !exploded
  const pupil = PUPIL_DIR[corner]

  // Bubble anchor — positioned relative to the 280x300 scene, counter-scaled
  const bubbleIsAbove = corner.startsWith('bottom')
  const bubbleIsRight = corner.includes('right')

  return (
    <>
      <style>{`
        @keyframes authCatFlyOut{0%{opacity:1;transform:translate(0,0) scale(1)}60%{opacity:1}100%{opacity:0;transform:translate(var(--tx),var(--ty)) scale(.2)}}
        @keyframes authCatReveal{0%{transform:scale(0);opacity:0}60%{transform:scale(1.15);opacity:1}100%{transform:scale(1);opacity:1}}
        @keyframes authCatShake{0%,100%{transform:translate(0)}25%{transform:translate(-2px,1px)}50%{transform:translate(2px,-1px)}75%{transform:translate(-1px,-2px)}}
        @keyframes authCatEarTwitch{0%,100%{transform:scale(1)}50%{transform:scale(1.15) rotate(4deg)}}
        @keyframes authCatBubbleIn{0%{opacity:0;transform:scale(.6) translateY(4px)}100%{opacity:1;transform:scale(1) translateY(0)}}
      `}</style>
      <div
        style={{
          position: 'absolute',
          ...POSITIONS[corner],
          width: 280, height: 300,
          transform: `scale(${SCALE})`,
          transformOrigin: ORIGINS[corner],
          cursor: 'pointer',
          userSelect: 'none',
          zIndex: 5,
        }}
        onMouseDown={startPress}
        onTouchStart={(e) => { e.preventDefault(); startPress() }}
      >
        {/* Thought bubble — wrapper counter-scales, inner div animates */}
        {thought && !exploded && (
          <div
            style={{
              position: 'absolute',
              ...(bubbleIsAbove ? { bottom: '100%', marginBottom: 14 } : { top: '100%', marginTop: 14 }),
              ...(bubbleIsRight ? { right: 0 } : { left: 0 }),
              transform: `scale(${INV_SCALE})`,
              transformOrigin: `${bubbleIsAbove ? 'bottom' : 'top'} ${bubbleIsRight ? 'right' : 'left'}`,
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <div
              style={{
                background: '#1a1a1a',
                border: '1px solid #2a2a2a',
                borderRadius: 12,
                padding: '7px 12px',
                fontSize: 13,
                color: '#e2e0da',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                fontWeight: 500,
                whiteSpace: 'nowrap',
                animation: 'authCatBubbleIn .3s cubic-bezier(.34,1.56,.64,1) forwards',
                boxShadow: '0 4px 16px rgba(0,0,0,.4)',
                position: 'relative',
              }}
            >
              {thought}
              {/* Tail triangle */}
              <div style={{
                position: 'absolute',
                width: 0, height: 0,
                ...(bubbleIsAbove
                  ? { top: '100%', borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid #1a1a1a' }
                  : { bottom: '100%', borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: '6px solid #1a1a1a' }
                ),
                ...(bubbleIsRight ? { right: 14 } : { left: 14 }),
              }} />
            </div>
          </div>
        )}

        {/* Scene wrapper for shake */}
        <div style={{ width: 280, height: 300, position: 'relative', animation: shaking ? 'authCatShake .08s infinite' : undefined }}>
          {/* Particles */}
          {particles.map((p) => <div key={p.id} style={p.style} />)}

          {/* Glow */}
          <div style={{
            position: 'absolute', top: 40, left: -10, right: -10, bottom: -30,
            borderRadius: '50%', background: 'radial-gradient(circle,rgba(232,90,0,.2) 0%,transparent 70%)',
            pointerEvents: 'none', opacity: vis, transition: 'opacity .4s', animation: revAnim,
          }} />

          {/* Ears */}
          {(['left', 'right'] as const).map((side) => (
            <div key={side} style={{
              position: 'absolute', width: 0, height: 0, zIndex: 1,
              top: 112, left: side === 'left' ? 67 : 213,
              transform: `rotate(${side === 'left' ? -45 : 45}deg)`,
              opacity: vis, transition: 'opacity .4s', animation: revAnim,
            }}>
              <div style={{
                position: 'absolute', width: 60, height: 30, overflow: 'hidden',
                left: -30, bottom: 0, transformOrigin: 'center bottom',
                transform: sq ? 'scale(.7)' : 'scale(1)',
                transition: 'transform .15s cubic-bezier(.34,1.56,.64,1)',
                animation: earTwitch && !sq ? 'authCatEarTwitch .3s cubic-bezier(.34,1.56,.64,1)' : undefined,
              }}>
                <div style={{ width: 60, height: 60, background: '#e85a00', borderRadius: '50%', position: 'absolute', top: 0, left: 0 }} />
                <div style={{ position: 'absolute', width: 36, height: 18, overflow: 'hidden', top: 6, left: 12 }}>
                  <div style={{ width: 36, height: 36, background: '#c04800', borderRadius: '50%', position: 'absolute', top: 0, left: 0 }} />
                </div>
              </div>
            </div>
          ))}

          {/* Face */}
          <div style={{
            position: 'absolute', top: 80, left: 30, right: 30, bottom: 10,
            borderRadius: sq ? '50% 50% 45% 45%' : '50%',
            background: 'radial-gradient(circle at 45% 40%,#f58030,#e85a00)',
            transform: sq ? 'scaleX(1.12) scaleY(0.92)' : 'scale(1)',
            transition: 'border-radius .15s cubic-bezier(.34,1.56,.64,1),transform .15s cubic-bezier(.34,1.56,.64,1),opacity .4s',
            zIndex: 2, opacity: vis, animation: revAnim,
          }}>

            {/* === Eyes === */}
            {peeking ? (
              <>
                {/* Wide open eyes looking at the input */}
                {(['left', 'right'] as const).map((side) => (
                  <div key={side} style={{
                    position: 'absolute', top: '40%',
                    ...(side === 'left' ? { left: '25%' } : { right: '25%' }),
                    width: 30, height: 30, borderRadius: '50%',
                    background: '#1a1a1a',
                    transition: 'all .25s cubic-bezier(.34,1.56,.64,1)',
                    overflow: 'hidden',
                  }}>
                    {/* White of eye */}
                    <div style={{
                      position: 'absolute', inset: 3,
                      borderRadius: '50%', background: '#fff',
                    }} />
                    {/* Pupil — shifted toward the input */}
                    <div style={{
                      position: 'absolute',
                      width: 12, height: 12, borderRadius: '50%',
                      background: '#1a1a1a',
                      top: `calc(50% - 6px + ${pupil.y}px)`,
                      left: `calc(50% - 6px + ${pupil.x}px)`,
                      transition: 'top .3s, left .3s',
                    }}>
                      {/* Glint */}
                      <div style={{
                        position: 'absolute', top: 1, right: 1,
                        width: 4, height: 4, borderRadius: '50%',
                        background: '#fff',
                      }} />
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <>
                {/* Normal squinted eyes (with blink) */}
                <div style={{
                  position: 'absolute', top: '44%',
                  width: sq ? 26 : 32,
                  height: blinking ? 2 : 6,
                  background: '#1a1a1a', borderRadius: 3, left: '28%',
                  transform: sq ? 'translateX(4px)' : undefined,
                  transition: 'width .15s, height .1s, transform .15s',
                }} />
                <div style={{
                  position: 'absolute', top: '44%',
                  width: sq ? 26 : 32,
                  height: blinking ? 2 : 6,
                  background: '#1a1a1a', borderRadius: 3, right: '28%',
                  transform: sq ? 'translateX(-4px)' : undefined,
                  transition: 'width .15s, height .1s, transform .15s',
                }} />
              </>
            )}

            {/* Mouth */}
            <div style={{
              position: 'absolute',
              top: sq ? '56%' : peeking ? '60%' : '58%',
              left: '50%', transform: 'translateX(-50%)',
              width: sq ? 22 : peeking ? 16 : 28,
              height: peeking ? 10 : 14,
              border: '3px solid #1a1a1a', borderTop: 'none',
              borderRadius: '0 0 14px 14px',
              transition: 'width .2s, top .2s, height .2s',
            }} />

            {/* Cheeks — show when peeking */}
            <div style={{
              position: 'absolute', top: '50%', width: 36, height: 24, borderRadius: '50%',
              background: 'rgba(220,80,30,.35)', left: '10%',
              opacity: sq ? 1 : peeking ? 0.7 : 0,
              transform: sq ? 'scale(1.2) translateX(-6px)' : peeking ? 'scale(1.05)' : undefined,
              transition: 'opacity .2s, transform .2s',
            }} />
            <div style={{
              position: 'absolute', top: '50%', width: 36, height: 24, borderRadius: '50%',
              background: 'rgba(220,80,30,.35)', right: '10%',
              opacity: sq ? 1 : peeking ? 0.7 : 0,
              transform: sq ? 'scale(1.2) translateX(6px)' : peeking ? 'scale(1.05)' : undefined,
              transition: 'opacity .2s, transform .2s',
            }} />
          </div>

          {/* Mini progress bar */}
          {progress > 0 && !exploded && (
            <div style={{ position: 'absolute', bottom: 0, left: 40, right: 40, height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: 'linear-gradient(90deg,#f07020,#e04500)', borderRadius: 3, transition: 'width .1s' }} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
