import type { Outcome } from '../types'

export type RunRecord = { id: string; startedAt: number; target: number; seed: number; completed: number }
export type EpisodeRecord = {
  runId: string; episode: number; stage: number; outcome: Outcome; reward: number; value: number
  actions: number; hp: number; noise: number; weight: number
}

async function transact<T>(mode: IDBTransactionMode, operation: (transaction: IDBTransaction) => IDBRequest<T>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('shh-cerberus-history', 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('runs', { keyPath: 'id' })
      open.result.createObjectStore('episodes', { keyPath: ['runId', 'episode'] })
    }
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(['runs', 'episodes'], mode)
      const request = operation(transaction)
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export function saveEpisode(run: RunRecord, episode: EpisodeRecord) {
  return transact('readwrite', transaction => {
    transaction.objectStore('runs').put({ ...run, completed: episode.episode })
    return transaction.objectStore('episodes').put(episode)
  })
}

export async function listRuns(): Promise<RunRecord[]> {
  const runs = await transact('readonly', transaction => transaction.objectStore('runs').getAll())
  return runs.sort((a, b) => b.startedAt - a.startedAt)
}

export async function listEpisodes(runId: string, first: number, last: number): Promise<EpisodeRecord[]> {
  const range = IDBKeyRange.bound([runId, first], [runId, last])
  const rows = await transact('readonly', transaction => transaction.objectStore('episodes').getAll(range))
  return rows.reverse()
}
