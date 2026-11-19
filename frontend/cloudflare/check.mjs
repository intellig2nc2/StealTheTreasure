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
const created = await request(list + '?portals=off', 'POST', 'owner')
assert.equal(created.status, 201)
const { id } = await created.json()
assert.equal((await request(list, 'POST', 'owner')).status, 429)
const path = list + '/' + id
assert.equal((await request(path, 'POST', 'viewer')).status, 403)
for (let i = 0; i < 65; i++) {
  const response = await request(path, 'POST', 'owner')
  assert.equal(response.status, 200)
  const run = await response.json()
  assert.equal(run.portals, false)
  if (run.blocked || run.episodes.length === run.target) break
}
const run = await (await request(path)).json()
const { state } = sqlite.prepare('SELECT state FROM online_runs WHERE id = ?').get(id)
const { paths, table } = JSON.parse(state)
assert.equal(run.owner, false)
assert.ok(run.episodes.length > 1)
assert.equal(new Set(paths).size, run.episodes.length)
assert.ok(table.length > 0)
assert.ok(run.episodes.every(episode => episode.outcome === 'escaped' || episode.score === 0))
assert.equal((await (await request(list)).json()).runs[0].completed, run.episodes.length)
console.log(`Verified Worker and SQLite migration with ${run.episodes.length} unique episodes.`)
