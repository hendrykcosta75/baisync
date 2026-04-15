import { describe, it, expect, beforeEach } from 'vitest'
import { useCalendarStore } from '@/store/useCalendarStore'

describe('useCalendarStore', () => {
  beforeEach(() => {
    useCalendarStore.setState({
      appointments: [],
      isLoading: false,
      selectedAssistantId: null,
    })
  })

  it('starts with empty appointments', () => {
    const state = useCalendarStore.getState()
    expect(state.appointments).toEqual([])
    expect(state.isLoading).toBe(false)
    expect(state.selectedAssistantId).toBeNull()
  })

  it('fetch loads appointments from API', async () => {
    await useCalendarStore.getState().fetch()
    const state = useCalendarStore.getState()
    expect(state.isLoading).toBe(false)
    // API returns empty array in mock
    expect(state.appointments).toEqual([])
  })

  it('create adds an appointment', async () => {
    const apt = await useCalendarStore.getState().create({
      clientName: 'John Doe',
      clientPhone: '+5511999999999',
      dateTime: '2026-05-01T10:00:00Z',
      durationMinutes: 30,
    })
    expect(apt.clientName).toBe('John Doe')
    expect(apt.clientPhone).toBe('+5511999999999')
    expect(useCalendarStore.getState().appointments).toHaveLength(1)
  })

  it('remove deletes an appointment', async () => {
    // First create
    await useCalendarStore.getState().create({
      clientName: 'John',
      clientPhone: '+5511999999999',
      dateTime: '2026-05-01T10:00:00Z',
    })
    const id = useCalendarStore.getState().appointments[0].id
    await useCalendarStore.getState().remove(id)
    expect(useCalendarStore.getState().appointments).toHaveLength(0)
  })

  it('setFilter updates selectedAssistantId', () => {
    useCalendarStore.getState().setFilter('ast-1')
    expect(useCalendarStore.getState().selectedAssistantId).toBe('ast-1')
    useCalendarStore.getState().setFilter(null)
    expect(useCalendarStore.getState().selectedAssistantId).toBeNull()
  })

  it('cancel sets appointment status to cancelled', async () => {
    await useCalendarStore.getState().create({
      clientName: 'Jane',
      clientPhone: '+5511888888888',
      dateTime: '2026-06-01T14:00:00Z',
    })
    const id = useCalendarStore.getState().appointments[0].id
    await useCalendarStore.getState().cancel(id)
    expect(useCalendarStore.getState().appointments[0].status).toBe('cancelled')
  })
})
