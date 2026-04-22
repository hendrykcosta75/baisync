import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiFetch } from '@/lib/api'
import type { CreateSkillInput, Skill, UpdateSkillInput } from '@/types/skill'

interface SkillsState {
  items: Skill[]
  isLoading: boolean
  hasFetched: boolean
  fetchSkills: () => Promise<void>
  createSkill: (input: CreateSkillInput) => Promise<Skill>
  updateSkill: (id: string, patch: UpdateSkillInput) => Promise<Skill>
  deleteSkill: (id: string) => Promise<void>

  // Per-assistant links (not persisted — re-fetched on navigation)
  linkedByAssistant: Record<string, Skill[]>
  fetchLinkedForAssistant: (assistantId: string) => Promise<void>
  linkToAssistant: (assistantId: string, skillId: string) => Promise<void>
  unlinkFromAssistant: (assistantId: string, skillId: string) => Promise<void>
}

export const useSkillsStore = create<SkillsState>()(
  persist(
    (set, get) => ({
      items: [],
      isLoading: false,
      hasFetched: false,
      linkedByAssistant: {},

      fetchSkills: async () => {
        set({ isLoading: true })
        try {
          const data = await apiFetch<Skill[]>('/api/skills')
          set({ items: data, hasFetched: true, isLoading: false })
        } catch (err) {
          console.error('Failed to fetch skills:', err)
          set({ isLoading: false, hasFetched: true })
        }
      },

      createSkill: async (input) => {
        const created = await apiFetch<Skill>('/api/skills', {
          method: 'POST',
          body: JSON.stringify(input),
        })
        set((s) => ({ items: [...s.items, created] }))
        return created
      },

      updateSkill: async (id, patch) => {
        const updated = await apiFetch<Skill>(`/api/skills/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? updated : it)),
          linkedByAssistant: Object.fromEntries(
            Object.entries(s.linkedByAssistant).map(([aid, list]) => [
              aid,
              list.map((it) => (it.id === id ? updated : it)),
            ])
          ),
        }))
        return updated
      },

      deleteSkill: async (id) => {
        await apiFetch(`/api/skills/${id}`, { method: 'DELETE' })
        set((s) => ({
          items: s.items.filter((it) => it.id !== id),
          linkedByAssistant: Object.fromEntries(
            Object.entries(s.linkedByAssistant).map(([aid, list]) => [
              aid,
              list.filter((it) => it.id !== id),
            ])
          ),
        }))
      },

      fetchLinkedForAssistant: async (assistantId) => {
        try {
          const data = await apiFetch<Skill[]>(`/api/assistants/${assistantId}/skills`)
          set((s) => ({
            linkedByAssistant: { ...s.linkedByAssistant, [assistantId]: data },
          }))
        } catch (err) {
          console.error('Failed to fetch linked skills:', err)
        }
      },

      linkToAssistant: async (assistantId, skillId) => {
        const skill = get().items.find((it) => it.id === skillId)
        // Optimistic
        set((s) => {
          const prev = s.linkedByAssistant[assistantId] ?? []
          const next = skill && !prev.some((p) => p.id === skillId) ? [...prev, skill] : prev
          return { linkedByAssistant: { ...s.linkedByAssistant, [assistantId]: next } }
        })
        try {
          await apiFetch(`/api/assistants/${assistantId}/skills/${skillId}`, {
            method: 'POST',
          })
        } catch (err) {
          console.error('link skill failed, reverting:', err)
          await get().fetchLinkedForAssistant(assistantId)
          throw err
        }
      },

      unlinkFromAssistant: async (assistantId, skillId) => {
        set((s) => ({
          linkedByAssistant: {
            ...s.linkedByAssistant,
            [assistantId]: (s.linkedByAssistant[assistantId] ?? []).filter(
              (it) => it.id !== skillId
            ),
          },
        }))
        try {
          await apiFetch(`/api/assistants/${assistantId}/skills/${skillId}`, {
            method: 'DELETE',
          })
        } catch (err) {
          console.error('unlink skill failed, reverting:', err)
          await get().fetchLinkedForAssistant(assistantId)
          throw err
        }
      },
    }),
    {
      name: 'skills-storage',
      partialize: (state) => ({ items: state.items }),
    }
  )
)
