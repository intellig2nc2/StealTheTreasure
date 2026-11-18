import { useEffect, useState } from 'react'
import { listEpisodes, listRuns } from './local/history'
import { outcomeLabels } from './types'
import type { EpisodeRecord, RunRecord } from './local/history'

const pageSize = 25
const date = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'short', timeStyle: 'medium' })

type Records = { runs: RunRecord[]; run?: RunRecord; rows: EpisodeRecord[] }

export default function History({ runId, completed, warning }: { runId: string; completed: number; warning: string | null }) {
  const [selection, setSelection] = useState('')
  const [page, setPage] = useState(0)
  const [records, setRecords] = useState<Records>()
  const [error, setError] = useState(false)

  useEffect(() => {
    let current = true
    async function load() {
      try {
        const runs = await listRuns()
        const run = runs.find(item => item.id === selection) ?? runs[0]
        const last = Math.max(1, (run?.completed ?? 0) - page * pageSize)
        const rows = run ? await listEpisodes(run.id, Math.max(1, last - pageSize + 1), last) : []
        if (current) {
          setRecords({ runs, run, rows })
          setError(false)
        }
      } catch {
        if (current) setError(true)
      }
    }
    void load()
    return () => { current = false }
  }, [selection, page, runId, completed])

  const { runs, run, rows } = records ?? { runs: [], rows: [] }

  return <>
    <section className="intro stats-intro">
      <div><p className="kicker">에피소드별 결과</p><h1>학습 <span>기록</span></h1>
        <p>완료된 학습 에피소드를 실행별로 확인하세요. 기록은 이 브라우저에 저장됩니다.</p></div>
    </section>
    {warning && <p className="error" role="alert">{warning}</p>}
    {error ? <p className="panel empty" role="alert">브라우저의 학습 기록을 불러올 수 없습니다.</p>
      : !records ? <p className="panel empty" role="status">학습 기록을 불러오는 중</p>
      : !run ? <section className="panel empty"><h2>아직 저장된 학습 기록이 없습니다</h2>
        <p>새 학습에서 첫 에피소드가 끝나면 여기에 기록됩니다.</p></section>
      : <section className="panel">
        <div className="history-toolbar">
          <label>학습 실행 <select value={selection} onChange={event => { setSelection(event.target.value); setPage(0) }}>
            <option value="">가장 최근 실행</option>
            {runs.map(item => <option key={item.id} value={item.id}>{date.format(item.startedAt)} · 시드 {item.seed}</option>)}
          </select></label>
          <p>{run.completed.toLocaleString('ko-KR')} / {run.target.toLocaleString('ko-KR')}회 완료</p>
        </div>
        <div className="history-scroll" tabIndex={0} role="region" aria-label="에피소드별 학습 기록">
          <table className="history-table" aria-label="에피소드별 학습 기록">
            <thead><tr>
              <th scope="col">회차</th><th scope="col">단계</th><th scope="col">결과</th>
              <th scope="col">정산 점수</th><th scope="col">보석 가치</th><th scope="col">행동 수</th>
              <th scope="col">최종 체력</th><th scope="col">최종 소음</th><th scope="col">최종 무게</th>
            </tr></thead>
            <tbody>{rows.map(row => <tr key={row.episode}>
              <th scope="row">{row.episode.toLocaleString('ko-KR')}</th>
              <td>{row.stage}</td><td>{outcomeLabels[row.outcome]}</td><td>{row.reward}</td><td>{row.value}</td>
              <td>{row.actions}</td><td>{row.hp}</td><td>{row.noise}</td><td>{row.weight}kg</td>
            </tr>)}</tbody>
          </table>
        </div>
        {run.completed > pageSize && <div className="history-toolbar history-pages">
          <button onClick={() => setPage(index => index - 1)} disabled={page === 0}>최신 쪽</button>
          <span>{page + 1} / {Math.ceil(run.completed / pageSize)} 페이지</span>
          <button onClick={() => setPage(index => index + 1)} disabled={(page + 1) * pageSize >= run.completed}>이전 기록</button>
        </div>}
      </section>}
  </>
}
