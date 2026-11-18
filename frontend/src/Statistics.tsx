import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { Replay, Row, Summary, Watch } from './types'
import { replays } from './types'

const tooltip = { background: '#212018', borderColor: '#4a4030', color: '#f2e7d0' }
const tones = ['#efbd72', '#9db5a4', '#9fb8d1', '#e28b73']
const grid = '#3a3629'
const metrics = [
  ['count', '전체 에피소드'], ['escape_rate', '탈출 성공률', '%'], ['avg_value', '평균 획득 보석 가치'],
  ['best_value', '최고 획득 보석 가치'], ['avg_moves', '평균 이동 횟수'], ['avg_hp', '평균 최종 체력'],
  ['avg_noise', '평균 최종 소음'], ['avg_weight', '평균 최종 무게', 'kg'],
  ['cerberus', '케르베로스 각성'], ['crushed', '압사'], ['hp_depleted', '체력 소진'], ['timeout', '시간 제한'],
] as const

const chart = [
  { title: '보상', lines: [['reward', '에피소드 보상'], ['avg100', '최근 100회 평균']] },
  { title: '탈출 성공률 (%)', lines: [['escape_rate', '누적 성공률']] },
  { title: '탐험 결과', lines: [['avg_value', '평균 보석 가치'], ['avg_moves', '평균 이동 횟수']] },
  { title: '탐험률 ε', lines: [['epsilon', 'ε']] },
]

function Metrics({ summary, title, note }: { summary: Summary; title: string; note?: string }) {
  return <section className="panel result">
    <div className="panel-head"><div><h2>{title}</h2></div>{note && <span className="technical">{note}</span>}</div>
    <dl>{metrics.map(([key, label, unit]) => <div key={key}><dt>{label}</dt>
      <dd>{summary[key].toLocaleString('ko-KR', { maximumFractionDigits: 1 })}{unit}</dd></div>)}</dl>
  </section>
}

export default function Statistics({ history, watch, replay, busy }: {
  history: Row[]; watch: Watch; replay: (name: Replay) => void; busy: boolean
}) {
  const [windowSize, setWindowSize] = useState('1000')
  const current = history.at(-1)
  const plotted = useMemo(() => {
    if (windowSize !== 'all') return history.slice(-Number(windowSize))
    const stride = Math.ceil(history.length / 1000)
    return history.filter((_, i) => i % stride === 0 || i === history.length - 1)
  }, [history, windowSize])
  const reasons = current ? [
    { name: '케르베로스', count: current.cerberus }, { name: '압사', count: current.crushed },
    { name: '체력 소진', count: current.hp_depleted },
  ] : []
  const dead = reasons.reduce((sum, reason) => sum + reason.count, 0)

  return <>
    <section className="intro stats-intro"><div><p className="kicker">훈련 기록 · ε-GREEDY</p><h1>학습 <span>통계</span></h1>
      <p>학습 중 수집한 기록과 탐험 없이 실행한 평가 결과를 확인하세요.</p></div></section>
    {!current ? <div className="panel empty"><span aria-hidden="true">▤</span><h2>아직 학습 기록이 없습니다</h2>
      <p>동굴 탐험 화면에서 학습을 시작하면 첫 에피소드가 끝난 뒤 그래프가 나타납니다.</p></div> : <>
      <div className="results">
        <Metrics summary={current} title="학습 결과" note="ε-greedy" />
        {watch.evaluation && <Metrics summary={watch.evaluation} title="최종 평가 결과"
          note={`STAGE 4 · ε = 0 · 시작 시드 ${watch.config?.evaluation_seed}`} />}
      </div>
      {watch.replays.length > 0 && <section className="panel replay-list">
        <h2>대표 경로 비교</h2><div>{watch.replays.map(name =>
          <button key={name} disabled={busy} onClick={() => replay(name)}>{replays[name]}</button>)}</div>
      </section>}
      <div className="stats-filter"><h2>에피소드 추이</h2><label>표시 구간
        <select value={windowSize} onChange={event => setWindowSize(event.target.value)}>
          <option value="100">최근 100회</option><option value="1000">최근 1,000회</option><option value="all">전체{history.length > 1000 ? ' · 간격 표본' : ''}</option>
        </select></label></div>
      <div className="charts">
        {chart.map(({ title, lines }) => <section className="panel chart" key={title}>
          <h3>{title}</h3>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={plotted} margin={{ left: -12, right: 12, bottom: 4 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="episode" tick={{ fill: '#b5ac96', fontSize: 11 }} tickLine={false} minTickGap={30} />
              <YAxis tick={{ fill: '#b5ac96', fontSize: 11 }} tickLine={false} />
              <Tooltip contentStyle={tooltip} labelStyle={{ color: '#eac88e' }} />
              <Legend />
              {lines.map(([key, name], index) => <Line key={key} name={name} type="linear" dataKey={key} stroke={tones[index]}
                strokeWidth={2} dot={plotted.length < 2} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </section>)}
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
