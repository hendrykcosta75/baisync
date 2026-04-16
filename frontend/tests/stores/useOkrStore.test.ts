import { describe, it, expect, beforeEach } from 'vitest'
import { useOkrStore } from '@/store/useOkrStore'

describe('useOkrStore', () => {
  beforeEach(() => {
    useOkrStore.setState({
      objectives: [],
      activeObjective: null,
      checkIns: [],
      checkInsCursor: null,
      isLoading: false,
    })
  })

  it('fetchObjectives populates objectives by cycle', async () => {
    await useOkrStore.getState().fetchObjectives('ws-1', '2026-Q2')
    const state = useOkrStore.getState()
    expect(state.objectives).toHaveLength(1)
    expect(state.objectives[0].title).toBe('Increase Revenue')
  })

  it('fetchObjectives without cycle returns empty', async () => {
    await useOkrStore.getState().fetchObjectives('ws-1')
    const state = useOkrStore.getState()
    expect(state.objectives).toHaveLength(0)
  })

  it('createObjective adds to store and returns objective', async () => {
    const obj = await useOkrStore.getState().createObjective('ws-1', {
      title: 'New Objective', objective_type: 'aspirational', cycle: '2026-Q2',
    })
    expect(obj.id).toBe('obj-new')
    expect(obj.title).toBe('New Objective')
    expect(useOkrStore.getState().objectives).toHaveLength(1)
  })

  it('setCycle updates currentCycle', () => {
    useOkrStore.getState().setCycle('2026-Q3')
    expect(useOkrStore.getState().currentCycle).toBe('2026-Q3')
  })

  it('fetchChildren returns empty array', async () => {
    const children = await useOkrStore.getState().fetchChildren('obj-1')
    expect(children).toEqual([])
  })
})
