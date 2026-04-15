'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useOkrStore } from '@/store/useOkrStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { ObjectiveFormModal } from '@/components/okr/objective-form-modal'
import { Target, ArrowRight, Plus } from 'lucide-react'
import { OKR_TYPE_CONFIG, getConfidenceColor, getProgressPercent, getCurrentCycle } from '@/types/okr'
import type { OkrObjective, OkrKeyResult, OkrObjectiveType } from '@/types/okr'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

export function GoalsTab({ teamId }: { teamId: string }) {
  const { objectives, fetchObjectives, isLoading } = useOkrStore()
  const { activeWorkspace } = useWorkspaceStore()
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  useEffect(() => {
    if (activeWorkspace?.workspace_id) {
      fetchObjectives(activeWorkspace.workspace_id, undefined, teamId)
    }
  }, [activeWorkspace?.workspace_id, teamId, fetchObjectives])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="text-subtle text-sm" style={{ fontFamily: mono }}>Carregando OKRs...</span>
      </div>
    )
  }

  if (objectives.length === 0) {
    return (
      <>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Target size={24} className="text-subtle mb-3" />
          <p className="text-subtle text-sm mb-4">Nenhum OKR vinculado a esta equipe</p>
          <button
            className="btn-neu text-sm px-4 py-2 rounded-[10px] flex items-center gap-2 mb-3"
            onClick={() => setIsCreateOpen(true)}
          >
            <Plus size={14} /> Criar Objetivo
          </button>
          <Link href="/dashboard/planning" className="text-[#D4835A] text-sm hover:underline flex items-center gap-1">
            Ver todos os OKRs <ArrowRight size={14} />
          </Link>
        </div>
        <ObjectiveFormModal
          isOpen={isCreateOpen}
          onClose={() => { setIsCreateOpen(false); if (activeWorkspace?.workspace_id) fetchObjectives(activeWorkspace.workspace_id, undefined, teamId) }}
          workspaceId={activeWorkspace?.workspace_id || ''}
          currentCycle={getCurrentCycle()}
          defaultTeamId={teamId}
        />
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-subtle text-xs font-medium" style={{ fontFamily: mono }}>
          {objectives.length} objetivo{objectives.length !== 1 ? 's' : ''}
        </span>
        <button
          className="btn-neu text-xs px-3 py-1.5 rounded-lg flex items-center gap-1.5"
          onClick={() => setIsCreateOpen(true)}
        >
          <Plus size={12} /> Criar Objetivo
        </button>
      </div>
      {objectives.map((obj) => {
        const o = obj as OkrObjective
        const typeCfg = OKR_TYPE_CONFIG[o.objective_type as OkrObjectiveType] || OKR_TYPE_CONFIG.committed
        const confidenceColor = getConfidenceColor(o.confidence ?? 0.5)
        const progress = Math.round((o.progress ?? 0) * 100)
        const krs = (o.key_results || []) as OkrKeyResult[]

        return (
          <div
            key={o.id || ('objective_id' in obj ? (obj as { objective_id: string }).objective_id : '')}
            className="rounded-xl p-5"
            style={{ background: '#141414', border: '1px solid #1e1e1e' }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-3">
              <Target size={16} style={{ color: '#D4835A' }} />
              <h4 className="text-heading text-sm font-semibold flex-1" style={{ fontFamily: mono }}>
                {o.title}
              </h4>
              <span
                className="px-2 py-0.5 rounded text-[10px] font-medium"
                style={{ background: `${typeCfg.color}15`, color: typeCfg.color }}
              >
                {typeCfg.label}
              </span>
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold"
                style={{ background: `${confidenceColor}15`, color: confidenceColor }}
              >
                {Math.round((o.confidence ?? 0.5) * 10)}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-subtle text-[10px]">Progresso</span>
                <span className="text-heading text-xs font-medium">{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-dim overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress}%`,
                    background: `linear-gradient(90deg, ${confidenceColor}80, ${confidenceColor})`,
                  }}
                />
              </div>
            </div>

            {/* Key Results */}
            {krs.length > 0 && (
              <div className="space-y-2 mt-3 pt-3 border-t border-dim">
                {krs.map((kr) => {
                  const krProgress = Math.round(getProgressPercent(kr))
                  const krConfColor = getConfidenceColor(kr.confidence)
                  return (
                    <div key={kr.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-body text-xs truncate">{kr.title}</p>
                      </div>
                      <span className="text-subtle text-[10px] shrink-0">
                        {kr.current_value}/{kr.target_value} {kr.unit || ''}
                      </span>
                      <div className="w-16 h-1 rounded-full bg-dim overflow-hidden shrink-0">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${krProgress}%`, backgroundColor: krConfColor }}
                        />
                      </div>
                      <span className="text-[10px] font-medium shrink-0" style={{ color: krConfColor }}>
                        {krProgress}%
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}

      <Link href="/dashboard/planning" className="text-[#D4835A] text-sm hover:underline flex items-center gap-1 justify-center py-3">
        Ver todos os OKRs <ArrowRight size={14} />
      </Link>

      <ObjectiveFormModal
        isOpen={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); if (activeWorkspace?.workspace_id) fetchObjectives(activeWorkspace.workspace_id, undefined, teamId) }}
        workspaceId={activeWorkspace?.workspace_id || ''}
        currentCycle={getCurrentCycle()}
        defaultTeamId={teamId}
      />
    </div>
  )
}
