'use client'

import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import type { Task } from '@/types/team'
import { TaskCard } from './task-card'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const WIP_LIMIT = 5

interface KanbanColumnProps {
  id: string
  label: string
  tasks: Task[]
  onCreateTask: () => void
  onTaskClick: (task: Task) => void
}

export function KanbanColumn({
  id,
  label,
  tasks,
  onCreateTask,
  onTaskClick,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  const overWip = tasks.length > WIP_LIMIT
  const taskIds = tasks.map((t) => t.id)

  return (
    <div
      className={`flex flex-col w-[280px] min-w-[280px] rounded-xl border transition-colors ${
        overWip
          ? 'border-amber-500/30'
          : isOver
            ? 'border-[#D4835A]/40'
            : 'border-[#1e1e1e]'
      }`}
      style={{ background: '#141414' }}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1e1e1e]">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] uppercase tracking-wider font-semibold"
            style={{ color: '#888', fontFamily: mono }}
          >
            {label}
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-md min-w-[20px] text-center"
            style={{
              background: 'rgba(255,255,255,0.04)',
              color: '#888',
              fontFamily: mono,
            }}
          >
            {tasks.length}
          </span>
        </div>
        {overWip && (
          <span
            className="text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded"
            style={{
              background: 'rgba(245,158,11,0.1)',
              color: '#f59e0b',
              fontFamily: mono,
            }}
          >
            WIP
          </span>
        )}
      </div>

      {/* Droppable task list */}
      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex-1 flex flex-col gap-2 p-2 min-h-[120px] overflow-y-auto"
          style={{ maxHeight: 'calc(100vh - 280px)' }}
        >
          {tasks.length === 0 && (
            <div
              className="flex-1 flex items-center justify-center min-h-[80px] rounded-lg border border-dashed border-[#1e1e1e]"
            >
              <span
                className="text-[11px]"
                style={{ color: '#555', fontFamily: mono }}
              >
                Sem tarefas
              </span>
            </div>
          )}
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
            />
          ))}
        </div>
      </SortableContext>

      {/* New task button */}
      <div className="p-2 border-t border-[#1e1e1e]">
        <button
          onClick={onCreateTask}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[10px] text-[11px] font-medium transition-all hover:text-[#D4835A]"
          style={{
            fontFamily: mono,
            color: '#666',
            background: 'transparent',
          }}
        >
          <Plus size={13} />
          Nova Tarefa
        </button>
      </div>
    </div>
  )
}
