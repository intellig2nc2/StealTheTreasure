import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../dist/server/index.js'

const sqlite = new DatabaseSync(':memory:')
for (const migration of ['0000_online_runs.sql', '0001_online_episode_batches.sql']) {
  sqlite.exec(readFileSync(new URL('../drizzle/' + migration, import.meta.url), 'utf8'))
}
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql)
    function bind(...args) {
      return {
        bind,
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: () => ({ meta: statement.run(...args) }),
      }
    }
    return bind()
  },
  batch(statements) {
    sqlite.exec('BEGIN')
    try {
      const results = statements.map(statement => statement.run())
      sqlite.exec('COMMIT')
      return results
    } catch (error) {
      sqlite.exec('ROLLBACK')
      throw error
    }
  },
}
const origin = 'https://example.test'
const request = (path, method = 'GET', user) => worker.fetch(new Request(origin + path, {
  method, headers: { Origin: origin, ...(user ? { 'oai-authenticated-user-id': user } : {}) },
}), { DB })
const home = await request('/')
assert.match(await home.text(), /<div id="root">/)
const list = '/api/online'
assert.equal((await request(list, 'POST')).status, 401)
assert.equal((await request(list + '?target=20', 'POST', 'owner')).status, 400)
const portals = process.argv.includes('--with-portals')
const goal = process.argv.includes('--full') ? 50000 : 5000
const created = await request(list + `?portals=${portals ? 'on' : 'off'}&target=1000`, 'POST', 'owner')
assert.equal(created.status, 201)
const { id } = await created.json()
assert.equal((await request(list, 'POST', 'owner')).status, 429)
const path = list + '/' + id
assert.equal((await request(path, 'POST', 'viewer')).status, 403)
const concurrent = await Promise.all([request(path, 'POST', 'owner'), request(path, 'POST', 'owner')])
assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409])
const legacyId = '01234567-0123-0123-0123-0123456789ab'
const legacy = [{ score: 0, outcome: 'dead_end', steps: 8 }, { score: 10, outcome: 'escaped', steps: 5 }]
sqlite.prepare('INSERT INTO online_runs (id, owner, created_at, state) VALUES (?, ?, ?, ?)')
  .run(legacyId, 'owner', 1, JSON.stringify({ portals, seed: 123, target: 20, retries: 0,
    episodes: legacy, paths: ['3,18;3,17', '3,18;4,18;3,18'], table: [], frames: [] }))
const legacyPath = list + '/' + legacyId
assert.deepEqual((await (await request(legacyPath + '?stats=0')).json()).episodes, legacy)
assert.equal((await (await request(legacyPath + '?target=50000', 'POST', 'owner')).json()).target, 50000)
assert.deepEqual((await (await request(legacyPath + '?stats=0')).json()).episodes, legacy)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM online_paths WHERE run_id = ?').get(legacyId).count, 2)
const timings = []
let extend = false
for (let i = 0; i < (goal === 50000 ? 40000 : 2000); i++) {
  const timer = performance.now()
  const response = await request(path + (extend ? `?target=${goal}` : ''), 'POST', 'owner')
  timings.push(performance.now() - timer)
  assert.equal(response.status, 200)
  const run = await response.json()
  assert.equal(run.portals, portals)
  assert.ok(run.episodes.length <= 20)
  if (run.blocked || run.completed === goal) break
  if (goal === 50000 && (i + 1) % 2000 === 0) console.log(`${run.completed}/${goal} episodes`)
  extend = run.target === 1000 && run.completed === 1000
}
const run = await (await request(path)).json()
const { state } = sqlite.prepare('SELECT state FROM online_runs WHERE id = ?').get(id)
const { table } = JSON.parse(state)
const { count } = sqlite.prepare('SELECT COUNT(*) AS count FROM online_paths WHERE run_id = ?').get(id)
const episodes = sqlite.prepare('SELECT episodes FROM online_episode_batches WHERE run_id = ? ORDER BY last_episode')
  .all(id).flatMap(row => JSON.parse(row.episodes))
const bytes = Buffer.byteLength(state)
assert.ok(bytes < 1_000_000)
assert.equal(run.owner, false)
assert.equal(run.completed, goal)
assert.equal(count, run.completed)
assert.equal(episodes.length, run.completed)
assert.ok(table.length > 0)
assert.ok(episodes.every(episode => episode.outcome === 'escaped' || episode.score === 0))
assert.equal((await (await request(list)).json()).runs[0].completed, run.completed)
assert.deepEqual(await (await request(path + '?before=21')).json(), { end: 20, episodes: episodes.slice(0, 20) })
assert.equal((await request(path + '?stats=-1')).status, 400)
assert.deepEqual(await (await request(path + '?stats=0')).json(), {
  completed: goal, target: goal, blocked: false, episodes: episodes.slice(0, 500),
})
assert.deepEqual(await (await request(path + `?stats=${goal - 1}`)).json(), {
  completed: goal, target: goal, blocked: false, episodes: episodes.slice(-1),
})
assert.ok(episodes.every(entry => typeof entry.epsilon === 'number' && typeof entry.hp === 'number'))
timings.sort((a, b) => a - b)
console.log(`Verified ${run.completed} unique episodes in ${timings.length} requests. Local p95: ${timings[Math.floor(timings.length * 0.95)].toFixed(1)}ms. Checkpoint: ${bytes} bytes.`)
