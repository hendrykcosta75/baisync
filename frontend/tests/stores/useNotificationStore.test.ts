import { describe, it, expect, beforeEach } from 'vitest'
import { useNotificationStore } from '@/store/useNotificationStore'

describe('useNotificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [], unreadCount: 0 })
  })

  it('starts with empty notifications', () => {
    const state = useNotificationStore.getState()
    expect(state.notifications).toEqual([])
    expect(state.unreadCount).toBe(0)
  })

  it('fetch loads notifications and counts unread', async () => {
    await useNotificationStore.getState().fetch()
    const state = useNotificationStore.getState()
    expect(state.notifications).toHaveLength(2)
    expect(state.unreadCount).toBe(1) // only notif-1 is unread
  })

  it('markRead marks a single notification as read', async () => {
    await useNotificationStore.getState().fetch()
    await useNotificationStore.getState().markRead('notif-1')
    const state = useNotificationStore.getState()
    const n = state.notifications.find(n => n.id === 'notif-1')
    expect(n?.is_read).toBe(true)
    expect(state.unreadCount).toBe(0)
  })

  it('markAllRead marks all notifications as read', async () => {
    await useNotificationStore.getState().fetch()
    await useNotificationStore.getState().markAllRead()
    const state = useNotificationStore.getState()
    expect(state.unreadCount).toBe(0)
    expect(state.notifications.every(n => n.is_read)).toBe(true)
  })

  it('deleteOne removes a notification', async () => {
    await useNotificationStore.getState().fetch()
    await useNotificationStore.getState().deleteOne('notif-1')
    const state = useNotificationStore.getState()
    expect(state.notifications).toHaveLength(1)
    expect(state.notifications[0].id).toBe('notif-2')
    expect(state.unreadCount).toBe(0) // remaining is already read
  })

  it('deleteAll clears all notifications', async () => {
    await useNotificationStore.getState().fetch()
    await useNotificationStore.getState().deleteAll()
    const state = useNotificationStore.getState()
    expect(state.notifications).toHaveLength(0)
    expect(state.unreadCount).toBe(0)
  })
})
