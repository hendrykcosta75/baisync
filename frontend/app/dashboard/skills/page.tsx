'use client'

import React, { useEffect, useState } from 'react'
import { Modal } from '@heroui/react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Sparkles, Plus, Pencil, Trash2, Loader2 } from 'lucide-react'
import { useSkillsStore } from '@/store/useSkillsStore'
import type { CreateSkillInput, Skill } from '@/types/skill'

const skillSchema = z.object({
  name: z.string().min(1, 'Nome obrigatório.').max(100, 'Máximo 100 caracteres.'),
  description: z
    .string()
    .min(1, 'Descrição obrigatória.')
    .max(500, 'Máximo 500 caracteres.'),
  instructions: z
    .string()
    .min(1, 'Instruções obrigatórias.')
    .max(8000, 'Máximo 8000 caracteres.'),
})
type SkillFormData = z.infer<typeof skillSchema>

function SkillForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  initial?: Partial<SkillFormData>
  onSubmit: (data: CreateSkillInput) => Promise<void>
  onCancel: () => void
  submitLabel: string
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<SkillFormData>({
    resolver: zodResolver(skillSchema),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      instructions: initial?.instructions ?? '',
    },
  })

  const onSave = async (data: SkillFormData) => {
    setSaving(true)
    setError(null)
    try {
      await onSubmit(data)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao salvar'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSave)} className="flex flex-col gap-4">
      <div>
        <label
          className="text-subtle text-xs font-medium mb-1.5 block"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          Nome
        </label>
        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <input
              {...field}
              placeholder="Ex: Agendar reunião"
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full"
            />
          )}
        />
        {errors.name && (
          <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>
        )}
      </div>

      <div>
        <label
          className="text-subtle text-xs font-medium mb-1.5 block"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          Quando usar (descrição para a IA)
        </label>
        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <textarea
              {...field}
              rows={2}
              placeholder="Ex: Use quando o usuário quiser marcar um horário..."
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full resize-y"
            />
          )}
        />
        {errors.description && (
          <p className="text-red-400 text-xs mt-1">{errors.description.message}</p>
        )}
        <p className="text-subtle text-xs mt-1">
          A IA lê isso para decidir quando chamar a skill. Seja direto sobre o gatilho.
        </p>
      </div>

      <div>
        <label
          className="text-subtle text-xs font-medium mb-1.5 block"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
        >
          Instruções (retornadas quando a IA invocar)
        </label>
        <Controller
          name="instructions"
          control={control}
          render={({ field }) => (
            <textarea
              {...field}
              rows={8}
              placeholder="Passo a passo que a IA deve seguir quando ativar essa skill..."
              className="bg-raised border border-dim rounded-[10px] px-3 py-2.5 text-body text-sm placeholder:text-subtle/50 focus:border-[#ff6b2c]/50 focus:ring-1 focus:ring-[#ff6b2c]/20 transition-all duration-200 outline-none w-full resize-y font-mono"
            />
          )}
        />
        {errors.instructions && (
          <p className="text-red-400 text-xs mt-1">{errors.instructions.message}</p>
        )}
      </div>

      {error && (
        <div
          className="p-3 rounded-[10px]"
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.3)',
          }}
        >
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="btn-neu-ghost text-sm"
          disabled={saving}
        >
          Cancelar
        </button>
        <button type="submit" className="btn-neu text-sm" disabled={saving}>
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Salvando...
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </form>
  )
}

export default function SkillsPage() {
  const { items, hasFetched, fetchSkills, createSkill, updateSkill, deleteSkill } =
    useSkillsStore()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Skill | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Skill | null>(null)

  useEffect(() => {
    if (!hasFetched) {
      fetchSkills()
    }
  }, [hasFetched, fetchSkills])

  return (
    <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1
            className="text-heading text-xl font-bold"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Skills
          </h1>
          <p className="text-subtle text-sm mt-1">
            Biblioteca de capacidades invocáveis pela IA. Cada skill carrega instruções
            que a IA recebe quando decide ativá-la.
          </p>
        </div>
        <button onClick={() => setCreating(true)} className="btn-neu text-sm">
          <span className="inline-flex items-center gap-2">
            <Plus size={14} />
            Nova skill
          </span>
        </button>
      </div>

      {!hasFetched ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={20} className="animate-spin text-subtle" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-xl bg-raised flex items-center justify-center mb-4">
            <Sparkles size={24} className="text-subtle" />
          </div>
          <h3
            className="text-heading text-base font-semibold mb-1"
            style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
          >
            Nenhuma skill ainda
          </h3>
          <p className="text-subtle text-sm max-w-md mb-4">
            Crie capacidades reutilizáveis que qualquer assistente do workspace pode
            vincular e invocar durante conversas.
          </p>
          <button onClick={() => setCreating(true)} className="btn-neu text-sm">
            <span className="inline-flex items-center gap-2">
              <Plus size={14} />
              Criar primeira skill
            </span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
          {items.map((skill, i) => (
            <div
              key={skill.id}
              className="glass-card rounded-xl p-5 transition-all duration-300 hover:shadow-lg animate-fade-in-up opacity-0"
              style={{ animationDelay: `${i * 60}ms`, animationFillMode: 'forwards' }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center shrink-0">
                    <Sparkles size={18} className="text-[#ff6b2c]" />
                  </div>
                  <div className="min-w-0">
                    <h3
                      className="text-heading text-sm font-semibold truncate"
                      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                    >
                      {skill.name}
                    </h3>
                    <p className="text-subtle text-[11px] truncate">
                      use_skill_{skill.slug}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    aria-label="Editar"
                    onClick={() => setEditing(skill)}
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-subtle hover:text-heading hover:bg-dim/50 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    aria-label="Deletar"
                    onClick={() => setConfirmDelete(skill)}
                    className="w-8 h-8 rounded-[8px] flex items-center justify-center text-subtle hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <p className="text-body text-sm leading-relaxed line-clamp-3">
                {skill.description}
              </p>
            </div>
          ))}
        </div>
      )}

      <Modal>
        <Modal.Backdrop isOpen={creating} onOpenChange={(v) => !v && setCreating(false)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[560px] w-full max-h-[90vh] overflow-y-auto p-6">
              <Modal.Header className="flex items-center justify-between mb-4">
                <Modal.Heading
                  className="text-heading text-[15px] font-bold"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                >
                  Nova skill
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <SkillForm
                  submitLabel="Criar skill"
                  onCancel={() => setCreating(false)}
                  onSubmit={async (data) => {
                    await createSkill(data)
                    setCreating(false)
                  }}
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal>
        <Modal.Backdrop isOpen={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[560px] w-full max-h-[90vh] overflow-y-auto p-6">
              <Modal.Header className="flex items-center justify-between mb-4">
                <Modal.Heading
                  className="text-heading text-[15px] font-bold"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                >
                  Editar skill
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {editing && (
                  <SkillForm
                    initial={editing}
                    submitLabel="Salvar alterações"
                    onCancel={() => setEditing(null)}
                    onSubmit={async (data) => {
                      await updateSkill(editing.id, data)
                      setEditing(null)
                    }}
                  />
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <Modal>
        <Modal.Backdrop
          isOpen={!!confirmDelete}
          onOpenChange={(v) => !v && setConfirmDelete(null)}
        >
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[400px] w-full p-6">
              <Modal.Header className="flex items-center justify-between mb-4">
                <Modal.Heading
                  className="text-heading text-[15px] font-bold"
                  style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                >
                  Deletar skill?
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {confirmDelete && (
                  <>
                    <p className="text-body text-sm mb-6">
                      <span className="text-heading font-semibold">
                        {confirmDelete.name}
                      </span>{' '}
                      será removida e desvinculada de todos os assistentes. Essa ação
                      não pode ser desfeita.
                    </p>
                    <div className="flex justify-end gap-3">
                      <button
                        className="btn-neu-ghost text-sm"
                        onClick={() => setConfirmDelete(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        className="btn-neu text-sm !text-red-400 hover:!text-red-300"
                        onClick={async () => {
                          await deleteSkill(confirmDelete.id)
                          setConfirmDelete(null)
                        }}
                      >
                        Deletar
                      </button>
                    </div>
                  </>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
