'use client'

import React, { useEffect, useState, useMemo, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Button, Select, ListBox } from '@heroui/react'
import { Plus, Filter } from 'lucide-react'
import { useCalendarStore } from '@/store/useCalendarStore'
import { useAssistantStore } from '@/store/useAssistantStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useAuthStore } from '@/store/useAuthStore'
import { apiFetch } from '@/lib/api'
import { AppointmentDetailModal } from '@/components/calendar/appointment-detail-modal'
import { CreateEventModal } from '@/components/calendar/create-event-modal'
import { TaskDetailModal } from '@/components/teams/task-detail-modal'
import type { Appointment } from '@/types/appointment'
import type { Task, TeamWithStats, TeamMember } from '@/types/team'

import type { EventClickArg, DateSelectArg } from '@fullcalendar/core'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'

const FullCalendar = dynamic(() => import('@fullcalendar/react'), { ssr: false })

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  confirmed: { bg: '#dcfce7', border: '#22c55e', text: '#15803d' },
  pending: { bg: '#fef9c3', border: '#eab308', text: '#a16207' },
  cancelled: { bg: '#fee2e2', border: '#f87171', text: '#b91c1c' },
  rescheduled: { bg: '#fff3e6', border: '#ff6b2c', text: '#cc5500' },
  completed: { bg: '#fff3e6', border: '#ff6b2c', text: '#cc5500' },
  no_show: { bg: '#f3f4f6', border: '#9ca3af', text: '#4b5563' },
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Confirmado',
  pending: 'Pendente',
  cancelled: 'Cancelado',
  rescheduled: 'Reagendado',
  completed: 'Concluído',
  no_show: 'Ausente',
}

export default function CalendarPage() {
  const { appointments, isLoading, fetch, selectedAssistantId, setFilter } = useCalendarStore()
  const { assistants, fetchAssistants, hasFetched } = useAssistantStore()

  const { activeWorkspace } = useWorkspaceStore()
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createDate, setCreateDate] = useState<string | null>(null)
  const [showFilter, setShowFilter] = useState(false)
  const [allTasks, setAllTasks] = useState<(Task & { team_name?: string })[]>([])
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [taskMembers, setTaskMembers] = useState<TeamMember[]>([])

  useEffect(() => {
    fetch()
    if (!hasFetched) fetchAssistants()
  }, [fetch, fetchAssistants, hasFetched])

  // Fetch tasks across all teams
  useEffect(() => {
    const wsId = activeWorkspace?.workspace_id
    if (!wsId) return
    let cancelled = false
    ;(async () => {
      try {
        const { teams } = await apiFetch<{ teams: TeamWithStats[] }>(`/api/workspaces/${wsId}/teams`)
        const taskPromises = teams.map(async (team) => {
          try {
            const { tasks } = await apiFetch<{ tasks: Task[] }>(`/api/teams/${team.id}/tasks`)
            return tasks
              .filter((t) => t.due_date && t.assignee_id === currentUserId)
              .map((t) => ({ ...t, team_name: team.name }))
          } catch {
            return []
          }
        })
        const results = await Promise.all(taskPromises)
        if (!cancelled) setAllTasks(results.flat())
      } catch {
        // ignore
      }
    })()
    return () => { cancelled = true }
  }, [activeWorkspace?.workspace_id, currentUserId])

  const filteredAppointments = useMemo(() => {
    if (!selectedAssistantId) return appointments
    return appointments.filter(a => a.assistantId === selectedAssistantId)
  }, [appointments, selectedAssistantId])

  const TASK_STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
    backlog: { bg: '#1e1e2e', border: '#6b7280', text: '#9ca3af' },
    todo: { bg: '#1e1e2e', border: '#3b82f6', text: '#60a5fa' },
    in_progress: { bg: '#1a1a2e', border: '#f59e0b', text: '#fbbf24' },
    in_review: { bg: '#1a1a2e', border: '#a855f7', text: '#c084fc' },
    done: { bg: '#1a2e1a', border: '#22c55e', text: '#4ade80' },
  }

  const calendarEvents = useMemo(() => {
    const appointmentEvents = filteredAppointments.map(a => {
      const colors = STATUS_COLORS[a.status] || STATUS_COLORS.pending
      return {
        id: a.id,
        title: a.clientName || a.appointmentType || 'Evento',
        start: a.dateTime,
        end: new Date(new Date(a.dateTime).getTime() + a.durationMinutes * 60000).toISOString(),
        backgroundColor: colors.bg,
        borderColor: colors.border,
        textColor: colors.text,
        extendedProps: { appointment: a },
      }
    })

    const taskEvents = allTasks.map(t => {
      const colors = TASK_STATUS_COLORS[t.status] || TASK_STATUS_COLORS.todo
      const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done'
      return {
        id: `task-${t.id}`,
        title: `${t.team_name ? `[${t.team_name}] ` : ''}${t.title}`,
        start: t.due_date!,
        allDay: true,
        backgroundColor: isOverdue ? '#2e1a1a' : colors.bg,
        borderColor: isOverdue ? '#ef4444' : colors.border,
        textColor: isOverdue ? '#f87171' : colors.text,
        extendedProps: { task: t },
      }
    })

    return [...appointmentEvents, ...taskEvents]
  }, [filteredAppointments, allTasks])

  const handleEventClick = useCallback(async (info: EventClickArg) => {
    if (info.event.extendedProps.task) {
      const task = info.event.extendedProps.task as Task & { team_name?: string }
      setSelectedTask(task)
      try {
        const data = await apiFetch<{ members: TeamMember[] }>(`/api/teams/${task.team_id}/members`)
        setTaskMembers(data.members)
      } catch {
        setTaskMembers([])
      }
      setTaskModalOpen(true)
      return
    }
    const appt = info.event.extendedProps.appointment as Appointment
    setSelectedAppointment(appt)
    setDetailOpen(true)
  }, [])

  const handleDateSelect = useCallback((info: DateSelectArg) => {
    setCreateDate(info.startStr)
    setCreateOpen(true)
  }, [])

  return (
    <div className="flex flex-col gap-4 w-full pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Agenda</h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className={`border-none ${showFilter || selectedAssistantId ? 'text-[#ff6b2c]' : 'text-subtle'}`}
            onPress={() => setShowFilter(!showFilter)}
          >
            <Filter size={15} />
          </Button>
          <button
            type="button"
            className="btn-neu text-sm flex items-center gap-1.5"
            onClick={() => { setCreateDate(null); setCreateOpen(true) }}
          >
            <Plus size={14} />
            Novo
          </button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilter && (
        <div className="flex items-center gap-3 text-sm">
          <Select
            className="w-52"
            selectedKey={selectedAssistantId || ''}
            onSelectionChange={(key) => setFilter(key === '' ? null : key as string)}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="Todos">Todos</ListBox.Item>
                {assistants.map(a => (
                  <ListBox.Item key={a.id} id={a.id} textValue={a.name}>{a.name}</ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {selectedAssistantId && (
            <button
              className="text-xs text-muted hover:text-foreground transition"
              onClick={() => setFilter(null)}
            >
              Limpar filtro
            </button>
          )}
        </div>
      )}

      {/* Calendar */}
      <div className="rounded-xl bg-overlay overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-[50vh] sm:h-[60vh] lg:h-[70vh]">
            <div className="flex flex-col items-center gap-2">
              <div className="w-6 h-6 border-2 border-[#ff6b2c] border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted">Carregando...</p>
            </div>
          </div>
        ) : (
          <div className="calendar-minimal">
            <FullCalendar
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView="dayGridMonth"
              headerToolbar={{
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay',
              }}
              locale="pt-br"
              buttonText={{
                today: 'Hoje',
                month: 'Mês',
                week: 'Semana',
                day: 'Dia',
              }}
              events={calendarEvents}
              eventClick={handleEventClick}
              selectable
              select={handleDateSelect}
              height="auto"
              editable={false}
              allDaySlot={false}
              dayMaxEvents={3}
              eventTimeFormat={{
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              }}
              eventDisplay="block"
              dayHeaderFormat={{ weekday: 'short' }}
              titleFormat={{ year: 'numeric', month: 'long' }}
            />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-1">
        {Object.entries(STATUS_COLORS).map(([status, colors]) => (
          <div key={status} className="flex items-center gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: colors.border }}
            />
            <span className="text-[11px] text-muted">{STATUS_LABELS[status]}</span>
          </div>
        ))}
        <div className="w-px h-4 bg-[rgba(255,255,255,0.08)]" />
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />
          <span className="text-[11px] text-muted">Tarefa</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
          <span className="text-[11px] text-muted">Atrasada</span>
        </div>
      </div>

      {/* Custom styles for FullCalendar — dark-first theme */}
      <style jsx global>{`
        .calendar-minimal .fc {
          --fc-border-color: rgba(255, 255, 255, 0.06);
          --fc-today-bg-color: rgba(255, 107, 0, 0.06);
          --fc-neutral-bg-color: transparent;
          --fc-page-bg-color: transparent;
          --fc-neutral-text-color: #9ca3af;
          font-family: inherit;
          color: #d1d5db;
        }
        .calendar-minimal .fc-theme-standard td,
        .calendar-minimal .fc-theme-standard th {
          border-color: var(--fc-border-color);
        }
        .calendar-minimal .fc .fc-toolbar {
          padding: 12px 16px;
          gap: 8px;
        }
        .calendar-minimal .fc .fc-toolbar-title {
          font-size: 1rem;
          font-weight: 600;
          color: #e5e7eb;
        }
        .calendar-minimal .fc .fc-button {
          font-size: 0.75rem;
          padding: 4px 10px;
          border-radius: 6px;
          font-weight: 500;
          text-transform: none;
          box-shadow: none;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.03);
          color: #9ca3af;
        }
        .calendar-minimal .fc .fc-button:hover {
          background: rgba(255, 107, 0, 0.12);
          color: #e5e7eb;
        }
        .calendar-minimal .fc .fc-button-active,
        .calendar-minimal .fc .fc-button:active,
        .calendar-minimal .fc .fc-button-primary:not(:disabled).fc-button-active {
          background: rgba(255, 107, 0, 0.18) !important;
          color: #ff6b2c !important;
          border-color: rgba(255, 107, 0, 0.3) !important;
        }
        .calendar-minimal .fc .fc-col-header-cell {
          padding: 8px 0;
          font-size: 0.7rem;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #6b7280;
        }
        .calendar-minimal .fc .fc-daygrid-day-number {
          font-size: 0.8rem;
          padding: 6px 8px;
          color: #9ca3af;
        }
        .calendar-minimal .fc .fc-day-today .fc-daygrid-day-number {
          background: #ff6b2c;
          color: white;
          border-radius: 50%;
          width: 26px;
          height: 26px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 4px;
          padding: 0;
          font-weight: 600;
        }
        .calendar-minimal .fc .fc-event {
          font-size: 0.7rem;
          padding: 2px 6px;
          border-radius: 4px;
          border-left-width: 3px;
          cursor: pointer;
        }
        .calendar-minimal .fc .fc-event-title {
          font-weight: 500;
        }
        .calendar-minimal .fc .fc-daygrid-more-link {
          font-size: 0.65rem;
          color: #ff6b2c;
          font-weight: 500;
        }
        .calendar-minimal .fc .fc-timegrid-slot {
          height: 40px;
        }
        .calendar-minimal .fc .fc-timegrid-slot-label {
          font-size: 0.7rem;
          color: #6b7280;
        }
        .calendar-minimal .fc .fc-scrollgrid {
          border: none;
        }
        .calendar-minimal .fc .fc-toolbar .fc-toolbar-chunk:first-child {
          display: flex;
          gap: 4px;
        }
        /* Hide "all-day" row */
        .calendar-minimal .fc .fc-timegrid-axis-cushion,
        .calendar-minimal .fc .fc-timegrid-axis-frame {
          visibility: hidden;
          height: 0;
          overflow: hidden;
        }
        .calendar-minimal .fc-timegrid .fc-timegrid-body table tr:first-child {
        }
        .calendar-minimal .fc .fc-timegrid-divider {
          display: none;
        }
        /* Hide the all-day section completely in timegrid views */
        .calendar-minimal .fc-timegrid .fc-daygrid-body {
          display: none !important;
        }
        .calendar-minimal .fc .fc-day-other .fc-daygrid-day-number {
          color: #4b5563;
        }
        .calendar-minimal .fc .fc-day-other {
          background: rgba(0, 0, 0, 0.1);
        }
      `}</style>

      <AppointmentDetailModal
        appointment={selectedAppointment}
        isOpen={detailOpen}
        onClose={() => { setDetailOpen(false); setSelectedAppointment(null) }}
        assistants={assistants}
      />

      <CreateEventModal
        isOpen={createOpen}
        onClose={() => { setCreateOpen(false); setCreateDate(null) }}
        assistants={assistants}
        initialDate={createDate}
      />

      <TaskDetailModal
        isOpen={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false)
          setSelectedTask(null)
          // Refresh tasks in case something changed
          const wsId = activeWorkspace?.workspace_id
          if (wsId) {
            apiFetch<{ teams: TeamWithStats[] }>(`/api/workspaces/${wsId}/teams`).then(({ teams }) => {
              Promise.all(teams.map(async (team) => {
                try {
                  const { tasks } = await apiFetch<{ tasks: Task[] }>(`/api/teams/${team.id}/tasks`)
                  return tasks
                    .filter((t) => t.due_date && t.assignee_id === currentUserId)
                    .map((t) => ({ ...t, team_name: team.name }))
                } catch { return [] }
              })).then((results) => setAllTasks(results.flat()))
            }).catch(() => {})
          }
        }}
        task={selectedTask}
        teamId={selectedTask?.team_id ?? ''}
        members={taskMembers}
      />
    </div>
  )
}
