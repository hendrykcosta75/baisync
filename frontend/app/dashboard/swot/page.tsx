'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useSwotStore } from '@/store/useSwotStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { PageTransition, StaggerContainer, StaggerItem } from '@/lib/motion'
import { Plus, Crosshair, Trash2, X, Sparkles } from 'lucide-react'
import dynamic from 'next/dynamic'

const SwotInterview = dynamic(() => import('@/components/swot/swot-interview'), { ssr: false })

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const QUADRANTS = [
  { key: 'strengths' as const, label: 'Forças', color: '#22c55e', emoji: 'S' },
  { key: 'weaknesses' as const, label: 'Fraquezas', color: '#ef4444', emoji: 'W' },
  { key: 'opportunities' as const, label: 'Oportunidades', color: '#3b82f6', emoji: 'O' },
  { key: 'threats' as const, label: 'Ameaças', color: '#f59e0b', emoji: 'T' },
]

export default function SwotPage() {
  const { analyses, activeAnalysis, fetchAnalyses, createAnalysis, getAnalysis, deleteAnalysis, createItem, deleteItem, isLoading } = useSwotStore()
  const { activeWorkspace } = useWorkspaceStore()
  const wsId = activeWorkspace?.workspace_id || ''

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newItemContent, setNewItemContent] = useState('')
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [interviewActive, setInterviewActive] = useState(false)

  const handleSwotCreated = useCallback(async (data: { title: string; items: { quadrant: string; content: string }[] }) => {
    if (!wsId) return
    try {
      const analysis = await createAnalysis(wsId, { title: data.title })
      for (const item of data.items) {
        await createItem(analysis.id, { quadrant: item.quadrant, content: item.content })
      }
      await getAnalysis(wsId, analysis.id)
      setInterviewActive(false)
    } catch (err) {
      console.error('Error creating SWOT from interview:', err)
    }
  }, [wsId, createAnalysis, createItem, getAnalysis])

  useEffect(() => {
    if (wsId) {
      useSwotStore.setState({ analyses: [], activeAnalysis: null })
      fetchAnalyses(wsId)
    }
  }, [wsId, fetchAnalyses])

  const handleCreate = async () => {
    if (!newTitle.trim() || !wsId) return
    const analysis = await createAnalysis(wsId, { title: newTitle })
    setNewTitle('')
    setShowCreateModal(false)
    getAnalysis(wsId, analysis.id)
  }

  const handleAddItem = async (quadrant: string) => {
    if (!newItemContent.trim() || !activeAnalysis) return
    await createItem(activeAnalysis.id, { quadrant, content: newItemContent })
    setNewItemContent('')
    setAddingTo(null)
  }

  const handleDeleteItem = async (itemId: string) => {
    if (!activeAnalysis) return
    await deleteItem(activeAnalysis.id, itemId)
  }

  const items = activeAnalysis?.items || []

  // If no analysis selected, show list
  if (!activeAnalysis) {
    return (
      <>
      <PageTransition>
        <StaggerContainer className="flex flex-col gap-6 w-full">
          <StaggerItem>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-light tracking-tight text-heading" style={{ fontFamily: mono }}>
                  Análise SWOT
                </h1>
                <p className="text-subtle text-sm mt-1">Análise de forças, fraquezas, oportunidades e ameaças</p>
              </div>
              <div className="flex items-center gap-2.5">
                <button
                  className="relative overflow-hidden px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 text-sm transition-all duration-200"
                  style={{
                    color: interviewActive ? 'var(--text-subtle)' : '#ff6b2c',
                    background: '#161616',
                    boxShadow: interviewActive
                      ? 'inset 2px 2px 6px rgba(0,0,0,0.5), inset -2px -2px 4px rgba(255,255,255,0.035)'
                      : '3px 3px 8px rgba(0,0,0,0.5), -2px -2px 6px rgba(255,255,255,0.035)',
                  }}
                  onClick={() => setInterviewActive(!interviewActive)}
                >
                  {!interviewActive && (
                    <span
                      className="absolute inset-0"
                      style={{
                        background: 'linear-gradient(90deg, transparent, rgba(255,107,44,0.06), transparent)',
                        animation: 'shimmer 4s infinite',
                      }}
                    />
                  )}
                  {interviewActive ? <X size={15} /> : <Sparkles size={15} />}
                  {interviewActive ? 'Cancelar' : 'Entrevista com IA'}
                </button>
                <button className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium flex items-center gap-2" onClick={() => setShowCreateModal(true)}>
                  <Plus size={16} />
                  Nova Analise
                </button>
              </div>
            </div>
          </StaggerItem>

          {interviewActive ? (
            <StaggerItem>
              <div className="flex flex-col" style={{ minHeight: 480, height: 'calc(100vh - 230px)' }}>
                <SwotInterview
                  onClose={() => setInterviewActive(false)}
                  onSwotCreated={handleSwotCreated}
                />
              </div>
            </StaggerItem>
          ) : isLoading && analyses.length === 0 ? (
            <StaggerItem>
              <div className="flex items-center justify-center py-20">
                <span className="text-subtle text-sm" style={{ fontFamily: mono }}>Carregando...</span>
              </div>
            </StaggerItem>
          ) : analyses.length === 0 ? (
            <StaggerItem>
              <div className="flex flex-col items-center justify-center p-16 rounded-2xl text-center" style={{ background: 'rgba(255,107,44,0.02)', border: '1px dashed rgba(255,107,44,0.12)' }}>
                <div className="w-16 h-16 rounded-xl bg-raised flex items-center justify-center mb-6">
                  <Crosshair size={28} className="text-subtle" />
                </div>
                <h3 className="text-lg font-semibold text-heading" style={{ fontFamily: mono }}>Crie sua primeira analise SWOT</h3>
                <p className="text-subtle text-sm mt-2 max-w-sm mb-6">Avalie fatores internos e externos que afetam seu workspace.</p>
                <button className="btn-neu btn-neu-lg px-5 py-2.5 rounded-xl font-medium flex items-center gap-2" onClick={() => setShowCreateModal(true)}>
                  <Plus size={16} />
                  Nova Analise
                </button>
              </div>
            </StaggerItem>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {analyses.map((a, i) => (
                <div
                  key={a.id}
                  className="glass-card rounded-xl p-5 cursor-pointer transition-all duration-300 hover:shadow-lg animate-fade-in-up opacity-0 group"
                  style={{ animationDelay: `${i * 80}ms`, animationFillMode: 'forwards' }}
                  onClick={() => wsId && getAnalysis(wsId, a.id)}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center">
                      <Crosshair size={18} style={{ color: '#D4835A' }} />
                    </div>
                    <h3 className="text-heading text-sm font-semibold" style={{ fontFamily: mono }}>{a.title}</h3>
                    <button
                      className="ml-auto text-subtle hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      onClick={(e) => { e.stopPropagation(); deleteAnalysis(wsId, a.id) }}
                      title="Excluir"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {a.description && <p className="text-subtle text-xs">{a.description}</p>}
                  <div className="flex items-center gap-3 mt-3">
                    {QUADRANTS.map((q) => (
                      <span key={q.key} className="text-[10px] font-bold w-6 h-6 rounded flex items-center justify-center" style={{ background: `${q.color}15`, color: q.color }}>
                        {q.emoji}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

        </StaggerContainer>
      </PageTransition>

      {/* Create modal — outside PageTransition */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setShowCreateModal(false)} />
          <div className="relative w-full max-w-md mx-4 rounded-xl p-6" style={{ background: '#141414', border: '1px solid #1e1e1e', boxShadow: '0 24px 48px rgba(0,0,0,0.5)', animation: 'baisync-panel-in 0.2s ease-out' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-heading text-[15px] font-bold" style={{ fontFamily: mono }}>Nova Análise SWOT</h2>
              <button className="text-subtle hover:text-heading transition-colors" onClick={() => setShowCreateModal(false)}><X size={18} /></button>
            </div>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Nome da análise..."
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full mb-4"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <div className="flex justify-end gap-3">
              <button className="btn-neu-ghost text-sm px-4 py-2 rounded-[10px]" onClick={() => setShowCreateModal(false)}>Cancelar</button>
              <button className="btn-neu text-sm px-4 py-2 rounded-[10px]" onClick={handleCreate} disabled={!newTitle.trim()}>Criar</button>
            </div>
          </div>
        </div>
      )}
      </>
    )
  }

  // SWOT Board view
  return (
    <PageTransition>
      <div className="flex flex-col gap-6 w-full">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button className="btn-neu-ghost text-sm px-3 py-1.5 rounded-lg" onClick={() => useSwotStore.setState({ activeAnalysis: null })}>
              ← Voltar
            </button>
            <h1 className="text-heading text-lg font-bold" style={{ fontFamily: mono }}>{activeAnalysis.title}</h1>
          </div>
        </div>

        {/* SWOT 2x2 Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {QUADRANTS.map((q) => {
            const quadrantItems = items.filter((i) => i.quadrant === q.key)
            return (
              <div
                key={q.key}
                className="rounded-xl p-4 min-h-[200px]"
                style={{ background: '#111111', border: `1px solid ${q.color}20` }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
                    style={{ background: `${q.color}15`, color: q.color }}
                  >
                    {q.emoji}
                  </span>
                  <h3 className="text-heading text-sm font-semibold" style={{ fontFamily: mono }}>{q.label}</h3>
                  <span className="text-subtle text-[10px] ml-auto">{quadrantItems.length}</span>
                </div>

                <div className="space-y-2">
                  {quadrantItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start gap-2 px-3 py-2 rounded-lg group transition-colors"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid #1e1e1e' }}
                    >
                      <span className="text-body text-xs flex-1">{item.content}</span>
                      <button
                        className="text-subtle hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        onClick={() => handleDeleteItem(item.id)}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                {addingTo === q.key ? (
                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={newItemContent}
                      onChange={(e) => setNewItemContent(e.target.value)}
                      placeholder="Novo item..."
                      className="bg-raised border border-dim rounded-lg px-2 py-1.5 text-body text-xs placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 outline-none flex-1"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddItem(q.key)
                        if (e.key === 'Escape') { setAddingTo(null); setNewItemContent('') }
                      }}
                    />
                    <button className="btn-neu text-[10px] px-2 py-1 rounded-lg" onClick={() => handleAddItem(q.key)}>+</button>
                  </div>
                ) : (
                  <button
                    className="flex items-center gap-1 text-subtle text-xs hover:text-heading transition-colors mt-2"
                    onClick={() => { setAddingTo(q.key); setNewItemContent('') }}
                  >
                    <Plus size={12} />
                    Adicionar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </PageTransition>
  )
}
