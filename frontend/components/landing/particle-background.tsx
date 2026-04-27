'use client';

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hueShift: number;
  seed: number;
}

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);

    function resize() {
      if (!canvas || !ctx) return;
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = Math.max(1, Math.floor(W * DPR));
      canvas.height = Math.max(1, Math.floor(H * DPR));
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    resize();
    window.addEventListener('resize', resize);

    function handleMove(e: MouseEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const inside =
        x >= 0 && x <= rect.width && y >= 0 && y <= rect.height;
      mouseRef.current = { x, y, active: inside };
    }
    function handleLeave() {
      mouseRef.current.active = false;
    }
    window.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseleave', handleLeave);

    const N = 320;
    const particles: Particle[] = [];
    for (let i = 0; i < N; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: rand(-0.2, 0.2),
        vy: rand(-0.2, 0.2),
        r: rand(0.5, 2.0),
        hueShift: rand(-12, 18),
        seed: Math.random() * 1000,
      });
    }

    let raf = 0;

    function step(t: number) {
      if (!ctx) return;

      // Autonomous attractor — slow elliptical orbit
      const ambX = W * 0.5 + Math.cos(t * 0.0003) * W * 0.25;
      const ambY = H * 0.5 + Math.sin(t * 0.00045) * H * 0.25;
      const m = mouseRef.current;
      const ax = m.active ? m.x : ambX;
      const ay = m.active ? m.y : ambY;

      // Trail fade
      ctx.fillStyle = 'rgba(13,9,7,0.16)';
      ctx.fillRect(0, 0, W, H);

      for (const p of particles) {
        // Curl-noise-ish flow field
        const fx = Math.sin(p.y * 0.006 + t * 0.0003 + p.seed * 0.001) * 0.06;
        const fy = Math.cos(p.x * 0.006 + t * 0.0003 + p.seed * 0.001) * 0.06;
        p.vx += fx;
        p.vy += fy;

        const dx = ax - p.x;
        const dy = ay - p.y;
        const d = Math.hypot(dx, dy) + 0.001;

        if (m.active) {
          // Close range: repel from cursor (creates a wake)
          if (d < 70) {
            p.vx -= (dx / d) * (1 - d / 70) * 0.9;
            p.vy -= (dy / d) * (1 - d / 70) * 0.9;
          } else if (d < 220) {
            // Medium range: gentle drift toward cursor
            p.vx += (dx / d) * 0.05;
            p.vy += (dy / d) * 0.05;
          }
        } else if (d < 280) {
          // Idle: soft pull toward the orbital attractor
          p.vx += (dx / d) * 0.025 * (1 - d / 280);
          p.vy += (dy / d) * 0.025 * (1 - d / 280);
        }

        p.vx *= 0.93;
        p.vy *= 0.93;
        p.x += p.vx;
        p.y += p.vy;

        // Wrap
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;
        if (p.y < -10) p.y = H + 10;
        if (p.y > H + 10) p.y = -10;

        const speed = Math.min(Math.hypot(p.vx, p.vy), 4);
        const lightness = Math.min(48 + speed * 12 + p.hueShift, 72);
        const alpha = 0.32 + Math.min(speed * 0.18, 0.55);
        ctx.beginPath();
        ctx.fillStyle = `hsla(${20 + p.hueShift * 0.4}, 96%, ${lightness}%, ${alpha})`;
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(step);
    }

    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseleave', handleLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ display: 'block' }}
    />
  );
}
