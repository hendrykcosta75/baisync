import { describe, it, expect, beforeEach } from 'vitest'
import { useErrorStore } from '@/store/useErrorStore'

describe('useErrorStore', () => {
  beforeEach(() => {
    useErrorStore.setState({ isOpen: false, title: 'Erro', message: '' })
  })

  it('starts closed with default title', () => {
    const state = useErrorStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.title).toBe('Erro')
    expect(state.message).toBe('')
  })

  it('showError opens modal with message', () => {
    useErrorStore.getState().showError('Something went wrong')
    const state = useErrorStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.message).toBe('Something went wrong')
    expect(state.title).toBe('Erro')
  })

  it('showError accepts custom title', () => {
    useErrorStore.getState().showError('Not found', 'Custom Title')
    const state = useErrorStore.getState()
    expect(state.isOpen).toBe(true)
    expect(state.title).toBe('Custom Title')
    expect(state.message).toBe('Not found')
  })

  it('close resets to default state', () => {
    useErrorStore.getState().showError('Error!', 'Title')
    useErrorStore.getState().close()
    const state = useErrorStore.getState()
    expect(state.isOpen).toBe(false)
    expect(state.title).toBe('Erro')
    expect(state.message).toBe('')
  })
})
