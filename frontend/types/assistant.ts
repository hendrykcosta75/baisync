export type LLMProvider = 'openai' | 'claude' | 'gemini' | 'grok' | 'deepseek'

export interface AssistantFile {
  id: string
  name: string
  size: number
  type: string
  uploadedAt: string
}

export type AuthType = 'none' | 'basic' | 'header' | 'bearer'

export interface AuthConfig {
  type: AuthType
  username?: string
  password?: string
  headerName?: string
  headerValue?: string
  token?: string
}

export type BodyContentType = 'json' | 'form-data' | 'form-urlencoded' | 'raw'

export interface KeyValuePair {
  key: string
  value: string
}

export interface ToolSettings {
  timeout: number
  retries: number
  retryOnFailure: boolean
  followRedirects: boolean
  ignoreSSLErrors: boolean
}

export type ToolType = 'http_request' | 'send_document' | 'notify_human' | 'schedule_appointment' | 'pix_payment' | 'card_payment' | 'create_meeting' | 'current_datetime'

export type NotifyHumanScope = 'all_workspace' | 'teams' | 'specific_users'

export interface NotifyHumanConfig {
  scope: NotifyHumanScope
  teamIds: string[]
  userIds: string[]
}

export interface AssistantTool {
  id: string
  name: string
  description: string
  endpoint: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  schema?: string
  headers?: string
  isEnabled: boolean
  auth?: AuthConfig
  queryParams?: KeyValuePair[]
  bodyContentType?: BodyContentType
  bodyContent?: string
  settings?: ToolSettings
  toolType?: ToolType
}

export type WhatsAppProvider = 'baileys' | 'meta_official'

export interface AssistantIntegration {
  id?: string
  provider: 'telegram' | 'whatsapp'
  status: 'connected' | 'disconnected'
  token?: string
  phoneNumber?: string
  chatwootUrl?: string
  // WhatsApp provider-specific
  whatsappProvider?: WhatsAppProvider
  phoneNumberId?: string     // Meta Official
  accessToken?: string       // Meta Official
  webhookVerifyToken?: string // Meta Official
  qrCode?: string            // Baileys - base64 QR code
}

export interface IntegrationCommonSettings {
  rateLimitPerDay: number
  maxMessageLength: number
  splitOnDoubleNewline: boolean
  typingIndicator: boolean
  interpretDocuments: boolean
  rateLimitMessage: string
  maxLengthMessage: string
  unsupportedMediaMessage: string
}

export type AudioMode = 'disabled' | 'always' | 'audio_to_audio'
export type AudioProvider = 'elevenlabs' | 'openai' | 'grok' | 'gemini'

export interface AudioConfig {
  provider: AudioProvider | null
  mode: AudioMode
  transcribe: boolean
  fallbackToText: boolean
  transcriptionFailureMessage: string
  voiceId: string | null
}

export type MessageChannel = 'whatsapp' | 'telegram' | 'baileys'

export interface Message {
  id: string
  content: string
  sender: 'user' | 'assistant'
  timestamp: string
  tokens_used?: number | null
  /** MIME type of the attached media (e.g. "image/jpeg", "application/pdf"). */
  media_type?: string | null
  /** True when raw media bytes are available via the media endpoint. */
  has_media?: boolean
}

export interface Conversation {
  id: string
  contactName: string
  profilePictureUrl?: string | null
  channel: MessageChannel
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  totalTokens: number
  aiEnabled: boolean
  messages: Message[]
}

export interface SubAgent {
  id: string
  name: string
  description: string
  inheritPrompt: boolean
  customPrompt: string
  inheritKnowledge: boolean
  inheritTools: boolean
  llmProvider: LLMProvider | 'inherit'
  model: string
}

export interface ToolCallLog {
  id: string
  assistant_id: string
  tool_id: string
  tool_name: string
  arguments: string | null
  status_code: number | null
  response_body: string | null
  error: string | null
  duration_ms: number
  called_at: string
}

export interface Assistant {
  id: string
  name: string
  description: string
  llmProvider: LLMProvider
  model: string
  temperature: number // 0 to 1
  maxTokens: number
  systemPrompt: string
  files: AssistantFile[]
  tools: AssistantTool[]
  integrations: AssistantIntegration[]
  integrationSettings?: IntegrationCommonSettings
  audioConfig?: AudioConfig
  isTeamLead: boolean
  parentAssistantId?: string
  subAgents: SubAgent[]
  /** W1.2 — cap on the number of tool-calling rounds per LLM turn.
   * Defaults to 5 when unset (enforced in backend). */
  configMaxToolRounds?: number | null
  /** W1.2 — cap on total wall-clock duration of the tool-calling loop,
   * in milliseconds. Defaults to 30000 when unset (enforced in backend). */
  configMaxDurationMs?: number | null
  /** T2.3 — when true, backend compacta conversas longas antes do turn LLM
   * (usa a própria key do workspace). Default false. */
  configAutoCompact?: boolean | null
  /** W2.1 — when true, backend dispara evaluator fire-and-forget após a
   * resposta (usa a própria key do workspace). Default false. */
  configEnableEvaluator?: boolean | null
  /** W2.1 — override opcional para o modelo barato do evaluator. Quando
   * null, backend escolhe um default por provider. */
  configEvaluatorModel?: string | null
}

export interface PixChargeSummary {
  id: string
  amount: number
  status: 'pending' | 'approved' | 'cancelled' | 'expired' | 'refunded'
  description: string
  contactPhone: string
  createdAt: string
  customerName?: string
  customerCpf?: string
  pixMode?: string
  paymentType?: 'pix' | 'card'
}

export interface FinancialSummary {
  totalRevenue: number
  totalCharges: number
  paidCount: number
  unpaidCount: number
  pendingCount: number
}

export interface AssistantFinancialOverview {
  assistantId: string
  totalRevenue: number
  totalCharges: number
  paidCount: number
  unpaidCount: number
  pendingCount: number
}
