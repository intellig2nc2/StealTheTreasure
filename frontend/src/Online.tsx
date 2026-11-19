import { useEffect, useMemo, useRef, useState } from 'react'
import Cave from './Cave'
import { CaveGame } from './local/game'
import { outcomeLabels } from './types'
import type { Frame, OnlineEpisode } from './types'
import { onlineRequest as api } from './online-api'
import type { Entry } from './online-api'

type Run = { id: string; portals: boolean; target: number; completed: number; blocked: boolean; owner: boolean; frames: Frame[]
  episodes: OnlineEpisode[] }

export default function Online({ visible }: { visible: boolean }) {
  const [selected, setSelected] = useState(() => location.hash.split('/')[1] ?? '')
  const [entries, setEntries] = useState<Entry[]>([])
  const [signedIn, setSignedIn] = useState(false)
  const [portals, setPortals] = useState(true)
  const [target, setTarget] = useState(1000)
  const [speed, setSpeed] = useState(1)
  const currentSpeed = useRef(speed)
  const [archive, setArchive] = useState<{ id: string; end: number; episodes: OnlineEpisode[] }>()
  const [run, setRun] = useState<Run>()
  const [running, setRunning] = useState(false)
  const observing = visible || running
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [frameIndex, setFrameIndex] = useState(1)
  const episode = run?.completed ?? 0
  const ended = Boolean(run && (run.blocked || episode >= run.target))
  const layout = useMemo(() => new CaveGame(4, undefined, run?.portals).layout, [run?.portals])
  const frames = run?.frames.slice(0, frameIndex) ?? []
  const frame = frames.at(-1)
  const archivePage = archive?.id === selected ? archive : undefined
  const records = archivePage?.episodes ?? run?.episodes ?? []
  const newest = archivePage?.end ?? episode

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    async function refresh() {
      try {
        const data = await api<{ signedIn: boolean; runs: Entry[] }>()
        if (!cancelled) {
          setEntries(data.runs)
          setSignedIn(data.signedIn)
        }
      } catch {
        if (!cancelled) setError('공유 학습 목록을 불러오지 못했습니다.')
      }
    }
    void refresh()
    const timer = setInterval(refresh, 5000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [visible])

  useEffect(() => {
    if (!selected || !observing || (ended && !running)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const next = await api<Run>('/' + selected, running && !ended ? 'POST' : 'GET')
        if (cancelled) return
        setRun(next)
        setError('')
        if (next.blocked || next.completed >= next.target) setRunning(false)
        else timer = setTimeout(refresh, running ? Math.max(40, 600 / currentSpeed.current) : 2000)
      } catch (failure) {
        if (cancelled) return
        setError(failure instanceof Error ? failure.message : '학습 상태를 불러오지 못했습니다.')
        setRunning(false)
        if (!running) timer = setTimeout(refresh, 5000)
      }
    }
    void refresh()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [selected, running, ended, observing])

  useEffect(() => {
    setFrameIndex(1)
    const count = run?.frames.length ?? 0
    if (!visible || count < 2) return
    if (speed === 100) {
      setFrameIndex(count)
      return
    }
    const timer = setInterval(() => setFrameIndex(index => {
      if (index + 1 >= count) clearInterval(timer)
      return Math.min(index + 1, count)
    }), Math.max(16, Math.min(110, 1450 / count) / speed))
    return () => clearInterval(timer)
  }, [run?.id, episode, run?.frames.length, visible, speed])

  function choose(id: string) {
    setSelected(id)
    setRun(undefined)
    setArchive(undefined)
    setRunning(false)
    setError('')
    history.replaceState(null, '', id ? '#online/' + id : '#online')
  }

  async function start() {
    setBusy(true)
    setError('')
    try {
      const next = await api<Run>(`?target=${target}&portals=${portals ? 'on' : 'off'}`, 'POST')
      choose(next.id)
      setRun(next)
      setRunning(true)
      setEntries(items => [{ id: next.id, createdAt: Date.now(), completed: 0, target: next.target }, ...items])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '학습을 시작하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function extend() {
    if (!run) return
    setBusy(true)
    try {
      setRun(await api<Run>(`/${run.id}?target=${target}`, 'POST'))
      setRunning(true)
      setError('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '학습을 연장하지 못했습니다.')
    } finally {
      setBusy(false)
    }
  }

  async function earlier() {
    const before = newest - records.length + 1
    try {
      const page = await api<{ end: number; episodes: OnlineEpisode[] }>(`/${selected}?before=${before}`)
      setArchive({ id: selected, ...page })
    } catch {
      setError('이전 회차를 불러오지 못했습니다.')
    }
  }

  return <>
    <section className="intro">
      <div><p className="kicker">Q-learning</p><h1>온라인 <span>학습</span></h1>
        <p>서버에서 실행하는 탐험을 팀과 함께 보고, 회차별 점수를 확인하세요.</p></div>
      {run && <div className="intro-status"><span>{ended ? run.blocked ? '새 경로를 찾지 못했습니다' : '학습 완료' : running ? '학습 중' : '진행 및 기록 보기'}</span>
        <strong>{episode.toLocaleString('ko-KR')}<small> / {run.target.toLocaleString('ko-KR')} 회</small></strong></div>}
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="workspace">
      <section className="panel board">
        <div className="panel-head"><h2>동굴 지도</h2><span className="technical">20 × 20 · STAGE 4</span></div>
        <div className="board-body">
          <div className="map-wrap"><Cave layout={layout} frames={frames} /></div>
          <div className="map-status"><strong>{frame ? outcomeLabels[frame.outcome] : '학습 선택 대기'}</strong>
            <span>{frame && (frame.outcome === 'running' ? `수집 점수 ${frame.value}` : `정산 점수 ${run?.episodes.at(-1)?.score ?? 0}`)}</span></div>
        </div>
      </section>
      <aside className="rail">
        <section className="panel board">
          <div className="panel-head"><h2>공유 학습</h2></div>
          <div className="board-body">
            <label className="episode-select"><span>최근 학습</span><select value={selected} onChange={event => choose(event.target.value)}>
              <option value="">학습 선택</option>
              {selected && !entries.some(entry => entry.id === selected) && <option value={selected}>공유 링크의 학습</option>}
              {entries.map(entry => <option key={entry.id} value={entry.id}>
                {new Date(entry.createdAt).toLocaleString('ko-KR')} · {entry.id.slice(0, 5)} · {entry.completed}/{entry.target}회
              </option>)}
            </select></label>
            <p className="hint">시작한 사람이 브라우저 탭을 열어 두면 학습이 계속됩니다. 현재 주소를 공유하면 팀원도 같은 학습을 볼 수 있습니다.</p>
            <label className="episode-select"><span>배속</span><select value={speed} onChange={event => {
              currentSpeed.current = Number(event.target.value)
              setSpeed(currentSpeed.current)
            }}>
              {[1, 2, 5, 10, 100].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
            </select></label>
            {signedIn ? <div>
              <label className="episode-select"><span>목표 회차</span><select value={target}
                onChange={event => setTarget(Number(event.target.value))}>
                <option value={1000}>1,000회</option><option value={5000}>5,000회</option>
                <option value={50000}>50,000회</option>
              </select></label>
              <label className="map-toggle"><input type="checkbox" checked={!portals} onChange={event => setPortals(!event.target.checked)} /> 지름길 없이</label>
              <button className="primary" disabled={busy || running} onClick={start}>새 학습 시작</button>
              {run?.owner && target > run.target && <button disabled={busy || running} onClick={extend}>
                {target.toLocaleString('ko-KR')}회까지 이어서 학습
              </button>}
            </div> : <a href="/signin-with-chatgpt?return_to=%2F%23online">로그인하고 학습 시작</a>}
            {run?.owner && !ended && <button type="button" onClick={() => setRunning(!running)}>{running ? '일시 정지' : '이어서 학습'}</button>}
          </div>
        </section>
        <section className="panel board">
          <div className="panel-head"><h2>회차별 기록</h2></div>
          <div className="board-body">
            {episode === 0 ? <p className="hint">첫 탐험이 끝나면 점수가 표시됩니다.</p> :
              <ol reversed start={newest}>{records.slice().reverse().map((result, index) => <li key={newest - index}>
                {outcomeLabels[result.outcome]} · {result.score}점 · {result.steps}행동
              </li>)}</ol>}
            {newest > records.length && <button onClick={earlier}>이전 회차</button>}
            {archivePage && <button onClick={() => setArchive(undefined)}>최신 회차</button>}
          </div>
        </section>
      </aside>
    </div>
  </>
}
