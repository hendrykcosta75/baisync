export type McpTransport = 'http' | 'sse'

export interface McpServerSummary {
  id: string
  slug: string
  name: string
  url: string
  transport: McpTransport
  auth_header_name: string | null
  has_auth_header: boolean
  tools_count: number | null
  tools_cached_at: string | null
  last_error: string | null
  last_error_at: string | null
  created_at: string
  updated_at: string
}

export interface CreateMcpServerInput {
  name: string
  url: string
  transport: McpTransport
  auth_header_name?: string | null
  auth_header_value?: string | null
}

export interface UpdateMcpServerInput {
  name?: string
  url?: string
  transport?: McpTransport
  auth_header_name?: string | null
  auth_header_value?: string | null
}

export interface McpTestResult {
  ok: boolean
  tools_count?: number
  tools?: Array<{ name: string; description: string }>
  error?: string
}
