'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Modal } from '@heroui/react'
import {
  X,
  Calendar,
  Tag,
  Trash2,
  Send,
  Plus,
  Link2,
  Paperclip,
  Download,
  FileText,
} from 'lucide-react'
import type { Task, TaskAttachment, TaskStatus, TaskPriority, TeamMember, TaskComment } from '@/types/team'
import { KANBAN_COLUMNS, PRIORITY_CONFIG } from '@/types/team'
import { useTeamStore } from '@/store/useTeamStore'
import { UserAvatar } from '@/components/user-avatar'
import { useToastStore } from '@/store/useToastStore'
import { ApiError } from '@/lib/api'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

function relativeTime(iso: string): string {
  try {
    const now = Date.now()
    const then = new Date(iso).getTime()
    const diffMs = now - then
    const minutes = Math.floor(diffMs / 60000)
    if (minutes < 1) return 'agora'
    if (minutes < 60) return `há ${minutes}min`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `há ${hours}h`
    const days = Math.floor(hours / 24)
    if (days < 30) return `há ${days}d`
    const months = Math.floor(days / 30)
    return `há ${months}m`
  } catch {
    return ''
  }
}

function getInitials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
}

interface TaskDetailModalProps {
  isOpen: boolean
  onClose: () => void
  task: Task | null
  teamId: string
  members: TeamMember[]
}

export function TaskDetailModal({
  isOpen,
  onClose,
  task,
  teamId,
  members,
}: TaskDetailModalProps) {
  const {
    updateTask,
    deleteTask,
    comments,
    fetchComments,
    createComment,
    taskAttachments,
    fetchTaskAttachments,
    uploadTaskAttachment,
    deleteTaskAttachment,
  } = useTeamStore()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<TaskStatus>('backlog')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assigneeId, setAssigneeId] = useState<string>('')
  const [dueDate, setDueDate] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const [commentText, setCommentText] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploading, setUploading] = useState(false)
  const addToast = useToastStore((s) => s.addToast)

  // Sync form state when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description || '')
      setStatus(task.status)
      setPriority(task.priority)
      setAssigneeId(task.assignee_id || '')
      setDueDate(task.due_date ? task.due_date.slice(0, 10) : '')
      setTags([...task.tags])
      setConfirmDelete(false)
    }
  }, [task])

  // Fetch comments and attachments when modal opens
  useEffect(() => {
    if (isOpen && task) {
      fetchComments(task.id)
      fetchTaskAttachments(teamId, task.id)
    }
  }, [isOpen, task, fetchComments, fetchTaskAttachments, teamId])

  const handleSave = useCallback(async () => {
    if (!task) return
    setSaving(true)
    try {
      await updateTask(teamId, task.id, {
        title,
        description: description || null,
        status,
        priority,
        assignee_id: assigneeId || null,
        due_date: dueDate ? `${dueDate}T00:00:00Z` : null,
        tags,
      })
      onClose()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao salvar tarefa'
      addToast('error', msg)
    } finally {
      setSaving(false)
    }
  }, [task, teamId, title, description, status, priority, assigneeId, dueDate, tags, updateTask, onClose])

  const handleDelete = useCallback(async () => {
    if (!task) return
    setDeleting(true)
    try {
      await deleteTask(teamId, task.id)
      onClose()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao excluir tarefa'
      addToast('error', msg)
    } finally {
      setDeleting(false)
    }
  }, [task, teamId, deleteTask, onClose])

  const handleAddTag = useCallback(() => {
    const trimmed = newTag.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed])
    }
    setNewTag('')
  }, [newTag, tags])

  const handleRemoveTag = useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }, [])

  const handleAddComment = useCallback(async () => {
    if (!task || !commentText.trim()) return
    try {
      await createComment(task.id, commentText.trim())
      setCommentText('')
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Falha ao adicionar comentário'
      addToast('error', msg)
    }
  }, [task, commentText, createComment])

  if (!task) return null

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(open: boolean) => {
          if (!open) {
            onClose()
            setConfirmDelete(false)
          }
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[560px] w-full bg-[#141414] border border-[#1e1e1e] rounded-xl shadow-2xl shadow-black/60 flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-[#1e1e1e] shrink-0">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="text-lg font-bold bg-transparent border-none outline-none w-full mr-3"
                style={{ color: '#e2e0da', fontFamily: mono }}
                placeholder="Título da tarefa"
              />
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[#555] hover:text-white hover:bg-[#1e1e1e] transition-colors shrink-0"
              >
                <X size={15} />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Description */}
              <div>
                <label
                  className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5"
                  style={{ color: '#888', fontFamily: mono }}
                >
                  Descrição
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="Adicionar descrição..."
                  className="w-full rounded-[10px] px-3 py-2.5 text-sm border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors resize-none"
                  style={{
                    background: '#161616',
                    color: '#c0c0c0',
                    fontFamily: mono,
                  }}
                />
              </div>

              {/* Status pills */}
              <div>
                <label
                  className="text-[11px] uppercase tracking-wider font-semibold block mb-2"
                  style={{ color: '#888', fontFamily: mono }}
                >
                  Status
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {KANBAN_COLUMNS.map((col) => {
                    const isActive = status === col.key
                    return (
                      <button
                        key={col.key}
                        onClick={() => setStatus(col.key)}
                        className="px-3 py-1.5 rounded-[10px] text-[11px] font-medium transition-all"
                        style={{
                          fontFamily: mono,
                          background: '#121212',
                          boxShadow: isActive
                            ? 'inset 2px 2px 6px rgba(0,0,0,0.5), inset -1px -1px 4px rgba(255,255,255,0.03)'
                            : '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                          color: isActive ? '#D4835A' : '#888',
                        }}
                      >
                        {col.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Priority */}
              <div>
                <label
                  className="text-[11px] uppercase tracking-wider font-semibold block mb-2"
                  style={{ color: '#888', fontFamily: mono }}
                >
                  Prioridade
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    Object.entries(PRIORITY_CONFIG) as [
                      TaskPriority,
                      { label: string; color: string },
                    ][]
                  ).map(([key, cfg]) => {
                    const isActive = priority === key
                    return (
                      <button
                        key={key}
                        onClick={() => setPriority(key)}
                        className="px-3 py-1.5 rounded-[10px] text-[11px] font-medium transition-all flex items-center gap-1.5"
                        style={{
                          fontFamily: mono,
                          background: '#121212',
                          boxShadow: isActive
                            ? 'inset 2px 2px 6px rgba(0,0,0,0.5), inset -1px -1px 4px rgba(255,255,255,0.03)'
                            : '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                          color: isActive ? cfg.color : '#888',
                        }}
                      >
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ background: cfg.color }}
                        />
                        {cfg.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Assignee + Due Date row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5"
                    style={{ color: '#888', fontFamily: mono }}
                  >
                    Responsável
                  </label>
                  <select
                    value={assigneeId}
                    onChange={(e) => setAssigneeId(e.target.value)}
                    className="w-full rounded-[10px] px-3 py-2 text-[12px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
                    style={{
                      background: '#161616',
                      color: assigneeId ? '#e2e0da' : '#888',
                      fontFamily: mono,
                    }}
                  >
                    <option value="">Nenhum</option>
                    {members.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.user_name || m.user_email || m.user_id}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5"
                    style={{ color: '#888', fontFamily: mono }}
                  >
                    <Calendar size={11} className="inline mr-1" />
                    Data Limite
                  </label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full rounded-[10px] px-3 py-2 text-[12px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
                    style={{
                      background: '#161616',
                      color: dueDate ? '#e2e0da' : '#888',
                      fontFamily: mono,
                      colorScheme: 'dark',
                    }}
                  />
                </div>
              </div>

              {/* Tags */}
              <div>
                <label
                  className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5"
                  style={{ color: '#888', fontFamily: mono }}
                >
                  <Tag size={11} className="inline mr-1" />
                  Tags
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {tags.map((tag) => (
                    <span
                      key={tag}
                      className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        background: 'rgba(255,107,44,0.1)',
                        color: '#D4835A',
                        fontFamily: mono,
                      }}
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-white transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddTag()
                      }
                    }}
                    placeholder="Nova tag..."
                    className="flex-1 rounded-[10px] px-3 py-1.5 text-[11px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
                    style={{
                      background: '#161616',
                      color: '#c0c0c0',
                      fontFamily: mono,
                    }}
                  />
                  <button
                    onClick={handleAddTag}
                    className="px-2 py-1.5 rounded-[10px] text-[#888] hover:text-[#D4835A] transition-colors"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* OKR Link (read-only) */}
              {(task.okr_objective_id || task.okr_key_result_id) && (
                <div>
                  <label
                    className="text-[11px] uppercase tracking-wider font-semibold block mb-1.5"
                    style={{ color: '#888', fontFamily: mono }}
                  >
                    <Link2 size={11} className="inline mr-1" />
                    OKR Vinculado
                  </label>
                  <div
                    className="rounded-[10px] px-3 py-2 text-[11px] border border-[#1e1e1e]"
                    style={{
                      background: '#161616',
                      color: '#c0c0c0',
                      fontFamily: mono,
                    }}
                  >
                    {task.okr_objective_id && (
                      <p>
                        <span style={{ color: '#888' }}>Objetivo:</span>{' '}
                        {task.okr_objective_id}
                      </p>
                    )}
                    {task.okr_key_result_id && (
                      <p>
                        <span style={{ color: '#888' }}>Key Result:</span>{' '}
                        {task.okr_key_result_id}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Attachments */}
              <div>
                <label
                  className="text-[11px] uppercase tracking-wider font-semibold block mb-2"
                  style={{ color: '#888', fontFamily: mono }}
                >
                  <Paperclip size={11} className="inline mr-1" />
                  Anexos ({taskAttachments.length})
                </label>

                {taskAttachments.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {taskAttachments.map((att: TaskAttachment) => (
                      <div
                        key={att.id}
                        className="flex items-center gap-2 rounded-lg px-3 py-2"
                        style={{ background: '#121212', border: '1px solid #1e1e1e' }}
                      >
                        <FileText size={14} style={{ color: '#D4835A' }} />
                        <span className="flex-1 text-[11px] truncate" style={{ color: '#c0c0c0', fontFamily: mono }}>
                          {att.file_name}
                        </span>
                        <span className="text-[10px] shrink-0" style={{ color: '#555' }}>
                          {(att.file_size / 1024).toFixed(0)}KB
                        </span>
                        <button
                          className="p-1 rounded hover:bg-dim/50 transition-colors"
                          title="Baixar"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/teams/${teamId}/tasks/${task!.id}/attachments/${att.id}`, {
                                credentials: 'same-origin',
                              })
                              if (!res.ok) throw new Error('Download failed')
                              const blob = await res.blob()
                              const url = URL.createObjectURL(blob)
                              const a = document.createElement('a')
                              a.href = url
                              a.download = att.file_name
                              a.click()
                              URL.revokeObjectURL(url)
                            } catch {
                              addToast('error', 'Falha ao baixar arquivo')
                            }
                          }}
                        >
                          <Download size={12} style={{ color: '#888' }} />
                        </button>
                        <button
                          className="p-1 rounded hover:bg-red-900/30 transition-colors"
                          title="Excluir"
                          onClick={() => deleteTaskAttachment(teamId, task!.id, att.id)}
                        >
                          <Trash2 size={12} style={{ color: '#ef4444' }} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <label
                  className="flex items-center justify-center gap-2 rounded-[10px] px-3 py-2.5 text-[11px] cursor-pointer transition-all duration-200 hover:border-[#D4835A]/40"
                  style={{
                    background: '#0d0d0d',
                    border: '1px dashed #1e1e1e',
                    color: '#888',
                    fontFamily: mono,
                  }}
                >
                  <Plus size={12} />
                  {uploading ? 'Enviando...' : 'Adicionar arquivo'}
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file || !task) return
                      setUploading(true)
                      try {
                        await uploadTaskAttachment(teamId, task.id, file)
                        addToast('success', 'Arquivo enviado')
                      } catch (err) {
                        const msg = err instanceof ApiError ? err.message : 'Falha ao enviar arquivo'
                        addToast('error', msg)
                      } finally {
                        setUploading(false)
                        e.target.value = ''
                      }
                    }}
                  />
                </label>
              </div>

              {/* Comments */}
              <div>
                <label
                  className="text-[11px] uppercase tracking-wider font-semibold block mb-2"
                  style={{ color: '#888', fontFamily: mono }}
                >
                  Comentários ({comments.length})
                </label>

                {/* Comment list */}
                <div className="space-y-3 mb-3 max-h-[200px] overflow-y-auto">
                  {comments.length === 0 && (
                    <p
                      className="text-[11px] text-center py-3"
                      style={{ color: '#555', fontFamily: mono }}
                    >
                      Nenhum comentário ainda
                    </p>
                  )}
                  {comments.map((comment: TaskComment) => (
                    <div key={comment.id} className="flex gap-2.5">
                      <div className="mt-0.5">
                        <UserAvatar userId={comment.author_id} name={comment.author_name} size={24} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[11px] font-semibold"
                            style={{ color: '#e2e0da', fontFamily: mono }}
                          >
                            {comment.author_name}
                          </span>
                          <span
                            className="text-[10px]"
                            style={{ color: '#555', fontFamily: mono }}
                          >
                            {relativeTime(comment.created_at)}
                          </span>
                        </div>
                        <p
                          className="text-[12px] mt-0.5 leading-relaxed"
                          style={{ color: '#c0c0c0', fontFamily: mono }}
                        >
                          {comment.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add comment */}
                <div className="flex gap-2">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleAddComment()
                      }
                    }}
                    placeholder="Adicionar comentário..."
                    className="flex-1 rounded-[10px] px-3 py-2 text-[12px] border border-[#1e1e1e] focus:border-[#D4835A] focus:outline-none transition-colors"
                    style={{
                      background: '#161616',
                      color: '#c0c0c0',
                      fontFamily: mono,
                    }}
                  />
                  <button
                    onClick={handleAddComment}
                    disabled={!commentText.trim()}
                    className="px-3 py-2 rounded-[10px] transition-all disabled:opacity-30"
                    style={{
                      background: '#121212',
                      boxShadow:
                        '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                      color: '#D4835A',
                    }}
                  >
                    <Send size={13} />
                  </button>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            <div className="flex items-center justify-between p-5 border-t border-[#1e1e1e] shrink-0">
              {/* Delete */}
              {!confirmDelete ? (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[11px] font-medium transition-all"
                  style={{
                    fontFamily: mono,
                    background: '#121212',
                    boxShadow:
                      '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                    color: '#ef4444',
                  }}
                >
                  <Trash2 size={12} />
                  Excluir
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px]"
                    style={{ color: '#ef4444', fontFamily: mono }}
                  >
                    Confirmar?
                  </span>
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50"
                    style={{ fontFamily: mono }}
                  >
                    {deleting ? '...' : 'Sim'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-3 py-1.5 rounded-md text-[11px] text-[#888] hover:text-white transition-colors"
                    style={{ fontFamily: mono }}
                  >
                    Não
                  </button>
                </div>
              )}

              {/* Save */}
              <button
                onClick={handleSave}
                disabled={saving || !title.trim()}
                className="px-5 py-2 rounded-[10px] text-[12px] font-semibold transition-all disabled:opacity-40"
                style={{
                  fontFamily: mono,
                  background: '#121212',
                  boxShadow:
                    '3px 3px 7px rgba(0,0,0,0.45), -1px -1px 5px rgba(255,255,255,0.03)',
                  color: '#D4835A',
                }}
              >
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
