export type RalphTaskStatus = 'pending' | 'running' | 'done' | 'failed'

export interface RalphTask {
  id: string
  title: string
  status: RalphTaskStatus
  response?: string
}

export interface RalphPlan {
  overall_goal: string
  tasks: RalphTask[]
}
