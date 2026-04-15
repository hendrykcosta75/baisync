'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTeamStore } from '@/store/useTeamStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { KanbanBoard } from '@/components/teams/kanban-board'
import { MembersTab } from '@/components/teams/members-tab'
import { ActivityTab } from '@/components/teams/activity-tab'
import { GoalsTab } from '@/components/teams/goals-tab'
import { TaskDetailModal } from '@/components/teams/task-detail-modal'
import { PageTransition } from '@/lib/motion'
import { ArrowLeft, LayoutGrid, Users, Target, Activity } from 'lucide-react'
import type { Task, TaskStatus } from '@/types/team'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const TABS = [
  { key: 'kanban', label: 'Kanban', icon: LayoutGrid },
  { key: 'members', label: 'Membros', icon: Users },
  { key: 'goals', label: 'Metas', icon: Target },
  { key: 'activity', label: 'Atividade', icon: Activity },
] as const

type TabKey = typeof TABS[number]['key']

export default function TeamDetailPage() {
  const params = useParams()
  const router = useRouter()
  const teamId = params.id as string

  const { activeTeam, setActiveTeam, fetchTasks, fetchMembers, tasks, members, createTask } = useTeamStore()
  const { activeWorkspace } = useWorkspaceStore()
  const { teams, fetchTeams } = useTeamStore()

  const [activeTab, setActiveTab] = useState<TabKey>('kanban')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)

  useEffect(() => {
    if (activeWorkspace?.workspace_id && teams.length === 0) {
      fetchTeams(activeWorkspace.workspace_id)
    }
  }, [activeWorkspace?.workspace_id, teams.length, fetchTeams])

  useEffect(() => {
    if (teamId) {
      fetchTasks(teamId)
      fetchMembers(teamId)
    }
  }, [teamId, fetchTasks, fetchMembers])

  useEffect(() => {
    if (teams.length > 0 && teamId) {
      const team = teams.find((t) => t.id === teamId)
      if (team) setActiveTeam(team)
    }
  }, [teams, teamId, setActiveTeam])

  // SSE listeners for real-time updates
  useEffect(() => {
    const handleTaskCreated = () => fetchTasks(teamId)
    const handleTaskUpdated = () => fetchTasks(teamId)
    const handleTaskMoved = () => fetchTasks(teamId)
    const handleTaskDeleted = () => fetchTasks(teamId)
    const handleMemberAdded = () => fetchMembers(teamId)
    const handleMemberRemoved = () => fetchMembers(teamId)

    window.addEventListener('sse:team_task_created', handleTaskCreated)
    window.addEventListener('sse:team_task_updated', handleTaskUpdated)
    window.addEventListener('sse:team_task_moved', handleTaskMoved)
    window.addEventListener('sse:team_task_deleted', handleTaskDeleted)
    window.addEventListener('sse:team_member_added', handleMemberAdded)
    window.addEventListener('sse:team_member_removed', handleMemberRemoved)

    return () => {
      window.removeEventListener('sse:team_task_created', handleTaskCreated)
      window.removeEventListener('sse:team_task_updated', handleTaskUpdated)
      window.removeEventListener('sse:team_task_moved', handleTaskMoved)
      window.removeEventListener('sse:team_task_deleted', handleTaskDeleted)
      window.removeEventListener('sse:team_member_added', handleMemberAdded)
      window.removeEventListener('sse:team_member_removed', handleMemberRemoved)
    }
  }, [teamId, fetchTasks, fetchMembers])

  const handleCreateTask = useCallback(async (status: string) => {
    const task = await createTask(teamId, {
      title: 'Nova tarefa',
      status,
    })
    setSelectedTask(task)
    setIsTaskModalOpen(true)
  }, [teamId, createTask])

  const handleTaskClick = useCallback((task: Task) => {
    setSelectedTask(task)
    setIsTaskModalOpen(true)
  }, [])

  if (!activeTeam) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-subtle text-sm" style={{ fontFamily: mono }}>Carregando equipe...</span>
      </div>
    )
  }

  return (
    <>
    <PageTransition>
      <div className="flex flex-col gap-6 w-full">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            className="w-9 h-9 rounded-[10px] flex items-center justify-center transition-all duration-200 text-subtle hover:text-heading"
            style={{
              background: '#121212',
              boxShadow: '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
            }}
            onClick={() => router.push('/dashboard/teams')}
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: activeTeam.color || '#ff6b2c' }}
            />
            <div>
              <h1 className="text-heading text-xl font-bold" style={{ fontFamily: mono }}>
                {activeTeam.name}
              </h1>
              {activeTeam.description && (
                <p className="text-subtle text-sm mt-0.5">{activeTeam.description}</p>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200"
                style={{
                  background: isActive ? 'rgba(255,107,44,0.12)' : 'transparent',
                  color: isActive ? '#ff6b2c' : '#888',
                  border: `1px solid ${isActive ? 'rgba(255,107,44,0.25)' : 'transparent'}`,
                  fontFamily: mono,
                  fontSize: '13px',
                }}
                onClick={() => setActiveTab(tab.key)}
              >
                <tab.icon size={14} />
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Tab content */}
        <div className="w-full">
          {activeTab === 'kanban' && (
            <KanbanBoard
              teamId={teamId}
              onCreateTask={handleCreateTask}
              onTaskClick={handleTaskClick}
            />
          )}
          {activeTab === 'members' && <MembersTab teamId={teamId} />}
          {activeTab === 'goals' && <GoalsTab teamId={teamId} />}
          {activeTab === 'activity' && <ActivityTab teamId={teamId} />}
        </div>

      </div>
    </PageTransition>

    {/* Task detail modal — outside PageTransition to avoid transform breaking position:fixed */}
    <TaskDetailModal
      isOpen={isTaskModalOpen}
      onClose={() => { setIsTaskModalOpen(false); setSelectedTask(null) }}
      task={selectedTask}
      teamId={teamId}
      members={members}
    />
    </>
  )
}
