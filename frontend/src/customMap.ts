const storageKey = 'shh-cerberus-custom-layout-v1'

export function readCustomGrid(): number[][] | undefined {
  try {
    const value = localStorage.getItem(storageKey)
    if (!value) return
    const grid: unknown = JSON.parse(value)
    if (Array.isArray(grid) && grid.length === 20 && grid.every(row => Array.isArray(row) &&
        row.length === 20 && row.every(tile => Number.isInteger(tile) && tile >= 0 && tile <= 12))) {
      return grid
    }
  } catch {
    return
  }
}

export function saveCustomGrid(grid: number[][]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(grid))
  } catch {
    throw new Error('브라우저에 지도를 저장할 수 없습니다.')
  }
}
