export const browserTraining = import.meta.env.MODE === 'sites'
const api = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
let worker: Worker | undefined

function portToWorker(path: string, payload?: object, request = false) {
  worker ??= new Worker(new URL('./local/worker.ts', import.meta.url), { type: 'module' })
  const { port1, port2 } = new MessageChannel()
  worker.postMessage({ path, payload, request }, [port2])
  return port1
}

type Callbacks = {
  open: (socket: Connection) => void
  close: () => void
  message: (data: unknown) => void
}

export type Connection = { readonly readyState: number; send: (data: object) => void; close: () => void }

export function connect(path: string, callbacks: Callbacks): Connection {
  if (browserTraining) {
    const port = portToWorker(path)
    let closed = false
    const connection: Connection = {
      get readyState() { return closed ? WebSocket.CLOSED : WebSocket.OPEN },
      send(data) { port.postMessage(data) },
      close() { closed = true; port.postMessage({ disconnect: true }); port.close() },
    }
    port.onmessage = ({ data }) => callbacks.message(data)
    queueMicrotask(() => { if (!closed) callbacks.open(connection) })
    return connection
  }
  const url = new URL(`${api}/api/${path}`, location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  const websocket = new WebSocket(url)
  const connection: Connection = {
    get readyState() { return websocket.readyState },
    send(data) { websocket.send(JSON.stringify(data)) },
    close() { websocket.close() },
  }
  websocket.onopen = () => callbacks.open(connection)
  websocket.onmessage = ({ data }) => callbacks.message(JSON.parse(data))
  websocket.onclose = callbacks.close
  return connection
}

export async function request(path: string, payload?: object) {
  if (browserTraining) return new Promise<unknown>((resolve, reject) => {
    const port = portToWorker(path, payload, true)
    const timeout = setTimeout(() => { port.close(); reject(new Error('브라우저 학습 작업이 응답하지 않습니다.')) }, 10000)
    port.onmessage = ({ data }) => {
      clearTimeout(timeout)
      port.close()
      if (data.error) reject(new Error(data.error))
      else resolve(data.result)
    }
  })

  const response = await fetch(`${api}/api/${path}`, payload ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.detail === 'string' ? result.detail : '입력 값을 확인해 주세요.')
  return result
}
