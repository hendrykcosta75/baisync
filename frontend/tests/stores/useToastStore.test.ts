import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useToastStore } from '@/store/useToastStore'

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
    vi.useFakeTimers()
  })

  it('addToast appends a toast', () => {
    useToastStore.getState().addToast('error', 'Something went wrong')
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].type).toBe('error')
    expect(toasts[0].message).toBe('Something went wrong')
  })

  it('addToast supports different types', () => {
    const { addToast } = useToastStore.getState()
    addToast('success', 'Done')
    addToast('info', 'Note')
    addToast('error', 'Fail')
    expect(useToastStore.getState().toasts).toHaveLength(3)
    expect(useToastStore.getState().toasts.map(t => t.type)).toEqual(['success', 'info', 'error'])
  })

  it('removeToast removes specific toast', () => {
    useToastStore.getState().addToast('error', 'msg1')
    useToastStore.getState().addToast('info', 'msg2')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(id)
    const { toasts } = useToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('msg2')
  })

  it('auto-removes toast after 5 seconds', () => {
    useToastStore.getState().addToast('error', 'temp')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('each toast gets a unique id', () => {
    const { addToast } = useToastStore.getState()
    addToast('error', 'a')
    addToast('error', 'b')
    const ids = useToastStore.getState().toasts.map(t => t.id)
    expect(ids[0]).not.toBe(ids[1])
  })
})
