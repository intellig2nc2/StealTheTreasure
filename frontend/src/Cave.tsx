import { useEffect, useRef } from 'react'
import type { Frame, Layout } from './types'

export const tiles = [
  ['통로', '#35332a'], ['벽', '#272620'], ['입구', '#e4b96e'], ['가시', '#b6a08b'],
  ['낙석', '#c48263'], ['물약', '#e58c75'], ['지름길', '#75c9c1'], ['침묵의 제단', '#d2c5a0'],
  ['케르베로스', '#db7852'], ['에메랄드', '#92d09f'], ['사파이어', '#7bbbeb'],
  ['루비', '#e57868'], ['전설의 보석', '#f7cb72'],
]

const size = 24
const consumed = new Set(['collect', 'potion', 'silence'])
const beast = [
  '...aa....aa....aa...',
  '..abba..abba..abba..',
  '..bccbaabccbaabccb..',
  '.abdbbbbbdbbbbbdba.',
  '..baabbbbbbbbb aab..',
  '....abbbbbbbbbba....',
  '...abbbbabbbbbbba...',
  '...bbbaaaaaaabbbb...',
  '..aaba.......aabaa..',
].map(line => line.replaceAll(' ', '.'))
const explorer = [
  '...yy...', '..yyyy..', '..cooc..', '...cc...', '..bwwb..',
  '.ybbbbt.', '...bb.t.', '..b..b..', '..c..c..',
]

function drawSprite(ctx: CanvasRenderingContext2D, rows: string[], colors: Record<string, string>, x: number, y: number, pixel: number) {
  rows.forEach((row, i) => Array.from(row).forEach((value, j) => {
    if (colors[value]) {
      ctx.fillStyle = colors[value]
      ctx.fillRect(x + j * pixel, y + i * pixel, pixel, pixel)
    }
  }))
}

export function drawTile(ctx: CanvasRenderingContext2D, tile: number, x: number, y: number) {
  const fill = (color: string, dx: number, dy: number, w: number, h: number) => {
    ctx.fillStyle = color
    ctx.fillRect(x + dx, y + dy, w, h)
  }
  const color = tiles[tile][1]
  if (tile >= 9) {
    fill('#171813', 6, 16, 12, 3)
    fill(color, 8, 5, 8, 3)
    fill(color, 5, 8, 14, 5)
    fill(color, 8, 13, 8, 3)
    fill(color, 11, 16, 2, 2)
    fill('#fffae3', 8, 8, 4, 2)
    fill('#181b17', 14, 12, 2, 2)
  } else if (tile === 2) {
    fill('#624527', 4, 4, 16, 17)
    fill(color, 6, 3, 12, 2)
    fill(color, 4, 6, 2, 13)
    fill(color, 18, 6, 2, 13)
    fill('#181610', 8, 7, 8, 12)
    fill(color, 3, 20, 18, 2)
  } else if (tile === 3) {
    for (const dx of [5, 11, 17]) {
      fill(color, dx, 9, 2, 8)
      fill('#615747', dx - 2, 14, 5, 4)
    }
  } else if (tile === 4) {
    fill('#522f22', 5, 11, 13, 7)
    fill(color, 7, 8, 9, 5)
    fill('#e2a184', 8, 8, 4, 2)
  } else if (tile === 5) {
    fill('#e2d5ac', 9, 5, 6, 3)
    fill('#733b31', 7, 11, 10, 7)
    fill(color, 8, 12, 8, 5)
    fill('#ffd6ad', 9, 12, 2, 2)
  } else if (tile === 6) {
    fill('#2f5550', 4, 3, 16, 18)
    fill(color, 7, 5, 10, 2)
    fill(color, 5, 8, 2, 9)
    fill(color, 17, 8, 2, 9)
    fill('#8de3ce', 9, 10, 6, 4)
    fill(color, 7, 18, 10, 2)
  } else if (tile === 7) {
    fill('#786d52', 6, 10, 12, 8)
    fill(color, 5, 9, 14, 3)
    fill(color, 4, 18, 16, 2)
    fill('#f0ddb5', 11, 5, 2, 4)
  } else if (tile === 8) {
    drawSprite(ctx, beast, { a: '#512d25', b: '#944a34', c: '#c46d48', d: '#ffbf70' }, x - 7, y + 2, 2)
  }
}

export function TileIcon({ tile }: { tile: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, size, size)
      drawTile(ctx, tile, 0, 0)
    }
  }, [tile])
  return <canvas ref={ref} width={size} height={size} aria-hidden="true" />
}

function seedShade(x: number, y: number) {
  return ((x * 4417) ^ (y * 7919) ^ (x * y * 2093)) & 15
}

export default function Cave({ layout, frames }: { layout?: Layout; frames: Frame[] }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const frame = frames.at(-1)
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const grid = layout?.grid.map(row => row.slice())
    if (!grid) return
    frames.forEach(({ event, position: [x, y] }) => {
      if (consumed.has(event)) grid[y][x] = 0
    })

    grid.forEach((row, y) => row.forEach((cell, x) => {
      const left = x * size, top = y * size
      const noise = seedShade(x, y)
      const wall = cell === 1
      ctx.fillStyle = wall ? '#23231e' : ['#343329', '#37352b', '#3a382e', '#3d392d'][noise % 4]
      ctx.fillRect(left, top, size, size)
      ctx.fillStyle = wall ? '#37362d' : '#444034'
      ctx.fillRect(left + 1, top + 1, wall ? 22 : 5 + noise, 1)
      ctx.fillStyle = wall ? '#151611' : '#2c2b23'
      ctx.fillRect(left, top + size - (wall ? 6 : 1), size, wall ? 6 : 1)
      ctx.fillRect(left + size - 1, top, 1, size)
      if (wall) {
        ctx.fillStyle = '#292921'
        ctx.fillRect(left + (noise % 2 ? 8 : 16), top + 2, 1, 16)
        ctx.fillRect(left + 1, top + 9, 22, 1)
      } else if (noise % 3 === 0) {
        ctx.fillStyle = '#524a39'
        ctx.fillRect(left + 4 + noise, top + 14, 2, 1)
        ctx.fillRect(left + 4, top + 9 + noise % 6, 4, 1)
      }
    }))

    ctx.setLineDash([3, 5])
    ctx.strokeStyle = '#73b7aa45'
    for (const [[ax, ay], [bx, by]] of layout?.portals.slice(0, 1) ?? []) {
      ctx.beginPath()
      ctx.moveTo(ax * size + 12, ay * size + 12)
      ctx.lineTo(bx * size + 12, by * size + 12)
      ctx.stroke()
    }
    ctx.setLineDash([])
    grid.forEach((row, y) => row.forEach((cell, x) => {
      if (cell > 1) drawTile(ctx, cell, x * size, y * size)
    }))

    if (layout && frame) {
      const visited = new Set<number>()
      for (const { event, position: [x, y] } of frames) {
        visited.add(y * 20 + x)
        if (event === 'portal') {
          const entry = layout.portals.find(([, [dx, dy]]) => dx === x && dy === y)?.[0]
          if (entry) visited.add(entry[1] * 20 + entry[0])
        }
      }
      visited.delete(layout.start[1] * 20 + layout.start[0])
      visited.delete(frame.position[1] * 20 + frame.position[0])
      ctx.fillStyle = '#10110fa8'
      for (const cell of visited) ctx.fillRect((cell % 20) * size, Math.floor(cell / 20) * size, size, size)
    }

    const route = frames.slice(-90)
    ctx.lineWidth = 2
    for (let i = 1; i < route.length; i++) {
      if (route[i].event === 'portal') continue
      ctx.strokeStyle = `rgba(238,191,107,${0.16 + 0.55 * i / route.length})`
      const [a, b] = route[i - 1].position
      const [x, y] = route[i].position
      ctx.beginPath()
      ctx.moveTo(a * size + 12, b * size + 12)
      ctx.lineTo(x * size + 12, y * size + 12)
      ctx.stroke()
    }
    if (frame) {
      const x = frame.position[0] * size, y = frame.position[1] * size
      ctx.strokeStyle = frame.outcome === 'running' || frame.outcome === 'escaped' ? '#e8b866' : '#e57868'
      ctx.lineWidth = 1
      ctx.strokeRect(x + 1.5, y + 1.5, 21, 21)
      ctx.fillStyle = '#14140e'
      ctx.fillRect(x + 5, y + 19, 15, 3)
      drawSprite(ctx, explorer, { y: '#f5ce82', b: '#af6b36', w: '#a7a99a', c: '#714735', o: '#f6dbba', t: '#edf0bc' }, x + 5, y + 3, 2)
    }
  }, [layout, frames, frame])

  return <canvas ref={ref} className="cave" width="480" height="480" role="img"
    aria-label={frame ? `20×20 동굴 지도, 현재 좌표 ${frame.position.map(n => n + 1).join(', ')}` : '20×20 동굴 지도'} />
}
