export type Entry = { id: string; createdAt: number; completed: number; target: number }

export async function onlineRequest<T>(path = '', method = 'GET'): Promise<T> {
  const response = await fetch('/api/online' + path, { method })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error)
  return data
}
