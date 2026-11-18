import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import Cave, { TileIcon, tiles } from './Cave'
import { WEIGHT_LIMIT, algorithmLabels, events, outcomeLabels, replays } from './types'
import type { Algorithm, Frame, Layout, Replay, Row, Status, Trace, Watch } from './types'
import '@fontsource-variable/space-grotesk'
import './style.css'
import { browserTraining, connect, request } from './transport'
import type { Connection } from './transport'
import { readCustomGrid, saveCustomGrid } from './customMap'

const Statistics = lazy(() => import('./Statistics'))
const History = lazy(() => import('./History'))
const MapEditor = lazy(() => import('./MapEditor'))
const speeds = [1, 2, 5, 10, 50, 'MAX'] as const
type Speed = typeof speeds[number]
type Mode = 'manual' | 'training' | 'replay'
const statusLabels: Record<Status, string> = {
  idle: '학습 대기', running: '학습 중', paused: '일시정지', stopping: '중단 중',
  evaluating: '최종 평가 중', stopped: '중단됨', completed: '학습 완료', error: '학습 오류',
}
const controls = [
  ['↑', '위로 이동'], ['↓', '아래로 이동'], ['←', '왼쪽으로 이동'], ['→', '오른쪽으로 이동'], ['◆', '보석 수집'],
]
const gemInfo = ['가치 10 · 1kg · 소음 +2', '가치 30 · 3kg · 소음 +2', '가치 60 · 5kg · 소음 +2', '가치 120 · 8kg · 소음 +2']
const keys: Record<string, number> = { ArrowUp: 0, w: 0, ArrowDown: 1, s: 1, ArrowLeft: 2, a: 2, ArrowRight: 3, d: 3, ' ': 4, e: 4 }
const initial: Watch = {
  run_id: '', status: 'idle', episode: 0, total: 0, history: [], live: null,
  replays: [], evaluation: null, error: null, checkpoint: false, device: null, cuda: false, config: null,
}

function useSocket(path: string, receive: (data: unknown) => void, onOpen?: (socket: Connection) => void) {
  const socket = useRef<Connection | null>(null)
  const callbacks = useRef({ receive, onOpen })
  callbacks.current = { receive, onOpen }
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let active = true
    function open() {
      socket.current = connect(path, {
        open: connection => {
          if (!active) return
          setConnected(true)
          callbacks.current.onOpen?.(connection)
        },
        message: data => { if (active) callbacks.current.receive(data) },
        close: () => {
          if (!active) return
          setConnected(false)
          timer = setTimeout(open, 1500)
        },
      })
    }
    open()
    return () => {
      active = false
      clearTimeout(timer)
      socket.current?.close()
    }
  }, [path])
  return { socket, connected }
}

function Meter({ label, value, limit, suffix, tone }: { label: string; value?: number; limit?: number; suffix?: string; tone: string }) {
  return <div className="meter" style={{ '--tone': tone } as React.CSSProperties}>
    <div><span className="meter-label"><i />{label}</span><strong>{value ?? '—'}{suffix}<small>{limit && ` / ${limit}`}</small></strong></div>
    {limit && <div className="meter-track" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit}
      aria-valuenow={Math.max(0, Math.min(value ?? 0, limit))}>
      <b style={{ width: `${Math.min(100, ((value ?? 0) / limit) * 100)}%` }} />
    </div>}
  </div>
}

function App() {
  const [tab, setTab] = useState<'cave' | 'stats' | 'history' | 'editor'>('cave')
  const [mode, setMode] = useState<Mode>('manual')
  const [speed, setSpeed] = useState<Speed>(5)
  const [watch, setWatch] = useState(initial)
  const [history, setHistory] = useState<Row[]>([])
  const [manualLayout, setManualLayout] = useState<Layout>()
  const [manualFrames, setManualFrames] = useState<Frame[]>([])
  const [manualSeed, setManualSeed] = useState('')
  const [savedGrid, setSavedGrid] = useState(() => browserTraining ? readCustomGrid() : undefined)
  const [manualCustomMap, setManualCustomMap] = useState(false)
  const [trainingCustomMap, setTrainingCustomMap] = useState(false)
  const [manualNoPortals, setManualNoPortals] = useState(false)
  const [manualBusy, setManualBusy] = useState(false)
  const [latest, setLatest] = useState<Trace>()
  const [trace, setTrace] = useState<Trace>()
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [selected, setSelected] = useState<Replay>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preset, setPreset] = useState(browserTraining ? '1000' : '20000')
  const [custom, setCustom] = useState('100')
  const [seed, setSeed] = useState('42')
  const [decay, setDecay] = useState('16000')
  const [evaluationSeed, setEvaluationSeed] = useState('2147483648')
  const [evaluationEpisodes, setEvaluationEpisodes] = useState('20')
  const [algorithm, setAlgorithm] = useState<Algorithm>('dqn')
  const [trainingNoPortals, setTrainingNoPortals] = useState(false)
  const [curriculum, setCurriculum] = useState(false)
  const [randomMaps, setRandomMaps] = useState(false)
  const [gpu, setGpu] = useState(false)
  const [resumeModel, setResumeModel] = useState(false)
  const modelAvailable = algorithm === 'q_learning' ? Boolean(watch.q_checkpoint) : watch.checkpoint
  const run = useRef('')
  const manual = useSocket('play', packet => {
    const data = packet as { layout?: Layout; frame?: Frame; error?: string }
    setManualBusy(false)
    if (data.error) setError(data.error)
    if (data.layout) setManualLayout(data.layout)
    if (data.frame) {
      const frame = data.frame
      setManualFrames(frames => data.layout ? [frame] : [...frames, frame])
    }
  }, () => setManualBusy(false))
  const watcher = useSocket('watch', packet => {
    const data = packet as Watch
    if (run.current !== data.run_id) {
      run.current = data.run_id
      setHistory(data.history)
      setLatest(data.live ?? undefined)
      if (mode === 'training') { setTrace(undefined); setIndex(0) }
    } else {
      if (data.history.length) setHistory(rows => [...rows, ...data.history.filter(row => row.episode > rows.length)])
      if (data.live) setLatest(data.live)
    }
    setWatch(data)
  }, socket => socket.send({ max_speed: speed === 'MAX' }))

  useEffect(() => {
    if (watcher.socket.current?.readyState === WebSocket.OPEN) {
      watcher.socket.current.send({ max_speed: speed === 'MAX' })
    }
  }, [speed, watcher.socket])

  useEffect(() => {
    if (mode !== 'training' || !latest || speed === 'MAX') return
    if (trace?.episode === latest.episode) {
      if (trace !== latest) setTrace(latest)
    } else if (!trace || index >= trace.frames.length - 1) {
      setTrace(latest)
      setIndex(0)
    }
  }, [latest, trace, index, mode, speed])

  const traceLength = useRef(0)
  traceLength.current = trace?.frames.length ?? 0
  useEffect(() => {
    if (mode === 'manual' || speed === 'MAX' || !playing) return
    const timer = setInterval(() => setIndex(value => Math.max(0,
      Math.min(traceLength.current - 1, value + (speed === 50 ? 4 : 1)))), Math.max(32, 450 / speed))
    return () => clearInterval(timer)
  }, [mode, speed, playing])

  const hideLive = mode === 'training' && speed === 'MAX'
  const layout = mode === 'manual' || hideLive ? manualLayout : trace?.layout ?? manualLayout
  const frames = mode === 'manual' ? manualFrames : hideLive ? [] : trace?.frames.slice(0, speed === 'MAX' ? undefined : index + 1) ?? []
  const frame = frames.at(-1)
  const active = ['running', 'paused', 'evaluating', 'stopping'].includes(watch.status)

  function play(action: number) {
    if (mode !== 'manual' || manualBusy || frame?.outcome !== 'running' || !frame.mask[action]
      || manual.socket.current?.readyState !== WebSocket.OPEN) return
    setManualBusy(true)
    manual.socket.current.send({ action })
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (tab !== 'cave' || mode !== 'manual' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey
        || (event.target instanceof HTMLElement && (event.target.closest('input, select, textarea, [contenteditable]') || (event.key === ' ' && event.target.closest('button, a'))))) return
      const action = keys[event.key]
      if (action !== undefined) { event.preventDefault(); play(action) }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  function restart() {
    if (manual.socket.current?.readyState !== WebSocket.OPEN) return
    if (!manualCustomMap && manualSeed !== '' && (!/^\d+$/.test(manualSeed) || Number(manualSeed) > 4294967295)) {
      setError('지도 시드는 0~4294967295의 정수여야 합니다.')
      return
    }
    setError('')
    setManualBusy(true)
    manual.socket.current.send({
      seed: manualCustomMap || manualSeed === '' ? null : Number(manualSeed),
      ...(browserTraining ? { portals: !manualNoPortals, custom_grid: manualCustomMap ? savedGrid : undefined } : {}),
    })
  }

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await request('train', {
        episodes: Number(preset === 'custom' ? custom : preset), seed: Number(seed), epsilon_decay: Number(decay),
        curriculum: !trainingCustomMap && curriculum, random_maps: !trainingCustomMap && randomMaps, gpu: gpu && watch.cuda, load_checkpoint: resumeModel && modelAvailable,
        ...(browserTraining ? { algorithm, portals: !trainingNoPortals, custom_grid: trainingCustomMap ? savedGrid : undefined } : {}),
        evaluation_seed: trainingCustomMap ? 2147483648 : Number(evaluationSeed), evaluation_episodes: Number(evaluationEpisodes),
      })
      setTrace(undefined)
      setIndex(0)
      setSelected(undefined)
      setPlaying(true)
      setMode('training')
      setTab('cave')
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function control(action: string) {
    setBusy(true)
    setError('')
    try { await request('control', { action }) }
    catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  async function replay(name: Replay) {
    setBusy(true)
    setError('')
    try {
      const result = await request(`replays/${name}`) as Trace
      setTrace(result)
      setIndex(0)
      setSelected(name)
      setPlaying(true)
      setMode('replay')
      setTab('cave')
    } catch (problem) { setError((problem as Error).message) }
    finally { setBusy(false) }
  }

  function observe() {
    setTrace(undefined)
    setIndex(0)
    setPlaying(true)
    setMode('training')
  }

  return <>
    <a className="skip-link" href="#game">본문으로 건너뛰기</a>
    <header className="top">
      <div className="top-inner">
        <button className="brand" onClick={() => setTab('cave')}><span className="brand-mark">◆</span><span>SHH!<em> CERBERUS</em></span></button>
        <nav aria-label="화면 선택">
          <button aria-current={tab === 'cave' ? 'page' : undefined} onClick={() => setTab('cave')}>동굴 탐험</button>
          <button aria-current={tab === 'stats' ? 'page' : undefined} onClick={() => setTab('stats')}>학습 통계</button>
          {browserTraining && <button aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>학습 기록</button>}
          {browserTraining && <button aria-current={tab === 'editor' ? 'page' : undefined} onClick={() => setTab('editor')}>지도 편집</button>}
        </nav>
        <span className="connection"><i className={watcher.connected ? 'online' : ''} />{browserTraining ? (watcher.connected ? '내 브라우저에서 실행' : '브라우저 준비 중') : (watcher.connected ? '서버 연결됨' : '서버 연결 대기')}</span>
      </div>
    </header>

    <main id="game" tabIndex={-1} data-enter="">
      {error && <p className="error" role="alert">{error} <button onClick={() => setError('')}>닫기</button></p>}
      {tab === 'cave' ? <>
        <section className="intro">
          <div><p className="kicker">강화학습 시뮬레이션</p>
            <h1>쉿! <span>케르베로스</span></h1>
            <p>잠든 수호견을 피해 보석을 모으고, 살아서 입구로 돌아오세요.</p></div>
          <div className="intro-status"><span>{statusLabels[watch.status]}</span><strong>{watch.episode.toLocaleString('ko-KR')}<small> / {watch.total.toLocaleString('ko-KR')} 회</small></strong></div>
        </section>

        <div className="workspace">
          <section className="panel board">
            <div className="panel-head"><div><span className="square-icon" aria-hidden="true">⌗</span><h2>동굴 지도</h2></div>
              <span className="technical">20 × 20{layout ? ` · STAGE ${layout.stage}` : ''}</span></div>
            <div className="board-body">
              <div className="map-wrap" data-visual="">
                <Cave layout={layout} frames={frames} />
                {!layout && <div className="map-notice">서버에 연결하는 중</div>}
                {hideLive && <div className="map-notice">MAX · 그래프에서 진행 상황을 확인하세요.</div>}
              </div>
              <div className="map-status">
                <div><i className={frame?.outcome === 'running' ? 'online' : ''} /><strong>{frame ? outcomeLabels[frame.outcome] : '탐험 대기'}</strong>
                  {frame?.outcome === 'running' && <span>{events[frame.event]}</span>}
                  {frame?.outcome === 'escaped' && <span>정산 점수 {frame.value}</span>}
                  {frame && !['running', 'escaped'].includes(frame.outcome) && <span>정산 점수 0</span>}
                </div>
                <span className="technical">{frame?.step ?? '—'} / 200 행동</span>
              </div>
            </div>
            <div className="legend" aria-label="지도 범례">
              {[2, 8, 9, 10, 11, 12, 3, 4, 5, 6, 7].filter(tile => tile !== 6 || layout?.portals.length).map(tile =>
                <span key={tile} title={gemInfo[tile - 9] ?? tiles[tile][0]}><TileIcon tile={tile} />{tiles[tile][0]}</span>)}
            </div>
          </section>

          <aside className="rail" aria-label="탐험 및 학습 제어">
            <section className="panel vitals">
              <div className="panel-head"><div><span className="square-icon" aria-hidden="true">✚</span><h2>탐험 상태</h2></div>
                <span className="technical">{mode === 'manual' ? '직접 플레이' : mode === 'replay' && selected ? replays[selected] : 'AI 에이전트'}</span></div>
              <div className="meters">
                <Meter label="체력" value={frame?.hp} limit={100} tone="#91b39b" />
                <Meter label="소음" value={frame?.noise} limit={100} tone="#e38f6d" />
                <Meter label="무게" value={frame?.weight} limit={WEIGHT_LIMIT} suffix="kg" tone="#9bb2d2" />
                <Meter label="수집한 보석 가치" value={frame?.value} tone="#ecc37f" />
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><div><span className="square-icon" aria-hidden="true">◈</span><h2>탐험 제어</h2></div>
                <div className="switch">
                  <button aria-pressed={mode === 'manual'} onClick={() => setMode('manual')}>직접 플레이</button>
                  <button aria-pressed={mode === 'training'} onClick={observe}>AI 관찰</button>
                </div>
              </div>
              <div className="panel-body">
                {mode === 'manual' ? <>
                  <div className="action-row">
                    {controls.map(([icon, label], i) => <button key={label} className={i === 4 ? 'collect' : ''} title={label}
                      aria-label={label} onClick={() => play(i)} disabled={!manual.connected || frame?.outcome !== 'running' || !frame.mask[i]}>
                      {icon}{i === 4 && <span>수집</span>}</button>)}
                  </div>
                  <div className="manual-reset">
                    <label><span>지도 시드</span><input inputMode="numeric" disabled={manualCustomMap} value={manualSeed} onChange={event => setManualSeed(event.target.value)} placeholder="기본 지도" /></label>
                    <button disabled={!manual.connected || manualBusy} onClick={restart}>다시 시작</button>
                  </div>
                  {savedGrid && <label className="map-toggle"><input type="checkbox" checked={manualCustomMap}
                    onChange={event => setManualCustomMap(event.target.checked)} />내 지도 사용 (다시 시작 시 적용)</label>}
                  {browserTraining && <label className="map-toggle"><input type="checkbox" checked={manualNoPortals}
                    onChange={event => setManualNoPortals(event.target.checked)} />지름길 없는 지도 (다시 시작 시 적용)</label>}
                  <p className="hint">방향키 또는 WASD로 이동 · E 또는 Space로 수집. 밟은 칸은 다시 갈 수 없고, 입구로 돌아오면 탈출합니다.</p>
                </> : <>
                  <p className="observer">{trace ? `에피소드 ${trace.episode.toLocaleString('ko-KR')} · ε ${trace.epsilon.toFixed(2)}` : '학습을 시작하면 AI를 관찰할 수 있습니다.'}</p>
                  <div className="speed-row" aria-label="화면 재생 배속">
                    {speeds.map(value => <button key={value} aria-pressed={speed === value} onClick={() => setSpeed(value)}>{value}{value === 'MAX' ? '' : '×'}</button>)}
                  </div>
                  {mode === 'replay' && trace && <div className="replay-controls">
                    <button disabled={speed === 'MAX'} onClick={() => setPlaying(value => !value)}>{playing ? '재생 멈춤' : '계속 재생'}</button>
                    <button onClick={() => { setIndex(0); setPlaying(true); if (speed === 'MAX') setSpeed(5) }}>처음부터</button>
                    <input aria-label="리플레이 행동 위치" type="range" min="0" max={trace.frames.length - 1}
                      disabled={speed === 'MAX'} value={speed === 'MAX' ? trace.frames.length - 1 : index}
                      onChange={event => { setIndex(Number(event.target.value)); setPlaying(false) }} />
                  </div>}
                </>}
              </div>
            </section>

            <section className="panel trainer">
              <div className="panel-head"><div><span className="square-icon" aria-hidden="true">▤</span><h2>학습 설정</h2></div>
                <span className="technical">{watch.device?.toUpperCase() ?? 'CPU'} · {algorithmLabels[(active ? watch.config?.algorithm : algorithm) ?? 'dqn']}</span></div>
              <form className="panel-body" onSubmit={start}>
                <fieldset disabled={active || busy}>
                  <label className="episode-select"><span>학습 에피소드</span>
                    <select value={preset} onChange={event => setPreset(event.target.value)}>
                      {[1000, 5000, 10000, 20000, 50000].map(n => <option value={n} key={n}>{n.toLocaleString('ko-KR')}회{n === (browserTraining ? 1000 : 20000) ? ' · 기본 학습' : ''}</option>)}
                      <option value="custom">직접 입력</option>
                    </select>
                  </label>
                  {preset === 'custom' && <label className="custom"><span>에피소드 수</span><input type="number" min="1" max="50000" required value={custom} onChange={event => setCustom(event.target.value)} /></label>}
                  {browserTraining && <div className="training-variant">
                    <label className="episode-select"><span>학습 알고리즘</span>
                      <select value={algorithm} onChange={event => { setAlgorithm(event.target.value as Algorithm); setResumeModel(false) }}>
                        <option value="dqn">Double DQN</option><option value="q_learning">Q-learning</option>
                      </select>
                    </label>
                    {savedGrid && <label className="map-toggle"><input type="checkbox" checked={trainingCustomMap}
                      onChange={event => setTrainingCustomMap(event.target.checked)} />학습에 내 지도 사용</label>}
                    <label className="map-toggle"><input type="checkbox" checked={trainingNoPortals}
                      onChange={event => setTrainingNoPortals(event.target.checked)} />학습에 지름길 없는 지도 사용</label>
                  </div>}
                  <details><summary>시드 및 고급 옵션</summary><div className="advanced">
                    <label>학습 시드<input type="number" min="0" max="2147483647" required value={seed} onChange={event => setSeed(event.target.value)} /></label>
                    <label>ε 감소 기간<input type="number" min="1" max="50000" required value={decay} onChange={event => setDecay(event.target.value)} /></label>
                    <label>평가 시드<input type="number" min="2147483648" max="4294967195" required disabled={trainingCustomMap} value={evaluationSeed} onChange={event => setEvaluationSeed(event.target.value)} /></label>
                    <label>평가 에피소드<input type="number" min="1" max="100" required value={evaluationEpisodes} onChange={event => setEvaluationEpisodes(event.target.value)} /></label>
                    <label className="check"><input type="checkbox" disabled={trainingCustomMap} checked={!trainingCustomMap && curriculum} onChange={event => setCurriculum(event.target.checked)} />쉬운 지도부터 단계별 학습</label>
                    <label className="check"><input type="checkbox" disabled={trainingCustomMap} checked={!trainingCustomMap && randomMaps} onChange={event => setRandomMaps(event.target.checked)} />시드 기반 랜덤 지도</label>
                    <label className="check"><input type="checkbox" checked={gpu && watch.cuda} disabled={!watch.cuda} onChange={event => setGpu(event.target.checked)} />CUDA 사용</label>
                    <label className="check"><input type="checkbox" checked={resumeModel && modelAvailable} disabled={!modelAvailable} onChange={event => setResumeModel(event.target.checked)} />저장 모델 불러오기</label>
                  </div></details>
                </fieldset>
                {browserTraining && <p className="hint">학습은 이 탭에서 실행되고 완료·중단 시 모델이 이 브라우저에 저장됩니다.</p>}
                <div className="progress-meta"><span>{statusLabels[watch.status]}</span><span>{watch.total ? (100 * watch.episode / watch.total).toFixed(1) : '0'}%</span></div>
                <progress aria-label="학습 진행률" value={watch.episode} max={watch.total || 1} />
                <div className="training-actions">
                  {active ? <>
                    {['running', 'paused'].includes(watch.status) && <button type="button" className="primary" disabled={busy} onClick={() => control(watch.status === 'paused' ? 'resume' : 'pause')}>
                      {watch.status === 'paused' ? '▶ 학습 재개' : 'Ⅱ 일시정지'}</button>}
                    <button type="button" disabled={busy || watch.status === 'stopping'} onClick={() => control('stop')}>■ 중단</button>
                  </> : <button className="primary" disabled={busy || !watcher.connected} type="submit">▶ 학습 시작</button>}
                </div>
                {watch.error && <p className="hint" role="alert">{watch.error}</p>}
              </form>
            </section>
          </aside>
        </div>
        {watch.replays.length > 0 && <section className="panel replay-list" aria-label="대표 에피소드 리플레이">
          <h2>대표 에피소드 다시 보기</h2>
          <div>{watch.replays.map(name => <button key={name} disabled={busy} aria-pressed={mode === 'replay' && selected === name} onClick={() => replay(name)}>{replays[name]}</button>)}</div>
        </section>}
      </> : tab === 'editor' ? <Suspense fallback={<p>지도 편집기를 여는 중</p>}>
        <MapEditor saved={savedGrid} onSave={grid => { saveCustomGrid(grid); setSavedGrid(grid) }} />
      </Suspense> : tab === 'history' ? <Suspense fallback={<p>학습 기록을 여는 중</p>}>
        <History runId={watch.run_id} completed={watch.episode} warning={watch.error} />
      </Suspense> : <Suspense fallback={<p>학습 통계를 여는 중</p>}><Statistics history={history} watch={watch} replay={replay} busy={busy} /></Suspense>}
    </main>
    <footer><span>SHH! CERBERUS</span><a href="https://github.com/intellig2nc2/StealTheTreasure">GitHub ↗</a></footer>
  </>
}

createRoot(document.getElementById('root')!).render(<App />)
