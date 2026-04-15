'use client'

import React, { useEffect, useCallback, useRef, useState } from 'react'
import {
  ReactFlow,
  MiniMap,
  Background,
  BackgroundVariant,
  SelectionMode,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useStrategyMapStore, type MapNode, type MapEdge } from '@/store/useStrategyMapStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { StrategyNode } from '@/components/strategy-map/strategy-node'
import {
  Target, BarChart3, RefreshCw, Building2,
  ZoomIn, ZoomOut, Maximize2, UsersRound, MessageSquare,
  Bot, ListTodo, Crosshair, Users, StickyNote, Plus,
} from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const LEGEND_ITEMS = [
  { icon: Building2, color: '#ff6b2c', label: 'Workspace' },
  { icon: Target, color: '#D4835A', label: 'Objetivo' },
  { icon: BarChart3, color: '#3b82f6', label: 'KR' },
  { icon: UsersRound, color: '#8b5cf6', label: 'Equipe' },
  { icon: Users, color: '#06b6d4', label: 'Membro' },
  { icon: MessageSquare, color: '#f59e0b', label: 'Canal' },
  { icon: Bot, color: '#ec4899', label: 'Assistente' },
  { icon: ListTodo, color: '#14b8a6', label: 'Tarefa' },
  { icon: Crosshair, color: '#f97316', label: 'SWOT' },
  { icon: StickyNote, color: '#fbbf24', label: 'Nota' },
]

function StrategyMapInner() {
  const { nodes: mapNodes, edges: mapEdges, fetchMap, syncMap, createNode, deleteNode, deleteEdge, batchUpdatePositions, isLoading } = useStrategyMapStore()
  const { activeWorkspace } = useWorkspaceStore()
  const wsId = activeWorkspace?.workspace_id || ''
  const { zoomIn, zoomOut, fitView } = useReactFlow()

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [syncing, setSyncing] = useState(false)
  const [panActive, setPanActive] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasInitialFitRef = useRef(false)

  // ─── Spacebar pan mode ───
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault()
        setPanActive(true)
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setPanActive(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  function mapNodeToFlow(n: MapNode): Node {
    const isWorkspace = n.node_type === 'workspace'
    const isStickyNote = n.node_type === 'sticky_note'
    return {
      id: n.id,
      type: 'strategy',
      position: { x: n.position_x, y: n.position_y },
      draggable: !isWorkspace,
      selectable: !isWorkspace,
      deletable: !isWorkspace,
      zIndex: isStickyNote ? -1 : 0,
      data: {
        label: n.label,
        nodeType: n.node_type,
        entityId: n.entity_id,
        bscPerspective: n.bsc_perspective,
        styleData: n.style_data,
        onDelete: isWorkspace ? undefined : (nodeId: string) => { if (wsId) deleteNode(wsId, nodeId) },
        onEditLabel: isWorkspace ? undefined : (nodeId: string, newLabel: string) => {
          if (wsId) useStrategyMapStore.getState().updateNode(wsId, nodeId, { label: newLabel })
        },
        onUpdateStyle: isWorkspace ? undefined : (nodeId: string, styleData: string) => {
          if (wsId) useStrategyMapStore.getState().updateNode(wsId, nodeId, { style_data: styleData })
        },
      },
    }
  }

  function mapEdgeToFlow(e: MapEdge): Edge {
    const colorMap: Record<string, string> = {
      hierarchy: '#D4835A',
      alignment: '#3b82f6',
      dependency: '#f59e0b',
      cause_effect: '#22c55e',
    }
    return {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      type: 'bezier',
      animated: e.edge_type === 'cause_effect',
      label: e.label || undefined,
      style: { stroke: colorMap[e.edge_type] || '#D4835A', strokeWidth: 1.5, opacity: 0.6 },
      labelStyle: { fill: '#666', fontFamily: mono, fontSize: 9 },
    }
  }

  const nodeTypes: NodeTypes = useRef<NodeTypes>({ strategy: StrategyNode }).current

  // Fetch map + auto-sync on workspace change
  useEffect(() => {
    if (wsId) {
      hasInitialFitRef.current = false
      useStrategyMapStore.setState({ nodes: [], edges: [] })
      fetchMap(wsId).then(() => {
        syncMap(wsId).catch(() => {})
      })
    }
  }, [wsId, fetchMap, syncMap])

  // Sync store data → ReactFlow state
  useEffect(() => {
    setNodes(mapNodes.map(mapNodeToFlow))
    setEdges(mapEdges.map(mapEdgeToFlow))
    if (!hasInitialFitRef.current && mapNodes.length > 0) {
      hasInitialFitRef.current = true
      setTimeout(() => fitView({ padding: 0.2 }), 150)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapNodes, mapEdges])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!wsId || !connection.source || !connection.target) return
      setEdges((eds) => addEdge({ ...connection, type: 'bezier', animated: false, style: { stroke: '#D4835A', strokeWidth: 1.5, opacity: 0.6 } }, eds))
      useStrategyMapStore.getState().createEdge(wsId, { source_node_id: connection.source, target_node_id: connection.target, edge_type: 'hierarchy' })
    },
    [wsId, setEdges],
  )

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      // Prevent position changes on workspace node
      const filtered = changes.filter((c) => {
        if (c.type === 'position' && 'id' in c) {
          const node = mapNodes.find((n) => n.id === c.id)
          if (node?.node_type === 'workspace') return false
        }
        return true
      })
      onNodesChange(filtered)
      const positionChanges = filtered.filter((c) => c.type === 'position' && 'position' in c && c.position && !c.dragging)
      if (positionChanges.length > 0 && wsId) {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        saveTimerRef.current = setTimeout(() => {
          const updates = positionChanges
            .filter((c): c is NodeChange<Node> & { id: string; position: { x: number; y: number } } => 'position' in c && !!c.position)
            .map((c) => ({ id: c.id, position_x: c.position.x, position_y: c.position.y }))
          if (updates.length > 0) batchUpdatePositions(wsId, updates)
        }, 300)
      }
    },
    [onNodesChange, wsId, batchUpdatePositions, mapNodes],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChange(changes)
      const removals = changes.filter((c) => c.type === 'remove')
      for (const r of removals) {
        if (wsId) deleteEdge(wsId, r.id)
      }
    },
    [onEdgesChange, wsId, deleteEdge],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
        const selectedNodes = nodes.filter((n) => n.selected)
        const selectedEdges = edges.filter((ed) => ed.selected)
        for (const node of selectedNodes) {
          // Prevent deleting workspace node
          const mapNode = mapNodes.find((mn) => mn.id === node.id)
          if (mapNode?.node_type === 'workspace') continue
          if (wsId) deleteNode(wsId, node.id)
        }
        for (const edge of selectedEdges) {
          if (wsId) deleteEdge(wsId, edge.id)
        }
      }
    },
    [nodes, edges, wsId, deleteNode, deleteEdge, mapNodes],
  )

  const handleSync = useCallback(async () => {
    if (!wsId || syncing) return
    setSyncing(true)
    try {
      await syncMap(wsId)
      setTimeout(() => fitView({ padding: 0.2 }), 200)
    } finally {
      setSyncing(false)
    }
  }, [wsId, syncing, syncMap, fitView])

  const handleAddStickyNote = useCallback(async () => {
    if (!wsId) return
    await createNode(wsId, {
      node_type: 'sticky_note',
      label: 'Nova nota',
      position_x: 100,
      position_y: 100,
      width: 280,
      height: 120,
    })
  }, [wsId, createNode])

  return (
    <div className="flex h-[calc(100vh-64px)] relative" onKeyDown={handleKeyDown}>
      {/* Canvas */}
      <div className="flex-1 overflow-hidden" style={{ background: '#0a0a0a' }}>
        {isLoading && nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-[#D4835A] border-t-transparent rounded-full animate-spin" />
              <span className="text-subtle text-xs" style={{ fontFamily: mono }}>Carregando mapa...</span>
            </div>
          </div>
        ) : !isLoading && nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-center max-w-[280px]">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center" style={{ background: 'rgba(212,131,90,0.1)' }}>
                <Building2 size={20} style={{ color: '#D4835A' }} />
              </div>
              <p className="text-subtle text-xs leading-relaxed" style={{ fontFamily: mono }}>
                Clique em <strong className="text-heading">Sincronizar</strong> para gerar o mapa do workspace a partir dos seus dados.
              </p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            snapToGrid
            snapGrid={[20, 20]}
            deleteKeyCode={null}
            selectionOnDrag={!panActive}
            panOnDrag={panActive}
            panOnScroll={false}
            zoomOnDoubleClick={false}
            selectionMode={SelectionMode.Partial}
            defaultEdgeOptions={{ type: 'bezier', animated: false }}
            minZoom={0.1}
            maxZoom={2}
            fitViewOptions={{ padding: 0.3 }}
            connectionLineStyle={{ stroke: '#D4835A', strokeWidth: 1.5, opacity: 0.5 }}
            style={{ background: '#0a0a0a', cursor: panActive ? 'grab' : 'default' }}
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap
              style={{ background: '#111111', border: '1px solid #1e1e1e', borderRadius: 10 }}
              nodeColor="#D4835A"
              maskColor="rgba(0,0,0,0.7)"
            />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1e1e1e" />
          </ReactFlow>
        )}
      </div>

      {/* Right-side toolbar */}
      <div
        className="absolute right-4 top-4 flex flex-col gap-1 rounded-xl p-1.5"
        style={{
          background: '#141414',
          border: '1px solid #1e1e1e',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        {/* Sync button */}
        <button
          className="group relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-[rgba(255,107,44,0.08)]"
          onClick={handleSync}
          disabled={syncing}
          title="Sincronizar dados"
        >
          <RefreshCw size={15} className={`text-subtle group-hover:text-[#D4835A] transition-colors ${syncing ? 'animate-spin' : ''}`} />
          <span
            className="absolute right-full mr-2 px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
            style={{ background: '#1e1e1e', color: '#ccc', fontFamily: mono }}
          >
            Sincronizar
          </span>
        </button>

        {/* Add Sticky Note */}
        <button
          className="group relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-[rgba(251,191,36,0.08)]"
          onClick={handleAddStickyNote}
          title="Nova nota"
        >
          <StickyNote size={15} className="text-subtle group-hover:text-[#fbbf24] transition-colors" />
          <span
            className="absolute right-full mr-2 px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"
            style={{ background: '#1e1e1e', color: '#ccc', fontFamily: mono }}
          >
            Nova Nota
          </span>
        </button>

        {/* Separator */}
        <div className="h-px mx-1.5 my-0.5" style={{ background: '#2a2a2a' }} />

        {/* Zoom controls */}
        <button
          className="group relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-[rgba(255,255,255,0.06)]"
          onClick={() => zoomIn()}
          title="Zoom in"
        >
          <ZoomIn size={15} className="text-subtle group-hover:text-heading transition-colors" />
        </button>
        <button
          className="group relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-[rgba(255,255,255,0.06)]"
          onClick={() => zoomOut()}
          title="Zoom out"
        >
          <ZoomOut size={15} className="text-subtle group-hover:text-heading transition-colors" />
        </button>
        <button
          className="group relative flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-200 hover:bg-[rgba(255,255,255,0.06)]"
          onClick={() => fitView({ padding: 0.2 })}
          title="Ajustar tudo"
        >
          <Maximize2 size={15} className="text-subtle group-hover:text-heading transition-colors" />
        </button>
      </div>

      {/* Legend */}
      <div
        className="absolute left-4 bottom-4 rounded-xl p-3 flex flex-wrap gap-x-4 gap-y-1.5"
        style={{
          background: '#141414',
          border: '1px solid #1e1e1e',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="flex items-center gap-1.5">
            <item.icon size={10} style={{ color: item.color }} />
            <span className="text-[9px]" style={{ color: '#888', fontFamily: mono }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function StrategyMapPage() {
  return (
    <ReactFlowProvider>
      <StrategyMapInner />
    </ReactFlowProvider>
  )
}
