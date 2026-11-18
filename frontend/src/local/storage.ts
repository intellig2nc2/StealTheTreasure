import type { Checkpoint } from './dqn'

export async function checkpoint(value?: Checkpoint): Promise<Checkpoint | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('shh-cerberus', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('models')
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => reject(open.error)
  })
  try {
    return await new Promise<Checkpoint | undefined>((resolve, reject) => {
      const transaction = db.transaction('models', value ? 'readwrite' : 'readonly')
      const store = transaction.objectStore('models')
      const operation = value ? store.put(value, 'double-dqn-browser-v1') : store.get('double-dqn-browser-v1')
      transaction.oncomplete = () => resolve(value ?? operation.result)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}
