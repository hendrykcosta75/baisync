'use client'

import React, { useMemo, useState, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { Filter, CalendarDays } from 'lucide-react'
import type { Task, TaskStatus, TaskPriority } from '@/types/team'
import { KANBAN_COLUMNS, PRIORITY_CONFIG } from '@/types/team'
import { useTeamStore } from '@/store/useTeamStore'
import { KanbanColumn } from './kanban-column'
import { TaskCardOverlay } from './task-card'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

interface KanbanBoardProps {
  teamId: string
  onCreateTask: (status: string) => void
  onTaskClick: (task: Task) => void
}

export function KanbanBoard({ teamId, onCreateTask, onTaskClick }: KanbanBoardProps) {
  const { tasks, members, moveTask } = useTeamStore()

  const [filterAssignee, setFilterAssignee] = useState<string>('')
  const [filterPriority, setFilterPriority] = useState<string>('')
  const [filterPeriod, setFilterPeriod] = useState<string>('month')
  const [filterDate, setFilterDate] = useState<string>(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  })
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  )

  // Filter tasks
  const filteredTasks = useMemo(() => {
    let result = tasks
    if (filterAssignee) {
      result = result.filter((t) => t.assignee_id === filterAssignee)
    }
    if (filterPriority) {
      result = result.filter((t) => t.priority === filterPriority)
    }
    if (filterPeriod !== 'all') {
      const ref = new Date(filterDate + 'T00:00:00')
      result = result.filter((t) => {
        if (!t.due_date && !t.created_at) return true // show tasks without dates
        const taskDate = new Date(t.due_date || t.created_at)
        if (filterPeriod === 'day') {
          return taskDate.toDateString() === ref.toDateString()
        }
        if (filterPeriod === 'week') {
          const startOfWeek = new Date(ref)
          startOfWeek.setDate(ref.getDate() - ref.getDay())
          startOfWeek.setHours(0, 0, 0, 0)
          const endOfWeek = new Date(startOfWeek)
          endOfWeek.setDate(startOfWeek.getDate() + 7)
          return taskDate >= startOfWeek && taskDate < endOfWeek
        }
        if (filterPeriod === 'month') {
          return taskDate.getFullYear() === ref.getFullYear() && taskDate.getMonth() === ref.getMonth()
        }
        if (filterPeriod === 'year') {
          return taskDate.getFullYear() === ref.getFullYear()
        }
        return true
      })
    }
    return result
  }, [tasks, filterAssignee, filterPriority, filterPeriod, filterDate])

  // Group tasks by status, sorted by position
  const columns = useMemo(() => {
    const grouped: Record<TaskStatus, Task[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
    }
    for (const task of filteredTasks) {
      if (grouped[task.status]) {
        grouped[task.status].push(task)
      }
    }
    // Sort each column by position
    for (const key of Object.keys(grouped) as TaskStatus[]) {
      grouped[key].sort((a, b) => a.position - b.position)
    }
    return grouped
  }, [filteredTasks])

  const findColumnForTask = useCallback(
    (taskId: string): TaskStatus | null => {
      for (const [status, columnTasks] of Object.entries(columns)) {
        if (columnTasks.some((t) => t.id === taskId)) {
          return status as TaskStatus
        }
      }
      return null
    },
    [columns]
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const task = filteredTasks.find((t) => t.id === event.active.id)
      setActiveTask(task || null)
    },
    [filteredTasks]
  )

  const handleDragOver = useCallback(() => {
    // Visual feedback is handled by useDroppable isOver state in KanbanColumn
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null)

      const { active, over } = event
      if (!over) return

      const activeId = active.id as string
      const overId = over.id as string

      // Determine target column: the over element could be a column or a task
      let targetStatus: TaskStatus | null = null
      let targetIndex = 0

      // Check if overId is a column id (one of the status keys)
      const isColumn = KANBAN_COLUMNS.some((c) => c.key === overId)
      if (isColumn) {
        targetStatus = overId as TaskStatus
        targetIndex = columns[targetStatus].length // append at end
      } else {
        // overId is a task — find which column it belongs to
        targetStatus = findColumnForTask(overId)
        if (targetStatus) {
          const targetTasks = columns[targetStatus]
          const overIndex = targetTasks.findIndex((t) => t.id === overId)
          targetIndex = overIndex >= 0 ? overIndex : targetTasks.length
        }
      }

      if (!targetStatus) return

      const sourceStatus = findColumnForTask(activeId)
      if (!sourceStatus) return

      // If same column and same position, nothing to do
      if (sourceStatus === targetStatus) {
        const sourceTasks = columns[sourceStatus]
        const oldIndex = sourceTasks.findIndex((t) => t.id === activeId)
        if (oldIndex === targetIndex) return

        // Reorder within same column
        const reordered = arrayMove(sourceTasks, oldIndex, targetIndex)
        const newPosition = targetIndex
        moveTask(teamId, activeId, targetStatus, newPosition)

        // Also update positions for other affected tasks
        void reordered // positions are managed server-side after the move
      } else {
        // Move across columns
        moveTask(teamId, activeId, targetStatus, targetIndex)
      }
    },
    [columns, findColumnForTask, moveTask, teamId]
  )

  const hasActiveFilters = filterAssignee || filterPriority || filterPeriod !== 'month'

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter size={13} style={{ color: '#888' }} />
          <span
            className="text-[11px] uppercase tracking-wider font-semibold"
            style={{ color: '#888', fontFamily: mono }}
          >
            Filtros
          </span>
        </div>

        {/* Assignee filter */}
        <select
          value={filterAssignee}
          onChange={(e) => setFilterAssignee(e.target.value)}
          className="rounded-[10px] px-3 py-1.5 text-[11px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
          style={{
            background: '#141414',
            color: filterAssignee ? '#e2e0da' : '#888',
            fontFamily: mono,
          }}
        >
          <option value="">Responsável</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.user_name || m.user_email || m.user_id}
            </option>
          ))}
        </select>

        {/* Priority filter */}
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="rounded-[10px] px-3 py-1.5 text-[11px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
          style={{
            background: '#141414',
            color: filterPriority ? '#e2e0da' : '#888',
            fontFamily: mono,
          }}
        >
          <option value="">Prioridade</option>
          {(Object.entries(PRIORITY_CONFIG) as [TaskPriority, { label: string; color: string }][]).map(
            ([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            )
          )}
        </select>

        <div className="w-px h-5 bg-[#1e1e1e]" />

        {/* Period filter */}
        <div className="flex items-center gap-1.5">
          <CalendarDays size={13} style={{ color: '#888' }} />
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            className="rounded-[10px] px-3 py-1.5 text-[11px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
            style={{
              background: '#141414',
              color: filterPeriod !== 'all' ? '#e2e0da' : '#888',
              fontFamily: mono,
            }}
          >
            <option value="all">Todas</option>
            <option value="day">Dia</option>
            <option value="week">Semana</option>
            <option value="month">Mês</option>
            <option value="year">Ano</option>
          </select>
        </div>

        {/* Date picker (shown when period is not "all") */}
        {filterPeriod !== 'all' && (
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="rounded-[10px] px-3 py-1.5 text-[11px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
            style={{
              background: '#141414',
              color: '#e2e0da',
              fontFamily: mono,
              colorScheme: 'dark',
            }}
          />
        )}

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={() => {
              setFilterAssignee('')
              setFilterPriority('')
              setFilterPeriod('month')
              const now = new Date()
              setFilterDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
            }}
            className="text-[11px] px-2 py-1 rounded-md transition-colors hover:text-[#D4835A]"
            style={{ color: '#888', fontFamily: mono }}
          >
            Limpar
          </button>
        )}
      </div>

      {/* Kanban columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((col) => (
            <KanbanColumn
              key={col.key}
              id={col.key}
              label={col.label}
              tasks={columns[col.key]}
              onCreateTask={() => onCreateTask(col.key)}
              onTaskClick={onTaskClick}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask ? <TaskCardOverlay task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
