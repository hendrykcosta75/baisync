'use client';

import { useEffect, useRef } from 'react';

interface Dot {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  glowing: boolean;
  glowPhase: number;
  glowSpeed: number;
}

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: 0, y: 0 });
  const dotsRef = useRef<Dot[]>([]);
  const animFrameRef = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        mouseRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
    }
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const spacing = 32;
    let width = 0;
    let height = 0;

    function initDots() {
      if (!canvas) return;
      width = canvas.offsetWidth;
      height = canvas.offsetHeight;
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
      ctx!.scale(devicePixelRatio, devicePixelRatio);

      const dots: Dot[] = [];
      const cols = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const x = col * spacing;
          const y = row * spacing;
          const glowing = Math.random() < 0.08;
          dots.push({
            x,
            y,
            baseX: x,
            baseY: y,
            glowing,
            glowPhase: Math.random() * Math.PI * 2,
            glowSpeed: 0.005 + Math.random() * 0.01,
          });
        }
      }
      dotsRef.current = dots;
    }

    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, width, height);

      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const parallaxStrength = 0.015;

      for (const dot of dotsRef.current) {
        const dx = dot.baseX - mx;
        const dy = dot.baseY - my;
        dot.x = dot.baseX + dx * parallaxStrength;
        dot.y = dot.baseY + dy * parallaxStrength;

        if (dot.glowing) {
          dot.glowPhase += dot.glowSpeed;
          const opacity = 0.2 * (0.5 + 0.5 * Math.sin(dot.glowPhase));
          ctx.fillStyle = `rgba(255, 107, 0, ${opacity})`;
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, 1.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = '#1a1a1a';
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, 1, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Radial glow following cursor
      if (mx > 0 && my > 0) {
        const gradient = ctx.createRadialGradient(mx, my, 0, mx, my, 200);
        gradient.addColorStop(0, 'rgba(255, 107, 0, 0.05)');
        gradient.addColorStop(1, 'rgba(255, 107, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }

      animFrameRef.current = requestAnimationFrame(draw);
    }

    initDots();
    animFrameRef.current = requestAnimationFrame(draw);

    const handleResize = () => {
      initDots();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 pointer-events-none"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
    </div>
  );
}
