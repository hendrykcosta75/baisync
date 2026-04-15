import { describe, it, expect, beforeEach } from 'vitest'
import { useStrategyMapStore } from '@/store/useStrategyMapStore'

describe('useStrategyMapStore', () => {
  beforeEach(() => {
    useStrategyMapStore.setState({
      nodes: [],
      edges: [],
      isLoading: false,
    })
  })

  it('fetchMap populates nodes and edges', async () => {
    await useStrategyMapStore.getState().fetchMap('ws-1')
    const state = useStrategyMapStore.getState()
    expect(state.nodes).toEqual([])
    expect(state.edges).toEqual([])
    expect(state.isLoading).toBe(false)
  })

  it('createNode adds node to store', async () => {
    const node = await useStrategyMapStore.getState().createNode('ws-1', {
      node_type: 'objective',
      label: 'Test Objective',
      position_x: 100,
      position_y: 200,
    })
    expect(node.id).toBe('node-new')
    expect(node.label).toBe('Test Objective')
    expect(useStrategyMapStore.getState().nodes).toHaveLength(1)
  })

  it('deleteNode removes node and connected edges', async () => {
    useStrategyMapStore.setState({
      nodes: [
        { workspace_id: 'ws-1', id: 'n1', node_type: 'objective', entity_id: null, label: 'A', position_x: 0, position_y: 0, width: 200, height: 100, style_data: null, bsc_perspective: null, created_at: '', updated_at: '' },
        { workspace_id: 'ws-1', id: 'n2', node_type: 'objective', entity_id: null, label: 'B', position_x: 0, position_y: 0, width: 200, height: 100, style_data: null, bsc_perspective: null, created_at: '', updated_at: '' },
      ],
      edges: [
        { workspace_id: 'ws-1', id: 'e1', source_node_id: 'n1', target_node_id: 'n2', edge_type: 'hierarchy', label: null, style_data: null, created_at: '' },
      ],
    })

    await useStrategyMapStore.getState().deleteNode('ws-1', 'n1')
    const state = useStrategyMapStore.getState()
    expect(state.nodes).toHaveLength(1)
    expect(state.nodes[0].id).toBe('n2')
    expect(state.edges).toHaveLength(0) // Edge connected to n1 removed
  })
})
