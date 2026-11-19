import { useEffect, useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { OnlineEpisode, Replay, Row, Summary, Watch } from './types'
import { replays } from './types'
import { onlineRequest } from './online-api'
import type { Entry } from './online-api'

const tooltip = { background: '#212018', borderColor: '#4a4030', color: '#f2e7d0' }
const tones = ['#efbd72', '#9db5a4', '#9fb8d1', '#e28b73']
const grid = '#3a3629'
const metrics = [
  ['count', '전체 에피소드'], ['escape_rate', '탈출 성공률', '%'], ['avg_score', '평균 정산 점수'],
  ['best_score', '최고 정산 점수'], ['avg_value', '평균 획득 보석 가치'],
  ['best_value', '최고 획득 보석 가치'], ['avg_moves', '평균 이동 횟수'], ['avg_hp', '평균 최종 체력'],
  ['avg_noise', '평균 최종 소음'], ['avg_weight', '평균 최종 무게', 'kg'],
  ['cerberus', '케르베로스 각성'], ['crushed', '압사'], ['hp_depleted', '체력 소진'], ['timeout', '시간 제한'], ['dead_end', '막다른 길'],
] as const

const chart = [
  { title: '보상', lines: [['reward', '에피소드 보상'], ['avg100', '최근 100회 평균']] },
  { title: '탈출 성공률 (%)', lines: [['escape_rate', '누적 성공률']] },
  { title: '탐험 결과', lines: [['avg_value', '평균 보석 가치'], ['avg_moves', '평균 이동 횟수']] },
  { title: '탐험률 ε', lines: [['epsilon', 'ε']] },
] satisfies { title: string; lines: [keyof StatsRow, string][] }[]

type StatsRow = Partial<Row> & Pick<Row, 'episode' | 'reward' | 'avg100' | 'cumulative'> & {
  avg_score?: number; best_score?: number
}

function Metrics({ summary, title, note }: { summary: Partial<Summary> & Pick<StatsRow, 'avg_score' | 'best_score'>; title: string; note?: string }) {
  return <section className="panel result">
    <div className="panel-head"><div><h2>{title}</h2></div>{note && <span className="technical">{note}</span>}</div>
    <dl>{metrics.map(([key, label, unit]) => {
      const value = summary[key]
      return value === undefined ? null : <div key={key}><dt>{label}</dt>
        <dd>{value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}{unit}</dd></div>
    })}</dl>
  </section>
}

function Results({ history, watch, replay, busy = false }: {
  history: StatsRow[]; watch?: Watch; replay?: (name: Replay) => void; busy?: boolean
}) {
  const [windowSize, setWindowSize] = useState('1000')
  const current = history.at(-1)
  const plotted = useMemo(() => {
    if (windowSize !== 'all') return history.slice(-Number(windowSize))
    const stride = Math.ceil(history.length / 1000)
    return history.filter((_, i) => i % stride === 0 || i === history.length - 1)
  }, [history, windowSize])
  const reasons = current ? [
    { name: '케르베로스', count: current.cerberus ?? 0 }, { name: '압사', count: current.crushed ?? 0 },
    { name: '체력 소진', count: current.hp_depleted ?? 0 },
  ] : []
  const dead = reasons.reduce((sum, reason) => sum + reason.count, 0)

  return <>
    {!current ? <div className="panel empty"><span aria-hidden="true">▤</span><h2>아직 학습 기록이 없습니다</h2>
      <p>첫 에피소드가 끝나면 그래프가 나타납니다.</p></div> : <>
      <div className="results">
        <Metrics summary={current} title="학습 결과" note="ε-greedy" />
        {watch?.evaluation && <Metrics summary={watch.evaluation} title="최종 평가 결과"
          note={`STAGE 4 · ε = 0 · ${watch.config?.custom_map ? '내 지도' : '시작 시드 ' + watch.config?.evaluation_seed}`} />}
      </div>
      {watch && replay && watch.replays.length > 0 && <section className="panel replay-list">
        <h2>대표 경로 비교</h2><div>{watch.replays.map(name =>
          <button key={name} disabled={busy} onClick={() => replay(name)}>{replays[name]}</button>)}</div>
      </section>}
      <div className="stats-filter"><h2>에피소드 추이</h2><label>표시 구간
        <select value={windowSize} onChange={event => setWindowSize(event.target.value)}>
          <option value="100">최근 100회</option><option value="1000">최근 1,000회</option><option value="all">전체{history.length > 1000 ? ' · 간격 표본' : ''}</option>
        </select></label></div>
      <div className="charts">
        {chart.map(({ title, lines }) => {
          const available = lines.filter(([key]) => plotted.some(row => row[key] !== undefined))
          return available.length > 0 && <section className="panel chart" key={title}>
          <h3>{title}</h3>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={plotted} margin={{ left: -12, right: 12, bottom: 4 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="episode" tick={{ fill: '#b5ac96', fontSize: 11 }} tickLine={false} minTickGap={30} />
              <YAxis tick={{ fill: '#b5ac96', fontSize: 11 }} tickLine={false} />
              <Tooltip contentStyle={tooltip} labelStyle={{ color: '#eac88e' }} />
              <Legend />
              {available.map(([key, name], index) => <Line key={key} name={name} type="linear" dataKey={key} stroke={tones[index]}
                strokeWidth={2} dot={plotted.length < 2} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </section>})}
        <section className="panel chart"><h3>사망 원인별 비율 (%)</h3>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={reasons.map(reason => ({ ...reason, ratio: dead ? Number((100 * reason.count / dead).toFixed(1)) : 0 }))} margin={{ left: -12, right: 12 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#b5ac96', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#b5ac96', fontSize: 11 }} />
              <Tooltip contentStyle={tooltip} />
              <Bar dataKey="ratio" name="전체 사망 중 비율" fill={tones[3]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </section>
        <section className="panel chart"><h3>누적 보상</h3>
          <ResponsiveContainer width="100%" height={210}>
            <AreaChart data={plotted.map(row => ({ episode: row.episode, cumulative: row.cumulative }))} margin={{ left: -12, right: 12 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="episode" tick={{ fill: '#b5ac96', fontSize: 11 }} minTickGap={30} />
              <YAxis tick={{ fill: '#b5ac96', fontSize: 11 }} />
              <Tooltip contentStyle={tooltip} />
              <Area dataKey="cumulative" name="보상 합계" stroke={tones[0]} fill="#eabe6c30" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </section>
      </div>
    </>}
  </>
}

function onlineRows(episodes: OnlineEpisode[]): StatsRow[] {
  const outcomes = { escaped: 0, cerberus: 0, crushed: 0, hp_depleted: 0, timeout: 0, dead_end: 0 }
  const fields = { value: 'avg_value', moves: 'avg_moves', hp: 'avg_hp', noise: 'avg_noise', weight: 'avg_weight' } as const
  const totals = { value: 0, moves: 0, hp: 0, noise: 0, weight: 0 }
  const counts = { ...totals }
  let cumulative = 0
  let recentScore = 0
  let bestScore = 0
  let bestValue: number | undefined
  return episodes.map((entry, index) => {
    const count = index + 1
    if (entry.outcome !== 'running') outcomes[entry.outcome] += 1
    cumulative += entry.score
    recentScore += entry.score - (episodes[index - 100]?.score ?? 0)
    bestScore = Math.max(bestScore, entry.score)
    if (entry.value !== undefined) bestValue = Math.max(bestValue ?? 0, entry.value)
    const row: StatsRow = { ...outcomes, count, episode: count, reward: entry.score, cumulative,
      epsilon: entry.epsilon, avg100: recentScore / Math.min(100, count), avg_score: cumulative / count,
      best_score: bestScore, best_value: bestValue, escape_rate: 100 * outcomes.escaped / count }
    for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
      const value = entry[field]
      if (value !== undefined) {
        totals[field] += value
        counts[field] += 1
      }
      if (counts[field]) row[fields[field]] = totals[field] / counts[field]
    }
    return row
  })
}

function OnlineStatistics({ preferred }: { preferred: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [selected, setSelected] = useState(preferred)
  const [error, setError] = useState('')
  const [snapshot, setSnapshot] = useState<{ id: string; episodes: OnlineEpisode[] }>()
  useEffect(() => {
    let stale = false
    onlineRequest<{ runs: Entry[] }>().then(({ runs }) => {
      if (stale) return
      setEntries(runs)
      setSelected(id => id || runs[0]?.id || '')
    }).catch(() => { if (!stale) setError('공유 학습 목록을 불러오지 못했습니다.') })
    return () => { stale = true }
  }, [])

  useEffect(() => {
    if (!selected) return
    let stale = false
    let timer: ReturnType<typeof setTimeout>
    let episodes: OnlineEpisode[] = []
    async function refresh() {
      try {
        const next = await onlineRequest<{ completed: number; target: number; blocked: boolean; episodes: OnlineEpisode[] }>(
          `/${selected}?stats=${episodes.length}`,
        )
        if (stale) return
        if (next.episodes.length || !episodes.length) {
          episodes = [...episodes, ...next.episodes]
          setSnapshot({ id: selected, episodes })
        }
        setError('')
        if (episodes.length < next.completed) timer = setTimeout(refresh, 0)
        else if (!next.blocked && next.completed < next.target) timer = setTimeout(refresh, 3000)
      } catch {
        if (stale) return
        setError('온라인 학습 통계를 불러오지 못했습니다.')
        timer = setTimeout(refresh, 5000)
      }
    }
    void refresh()
    return () => { stale = true; clearTimeout(timer) }
  }, [selected])

  const matching = snapshot?.id === selected ? snapshot : undefined
  const rows = useMemo(() => matching ? onlineRows(matching.episodes) : [], [matching])
  return <>
    <div className="stats-filter"><label>공유 학습
      <select value={selected} onChange={event => setSelected(event.target.value)}>
        <option value="">학습 선택</option>
        {selected && !entries.some(entry => entry.id === selected) && <option value={selected}>공유 링크의 학습</option>}
        {entries.map(entry => <option key={entry.id} value={entry.id}>
          {new Date(entry.createdAt).toLocaleString('ko-KR')} · {entry.id.slice(0, 5)}
        </option>)}
      </select></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    {selected && !matching && !error ? <p role="status">온라인 학습 통계를 불러오는 중</p> :
      <Results key={selected} history={rows} />}
  </>
}

export default function Statistics({ history, watch, replay, busy, onlineEnabled }: {
  history: Row[]; watch: Watch; replay: (name: Replay) => void; busy: boolean; onlineEnabled: boolean
}) {
  const [preferred] = useState(() => /^#online\/([0-9a-f-]{36})$/.exec(location.hash)?.[1] ?? '')
  const [source, setSource] = useState(onlineEnabled && (preferred || !history.length) ? 'online' : 'local')
  return <>
    <section className="intro stats-intro"><div><p className="kicker">훈련 기록 · ε-GREEDY</p><h1>학습 <span>통계</span></h1>
      <p>학습 중 수집한 기록과 탐험 결과를 확인하세요.</p></div></section>
    {onlineEnabled && <div className="stats-filter"><label>학습 위치
      <select value={source} onChange={event => setSource(event.target.value)}>
        <option value="online">온라인 학습</option><option value="local">내 브라우저 학습</option>
      </select></label></div>}
    {source === 'online' ? <OnlineStatistics preferred={preferred} /> :
      <Results history={history} watch={watch} replay={replay} busy={busy} />}
  </>
}
