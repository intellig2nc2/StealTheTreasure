import { useMemo, useRef, useState } from 'react'
import Cave, { TileIcon, tiles } from './Cave'
import { CaveGame, customLayout, previewLayout } from './local/game'

const baseGrid = () => new CaveGame().layout.grid.map(row => row.slice())
const directions: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
}

export default function MapEditor({ saved, onSave }: { saved?: number[][]; onSave: (grid: number[][]) => void }) {
  const [grid, setGrid] = useState(() => saved ?? baseGrid())
  const [tile, setTile] = useState(1)
  const [focused, setFocused] = useState(0)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const layout = useMemo(() => previewLayout(grid), [grid])

  function paint(index: number) {
    const x = index % 20
    const y = Math.floor(index / 20)
    if (grid[y][x] === tile) return
    setGrid(rows => rows.map((row, line) => row.map((value, column) => {
      if (line === y && column === x) return tile
      return tile === 2 && value === 2 ? 0 : value
    })))
    setNotice('')
    setError('')
  }

  function moveFocus(event: React.KeyboardEvent, index: number) {
    const direction = directions[event.key]
    if (!direction) return
    event.preventDefault()
    const x = Math.max(0, Math.min(19, index % 20 + direction[0]))
    const y = Math.max(0, Math.min(19, Math.floor(index / 20) + direction[1]))
    buttons.current[y * 20 + x]?.focus()
  }

  function save() {
    try {
      onSave(customLayout(grid).grid)
      setError('')
      setNotice('저장했습니다. 동굴 탐험에서 내 지도를 선택할 수 있습니다.')
    } catch (failure) {
      setNotice('')
      setError(failure instanceof Error ? failure.message : '지도를 저장할 수 없습니다.')
    }
  }

  return <>
    <section className="intro">
      <div><h1>지도 <span>편집</span></h1><p>타일을 고른 뒤 20×20 지도에서 바꿀 칸을 누르세요.</p></div>
    </section>
    <div className="workspace editor-workspace">
      <section className="panel">
        <div className="panel-head"><div><span className="square-icon" aria-hidden="true">⌗</span><h2>편집 지도</h2></div><span className="technical">20 × 20</span></div>
        <div className="editor-scroll">
          <div className="editor-map">
            <div aria-hidden="true"><Cave layout={layout} frames={[]} /></div>
            <div className="editor-grid" role="group" aria-label="지도 편집 격자">
              {grid.flat().map((value, index) => <button key={index} type="button"
                ref={element => { buttons.current[index] = element }}
                aria-label={`${index % 20 + 1}열 ${Math.floor(index / 20) + 1}행, ${tiles[value][0]}`}
                tabIndex={index === focused ? 0 : -1}
                onFocus={() => setFocused(index)} onKeyDown={event => moveFocus(event, index)} onClick={() => paint(index)} />)}
            </div>
          </div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><span className="square-icon" aria-hidden="true">◈</span><h2>배치할 타일</h2></div></div>
        <div className="panel-body">
          <div className="editor-palette" role="group" aria-label="배치할 타일">
            {tiles.map(([name, color], value) => <button type="button" key={name}
              aria-pressed={tile === value} onClick={() => setTile(value)}>
              {value < 2 ? <i className="editor-swatch" style={{ background: color }} /> : <TileIcon tile={value} />}
              {name}
            </button>)}
          </div>
          <p className="hint">입구는 하나, 지름길은 두 칸을 한 쌍으로 배치하세요. 방향키로 칸을 이동하고 Enter로 배치할 수 있습니다.</p>
          <div className="editor-actions">
            <button type="button" onClick={() => { setGrid(baseGrid()); setNotice(''); setError('') }}>기본 배치 가져오기</button>
            <button type="button" className="primary" onClick={save}>내 지도 저장</button>
          </div>
          {error && <p className="hint editor-error" role="alert">{error}</p>}
          {notice && <p className="hint" role="status">{notice}</p>}
        </div>
      </section>
    </div>
  </>
}
