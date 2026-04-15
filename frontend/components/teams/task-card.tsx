'use client'

import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Flag, Clock, GripVertical, CheckSquare } from 'lucide-react'
import type { Task } from '@/types/team'
import { PRIORITY_CONFIG } from '@/types/team'
import { UserAvatar } from '@/components/user-avatar'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

function isOverdue(date: string): boolean {
  try {
    return new Date(date) < new Date()
  } catch {
    return false
  }
}

function formatDueDate(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  } catch {
    return iso
  }
}

interface TaskCardProps {
  task: Task
  onClick: () => void
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, data: { task } })

  const style: React.CSSProperties = isDragging
    ? { opacity: 0.3, pointerEvents: 'none' }
    : { transform: CSS.Translate.toString(transform), transition }

  const priority = PRIORITY_CONFIG[task.priority]
  const overdue = task.due_date ? isOverdue(task.due_date) : false
  const hasChecklist = task.checklist_total > 0
  const checklistPct = hasChecklist
    ? Math.round((task.checklist_done / task.checklist_total) * 100)
    : 0

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`group relative bg-[#1a1a1a] border border-[#1e1e1e] rounded-[10px] p-3 cursor-grab active:cursor-grabbing transition-shadow ${
        isDragging ? 'shadow-lg shadow-black/40' : 'hover:shadow-md hover:shadow-black/20'
      }`}
      onClick={onClick}
    >
      {/* Drag handle indicator */}
      <div className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-[#555]">
        <GripVertical size={14} />
      </div>

      {/* Priority + Title */}
      <div className="flex items-start gap-2 mb-2 pr-5">
        <Flag size={12} style={{ color: priority.color, flexShrink: 0, marginTop: 3 }} />
        <p
          className="text-sm font-medium leading-snug line-clamp-2"
          style={{ color: '#e2e0da', fontFamily: mono }}
        >
          {task.title}
        </p>
      </div>

      {/* Tags */}
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded text-[10px] font-medium"
              style={{
                background: 'rgba(255,107,44,0.1)',
                color: '#D4835A',
                fontFamily: mono,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Bottom row: checklist, due date, assignee */}
      <div className="flex items-center gap-2 mt-1">
        {/* Checklist progress */}
        {hasChecklist && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <CheckSquare size={11} style={{ color: '#888' }} />
            <span
              className="text-[10px]"
              style={{ color: '#888', fontFamily: mono }}
            >
              {task.checklist_done}/{task.checklist_total}
            </span>
            <div className="w-10 h-1 rounded-full bg-[#222] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${checklistPct}%`,
                  background: checklistPct === 100 ? '#34d399' : '#D4835A',
                }}
              />
            </div>
          </div>
        )}

        {/* Due date */}
        {task.due_date && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <Clock size={11} style={{ color: overdue ? '#ef4444' : '#888' }} />
            <span
              className="text-[10px]"
              style={{
                color: overdue ? '#ef4444' : '#888',
                fontFamily: mono,
              }}
            >
              {formatDueDate(task.due_date)}
            </span>
          </div>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Assignee */}
        {task.assignee_name && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <UserAvatar userId={task.assignee_id || undefined} name={task.assignee_name} size={20} />
            <span
              className="text-[10px] max-w-[60px] truncate"
              style={{ color: '#888', fontFamily: mono }}
            >
              {task.assignee_name}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Overlay version rendered during drag (no interactivity, just visual) */
export function TaskCardOverlay({ task }: { task: Task }) {
  const priority = PRIORITY_CONFIG[task.priority]

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-[10px] p-3 shadow-xl shadow-black/50 rotate-[2deg] w-[260px]">
      <div className="flex items-start gap-2 pr-5">
        <Flag size={12} style={{ color: priority.color, flexShrink: 0, marginTop: 3 }} />
        <p
          className="text-sm font-medium leading-snug line-clamp-2"
          style={{ color: '#e2e0da', fontFamily: mono }}
        >
          {task.title}
        </p>
      </div>
    </div>
  )
}
