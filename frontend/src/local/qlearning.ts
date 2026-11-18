import { random, weightInputScale } from './game'
import type { Observation } from './game'

const capacity = 200_000
const alpha = 0.15
const gamma = 0.99
const scales = [19, 19, 10, 10, weightInputScale, 20, 12, 12, 12, 12, 12]

export type QCheckpoint = [string, number[]][]

function key(state: Observation) {
  return state.features.map((value, i) => Math.round(value * scales[i])).join(',')
}

function validActions(state: Observation) {
  return state.mask.flatMap((available, action) => available ? [action] : [])
}

export class QLearning {
  private readonly rng: () => number
  private table = new Map<string, number[]>()

  constructor(seed: number) { this.rng = random(seed) }

  choose(state: Observation, epsilon: number) {
    const valid = validActions(state)
    if (epsilon && this.rng() < epsilon) return valid[Math.floor(this.rng() * valid.length)]
    const values = this.table.get(key(state))
    const best = Math.max(...valid.map(action => values?.[action] ?? 0))
    const tied = valid.filter(action => (values?.[action] ?? 0) === best)
    return tied[epsilon ? Math.floor(this.rng() * tied.length) : 0]
  }

  remember({ from, action, reward, to, terminated }: {
    from: Observation; action: number; reward: number; to: Observation; terminated: boolean
  }) {
    const id = key(from)
    const previous = this.table.get(id)
    const values = previous ?? [0, 0, 0, 0, 0]
    const next = this.table.get(key(to))
    const valid = validActions(to)
    const future = !terminated && valid.length ? Math.max(...valid.map(index => next?.[index] ?? 0)) : 0
    values[action] += alpha * (reward + gamma * future - values[action])
    if (!previous) {
      // shortcut: cap the table in a browser tab; increase only after measuring memory on long runs.
      if (this.table.size >= capacity) this.table.delete(this.table.keys().next().value!)
      this.table.set(id, values)
    }
  }

  checkpoint(): QCheckpoint { return Array.from(this.table) }
  restore(saved: QCheckpoint) { this.table = new Map(saved) }
  dispose() { this.table.clear() }
}
