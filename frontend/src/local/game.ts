import { WEIGHT_LIMIT } from '../types'
import type { Frame, Layout, Outcome, Point } from '../types'
import layouts from './layouts.json'

const size = 20
// Preserve the input scale used by existing checkpoints.
export const weightInputScale = 12
const directions: Point[] = [[0, -1], [0, 1], [-1, 0], [1, 0]]
const gems: Record<number, [number, number]> = {
  9: [10, 1], 10: [30, 3], 11: [60, 5], 12: [120, 8],
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

type RouteNode = { previous: number; action: number; distance: number }

function paths(layout: Layout, origin: Point, avoidHazards = false, blocked?: Set<number>) {
  const points = [origin]
  const routes = new Map<number, RouteNode>([[flat(origin), { previous: -1, action: -1, distance: 0 }]])
  for (let index = 0; index < points.length; index++) {
    const point = points[index]
    const previous = flat(point)
    const distance = routes.get(previous)!.distance + 1
    neighbors(point, ([x, y]) => {
      const tile = layout.grid[y][x]
      return tile === 1 || (avoidHazards && (tile === 3 || tile === 4 || tile === 7))
    }).forEach((entry, action) => {
      if (!entry) return
      const next = destination(entry, layout.portals)
      const cell = flat(next)
      if (blocked?.has(flat(entry)) || blocked?.has(cell)) return
      if (!routes.has(cell)) {
        routes.set(cell, { previous, action, distance })
        points.push(next)
      }
    })
  }
  return routes
}

function pathTo(paths: Map<number, RouteNode>, destination: number) {
  const actions: number[] = []
  for (let node = paths.get(destination); node?.distance; node = paths.get(node.previous)) actions.push(node.action)
  return actions.reverse()
}

function connected(layout: Layout) {
  return paths(layout, layout.start).size === layout.grid.flat().filter(tile => tile !== 1).length
}

export function previewLayout(grid: number[][]): Layout {
  let start: Point = [0, 0]
  const gates: Point[] = []
  grid.forEach((row, y) => row.forEach((tile, x) => {
    if (tile === 2) start = [x, y]
    if (tile === 6) gates.push([x, y])
  }))
  return { grid, start, stage: 4, portals: gates.length === 2 ? [[gates[0], gates[1]], [gates[1], gates[0]]] : [] }
}

export function customLayout(value: unknown, portals = true): Layout {
  if (!Array.isArray(value) || value.length !== size || value.some(row =>
    !Array.isArray(row) || row.length !== size || Array.from(row).some(tile => !Number.isInteger(tile) || tile < 0 || tile > 12))) {
    throw new Error('지도에는 20×20 칸이 필요합니다.')
  }
  const grid = (value as number[][]).map(row => row.map(tile => !portals && tile === 6 ? 0 : tile))
  const tiles = grid.flat()
  if (tiles.filter(tile => tile === 2).length !== 1) throw new Error('입구를 하나 배치해 주세요.')
  if (![0, 2].includes(tiles.filter(tile => tile === 6).length)) throw new Error('지름길은 두 칸을 한 쌍으로 배치해 주세요.')
  if (!tiles.some(tile => tile in gems)) throw new Error('보석을 한 개 이상 배치해 주세요.')
  const layout = previewLayout(grid)
  if (!connected(layout)) throw new Error('입구에서 모든 통로에 닿을 수 있도록 길을 연결해 주세요.')

  // Simulate a round trip so that an accessible gem also has a survivable route home.
  for (const avoidHazards of [true, false]) {
    const outward = paths(layout, layout.start, avoidHazards)
    for (const [cell, outbound] of outward) {
      if (!(tiles[cell] in gems) || outbound.distance >= 199) continue
      const game = new CaveGame(4, undefined, portals, layout)
      const approach = [...pathTo(outward, cell), 4]
      if (!approach.every(action => {
        if (game.outcome !== 'running' || !game.frame().mask[action]) return false
        game.advance(action)
        return true
      })) continue
      const origin = flat(layout.start)
      const blocked = new Set(game.visited)
      blocked.delete(origin)
      const returnPaths = paths(layout, game.position, avoidHazards, blocked)
      const home = returnPaths.get(origin)
      if (!home || game.step + home.distance > 200) continue
      for (const action of pathTo(returnPaths, origin)) {
        if (game.outcome !== 'running' || !game.frame().mask[action]) break
        if (game.advance(action) > 0) return layout
      }
    }
  }
  throw new Error('보석을 얻고 생존해서 돌아올 수 있도록 입구 주변에 경로를 확보해 주세요.')
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
    if (tile === 0 && !(y === 16 && x >= 2 && x <= 4)) floors.push([x, y])
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
  readonly visited: Set<number>
  position: Point
  hp = 100
  noise = 0
  weight = 0
  value = 0
  step = 0
  moves = 0
  outcome: Outcome = 'running'
  event = 'enter'

  constructor(stage = 4, seed?: number, portals = true, layout?: Layout) {
    this.layout = layout ?? cave(stage, seed, portals)
    this.grid = Uint8Array.from(this.layout.grid.flat())
    this.position = this.layout.start
    this.visited = new Set([flat(this.position)])
  }

  private exits() {
    const allowed = (point: Point) => !this.visited.has(flat(point)) || same(point, this.layout.start)
    return neighbors(this.position, point => this.grid[flat(point)] === 1 || !allowed(point) ||
      !allowed(destination(point, this.layout.portals)))
  }

  private mask(exits = this.exits()) {
    return [...exits.map(point => Number(point !== null)), Number(this.grid[flat(this.position)] in gems)]
  }

  observe(): Observation {
    const [x, y] = this.position
    const exits = this.exits()
    const map = this.grid.slice()
    for (const cell of this.visited) {
      if (cell !== flat(this.position) && cell !== flat(this.layout.start)) map[cell] = 1
    }
    return {
      map, mask: this.mask(exits),
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
      const [value, weight] = gems[this.grid[cell]]
      this.value += value
      this.weight += weight
      if (survival) this.noise += 2
      this.grid[cell] = 0
      this.event = 'collect'
      if (this.layout.stage >= 2 && this.weight > WEIGHT_LIMIT) this.outcome = 'crushed'
    } else {
      this.position = exits[action]!
      this.visited.add(flat(this.position))
      this.moves += 1
      this.event = 'move'
      if (survival) {
        this.hp -= 1
        this.noise = (Math.round(this.noise * 10) + 5) / 10
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
            this.noise = (Math.round(this.noise * 10) + 150) / 10
            this.event = 'rock'
            break
          case 5:
            this.hp = Math.min(100, this.hp + 25)
            this.grid[cell] = 0
            this.event = 'potion'
            break
          case 6:
            this.position = destination(this.position, this.layout.portals)
            this.visited.add(flat(this.position))
            this.event = 'portal'
            break
          case 7:
            this.hp -= 5
            this.noise = Math.max(0, Math.round(this.noise * 10) - 200) / 10
            this.grid[cell] = 0
            this.event = 'silence'
            break
        }
      }
    }
    if (this.outcome === 'running' && survival) this.checkSurvival()
    if (this.outcome === 'running' && this.step > 0 && same(this.position, this.layout.start)) this.outcome = 'escaped'
    if (this.outcome === 'running' && this.step >= 200) this.outcome = 'timeout'
    if (this.outcome === 'running' && !this.mask().some(Boolean)) this.outcome = 'dead_end'
    return this.outcome === 'escaped' ? this.value : 0
  }
}
