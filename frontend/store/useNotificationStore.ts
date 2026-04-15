import { create } from 'zustand'
import { apiFetch } from '@/lib/api'
import { Notification } from '@/types/notification'

interface NotificationState {
  notifications: Notification[]
  unreadCount: number
  fetch: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  deleteOne: (id: string) => Promise<void>
  deleteAll: () => Promise<void>
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,

  fetch: async () => {
    try {
      const data = await apiFetch<Notification[]>('/api/notifications')
      const unreadCount = data.filter((n) => !n.is_read).length
      set({ notifications: data, unreadCount })
    } catch {
      // Silently ignore fetch errors (e.g. when not logged in yet)
    }
  },

  markRead: async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' })
      set((state) => ({
        notifications: state.notifications.map((n) =>
          n.id === id ? { ...n, is_read: true } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      }))
    } catch {
      // ignore
    }
  },

  markAllRead: async () => {
    try {
      await apiFetch('/api/notifications/read-all', { method: 'POST' })
      set((state) => ({
        notifications: state.notifications.map((n) => ({ ...n, is_read: true })),
        unreadCount: 0,
      }))
    } catch {
      // ignore
    }
  },

  deleteOne: async (id: string) => {
    try {
      await apiFetch(`/api/notifications/${id}`, { method: 'DELETE' })
      set((state) => {
        const updated = state.notifications.filter((n) => n.id !== id)
        return {
          notifications: updated,
          unreadCount: updated.filter((n) => !n.is_read).length,
        }
      })
    } catch {
      // ignore
    }
  },

  deleteAll: async () => {
    try {
      await apiFetch('/api/notifications', { method: 'DELETE' })
      set({ notifications: [], unreadCount: 0 })
    } catch {
      // ignore
    }
  },
}))
