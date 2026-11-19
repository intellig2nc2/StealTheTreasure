import { CaveGame } from '../src/local/game'
import { QLearning } from '../src/local/qlearning'
import type { QCheckpoint } from '../src/local/qlearning'
import type { Frame, OnlineEpisode } from '../src/types'

declare const assets: Record<string, [string, string]>
type Statement = {
  bind(...args: (string | number)[]): Statement
  first<T>(): Promise<T | null>
  all<T>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: { changes: number } }>
}
type Run = {
  portals: boolean
  seed: number
  target: number
  retries: number
  paths: string[]
  table: QCheckpoint
  episodes: OnlineEpisode[]
  frames: Frame[]
}
type Row = { id: string; owner: string; revision: number; state: string }
const targets = [1000, 5000]
const attemptsPerRequest = 10
const retryLimit = 400
const pageSize = 20
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

function view(row: Row, state: Run, user: string | null) {
  const { portals, target, episodes, frames, retries } = state
  return { id: row.id, portals, target, completed: episodes.length, episodes: episodes.slice(-pageSize),
    frames, blocked: retries >= retryLimit, owner: row.owner === user }
}

async function pathKey(path: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path))
  return Array.from(new Uint8Array(hash, 0, 12), n => n.toString(16).padStart(2, '0')).join('')
}

async function advance(state: Run, revision: number) {
  // shortcut: keep the checkpoint within D1's row size; shard it if substantially larger runs are needed.
  const agent = new QLearning((state.seed + revision * 1009) >>> 0, 4096)
  agent.restore(state.table)
  const paths = new Set<string>()
  for (const path of state.paths) paths.add(path.includes(',') ? await pathKey(path) : path)
  for (let attempt = 0; attempt < attemptsPerRequest && state.episodes.length < state.target &&
    state.retries < retryLimit; attempt += 1) {
    await episode(state, agent, paths)
  }
  state.paths = [...paths]
  state.table = agent.checkpoint()
}

async function episode(state: Run, agent: QLearning, paths: Set<string>) {
  const game = new CaveGame(4, undefined, state.portals)
  const frames = [game.frame()]
  const epsilon = Math.min(1, Math.max(0.10, 1 - 0.9 * state.episodes.length / (state.target - 1)) + state.retries / 35)
  const transitions: Parameters<QLearning['remember']>[0][] = []
  let observation = game.observe()
  let score = 0
  while (game.outcome === 'running') {
    const action = agent.choose(observation, epsilon)
    const value = game.value
    score = game.advance(action)
    const next = game.observe()
    const frame = game.frame()
    const failed = frame.outcome !== 'running' && frame.outcome !== 'escaped'
    transitions.push({ from: observation, action, reward: game.value - value - (failed ? game.value : 0),
      to: next, terminated: frame.outcome !== 'running' })
    frames.push(frame)
    observation = next
  }
  const path = frames.filter((frame, i) => i === 0 || frame.position.join() !== frames[i - 1].position.join())
    .map(frame => frame.position.join()).join(';')
  const key = await pathKey(path)
  if (paths.has(key)) {
    state.retries += 1
    return
  }
  state.retries = 0
  paths.add(key)
  for (const transition of transitions) agent.remember(transition)
  state.frames = frames
  state.episodes.push({ score, outcome: game.outcome, steps: game.step, epsilon, value: game.value,
    moves: game.moves, hp: game.hp, noise: game.noise, weight: game.weight })
}

async function api(request: Request, db: { prepare(sql: string): Statement }, url: URL) {
  const user = request.headers.get('oai-authenticated-user-id')
  const route = /^\/api\/online(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname)
  if (!route) return json({ error: '주소를 찾을 수 없습니다.' }, 404)
  const id = route[1]
  if (request.method === 'GET') {
    if (!id) {
      const { results } = await db.prepare(`SELECT id, created_at AS createdAt,
        json_array_length(state, '$.episodes') AS completed, json_extract(state, '$.target') AS target
        FROM online_runs ORDER BY created_at DESC LIMIT 20`).all()
      return json({ runs: results, signedIn: Boolean(user) })
    }
    const row = await db.prepare('SELECT * FROM online_runs WHERE id = ?').bind(id).first<Row>()
    if (!row) return json({ error: '학습 기록을 찾을 수 없습니다.' }, 404)
    const state: Run = JSON.parse(row.state)
    if (url.searchParams.has('stats')) {
      const after = Number(url.searchParams.get('stats'))
      if (!Number.isSafeInteger(after) || after < 0 || after > state.episodes.length) {
        return json({ error: '통계 범위를 확인해 주세요.' }, 400)
      }
      const completed = state.episodes.length
      return json({ target: state.target, completed, blocked: state.retries >= retryLimit,
        episodes: state.episodes.slice(after, after + 500) })
    }
    const before = Number(url.searchParams.get('before'))
    if (Number.isSafeInteger(before) && before >= 2) {
      const end = Math.min(before - 1, state.episodes.length)
      return json({ end, episodes: state.episodes.slice(Math.max(0, end - pageSize), end) })
    }
    return json(view(row, state, user))
  }
  if (request.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405)
  if (request.headers.get('Origin') !== url.origin) return json({ error: '사이트에서 요청해 주세요.' }, 403)
  if (!user) return json({ error: '학습을 시작하려면 로그인해 주세요.' }, 401)
  const target = Number(url.searchParams.get('target') ?? (id ? 0 : targets[0]))
  if ((target || !id || url.searchParams.has('target')) && !targets.includes(target)) {
    return json({ error: '학습 횟수는 1,000회 또는 5,000회로 설정해 주세요.' }, 400)
  }
  if (!id) {
    const portals = url.searchParams.get('portals') !== 'off'
    const state: Run = { portals, seed: Date.now() % 2147483648, target, retries: 0,
      paths: [], table: [], episodes: [], frames: [] }
    const row = { id: crypto.randomUUID(), owner: user, revision: 0, state: JSON.stringify(state) }
    const now = Date.now()
    const result = await db.prepare(`INSERT INTO online_runs (id, owner, created_at, state)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM online_runs WHERE owner = ? AND created_at > ?)`)
      .bind(row.id, user, now, row.state, user, now - 30000).run()
    return result.meta.changes ? json(view(row, state, user), 201) : json({ error: '학습을 만들려면 30초 간격을 두어 주세요.' }, 429)
  }
  const row = await db.prepare('SELECT * FROM online_runs WHERE id = ?').bind(id).first<Row>()
  if (!row) return json({ error: '학습 기록을 찾을 수 없습니다.' }, 404)
  if (row.owner !== user) return json({ error: '이 학습을 시작한 팀원만 실행할 수 있습니다.' }, 403)
  const state: Run = JSON.parse(row.state)
  if (target > state.target) {
    state.target = target
    state.retries = 0
  }
  if (state.episodes.length < state.target && state.retries < retryLimit) {
    await advance(state, row.revision)
    const result = await db.prepare('UPDATE online_runs SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?')
      .bind(JSON.stringify(state), id, row.revision).run()
    if (!result.meta.changes) return json({ error: '이미 진행 중입니다. 잠시 뒤 다시 시도해 주세요.' }, 409)
  }
  return json(view(row, state, user))
}

export default {
  async fetch(request: Request, env: { DB: { prepare(sql: string): Statement } }) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/online')) {
      try {
        return await api(request, env.DB, url)
      } catch (error) {
        console.error(error)
        return json({ error: '공유 학습 서버에 연결할 수 없습니다.' }, 503)
      }
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname
    const file = Object.hasOwn(assets, path) ? assets[path] : undefined
    if (!file || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response(null, { status: 404 })
    const [type, contents] = file
    const body = type.startsWith('font/') ? Uint8Array.from(atob(contents), c => c.charCodeAt(0)) : contents
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: { 'Content-Type': type, 'Cache-Control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' },
    })
  },
}
