export const WEIGHT_LIMIT = 30

export type Point = [number, number]
export type Layout = { grid: number[][]; start: Point; portals: [Point, Point][]; stage: number }
export type Outcome = 'running' | 'escaped' | 'cerberus' | 'crushed' | 'hp_depleted' | 'timeout' | 'dead_end'
export type Frame = {
  position: Point; hp: number; noise: number; weight: number; value: number; step: number
  outcome: Outcome; event: string; mask: number[]
}
export type Trace = { episode: number; epsilon: number; frames: Frame[]; layout: Layout; reward?: number }
export type Status = 'idle' | 'running' | 'paused' | 'stopping' | 'evaluating' | 'stopped' | 'completed' | 'error'
export type Algorithm = 'dqn' | 'q_learning'
export type Replay = 'early' | 'middle' | 'late' | 'evaluation'
export type Summary = {
  count: number; escape_rate: number; best_value: number; avg_value: number; avg_moves: number
  avg_hp: number; avg_noise: number; avg_weight: number; escaped: number; cerberus: number
  crushed: number; hp_depleted: number; timeout: number; dead_end: number
}
export type Row = Summary & { episode: number; epsilon: number; reward: number; cumulative: number; avg100: number; stage: number }
export type Watch = {
  run_id: string; status: Status; episode: number; total: number; history: Row[]; live: Trace | null
  replays: Replay[]; evaluation: Summary | null; error: string | null; checkpoint: boolean; q_checkpoint?: boolean
  device: string | null; cuda: boolean; config: { evaluation_seed: number; evaluation_episodes: number; algorithm?: Algorithm; portals?: boolean; custom_map?: boolean } | null
}

export const algorithmLabels: Record<Algorithm, string> = { dqn: 'Double DQN', q_learning: 'Q-learning' }

export const outcomeLabels: Record<Outcome, string> = {
  running: '탐험 중', escaped: '탈출 성공', cerberus: '케르베로스 각성',
  crushed: '무게 초과로 압사', hp_depleted: '체력 소진', timeout: '행동 한도 초과', dead_end: '막다른 길',
}
export const events: Record<string, string> = {
  enter: '동굴에 진입했습니다.', move: '통로를 이동하고 있습니다.', collect: '보석을 수집했습니다.',
  portal: '지름길을 통과했습니다.', potion: '물약으로 체력을 회복했습니다.', silence: '제단에서 소음을 낮췄습니다.',
  spike: '가시 함정을 밟았습니다.', rock: '낙석 함정이 발동했습니다.',
}
export const replays: Record<Replay, string> = {
  early: '초기 학습', middle: '중기 학습', late: '후기 학습', evaluation: '최종 평가',
}
