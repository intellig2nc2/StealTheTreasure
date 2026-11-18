import type { Checkpoint } from './dqn'
import type { QCheckpoint } from './qlearning'

async function stored<T>(key: string, value?: T): Promise<T | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('shh-cerberus', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('models')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction('models', value !== undefined ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('models')
      const operation = value !== undefined ? store.put(value, key) : store.get(key)
      transaction.oncomplete = () => resolve(value ?? operation.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

export const checkpoint = (value?: Checkpoint) => stored('double-dqn-browser-v1', value)
export const qCheckpoint = (value?: QCheckpoint) => stored('q-learning-browser-v1', value)
