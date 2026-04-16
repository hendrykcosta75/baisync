export interface OkrObjective {
  workspace_id: string
  id: string
  title: string
  description: string | null
  objective_type: OkrObjectiveType
  cycle: string
  status: OkrStatus
  owner_id: string
  team_id: string | null
  team_ids?: string[] | null
  parent_objective_id: string | null
  progress: number
  confidence: number
  created_at: string
  updated_at: string
  key_results?: OkrKeyResult[]
  owner_name?: string | null
  team_name?: string | null
  children?: OkrObjectiveChild[]
}

export interface OkrObjectiveChild {
  parent_objective_id: string
  child_objective_id: string
  workspace_id: string
  child_title: string
  child_progress: number
  child_confidence: number
  child_team_id: string | null
}

export interface OkrObjectiveByCycle {
  workspace_id: string
  cycle: string
  objective_id: string
  title: string
  objective_type: OkrObjectiveType
  status: OkrStatus
  progress: number
  confidence: number
  owner_id: string
  team_id: string | null
  team_ids?: string[] | null
  key_results?: OkrKeyResult[]
}

export interface OkrKeyResult {
  objective_id: string
  id: string
  title: string
  kr_type: KrType
  start_value: number
  target_value: number
  current_value: number
  unit: string | null
  confidence: number
  status: OkrStatus
  owner_id: string
  created_at: string
  updated_at: string
  owner_name?: string | null
  check_ins?: OkrCheckIn[]
}

export interface OkrCheckIn {
  key_result_id: string
  id: string
  previous_value: number
  new_value: number
  confidence: number
  note: string | null
  blockers: string | null
  author_id: string
  author_name: string
  created_at: string
}

export interface OkrAttachment {
  entity_id: string
  id: string
  entity_type: string
  workspace_id: string
  file_name: string
  file_size: number
  mime_type: string
  uploaded_by: string
  uploader_name: string
  created_at: string
}

export type OkrObjectiveType = 'committed' | 'aspirational' | 'learning'
export type OkrStatus = 'on_track' | 'at_risk' | 'behind' | 'achieved' | 'canceled'
export type KrType = 'number' | 'percentage' | 'binary'
export const OKR_TYPE_CONFIG: Record<OkrObjectiveType, { label: string; color: string }> = {
  committed: { label: 'Committed', color: '#22c55e' },
  aspirational: { label: 'Aspirational', color: '#f59e0b' },
  learning: { label: 'Learning', color: '#3b82f6' },
}

export const OKR_STATUS_CONFIG: Record<OkrStatus, { label: string; color: string }> = {
  on_track: { label: 'No Prazo', color: '#22c55e' },
  at_risk: { label: 'Em Risco', color: '#f59e0b' },
  behind: { label: 'Atrasado', color: '#ef4444' },
  achieved: { label: 'Alcançado', color: '#8b5cf6' },
  canceled: { label: 'Cancelado', color: '#6b7280' },
}

export function getCurrentCycle(): string {
  const now = new Date()
  const quarter = Math.ceil((now.getMonth() + 1) / 3)
  return `${now.getFullYear()}-Q${quarter}`
}

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return '#22c55e'
  if (confidence >= 0.4) return '#f59e0b'
  return '#ef4444'
}

export function getProgressPercent(kr: OkrKeyResult): number {
  const range = kr.target_value - kr.start_value
  if (Math.abs(range) < 0.0001) {
    return kr.kr_type === 'binary' ? (kr.current_value >= 1 ? 100 : 0) : 0
  }
  return Math.min(100, Math.max(0, ((kr.current_value - kr.start_value) / range) * 100))
}
