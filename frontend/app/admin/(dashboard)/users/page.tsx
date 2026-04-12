'use client'

import React, { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useAdminStore } from '@/store/useAdminStore'
import { Button, Input, Label, Modal } from '@heroui/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Eye, ShieldBan, ShieldCheck, Trash2, Search } from 'lucide-react'

const mono = "'JetBrains Mono', 'Fira Code', monospace"

const createUserSchema = z.object({
  email: z.string().email('E-mail invalido'),
  password: z.string().min(6, 'Minimo 6 caracteres'),
  name: z.string().min(1, 'Nome e obrigatorio'),
})

type CreateUserForm = z.infer<typeof createUserSchema>

function CloseTrigger() {
  return (
    <Modal.CloseTrigger className="absolute right-4 top-4 z-10 flex items-center justify-center w-8 h-8 rounded-full hover:bg-[#1a1a1a] transition-colors cursor-pointer text-[#555] hover:text-white">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </Modal.CloseTrigger>
  )
}

export default function AdminUsersPage() {
  const { users, fetchUsers, createUser, blockUser, deleteUser, isLoading, error, clearError } = useAdminStore()
  const [search, setSearch] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [confirmBlock, setConfirmBlock] = useState<{ id: string; blocked: boolean; name: string } | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors: formErrors },
  } = useForm<CreateUserForm>({
    resolver: zodResolver(createUserSchema),
  })

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  )

  const handleCreate = useCallback(async (data: CreateUserForm) => {
    try {
      await createUser(data.email, data.password, data.name)
      setShowCreateModal(false)
      reset()
      fetchUsers()
    } catch {
      // error in store
    }
  }, [createUser, fetchUsers, reset])

  const handleBlock = useCallback(async () => {
    if (!confirmBlock) return
    try {
      await blockUser(confirmBlock.id, confirmBlock.blocked)
      setConfirmBlock(null)
      fetchUsers()
    } catch {
      // error in store
    }
  }, [confirmBlock, blockUser, fetchUsers])

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) return
    try {
      await deleteUser(confirmDelete)
      setConfirmDelete(null)
      fetchUsers()
    } catch {
      // error in store
    }
  }, [confirmDelete, deleteUser, fetchUsers])

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 style={{ fontFamily: mono, fontSize: 24, fontWeight: 700, color: '#fff' }}>
            Usuarios
          </h1>
          <p style={{ fontFamily: mono, fontSize: 13, color: '#555', marginTop: 4 }}>
            {users.length} usuarios cadastrados
          </p>
        </div>
        <Button
          onPress={() => { clearError(); setShowCreateModal(true) }}
          className="border-none font-semibold"
          style={{ background: '#FF6B00', color: '#000', fontFamily: mono }}
        >
          <Plus size={16} />
          Novo Usuario
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#555]" />
        <Input
          placeholder="Buscar por nome ou e-mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 border-[#222] focus-within:!border-[#FF6B00]"
        />
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-[#1a1a1a] overflow-hidden" style={{ background: '#0a0a0a' }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#1a1a1a]">
                {['Nome', 'E-mail', 'Status', 'Assistentes', 'Criado em', 'Acoes'].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left"
                    style={{ fontFamily: mono, fontSize: 10, color: '#555', letterSpacing: 1, textTransform: 'uppercase' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center" style={{ fontFamily: mono, fontSize: 13, color: '#555' }}>
                    Carregando...
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center" style={{ fontFamily: mono, fontSize: 13, color: '#555' }}>
                    Nenhum usuario encontrado
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id} className="border-b border-[#111] hover:bg-[#111]/50 transition-colors">
                    <td className="px-4 py-3" style={{ fontFamily: mono, fontSize: 13, color: '#fff' }}>
                      {user.name}
                    </td>
                    <td className="px-4 py-3" style={{ fontFamily: mono, fontSize: 13, color: '#888' }}>
                      {user.email}
                    </td>
                    <td className="px-4 py-3">
                      {user.blocked ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs" style={{ fontFamily: mono, background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
                          Bloqueado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs" style={{ fontFamily: mono, background: 'rgba(16,185,129,0.1)', color: '#10b981' }}>
                          Ativo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3" style={{ fontFamily: mono, fontSize: 13, color: '#888' }}>
                      {user.assistant_count}
                    </td>
                    <td className="px-4 py-3" style={{ fontFamily: mono, fontSize: 12, color: '#555' }}>
                      {formatDate(user.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <Link href={`/admin/users/${user.id}`}>
                          <button className="p-2 rounded-lg text-[#888] hover:text-[#FF6B00] hover:bg-[#111] transition-colors" title="Ver detalhes">
                            <Eye size={15} />
                          </button>
                        </Link>
                        <button
                          className="p-2 rounded-lg text-[#888] hover:text-amber-400 hover:bg-[#111] transition-colors"
                          title={user.blocked ? 'Desbloquear' : 'Bloquear'}
                          onClick={() => setConfirmBlock({ id: user.id, blocked: !user.blocked, name: user.name })}
                        >
                          {user.blocked ? <ShieldCheck size={15} /> : <ShieldBan size={15} />}
                        </button>
                        <button
                          className="p-2 rounded-lg text-[#888] hover:text-red-400 hover:bg-[#111] transition-colors"
                          title="Remover"
                          onClick={() => setConfirmDelete(user.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      <Modal>
        <Modal.Backdrop isOpen={showCreateModal} onOpenChange={setShowCreateModal}>
          <Modal.Container>
            <Modal.Dialog className="max-w-md w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl">
              <CloseTrigger />
              <Modal.Header>
                <Modal.Heading style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: '#fff' }}>
                  Novo Usuario
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <form onSubmit={handleSubmit(handleCreate)} className="flex flex-col gap-4">
                  {error && (
                    <div className="rounded-xl p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                      {error}
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>Nome</Label>
                    <Input placeholder="Nome completo" className="border-[#222] focus-within:!border-[#FF6B00]" {...register('name')} />
                    {formErrors.name && <p className="text-xs text-red-500">{formErrors.name.message}</p>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>E-mail</Label>
                    <Input placeholder="email@exemplo.com" type="email" className="border-[#222] focus-within:!border-[#FF6B00]" {...register('email')} />
                    {formErrors.email && <p className="text-xs text-red-500">{formErrors.email.message}</p>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label style={{ fontFamily: mono, fontSize: 11, color: '#888', letterSpacing: 1, textTransform: 'uppercase' as const }}>Senha</Label>
                    <Input placeholder="Minimo 6 caracteres" type="password" className="border-[#222] focus-within:!border-[#FF6B00]" {...register('password')} />
                    {formErrors.password && <p className="text-xs text-red-500">{formErrors.password.message}</p>}
                  </div>
                  <Modal.Footer className="flex justify-end gap-3 pt-4 pb-2 px-0">
                    <Button variant="ghost" onPress={() => setShowCreateModal(false)} className="border-[#222] text-[#888]">
                      Cancelar
                    </Button>
                    <Button type="submit" isDisabled={isLoading} className="border-none font-semibold" style={{ background: '#FF6B00', color: '#000', fontFamily: mono }}>
                      {isLoading ? 'Criando...' : 'Criar'}
                    </Button>
                  </Modal.Footer>
                </form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Block Confirmation Modal */}
      <Modal>
        <Modal.Backdrop isOpen={!!confirmBlock} onOpenChange={(open) => { if (!open) setConfirmBlock(null) }}>
          <Modal.Container>
            <Modal.Dialog className="max-w-sm w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl">
              <CloseTrigger />
              <Modal.Header>
                <Modal.Heading style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: '#fff' }}>
                  {confirmBlock?.blocked ? 'Bloquear Usuario' : 'Desbloquear Usuario'}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="pb-2">
                <p style={{ fontFamily: mono, fontSize: 13, color: '#888' }}>
                  {confirmBlock?.blocked
                    ? `Tem certeza que deseja bloquear ${confirmBlock?.name}? O usuario nao conseguira fazer login.`
                    : `Tem certeza que deseja desbloquear ${confirmBlock?.name}?`}
                </p>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 pt-4 pb-5 px-6">
                <Button variant="ghost" onPress={() => setConfirmBlock(null)} className="border-[#222] text-[#888]">
                  Cancelar
                </Button>
                <Button
                  onPress={handleBlock}
                  className="border-none font-semibold"
                  style={{ background: confirmBlock?.blocked ? '#ef4444' : '#10b981', color: '#fff', fontFamily: mono }}
                >
                  Confirmar
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal>
        <Modal.Backdrop isOpen={!!confirmDelete} onOpenChange={(open) => { if (!open) setConfirmDelete(null) }}>
          <Modal.Container>
            <Modal.Dialog className="max-w-sm w-full bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl">
              <CloseTrigger />
              <Modal.Header>
                <Modal.Heading style={{ fontFamily: mono, fontSize: 16, fontWeight: 700, color: '#ef4444' }}>
                  Remover Usuario
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="pb-2">
                <p style={{ fontFamily: mono, fontSize: 13, color: '#888' }}>
                  Esta acao e irreversivel. Todos os dados do usuario serao removidos permanentemente, incluindo assistentes, conversas e cobrancas.
                </p>
              </Modal.Body>
              <Modal.Footer className="flex justify-end gap-3 pt-4 pb-5 px-6">
                <Button variant="ghost" onPress={() => setConfirmDelete(null)} className="border-[#222] text-[#888]">
                  Cancelar
                </Button>
                <Button
                  onPress={handleDelete}
                  className="border-none font-semibold"
                  style={{ background: '#ef4444', color: '#fff', fontFamily: mono }}
                >
                  Remover
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
