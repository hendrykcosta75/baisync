import { describe, it, expect, beforeEach } from 'vitest'
import { useSwotStore } from '@/store/useSwotStore'

describe('useSwotStore', () => {
  beforeEach(() => {
    useSwotStore.setState({
      analyses: [],
      activeAnalysis: null,
      isLoading: false,
    })
  })

  it('fetchAnalyses populates analyses list', async () => {
    await useSwotStore.getState().fetchAnalyses('ws-1')
    const state = useSwotStore.getState()
    expect(state.analyses).toHaveLength(1)
    expect(state.analyses[0].title).toBe('Q2 Analysis')
  })

  it('createAnalysis adds to store', async () => {
    const analysis = await useSwotStore.getState().createAnalysis('ws-1', { title: 'New SWOT' })
    expect(analysis.id).toBe('swot-new')
    expect(analysis.title).toBe('New SWOT')
    expect(useSwotStore.getState().analyses).toHaveLength(1)
  })

  it('getAnalysis sets activeAnalysis with items', async () => {
    await useSwotStore.getState().getAnalysis('ws-1', 'swot-1')
    const state = useSwotStore.getState()
    expect(state.activeAnalysis).toBeTruthy()
    expect(state.activeAnalysis?.title).toBe('Q2 Analysis')
    expect(state.activeAnalysis?.items).toHaveLength(1)
    expect(state.activeAnalysis?.items?.[0].quadrant).toBe('strengths')
  })

  it('createItem adds to activeAnalysis items', async () => {
    // First set active analysis
    await useSwotStore.getState().getAnalysis('ws-1', 'swot-1')

    const item = await useSwotStore.getState().createItem('swot-1', {
      quadrant: 'weaknesses', content: 'Lack of resources',
    })
    expect(item.quadrant).toBe('weaknesses')
    expect(useSwotStore.getState().activeAnalysis?.items).toHaveLength(2)
  })

  it('deleteItem removes from activeAnalysis items', async () => {
    await useSwotStore.getState().getAnalysis('ws-1', 'swot-1')
    await useSwotStore.getState().deleteItem('swot-1', 'item-1')
    expect(useSwotStore.getState().activeAnalysis?.items).toHaveLength(0)
  })
})
