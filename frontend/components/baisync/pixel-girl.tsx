'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { GIRL_H, GIRL_PALETTE, GIRL_PIXELS, GIRL_W } from './pixel-girl-data'

type RGB = [number, number, number]

const paletteRgb: RGB[] = GIRL_PALETTE.map((hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
})

const NEIGHBORS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
]

type Cell = { x: number; y: number; idx: number }

function cleanedPixels(): { cells: Cell[]; minX: number; maxX: number; minY: number; maxY: number } {
  const W = GIRL_W, H = GIRL_H
  const isWhite = (r: number, g: number, b: number) => r > 225 && g > 225 && b > 225
  const isGreen = (r: number, g: number, b: number) => g > r && g > b && g - Math.min(r, b) > 15
  const isFlower = (r: number, g: number, b: number) => r > 180 && g > 150 && b < 110 && r >= g
  const isWatermark = (r: number, g: number, b: number) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const sat = max === 0 ? 0 : (max - min) / max
    return sat < 0.12 && max > 60 && max < 215
  }
  const isBg = (r: number, g: number, b: number) => r > 235 && g > 235 && b > 235

  const keep: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false))
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pi = GIRL_PIXELS[y][x]
      if (pi < 0) continue
      const [r, g, b] = paletteRgb[pi]
      if (isBg(r, g, b)) continue
      if (isWhite(r, g, b)) continue
      if (isGreen(r, g, b)) continue
      if (isFlower(r, g, b)) continue
      if (isWatermark(r, g, b)) continue
      keep[y][x] = true
    }
  }

  // Largest connected component (8-neighbor)
  const seen: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false))
  let best: [number, number][] | null = null
  let bestSize = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!keep[y][x] || seen[y][x]) continue
      const stack: [number, number][] = [[x, y]]
      const comp: [number, number][] = []
      seen[y][x] = true
      while (stack.length) {
        const [cx, cy] = stack.pop()!
        comp.push([cx, cy])
        for (const [dx, dy] of NEIGHBORS) {
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          if (seen[ny][nx] || !keep[ny][nx]) continue
          seen[ny][nx] = true
          stack.push([nx, ny])
        }
      }
      if (comp.length > bestSize) { bestSize = comp.length; best = comp }
    }
  }

  const mask: boolean[][] = Array.from({ length: H }, () => new Array(W).fill(false))
  if (best) for (const [x, y] of best) mask[y][x] = true

  const cells: Cell[] = []
  let minX = W, maxX = 0, minY = H, maxY = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y][x]) continue
      cells.push({ x, y, idx: GIRL_PIXELS[y][x] })
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { cells, minX, maxX, minY, maxY }
}

export type PixelGirlProps = {
  size?: number
  audioLevel?: number
  /** 'full' renders the whole rasterized figure; 'head' crops to the top portion
   *  (head + hair + shoulders). Useful for compact avatars like the Baisync bubble. */
  crop?: 'full' | 'head'
}

export function PixelGirl({ size = 120, audioLevel = 0, crop = 'full' }: PixelGirlProps) {
  const cleaned = useMemo(() => cleanedPixels(), [])
  const [tick, setTick] = useState(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const t0 = performance.now()
    const loop = (t: number) => {
      setTick((t - t0) / 1000)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current != null) cancelAnimationFrame(rafRef.current) }
  }, [])

  const fullW = cleaned.maxX - cleaned.minX + 1
  const fullH = cleaned.maxY - cleaned.minY + 1
  const shifted = cleaned.cells.map((c) => ({ x: c.x - cleaned.minX, y: c.y - cleaned.minY, idx: c.idx }))

  // 'head' mode: keep only hair + face (rows 0..9 of the cleaned sprite,
  // i.e. before the shoulders kick in). The caller is expected to render the
  // result inside a container with border-radius + overflow:hidden so the
  // wider hair/ears overflow horizontally and get clipped to the circle.
  const headCutoff = crop === 'head' ? Math.min(10, fullH) : fullH
  const cropped = crop === 'head'
    ? shifted.filter((c) => c.y < headCutoff)
    : shifted

  // Recompute bounding box for the cropped subset so the sprite scales to `size`
  let minX = fullW, maxX = 0, minY = fullH, maxY = 0
  for (const c of cropped) {
    if (c.x < minX) minX = c.x
    if (c.x > maxX) maxX = c.x
    if (c.y < minY) minY = c.y
    if (c.y > maxY) maxY = c.y
  }
  const cw = Math.max(1, maxX - minX + 1)
  const ch = Math.max(1, maxY - minY + 1)
  // Scale by the larger axis so the sprite fits inside a size×size box
  // regardless of whether it's a wide head crop or a tall full body.
  const px = size / Math.max(cw, ch)
  const normalized = cropped.map((c) => ({ x: c.x - minX, y: c.y - minY, idx: c.idx }))

  const breath = Math.sin(tick * 2.0) * 0.5 + audioLevel * 0.8
  const hairSway = Math.sin(tick * 1.3) * 0.6 + audioLevel * 1.5

  const hairLineY = Math.floor(ch * 0.20)
  const hair: typeof normalized = []
  const body: typeof normalized = []
  for (const r of normalized) (r.y < hairLineY ? hair : body).push(r)

  return (
    <svg
      width={cw * px}
      height={ch * px}
      viewBox={`0 0 ${cw * px} ${ch * px}`}
      style={{
        imageRendering: 'pixelated',
        display: 'block',
        // Prevent flex parents from shrinking the sprite (which would compress
        // it via preserveAspectRatio instead of letting it overflow for clip).
        flexShrink: 0,
        filter: 'drop-shadow(0 2px 0 rgba(0,0,0,0.4))',
      }}
      aria-hidden="true"
    >
      <g transform={`translate(0 ${breath})`}>
        {body.map((r, i) => (
          <rect
            key={`b${i}`}
            x={r.x * px} y={r.y * px}
            width={px + 0.5} height={px + 0.5}
            fill={GIRL_PALETTE[r.idx]}
            shapeRendering="crispEdges"
          />
        ))}
      </g>
      <g transform={`translate(${hairSway} ${breath * 0.5})`}>
        {hair.map((r, i) => (
          <rect
            key={`h${i}`}
            x={r.x * px} y={r.y * px}
            width={px + 0.5} height={px + 0.5}
            fill={GIRL_PALETTE[r.idx]}
            shapeRendering="crispEdges"
          />
        ))}
      </g>
    </svg>
  )
}
