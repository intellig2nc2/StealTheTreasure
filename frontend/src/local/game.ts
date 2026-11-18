import { WEIGHT_LIMIT } from '../types'
import type { Frame, Layout, Outcome, Point } from '../types'
import layouts from './layouts.json'

const size = 20
// Preserve the input scale used by existing checkpoints.
export const weightInputScale = 12
const directions: Point[] = [[0, -1], [0, 1], [-1, 0], [1, 0]]
const gems: Record<number, [number, number, number]> = {
  9: [10, 1, 2], 10: [30, 3, 5], 11: [60, 5, 10], 12: [120, 8, 18],
}
const flat = ([x, y]: Point) => y * size + x
const same = ([x, y]: Point, [a, b]: Point) => x === a && y === b

export function random(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = Math.imul(state ^ (state >>> 15), state | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function neighbors([x, y]: Point, wall: (point: Point) => boolean): (Point | null)[] {
  return directions.map(([dx, dy]) => {
    const nx = x + dx, ny = y + dy
    return nx >= 0 && nx < size && ny >= 0 && ny < size && !wall([nx, ny]) ? [nx, ny] : null
  })
}

function destination(point: Point, portals: Layout['portals']) {
  return portals.find(([entry]) => same(entry, point))?.[1] ?? point
}

function connected(layout: Layout) {
  const points = [layout.start]
  const seen = new Set([flat(layout.start)])
  for (let i = 0; i < points.length; i++) {
    for (const entry of neighbors(points[i], ([x, y]) => layout.grid[y][x] === 1)) {
      if (!entry) continue
      const next = destination(entry, layout.portals)
      const id = flat(next)
      if (!seen.has(id)) {
        points.push(next)
        seen.add(id)
      }
    }
  }
  return seen.size === layout.grid.flat().filter(tile => tile !== 1).length
}

function cave(stage: number, seed?: number, portals = true): Layout {
  const base = layouts[stage - 1] as Layout
  const original = portals ? base : { ...base, portals: [], grid: base.grid.map(row => row.map(tile => tile === 6 ? 0 : tile)) }
  if (seed === undefined) return original
  const rng = random(seed)
  const layout: Layout = { ...original, grid: original.grid.map(row => row.slice()) }
  const slots: Point[] = [], contents: number[] = [], floors: Point[] = []
  layout.grid.forEach((row, y) => row.forEach((tile, x) => {
    if (x === 3 && y === 17 || x === 4 && y === 17) return
    if (tile === 0) floors.push([x, y])
    else if (tile > 2 && tile !== 6) {
      slots.push([x, y])
      contents.push(tile)
    }
  }))
  for (const [x, y] of slots) {
    const [tile] = contents.splice(Math.floor(rng() * contents.length), 1)
    layout.grid[y][x] = tile
  }
  for (let count = 0; stage >= 3 && count < 16 && floors.length; count++) {
    const [[x, y]] = floors.splice(Math.floor(rng() * floors.length), 1)
    layout.grid[y][x] = 1
    if (!connected(layout)) layout.grid[y][x] = 0
  }
  // Keep the safe two-step emerald corridor and rotate all of its coordinates together.
  const turns = Math.floor(rng() * 4)
  const rotate = ([x, y]: Point): Point => {
    for (let turn = 0; turn < turns; turn++) [x, y] = [y, size - 1 - x]
    return [x, y]
  }
  const grid = layout.grid.map(row => row.slice())
  layout.grid.forEach((row, y) => row.forEach((tile, x) => {
    const [nx, ny] = rotate([x, y])
    grid[ny][nx] = tile
  }))
  return { grid, start: rotate(layout.start), portals: layout.portals.map(([a, b]) => [rotate(a), rotate(b)]), stage }
}

export type Observation = { map: Uint8Array; features: number[]; mask: number[] }

export class CaveGame {
  readonly layout: Layout
  readonly grid: Uint8Array
  position: Point
  hp = 100
  noise = 0
  weight = 0
  value = 0
  step = 0
  moves = 0
  outcome: Outcome = 'running'
  event = 'enter'

  constructor(stage = 4, seed?: number, portals = true) {
    this.layout = cave(stage, seed, portals)
    this.grid = Uint8Array.from(this.layout.grid.flat())
    this.position = this.layout.start
  }

  private exits() {
    return neighbors(this.position, point => this.grid[flat(point)] === 1)
  }

  private mask(exits = this.exits()) {
    return [...exits.map(point => Number(point !== null)), Number(this.grid[flat(this.position)] in gems)]
  }

  observe(): Observation {
    const [x, y] = this.position
    const exits = this.exits()
    return {
      map: this.grid.slice(), mask: this.mask(exits),
      features: [x / 19, y / 19, this.hp / 100, this.noise / 100, this.weight / weightInputScale, this.value / 200,
        this.grid[flat(this.position)] / 12, ...exits.map(point => point ? this.grid[flat(point)] / 12 : 1 / 12)],
    }
  }

  frame(): Frame {
    return {
      position: this.position, hp: this.hp, noise: this.noise, weight: this.weight, value: this.value,
      step: this.step, outcome: this.outcome, event: this.event, mask: this.mask(),
    }
  }

  private checkSurvival() {
    this.hp = Math.max(0, this.hp)
    if (this.noise >= 100) this.outcome = 'cerberus'
    else if (this.hp === 0) this.outcome = 'hp_depleted'
  }

  advance(action: number): number {
    const exits = this.exits()
    if (this.outcome !== 'running' || !this.mask(exits)[action]) throw new Error('현재 위치에서 실행할 수 없는 행동입니다.')
    this.step += 1
    const survival = this.layout.stage >= 3
    if (action === 4) {
      const cell = flat(this.position)
      const [value, weight, noise] = gems[this.grid[cell]]
      this.value += value
      this.weight += weight
      if (survival) this.noise += noise
      this.grid[cell] = 0
      this.event = 'collect'
      if (this.layout.stage >= 2 && this.weight > WEIGHT_LIMIT) this.outcome = 'crushed'
    } else {
      this.position = exits[action]!
      this.moves += 1
      this.event = 'move'
      if (survival) {
        this.hp -= 1
        this.noise += 1 + Number(this.weight >= 7)
        this.checkSurvival()
      }
      if (this.outcome === 'running') {
        const cell = flat(this.position)
        switch (this.grid[cell]) {
          case 3:
            this.hp -= 15
            this.event = 'spike'
            break
          case 4:
            this.hp -= 10
            this.noise += 15
            this.event = 'rock'
            break
          case 5:
            this.hp = Math.min(100, this.hp + 25)
            this.grid[cell] = 0
            this.event = 'potion'
            break
          case 6:
            this.position = destination(this.position, this.layout.portals)
            this.event = 'portal'
            break
          case 7:
            this.hp -= 5
            this.noise = Math.max(0, this.noise - 20)
            this.grid[cell] = 0
            this.event = 'silence'
            break
        }
      }
    }
    if (this.outcome === 'running' && survival) this.checkSurvival()
    if (this.outcome === 'running' && this.value && same(this.position, this.layout.start)) this.outcome = 'escaped'
    if (this.outcome === 'running' && this.step >= 200) this.outcome = 'timeout'
    return this.outcome === 'escaped' ? this.value : 0
  }
}
