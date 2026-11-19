import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../dist/server/index.js'

const sqlite = new DatabaseSync(':memory:')
sqlite.exec(readFileSync(new URL('../drizzle/0000_online_runs.sql', import.meta.url), 'utf8'))
const DB = {
  prepare(sql) {
    const statement = sqlite.prepare(sql)
    function bind(...args) {
      return {
        bind,
        first: async () => statement.get(...args) ?? null,
        all: async () => ({ results: statement.all(...args) }),
        run: async () => ({ meta: statement.run(...args) }),
      }
    }
    return bind()
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
const created = await request(list + `?portals=${portals ? 'on' : 'off'}&target=1000`, 'POST', 'owner')
assert.equal(created.status, 201)
const { id } = await created.json()
assert.equal((await request(list, 'POST', 'owner')).status, 429)
const path = list + '/' + id
assert.equal((await request(path, 'POST', 'viewer')).status, 403)
const timings = []
let extend = false
for (let i = 0; i < 2000; i++) {
  const timer = performance.now()
  const response = await request(path + (extend ? '?target=5000' : ''), 'POST', 'owner')
  timings.push(performance.now() - timer)
  assert.equal(response.status, 200)
  const run = await response.json()
  assert.equal(run.portals, portals)
  assert.ok(run.episodes.length <= 20)
  if (run.blocked || run.completed === 5000) break
  extend = run.target === 1000 && run.completed === 1000
}
const run = await (await request(path)).json()
const { state } = sqlite.prepare('SELECT state FROM online_runs WHERE id = ?').get(id)
const { paths, table, episodes } = JSON.parse(state)
const bytes = Buffer.byteLength(state)
assert.ok(bytes < 1_000_000)
assert.equal(run.owner, false)
assert.equal(run.completed, 5000)
assert.equal(new Set(paths).size, run.completed)
assert.ok(table.length > 0)
assert.ok(episodes.every(episode => episode.outcome === 'escaped' || episode.score === 0))
assert.equal((await (await request(list)).json()).runs[0].completed, run.completed)
assert.deepEqual(await (await request(path + '?before=21')).json(), { end: 20, episodes: episodes.slice(0, 20) })
timings.sort((a, b) => a - b)
console.log(`Verified ${run.completed} unique episodes in ${timings.length} requests. Local p95: ${timings[Math.floor(timings.length * 0.95)].toFixed(1)}ms. Checkpoint: ${bytes} bytes.`)
