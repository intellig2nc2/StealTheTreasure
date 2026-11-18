import * as tf from '@tensorflow/tfjs'
import { random } from './game'
import type { Observation } from './game'

const actions = 5
const batchSize = 64
const capacity = 100_000
const inputSize = 25 * 13 + 11
const hidden = 64
const shapes: [number, number][] = [[inputSize, hidden], [1, hidden], [hidden, actions], [1, actions]]
type Weights = tf.Variable<tf.Rank.R2>[]
type Transition = { from: Observation; action: number; reward: number; to: Observation; terminated: boolean }
export type Checkpoint = { online: Float32Array[]; target: Float32Array[]; updates: number }

function input(states: Observation[]) {
  const values = new Float32Array(states.length * inputSize)
  for (const [index, state] of states.entries()) {
    const offset = index * inputSize
    for (let cell = 0; cell < 400; cell++) {
      const block = Math.floor(cell / 80) * 5 + Math.floor((cell % 20) / 4)
      values[offset + block * 13 + state.map[cell]] += 1 / 16
    }
    values.set(state.features, offset + 25 * 13)
  }
  return tf.tensor2d(values, [states.length, inputSize])
}

export function maskedBest(values: ArrayLike<number>, mask: number[], offset = 0) {
  let chosen = -1
  for (let action = 0; action < actions; action++) {
    if (mask[action] && (chosen === -1 || values[offset + action] > values[offset + chosen])) chosen = action
  }
  return chosen
}

function predict(states: tf.Tensor2D, [w, b, output, bias]: Weights) {
  return states.matMul(w).add(b).relu().matMul(output).add(bias)
}

export class Agent {
  private readonly rng: () => number
  private readonly online: Weights
  private readonly target: Weights
  private readonly optimizer = tf.train.adam(0.0001)
  private readonly replay: Transition[] = []
  private entries = 0
  updates = 0

  constructor(seed: number) {
    this.rng = random(seed)
    const init = () => shapes.map(([rows, cols], index) => tf.tidy(() => {
      const magnitude = Math.sqrt(6 / (rows + cols))
      const data = Float32Array.from({ length: rows * cols }, () => index % 2 ? 0 : (2 * this.rng() - 1) * magnitude)
      return tf.variable(tf.tensor2d(data, [rows, cols]))
    }))
    this.online = init()
    this.target = init()
    this.sync()
  }

  private sync() {
    this.target.forEach((target, i) => target.assign(this.online[i]))
  }

  choose(state: Observation, epsilon: number) {
    if (epsilon && this.rng() < epsilon) {
      const valid = state.mask.flatMap((enabled, action) => enabled ? [action] : [])
      return valid[Math.floor(this.rng() * valid.length)]
    }
    return tf.tidy(() => maskedBest(predict(input([state]), this.online).dataSync(), state.mask))
  }

  remember(transition: Transition) {
    this.replay[this.entries % capacity] = transition
    this.entries += 1
    if (this.replay.length < batchSize || this.entries % 4) return

    const sampled = new Set<number>()
    while (sampled.size < batchSize) sampled.add(Math.floor(this.rng() * this.replay.length))
    const batch = Array.from(sampled, index => this.replay[index])
    tf.tidy(() => {
      const next = input(batch.map(item => item.to))
      const onlineQ = predict(next, this.online).dataSync()
      const targetQ = predict(next, this.target).dataSync()
      const targets = tf.tensor1d(batch.map((item, i) => {
        const offset = i * actions
        const chosen = maskedBest(onlineQ, item.to.mask, offset)
        return item.reward + (item.terminated || chosen < 0 ? 0 : 0.99 * targetQ[offset + chosen])
      }))
      const previous = input(batch.map(item => item.from))
      const taken = tf.oneHot(tf.tensor1d(batch.map(item => item.action), 'int32'), actions)
      const { grads } = tf.variableGrads(() => {
        const errors = predict(previous, this.online).mul(taken).sum(1).sub(targets).abs()
        const quadratic = errors.minimum(1)
        return quadratic.square().mul(0.5).add(errors.sub(quadratic)).mean()
      }, this.online)
      const norm = tf.addN(Object.values(grads).map(gradient => gradient.square().sum())).sqrt()
      const scale = tf.scalar(10).div(norm.maximum(10))
      this.optimizer.applyGradients(Object.entries(grads).map(([name, gradient]) => ({ name, tensor: gradient.mul(scale) })))
    })
    this.updates += 1
    if (this.updates % 1000 === 0) this.sync()
  }

  checkpoint(): Checkpoint {
    const copy = (weights: Weights) => weights.map(variable => Float32Array.from(variable.dataSync()))
    return { online: copy(this.online), target: copy(this.target), updates: this.updates }
  }

  restore(checkpoint: Checkpoint) {
    tf.tidy(() => {
      for (const [i, shape] of shapes.entries()) {
        this.online[i].assign(tf.tensor2d(checkpoint.online[i], shape))
        this.target[i].assign(tf.tensor2d(checkpoint.target[i], shape))
      }
    })
    this.updates = checkpoint.updates
  }

  dispose() {
    tf.dispose([...this.online, ...this.target])
    this.optimizer.dispose()
  }
}
