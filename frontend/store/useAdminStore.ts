'use client'

import { create } from 'zustand'
import { apiFetch } from '@/lib/api'

interface MonthlyCount {
  month: string
  count: number
}

interface MonthlyRevenue {
  month: string
  revenue: number
  charges: number
}

interface ProviderCount {
  provider: string
  count: number
}

interface RecentUser {
  id: string
  name: string
  email: string
  created_at: string
}

interface AdminDashboardStats {
  total_users: number
  total_assistants: number
  total_conversations: number
  total_messages: number
  total_revenue: number
  total_charges: number
  paid_count: number
  pending_count: number
  cancelled_count: number
  users_by_month: MonthlyCount[]
  revenue_by_month: MonthlyRevenue[]
  providers: ProviderCount[]
  recent_users: RecentUser[]
}

interface AdminUserInfo {
  id: string
  email: string
  name: string
  blocked: boolean
  created_at: string
  assistant_count: number
}

interface AdminUserAssistant {
  id: string
  name: string
  description: string | null
}

interface AdminUserDetail {
  id: string
  email: string
  name: string
  blocked: boolean
  created_at: string
  assistants: AdminUserAssistant[]
}

// --- Integrations ---

interface AdminIntegrationInfo {
  id: string
  assistant_id: string
  assistant_name: string
  user_id: string
  user_name: string
  user_email: string
  channel: string
  provider: string
  status: string
  phone_number: string | null
  created_at: string
}

interface ChannelCount {
  channel: string
  count: number
}

interface AdminIntegrationsResponse {
  total: number
  connected: number
  disconnected: number
  by_channel: ChannelCount[]
  by_provider: ProviderCount[]
  integrations: AdminIntegrationInfo[]
}

// --- Usage ---

interface MonthlyTokens {
  month: string
  tokens: number
  messages: number
}

interface UserTokens {
  user_id: string
  user_name: string
  user_email: string
  tokens: number
}

interface AssistantTokens {
  assistant_id: string
  assistant_name: string
  user_id: string
  tokens: number
}

interface ProviderTokens {
  provider: string
  tokens: number
}

export interface AdminUsageResponse {
  total_tokens_current_month: number
  total_tokens_previous_month: number
  total_messages_current_month: number
  tokens_by_month: MonthlyTokens[]
  top_users_by_tokens: UserTokens[]
  top_assistants_by_tokens: AssistantTokens[]
  by_provider: ProviderTokens[]
}

// --- Enriched User Detail ---

interface AdminChargeInfo {
  id: string
  amount: number
  status: string
  description: string | null
  customer_name: string | null
  created_at: string
}

interface AdminUserIntegration {
  id: string
  assistant_id: string
  channel: string
  provider: string
  status: string
  phone_number: string | null
}

interface AppointmentStatusCount {
  status: string
  count: number
}

interface AdminUserAssistantEnriched {
  id: string
  name: string
  description: string | null
  llm_provider: string
  model: string
  tool_count: number
  file_count: number
  integration_count: number
}

export interface AdminUserDetailEnriched {
  id: string
  email: string
  name: string
  blocked: boolean
  created_at: string
  two_factor_enabled: boolean
  has_openai_key: boolean
  has_claude_key: boolean
  has_gemini_key: boolean
  has_elevenlabs_key: boolean
  has_mercadopago_key: boolean
  total_revenue: number
  paid_charges: number
  pending_charges: number
  cancelled_charges: number
  recent_charges: AdminChargeInfo[]
  total_tokens: number
  total_messages: number
  integrations: AdminUserIntegration[]
  appointments_by_status: AppointmentStatusCount[]
  assistants: AdminUserAssistantEnriched[]
}

interface AdminStore {
  isAuthenticated: boolean
  stats: AdminDashboardStats | null
  users: AdminUserInfo[]
  selectedUser: AdminUserDetail | null
  selectedUserEnriched: AdminUserDetailEnriched | null
  integrationsData: AdminIntegrationsResponse | null
  usageData: AdminUsageResponse | null
  isLoading: boolean
  error: string | null

  adminLogin: (username: string, password: string) => Promise<void>
  adminLogout: () => Promise<void>
  fetchStats: () => Promise<void>
  fetchUsers: () => Promise<void>
  fetchUserDetail: (id: string) => Promise<void>
  fetchUserDetailEnriched: (id: string) => Promise<void>
  fetchIntegrations: () => Promise<void>
  fetchUsage: () => Promise<void>
  createUser: (email: string, password: string, name: string) => Promise<void>
  blockUser: (id: string, blocked: boolean) => Promise<void>
  deleteUser: (id: string) => Promise<void>
  clearError: () => void
}

export const useAdminStore = create<AdminStore>((set) => ({
  isAuthenticated: typeof window !== 'undefined' && localStorage.getItem('admin-auth') === 'true',
  stats: null,
  users: [],
  selectedUser: null,
  selectedUserEnriched: null,
  integrationsData: null,
  usageData: null,
  isLoading: false,
  error: null,

  adminLogin: async (username, password) => {
    set({ isLoading: true, error: null })
    try {
      await apiFetch<{ token: string }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      localStorage.setItem('admin-auth', 'true')
      set({ isAuthenticated: true, isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao fazer login'
      set({ error: msg, isLoading: false })
      throw e
    }
  },

  adminLogout: async () => {
    await fetch('/api/admin/logout', { method: 'POST', credentials: 'same-origin' })
    localStorage.removeItem('admin-auth')
    set({ isAuthenticated: false, stats: null, users: [], selectedUser: null, selectedUserEnriched: null, integrationsData: null, usageData: null })
  },

  fetchStats: async () => {
    set({ isLoading: true })
    try {
      const stats = await apiFetch<AdminDashboardStats>('/api/admin/stats')
      set({ stats, isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar estatísticas'
      set({ error: msg, isLoading: false })
    }
  },

  fetchUsers: async () => {
    set({ isLoading: true })
    try {
      const users = await apiFetch<AdminUserInfo[]>('/api/admin/users')
      set({ users, isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar usuários'
      set({ error: msg, isLoading: false })
    }
  },

  fetchUserDetail: async (id) => {
    set({ isLoading: true })
    try {
      const detail = await apiFetch<AdminUserDetail>(`/api/admin/users/${id}`)
      set({ selectedUser: detail, isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar detalhes'
      set({ error: msg, isLoading: false })
    }
  },

  createUser: async (email, password, name) => {
    set({ isLoading: true, error: null })
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      })
      set({ isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao criar usuário'
      set({ error: msg, isLoading: false })
      throw e
    }
  },

  blockUser: async (id, blocked) => {
    try {
      await apiFetch(`/api/admin/users/${id}/block`, {
        method: 'PUT',
        body: JSON.stringify({ blocked }),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao atualizar usuário'
      set({ error: msg })
      throw e
    }
  },

  deleteUser: async (id) => {
    try {
      await apiFetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao remover usuário'
      set({ error: msg })
      throw e
    }
  },

  fetchUserDetailEnriched: async (id) => {
    set({ isLoading: true })
    try {
      const detail = await apiFetch<AdminUserDetailEnriched>(`/api/admin/users/${id}/detail`)
      set({ selectedUserEnriched: detail, isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar detalhes'
      set({ error: msg, isLoading: false })
    }
  },

  fetchIntegrations: async () => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<AdminIntegrationsResponse>('/api/admin/integrations')
      set({ integrationsData: data, isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar integrações'
      set({ error: msg, isLoading: false })
    }
  },

  fetchUsage: async () => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<AdminUsageResponse>('/api/admin/usage')
      set({ usageData: data, isLoading: false })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao carregar uso'
      set({ error: msg, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
