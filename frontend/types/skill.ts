export interface Skill {
  workspace_id: string
  id: string
  slug: string
  name: string
  description: string
  instructions: string
  created_by: string
  created_at: string
  updated_at: string
}

export interface CreateSkillInput {
  name: string
  description: string
  instructions: string
}

export interface UpdateSkillInput {
  name?: string
  description?: string
  instructions?: string
}
