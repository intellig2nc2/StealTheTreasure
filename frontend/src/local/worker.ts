import type { Replay, Row, Summary, Trace, Watch } from '../types'
import type { Agent } from './dqn'
import { CaveGame } from './game'
import { checkpoint } from './storage'
import { saveEpisode } from './history'
import type { RunRecord } from './history'

type Config = {
  episodes: number; seed: number; epsilon_decay: number; curriculum: boolean; random_maps: boolean;
  load_checkpoint: boolean; evaluation_episodes: number; evaluation_seed: number
}
const labels = ['early', 'middle', 'late', 'evaluation'] as const
const replays = new Map<Replay, Trace>()
let history: Row[] = []
let live: Trace | null = null
let runId = ''
let status: Watch['status'] = 'idle'
let config: Config | null = null
let evaluation: Summary | null = null
let error: string | null = null
let hasModel = false
const active = () => ['running', 'paused', 'stopping', 'evaluating'].includes(status)
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
void checkpoint().then(model => { hasModel = Boolean(model) }).catch(() => {})

class Metrics {
  private counts = { escaped: 0, cerberus: 0, crushed: 0, hp_depleted: 0, timeout: 0 }
  private totals = { value: 0, moves: 0, hp: 0, noise: 0, weight: 0 }
  private count = 0
  private best = 0
  private rewards: number[] = []
  cumulative = 0

  record(env: CaveGame, reward: number) {
    if (env.outcome === 'running') throw new Error('Episode is still running')
    this.counts[env.outcome] += 1
    this.count += 1
    this.best = Math.max(this.best, env.value)
    this.cumulative += reward
    this.rewards.push(reward)
    if (this.rewards.length > 100) this.rewards.shift()
    for (const key of Object.keys(this.totals) as (keyof typeof this.totals)[]) this.totals[key] += env[key]
  }

  get avg100() { return this.rewards.reduce((sum, value) => sum + value, 0) / this.countRecent }
  private get countRecent() { return this.rewards.length || 1 }

  result(): Summary {
    const count = Math.max(1, this.count)
    return { ...this.counts, count: this.count, escape_rate: 100 * this.counts.escaped / count, best_value: this.best,
      avg_value: this.totals.value / count, avg_moves: this.totals.moves / count, avg_hp: this.totals.hp / count,
      avg_noise: this.totals.noise / count, avg_weight: this.totals.weight / count }
  }
}

async function episode(agent: Agent, env: CaveGame, number: number, epsilon: number, train: boolean) {
  const frames = [env.frame()]
  let state = env.observe()
  let reward = 0
  while (env.outcome === 'running') {
    while (status === 'paused') await sleep(40)
    if (status === 'stopping') return null
    const action = agent.choose(state, epsilon)
    reward = env.advance(action)
    const next = env.observe()
    frames.push(env.frame())
    if (train) {
      agent.remember({ from: state, action, reward, to: next, terminated: env.outcome !== 'running' && env.outcome !== 'timeout' })
      live = { episode: number, epsilon, layout: env.layout, frames }
    }
    state = next
    if (env.step % 8 === 0) await sleep(0)
  }
  return { episode: number, epsilon, layout: env.layout, frames, reward }
}

async function run(parameters: Config, record: RunRecord) {
  let recording = true
  let agent: Agent | undefined
  try {
    const { Agent } = await import('./dqn')
    agent = new Agent(parameters.seed)
    if (parameters.load_checkpoint) {
      const saved = await checkpoint()
      if (!saved) throw new Error('저장된 모델이 없습니다.')
      agent.restore(saved)
    }
    const metrics = new Metrics()
    for (let number = 1; number <= parameters.episodes; number++) {
      const stage = parameters.curriculum && number < parameters.episodes ? 1 + Math.floor((number - 1) * 4 / parameters.episodes) : 4
      const mapSeed = parameters.random_maps ? (parameters.seed + number - 1) % 2147483648 : undefined
      const epsilon = Math.max(0.05, 1 - 0.95 * (number - 1) / parameters.epsilon_decay)
      const env = new CaveGame(stage, mapSeed)
      const trace = await episode(agent, env, number, epsilon, true)
      if (!trace) break
      if (recording) {
        try {
          await saveEpisode(record, {
            runId: record.id, episode: number, stage, outcome: env.outcome, reward: trace.reward, value: env.value,
            actions: env.step, hp: env.hp, noise: env.noise, weight: env.weight,
          })
        } catch {
          recording = false
          error = '브라우저 저장소에 에피소드 기록을 저장할 수 없습니다.'
        }
      }
      metrics.record(env, trace.reward)
      history.push({ ...metrics.result(), episode: number, epsilon, stage, reward: trace.reward,
        cumulative: metrics.cumulative, avg100: metrics.avg100 })
      if (number === 1) replays.set('early', trace)
      if (number === Math.ceil(parameters.episodes / 2)) replays.set('middle', trace)
      replays.set('late', trace)
      await sleep(0)
    }
    try {
      await checkpoint(agent.checkpoint())
      hasModel = true
    } catch {
      error ??= '브라우저 저장소에 모델을 저장할 수 없습니다. 학습 결과는 현재 탭에서 확인할 수 있습니다.'
    }
    while (status === 'paused') await sleep(40)
    if (status === 'stopping') {
      status = 'stopped'
      return
    }
    status = 'evaluating'
    const assessment = new Metrics()
    for (let index = 0; index < parameters.evaluation_episodes; index++) {
      const env = new CaveGame(4, parameters.evaluation_seed + index)
      const trace = await episode(agent, env, index + 1, 0, false)
      if (!trace) break
      assessment.record(env, trace.reward)
      if (trace.reward > (replays.get('evaluation')?.reward ?? -1)) replays.set('evaluation', trace)
      await sleep(0)
    }
    evaluation = assessment.result()
    status = stopped() ? 'stopped' : 'completed'
  } catch (failure) {
    console.error(failure)
    error = failure instanceof Error ? failure.message : '브라우저 학습에 실패했습니다.'
    status = 'error'
  } finally {
    agent?.dispose()
  }
}

function stopped() { return status === 'stopping' }

function train(value: Config) {
  if (active()) throw new Error('이미 실행 중인 학습이 있습니다.')
  const valid = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max
  if (!valid(value.episodes, 1, 50000) || !valid(value.seed, 0, 2147483647) || !valid(value.epsilon_decay, 1, 50000)
      || !valid(value.evaluation_seed, 2147483648, 4294967195) || !valid(value.evaluation_episodes, 1, 100)) {
    throw new Error('학습 설정을 확인해 주세요.')
  }
  if (value.load_checkpoint && !hasModel) throw new Error('저장된 모델이 없습니다.')
  config = value
  runId = crypto.randomUUID()
  status = 'running'
  history = []
  replays.clear()
  live = evaluation = error = null
  void run(value, { id: runId, startedAt: Date.now(), target: value.episodes, seed: value.seed, completed: 0 })
  return { run_id: runId }
}

function control(action: string) {
  if (action === 'pause' && status === 'running') status = 'paused'
  else if (action === 'resume' && status === 'paused') status = 'running'
  else if (action === 'stop' && ['running', 'paused', 'evaluating'].includes(status)) status = 'stopping'
  else throw new Error('현재 상태에서는 이 작업을 실행할 수 없습니다.')
  return { status }
}

function handle(path: string, payload?: object) {
  if (path === 'train') return train(payload as Config)
  if (path === 'control') return control((payload as { action: string }).action)
  const trace = replays.get(path.replace('replays/', '') as Replay)
  if (!trace) throw new Error('아직 리플레이가 없습니다.')
  return trace
}

const message = (failure: unknown) => failure instanceof Error ? failure.message : '요청을 처리할 수 없습니다.'

function play(port: MessagePort) {
  let game = new CaveGame()
  port.postMessage({ layout: game.layout, frame: game.frame() })
  port.onmessage = ({ data }: MessageEvent<{ action?: number; seed?: number | null; disconnect?: boolean }>) => {
    if (data.disconnect) { port.close(); return }
    try {
      if (data.action === undefined) {
        game = new CaveGame(4, data.seed ?? undefined)
        port.postMessage({ layout: game.layout, frame: game.frame() })
      } else {
        const reward = game.advance(data.action)
        port.postMessage({ frame: game.frame(), reward })
      }
    } catch (failure) {
      port.postMessage({ error: message(failure) })
    }
  }
}

function watch(port: MessagePort) {
  let cursor = 0, previous = '', max = false, stamp = '', lastSend = 0
  const send = () => {
    if (previous !== runId) cursor = 0
    const state: Watch = { run_id: runId, status, episode: history.length, total: config?.episodes ?? 0,
      history: history.slice(cursor, cursor + 1000), live: max ? null : live,
      replays: labels.filter(name => replays.has(name)), evaluation, error, checkpoint: hasModel,
      device: 'cpu', cuda: false, config }
    const next = [runId, status, max, cursor + state.history.length, state.live?.episode,
      state.live?.frames.length, hasModel, state.replays.length, error].join(':')
    if (next !== stamp) {
      port.postMessage(state)
      stamp = next
      cursor += state.history.length
      previous = runId
      lastSend = performance.now()
    }
  }
  send()
  const timer = setInterval(() => {
    if (!max || performance.now() - lastSend >= 950) send()
  }, 160)
  port.onmessage = ({ data }: MessageEvent<{ max_speed?: boolean; disconnect?: boolean }>) => {
    if (data.disconnect) { clearInterval(timer); port.close(); return }
    max = Boolean(data.max_speed)
    send()
  }
}

self.onmessage = ({ data, ports: [port] }: MessageEvent<{ path: string; payload?: object; request?: boolean }>) => {
  if (data.request) {
    try { port.postMessage({ result: handle(data.path, data.payload) }) }
    catch (failure) { port.postMessage({ error: message(failure) }) }
    finally { port.close() }
  } else if (data.path === 'watch') watch(port)
  else if (data.path === 'play') play(port)
}
