'use client'

import React, { useState, useEffect } from 'react'
import { useTeamStore } from '@/store/useTeamStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { TeamCard } from '@/components/teams/team-card'
import { TeamFormModal } from '@/components/teams/team-form-modal'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'
import { Users, Plus } from 'lucide-react'
import type { TeamWithStats } from '@/types/team'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export default function TeamsPage() {
  const { teams, fetchTeams, isLoading } = useTeamStore()
  const { activeWorkspace } = useWorkspaceStore()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTeam, setEditingTeam] = useState<TeamWithStats | undefined>(undefined)

  useEffect(() => {
    if (activeWorkspace?.workspace_id) {
      useTeamStore.setState({ teams: [] })
      fetchTeams(activeWorkspace.workspace_id)
    }
  }, [activeWorkspace?.workspace_id, fetchTeams])

  const handleCreate = () => {
    setEditingTeam(undefined)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingTeam(undefined)
  }

  return (
    <>
    <PageTransition>
      <StaggerContainer className="flex flex-col gap-6 w-full">
        <StaggerItem>
          <div className="flex items-center justify-between w-full">
            <div>
              <h1
                className="text-2xl font-light tracking-tight text-heading"
                style={{ fontFamily: mono }}
              >
                Equipes
              </h1>
              <p className="text-subtle text-sm mt-1">
                Gerencie suas equipes e acompanhe o progresso
              </p>
            </div>
            <button
              className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium flex items-center gap-2"
              onClick={handleCreate}
            >
              <Plus size={16} />
              Nova Equipe
            </button>
          </div>
        </StaggerItem>

        {isLoading && teams.length === 0 ? (
          <StaggerItem>
            <div className="flex items-center justify-center py-20">
              <div
                className="text-sm text-subtle"
                style={{ fontFamily: mono }}
              >
                Carregando equipes...
              </div>
            </div>
          </StaggerItem>
        ) : teams.length === 0 ? (
          <StaggerItem>
            <div
              className="flex flex-col items-center justify-center p-16 mt-8 rounded-2xl w-full text-center"
              style={{
                background: 'rgba(255, 107, 44, 0.02)',
                border: '1px dashed rgba(255, 107, 44, 0.12)',
              }}
            >
              <div className="w-16 h-16 rounded-xl bg-raised flex items-center justify-center mb-6">
                <Users size={28} className="text-subtle" />
              </div>
              <h3
                className="text-lg font-semibold text-heading"
                style={{ fontFamily: mono }}
              >
                Crie sua primeira equipe
              </h3>
              <p className="text-subtle text-sm mt-2 max-w-sm mb-6">
                Organize tarefas, acompanhe progresso e colabore com sua equipe em um s&oacute; lugar.
              </p>
              <button
                className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium flex items-center gap-2"
                onClick={handleCreate}
              >
                <Plus size={16} />
                Nova Equipe
              </button>
            </div>
          </StaggerItem>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6 w-full">
            {teams.map((team) => (
              <StaggerItem key={team.id}>
                <TeamCard team={team} />
              </StaggerItem>
            ))}
          </div>
        )}

      </StaggerContainer>
    </PageTransition>

    <TeamFormModal
      isOpen={isModalOpen}
      onClose={handleCloseModal}
      team={editingTeam}
    />
    </>
  )
}
