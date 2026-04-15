export interface Team {
  workspace_id: string
  id: string
  name: string
  description: string | null
  color: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface TeamWithStats extends Team {
  member_count: number
  task_counts: TaskCounts
  okr_progress: number | null
}

export interface TaskCounts {
  open: number
  in_progress: number
  done: number
}

export interface TeamMember {
  team_id: string
  user_id: string
  workspace_id: string
  role: string
  joined_at: string
  user_name: string | null
  user_email: string | null
  task_count?: {
    assigned: number
    open: number
    done: number
  }
}

export interface Task {
  team_id: string
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assignee_id: string | null
  created_by: string
  due_date: string | null
  tags: string[]
  checklist_total: number
  checklist_done: number
  okr_objective_id: string | null
  okr_key_result_id: string | null
  position: number
  created_at: string
  updated_at: string
  assignee_name?: string | null
}

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done'
export type TaskPriority = 'urgent' | 'high' | 'medium' | 'low'

export interface TaskComment {
  task_id: string
  id: string
  author_id: string
  author_name: string
  content: string
  created_at: string
}

export interface TeamActivityEntry {
  team_id: string
  id: string
  actor_id: string
  actor_name: string
  action: string
  entity_type: string
  entity_id: string | null
  entity_name: string | null
  details: string | null
  created_at: string
}

export interface TaskAttachment {
  task_id: string
  id: string
  team_id: string
  file_name: string
  file_size: number
  mime_type: string
  uploaded_by: string
  uploader_name: string
  created_at: string
}

export interface ActivityPage {
  entries: TeamActivityEntry[]
  next_cursor: string | null
}

export interface CommentsPage {
  comments: TaskComment[]
  next_cursor: string | null
}

export const KANBAN_COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'todo', label: 'A Fazer' },
  { key: 'in_progress', label: 'Em Progresso' },
  { key: 'in_review', label: 'Em Revisão' },
  { key: 'done', label: 'Concluído' },
]

export const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string }> = {
  urgent: { label: 'Urgente', color: '#ef4444' },
  high: { label: 'Alta', color: '#f59e0b' },
  medium: { label: 'Média', color: '#3b82f6' },
  low: { label: 'Baixa', color: '#6b7280' },
}
