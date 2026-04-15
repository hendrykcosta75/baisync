'use client'

import React, { useState, useEffect } from 'react'
import { useOkrStore } from '@/store/useOkrStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { OkrCard } from '@/components/okr/okr-card'
import { CheckInModal } from '@/components/okr/check-in-modal'
import { CycleSelector } from '@/components/okr/cycle-selector'
import { ObjectiveFormModal } from '@/components/okr/objective-form-modal'
import { KrFormModal } from '@/components/okr/kr-form-modal'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'
import { Target, Plus, TrendingUp, AlertTriangle, XCircle } from 'lucide-react'
import type { OkrObjective, OkrObjectiveByCycle } from '@/types/okr'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export default function PlanningPage() {
  const { objectives, fetchObjectives, deleteObjective, isLoading, currentCycle, setCycle } = useOkrStore()
  const { activeWorkspace } = useWorkspaceStore()

  const [isObjModalOpen, setIsObjModalOpen] = useState(false)
  const [isKrModalOpen, setIsKrModalOpen] = useState(false)
  const [isCheckInOpen, setIsCheckInOpen] = useState(false)
  const [selectedObjId, setSelectedObjId] = useState('')
  const [selectedKrId, setSelectedKrId] = useState('')
  const [selectedKrValue, setSelectedKrValue] = useState(0)

  useEffect(() => {
    if (activeWorkspace?.workspace_id) {
      useOkrStore.setState({ objectives: [] })
      fetchObjectives(activeWorkspace.workspace_id, currentCycle)
    }
  }, [activeWorkspace?.workspace_id, currentCycle, fetchObjectives])

  const handleCheckIn = (krId: string, currentValue: number) => {
    setSelectedKrId(krId)
    setSelectedKrValue(currentValue)
    setIsCheckInOpen(true)
  }

  const handleAddKr = (objectiveId: string) => {
    setSelectedObjId(objectiveId)
    setIsKrModalOpen(true)
  }

  const handleDelete = async (objectiveId: string) => {
    try {
      await deleteObjective(objectiveId)
    } catch {
      // Error handled by store
    }
  }

  const handleCheckInClose = () => {
    setIsCheckInOpen(false)
    if (activeWorkspace?.workspace_id) {
      fetchObjectives(activeWorkspace.workspace_id, currentCycle)
    }
  }

  const handleKrClose = () => {
    setIsKrModalOpen(false)
    if (activeWorkspace?.workspace_id) {
      fetchObjectives(activeWorkspace.workspace_id, currentCycle)
    }
  }

  // Stats
  const total = objectives.length
  const onTrack = objectives.filter((o) => {
    const status = 'status' in o ? o.status : ''
    return status === 'on_track' || status === 'achieved'
  }).length
  const atRisk = objectives.filter((o) => ('status' in o ? o.status : '') === 'at_risk').length
  const behind = objectives.filter((o) => ('status' in o ? o.status : '') === 'behind').length

  return (
    <>
    <PageTransition>
      <StaggerContainer className="flex flex-col gap-6 w-full">
        {/* Header */}
        <StaggerItem className="relative z-10">
          <div className="flex items-center justify-between w-full">
            <div>
              <h1 className="text-2xl font-light tracking-tight text-foreground" style={{ fontFamily: mono }}>
                Objetivos e Resultados-Chave
              </h1>
              <p className="text-subtle text-sm mt-1">Planejamento estratégico do workspace</p>
            </div>
            <div className="flex items-center gap-3">
              <CycleSelector value={currentCycle} onChange={setCycle} />
              <button
                className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium flex items-center gap-2"
                onClick={() => setIsObjModalOpen(true)}
              >
                <Plus size={16} />
                Novo Objetivo
              </button>
            </div>
          </div>
        </StaggerItem>

        {/* Summary cards */}
        <StaggerItem>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard label="Total de Objetivos" value={total} icon={Target} color="#D4835A" />
            <MetricCard label="No Prazo" value={onTrack} icon={TrendingUp} color="#22c55e" />
            <MetricCard label="Em Risco" value={atRisk} icon={AlertTriangle} color="#f59e0b" />
            <MetricCard label="Atrasados" value={behind} icon={XCircle} color="#ef4444" />
          </div>
        </StaggerItem>

        {/* Objectives list */}
        {isLoading && objectives.length === 0 ? (
          <StaggerItem>
            <div className="flex items-center justify-center py-20">
              <span className="text-subtle text-sm" style={{ fontFamily: mono }}>Carregando OKRs...</span>
            </div>
          </StaggerItem>
        ) : objectives.length === 0 ? (
          <StaggerItem>
            <div
              className="flex flex-col items-center justify-center p-16 mt-4 rounded-2xl text-center"
              style={{ background: 'rgba(255,107,44,0.02)', border: '1px dashed rgba(255,107,44,0.12)' }}
            >
              <div className="w-16 h-16 rounded-xl bg-raised flex items-center justify-center mb-6">
                <Target size={28} className="text-subtle" />
              </div>
              <h3 className="text-lg font-semibold" style={{ color: '#f0f0f0', fontFamily: mono }}>
                Defina seus objetivos
              </h3>
              <p className="text-subtle text-sm mt-2 max-w-sm mb-6">
                Crie OKRs para acompanhar o progresso estratégico do seu workspace.
              </p>
              <button
                className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium flex items-center gap-2"
                onClick={() => setIsObjModalOpen(true)}
              >
                <Plus size={16} />
                Novo Objetivo
              </button>
            </div>
          </StaggerItem>
        ) : (
          <div className="space-y-4">
            {objectives.map((obj, i) => (
              <div
                key={'objective_id' in obj ? obj.objective_id : obj.id}
                className="animate-fade-in-up opacity-0"
                style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'forwards' }}
              >
                <OkrCard
                  objective={obj}
                  onCheckIn={handleCheckIn}
                  onAddKr={handleAddKr}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
        )}

      </StaggerContainer>
    </PageTransition>

    {/* Modals — outside PageTransition to avoid transform breaking position:fixed */}
    <ObjectiveFormModal
      isOpen={isObjModalOpen}
      onClose={() => { setIsObjModalOpen(false); if (activeWorkspace?.workspace_id) fetchObjectives(activeWorkspace.workspace_id, currentCycle) }}
      workspaceId={activeWorkspace?.workspace_id || ''}
      currentCycle={currentCycle}
    />
    <KrFormModal
      isOpen={isKrModalOpen}
      onClose={handleKrClose}
      objectiveId={selectedObjId}
    />
    <CheckInModal
      isOpen={isCheckInOpen}
      onClose={handleCheckInClose}
      krId={selectedKrId}
      currentValue={selectedKrValue}
    />
    </>
  )
}

function MetricCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: React.ElementType; color: string }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: '#141414', border: '1px solid #1e1e1e' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${color}12` }}>
          <Icon size={14} style={{ color }} />
        </div>
        <span className="text-subtle text-[11px] font-medium" style={{ fontFamily: mono }}>{label}</span>
      </div>
      <p className="text-heading text-2xl font-bold" style={{ fontFamily: mono }}>{value}</p>
    </div>
  )
}
