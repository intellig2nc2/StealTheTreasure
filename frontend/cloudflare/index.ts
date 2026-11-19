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
type Database = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<{ meta: { changes: number } }[]> }
type Run = {
  portals: boolean
  seed: number
  target: number
  retries: number
  completed?: number
  paths?: string[]
  table: QCheckpoint
  episodes: OnlineEpisode[]
  frames: Frame[]
}
type Row = { id: string; owner: string; revision: number; state: string }
const targets = [1000, 5000, 50000]
const attemptsPerRequest = 10
const retryLimit = 1000
const pageSize = 20
const legacyBatchSize = 100
const count = (state: Run) => state.completed ?? state.episodes.length
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

function view(row: Row, state: Run, user: string | null) {
  const { portals, target, episodes, frames, retries } = state
  return { id: row.id, portals, target, completed: count(state), episodes: episodes.slice(-pageSize),
    frames, blocked: retries >= retryLimit, owner: row.owner === user }
}

async function pathKey(path: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path))
  return Array.from(new Uint8Array(hash, 0, 12), n => n.toString(16).padStart(2, '0')).join('')
}

async function advance(db: Database, row: Row, state: Run) {
  // shortcut: cap the checkpoint to keep loading it within a Worker request's CPU budget.
  const agent = new QLearning((state.seed + row.revision * 1009) >>> 0, 4096)
  agent.restore(state.table)
  const completed = count(state)
  const candidates = []
  for (let attempt = 0; attempt < attemptsPerRequest && attempt < state.target - completed; attempt += 1) {
    candidates.push(await episode(state, agent, completed))
  }
  const { results } = await db.prepare(`SELECT path FROM online_paths
    WHERE run_id = ? AND path IN (SELECT value FROM json_each(?))`)
    .bind(row.id, JSON.stringify(candidates.map(candidate => candidate.key))).all<{ path: string }>()
  const seen = new Set(results.map(result => result.path))
  const paths: string[] = []
  const episodes: OnlineEpisode[] = []
  for (const candidate of candidates) {
    if (seen.has(candidate.key)) {
      state.retries += 1
      if (state.retries >= retryLimit) break
      continue
    }
    state.retries = 0
    seen.add(candidate.key)
    paths.push(candidate.key)
    episodes.push(candidate.result)
    for (const transition of candidate.transitions) agent.remember(transition)
    state.frames = candidate.frames
  }
  state.table = agent.checkpoint()
  state.completed = completed + episodes.length
  state.episodes = [...state.episodes, ...episodes].slice(-pageSize)
  const save = checkpoint(db, row, state)
  if (!episodes.length) return (await save.run()).meta.changes
  const result = await db.batch([
    db.prepare(`INSERT INTO online_paths (run_id, path)
      SELECT r.id, path.value FROM online_runs r, json_each(?) path WHERE r.id = ? AND r.revision = ?`)
      .bind(JSON.stringify(paths), row.id, row.revision),
    db.prepare(`INSERT INTO online_episode_batches (run_id, last_episode, episodes)
      SELECT id, ?, ? FROM online_runs WHERE id = ? AND revision = ?`)
      .bind(state.completed, JSON.stringify(episodes), row.id, row.revision),
    save,
  ])
  return result[2].meta.changes
}

function checkpoint(db: Database, row: Row, state: Run) {
  return db.prepare('UPDATE online_runs SET state = ?, revision = revision + 1 WHERE id = ? AND revision = ?')
    .bind(JSON.stringify(state), row.id, row.revision)
}

async function migrateRun(db: Database, row: Row, state: Run) {
  const paths = await Promise.all((state.paths ?? []).map(path => path.includes(',') ? pathKey(path) : path))
  state.completed = state.episodes.length
  state.episodes = state.episodes.slice(-pageSize)
  delete state.paths
  const result = await db.batch([
    db.prepare(`INSERT INTO online_paths (run_id, path)
      SELECT r.id, p.value FROM online_runs r, json_each(?) p WHERE r.id = ? AND r.revision = ?`)
      .bind(JSON.stringify(paths), row.id, row.revision),
    db.prepare(`INSERT INTO online_episode_batches (run_id, last_episode, episodes)
      SELECT r.id, MAX(CAST(e.key AS INTEGER)) + 1, json_group_array(json(e.value) ORDER BY CAST(e.key AS INTEGER))
      FROM online_runs r, json_each(r.state, '$.episodes') e WHERE r.id = ? AND r.revision = ?
      GROUP BY CAST(e.key AS INTEGER) / ?`).bind(row.id, row.revision, legacyBatchSize),
    checkpoint(db, row, state),
  ])
  return result[2].meta.changes
}

async function history(db: Database, row: Row, state: Run, start: number, end: number) {
  if (end < start) return []
  if (state.completed === undefined) return state.episodes.slice(start - 1, end)
  const { results } = await db.prepare(`SELECT last_episode, episodes FROM online_episode_batches
    WHERE run_id = ? AND last_episode BETWEEN ? AND ? ORDER BY last_episode`)
    .bind(row.id, start, Math.min(state.completed, end + legacyBatchSize - 1))
    .all<{ last_episode: number; episodes: string }>()
  return results.flatMap(batch => {
    const episodes: OnlineEpisode[] = JSON.parse(batch.episodes)
    const first = batch.last_episode - episodes.length + 1
    return episodes.slice(Math.max(0, start - first), Math.max(0, end - first + 1))
  })
}

async function episode(state: Run, agent: QLearning, completed: number) {
  const game = new CaveGame(4, undefined, state.portals)
  const frames = [game.frame()]
  const epsilon = Math.min(1, Math.max(0.10, 1 - 0.9 * completed / (state.target - 1)) + state.retries / 35)
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
  return { key: await pathKey(path), frames, transitions,
    result: { score, outcome: game.outcome, steps: game.step, epsilon, value: game.value,
      moves: game.moves, hp: game.hp, noise: game.noise, weight: game.weight } }
}

async function api(request: Request, db: Database, url: URL) {
  const user = request.headers.get('oai-authenticated-user-id')
  const route = /^\/api\/online(?:\/([0-9a-f-]{36}))?$/.exec(url.pathname)
  if (!route) return json({ error: '주소를 찾을 수 없습니다.' }, 404)
  const id = route[1]
  if (request.method === 'GET') {
    if (!id) {
      const { results } = await db.prepare(`SELECT id, created_at AS createdAt,
        COALESCE(json_extract(state, '$.completed'), json_array_length(state, '$.episodes')) AS completed,
        json_extract(state, '$.target') AS target
        FROM online_runs ORDER BY created_at DESC LIMIT 20`).all()
      return json({ runs: results, signedIn: Boolean(user) })
    }
    const row = await db.prepare(`SELECT id, owner, revision, json_remove(state, '$.table', '$.paths') AS state
      FROM online_runs WHERE id = ?`).bind(id).first<Row>()
    if (!row) return json({ error: '학습 기록을 찾을 수 없습니다.' }, 404)
    const state: Run = JSON.parse(row.state)
    const completed = count(state)
    if (url.searchParams.has('stats')) {
      const after = Number(url.searchParams.get('stats'))
      if (!Number.isSafeInteger(after) || after < 0 || after > completed) {
        return json({ error: '통계 범위를 확인해 주세요.' }, 400)
      }
      return json({ target: state.target, completed, blocked: state.retries >= retryLimit,
        episodes: await history(db, row, state, after + 1, Math.min(after + 500, completed)) })
    }
    const before = Number(url.searchParams.get('before'))
    if (Number.isSafeInteger(before) && before >= 2) {
      const end = Math.min(before - 1, completed)
      return json({ end, episodes: await history(db, row, state, Math.max(1, end - pageSize + 1), end) })
    }
    return json(view(row, state, user))
  }
  if (request.method !== 'POST') return json({ error: '지원하지 않는 요청입니다.' }, 405)
  if (request.headers.get('Origin') !== url.origin) return json({ error: '사이트에서 요청해 주세요.' }, 403)
  if (!user) return json({ error: '학습을 시작하려면 로그인해 주세요.' }, 401)
  const target = Number(url.searchParams.get('target') ?? (id ? 0 : targets[0]))
  if ((target || !id || url.searchParams.has('target')) && !targets.includes(target)) {
    return json({ error: '학습 목표를 1,000회, 5,000회, 50,000회 중에서 선택해 주세요.' }, 400)
  }
  if (!id) {
    const portals = url.searchParams.get('portals') !== 'off'
    const state: Run = { portals, seed: Date.now() % 2147483648, target, retries: 0,
      completed: 0, table: [], episodes: [], frames: [] }
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
  if (count(state) < state.target && state.retries < retryLimit) {
    const updated = state.completed === undefined ? await migrateRun(db, row, state) : await advance(db, row, state)
    if (!updated) return json({ error: '이미 진행 중입니다. 잠시 뒤 다시 시도해 주세요.' }, 409)
  }
  return json(view(row, state, user))
}

export default {
  async fetch(request: Request, env: { DB: Database }) {
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
