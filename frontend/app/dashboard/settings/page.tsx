'use client'

import React, { useState, useEffect } from 'react'
import { Card, Input, Form, Modal, TextField, Label, FieldError } from '@heroui/react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuthStore } from '@/store/useAuthStore'
import { Trash2 } from 'lucide-react'

const profileSchema = z.object({
  name: z.string().min(2, 'O nome deve ter pelo menos 2 caracteres'),
})

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Senha atual é obrigatória'),
  newPassword: z.string().min(6, 'A nova senha deve ter pelo menos 6 caracteres'),
  confirmPassword: z.string().min(1, 'Confirme a nova senha'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'As senhas não coincidem',
  path: ['confirmPassword'],
})

const deleteSchema = z.object({
  password: z.string().min(1, 'Senha é obrigatória para confirmar'),
})

type ProfileFormData = z.infer<typeof profileSchema>
type PasswordFormData = z.infer<typeof passwordSchema>
type DeleteFormData = z.infer<typeof deleteSchema>

export default function SettingsPage() {
  const { user, updateProfile, uploadAvatar, deleteAvatar, changePassword, deleteAccount, isLoading } = useAuthStore()
  const [profileSaved, setProfileSaved] = useState(false)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarKey, setAvatarKey] = useState(0)
  const [showDeleteAvatarModal, setShowDeleteAvatarModal] = useState(false)
  const [avatarDeleting, setAvatarDeleting] = useState(false)

  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user?.name || '' },
  })

  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const deleteForm = useForm<DeleteFormData>({
    resolver: zodResolver(deleteSchema),
    defaultValues: { password: '' },
  })

  useEffect(() => {
    if (user?.name) {
      profileForm.reset({ name: user.name })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name])

  const profileErrors = profileForm.formState.errors
  const passwordErrors = passwordForm.formState.errors
  const deleteErrors = deleteForm.formState.errors

  const onProfileSubmit = async (data: ProfileFormData) => {
    setProfileError(null)
    try {
      await updateProfile(data.name)
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Erro ao atualizar perfil')
    }
  }

  const onPasswordSubmit = async (data: PasswordFormData) => {
    setPasswordError(null)
    try {
      await changePassword(data.currentPassword, data.newPassword)
      setPasswordChanged(true)
      passwordForm.reset()
      setTimeout(() => setPasswordChanged(false), 3000)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Erro ao alterar senha')
    }
  }

  const onDeleteSubmit = async (data: DeleteFormData) => {
    setDeleteError(null)
    try {
      await deleteAccount(data.password)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Erro ao remover conta')
    }
  }

  return (
    <div className="flex flex-col gap-8 pb-10 max-w-full sm:max-w-2xl">
      <div>
        <h1 className="text-2xl font-light tracking-tight text-foreground" style={{ fontFamily: "'Fira Code', 'JetBrains Mono', monospace" }}>Minhas Configurações</h1>
        <p className="text-sm text-muted mt-1">
          Gerencie seu perfil, segurança e configurações da conta.
        </p>
      </div>

      {/* Account Info */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Informações da Conta</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-subtle uppercase tracking-wider font-medium mb-1">Email</p>
            <p className="text-sm text-foreground">{user?.email || '—'}</p>
          </div>
          <div>
            <p className="text-xs text-subtle uppercase tracking-wider font-medium mb-1">ID da Conta</p>
            <p className="text-sm text-foreground font-mono truncate">{user?.id || '—'}</p>
          </div>
        </div>
      </Card>

      {/* Avatar */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Foto de Perfil</h2>
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 rounded-full overflow-hidden bg-raised border border-dim flex items-center justify-center shrink-0">
            {user?.has_avatar ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={avatarKey}
                src={`/api/users/${user.id}/avatar?v=${avatarKey}`}
                alt="Avatar"
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl font-bold text-subtle">
                {user?.name?.charAt(0)?.toUpperCase() || '?'}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <label className={`btn-neu text-sm px-4 py-2 rounded-[10px] cursor-pointer inline-flex items-center gap-2 ${avatarUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {avatarUploading ? 'Enviando...' : 'Alterar Foto'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={avatarUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    setAvatarUploading(true)
                    try {
                      await uploadAvatar(file)
                      setAvatarKey((k) => k + 1)
                    } catch {
                      setProfileError('Erro ao enviar foto')
                    } finally {
                      setAvatarUploading(false)
                      e.target.value = ''
                    }
                  }}
                />
              </label>
              {user?.has_avatar && (
                <button
                  type="button"
                  className="btn-neu text-sm px-3 py-2 rounded-[10px] inline-flex items-center gap-1.5 !text-red-400 hover:!text-red-300"
                  onClick={() => setShowDeleteAvatarModal(true)}
                >
                  <Trash2 size={14} />
                  Remover
                </button>
              )}
            </div>
            <p className="text-xs text-subtle">JPG, PNG ou GIF. Máximo 2MB.</p>
          </div>
        </div>
      </Card>

      {/* Profile Name */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Perfil</h2>
        <Form onSubmit={profileForm.handleSubmit(onProfileSubmit)} className="flex flex-col gap-4">
          <Controller
            name="name"
            control={profileForm.control}
            render={({ field }) => (
              <TextField className="w-full" isInvalid={!!profileErrors.name}>
                <Label className="text-sm font-medium text-foreground mb-1">Nome</Label>
                <Input {...field} placeholder="Seu nome" />
                {profileErrors.name && <FieldError>{profileErrors.name.message}</FieldError>}
              </TextField>
            )}
          />
          {profileError && (
            <p className="text-sm text-red-500">{profileError}</p>
          )}
          <div className="flex items-center gap-3">
            <button className="btn-neu text-sm" type="submit" disabled={isLoading}>
              Salvar Nome
            </button>
            {profileSaved && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                Perfil atualizado!
              </span>
            )}
          </div>
        </Form>
      </Card>

      {/* Change Password */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Alterar Senha</h2>
        <Form onSubmit={passwordForm.handleSubmit(onPasswordSubmit)} className="flex flex-col gap-4">
          <Controller
            name="currentPassword"
            control={passwordForm.control}
            render={({ field }) => (
              <TextField className="w-full" isInvalid={!!passwordErrors.currentPassword}>
                <Label className="text-sm font-medium text-foreground mb-1">Senha Atual</Label>
                <Input {...field} type="password" placeholder="Digite sua senha atual" />
                {passwordErrors.currentPassword && <FieldError>{passwordErrors.currentPassword.message}</FieldError>}
              </TextField>
            )}
          />
          <Controller
            name="newPassword"
            control={passwordForm.control}
            render={({ field }) => (
              <TextField className="w-full" isInvalid={!!passwordErrors.newPassword}>
                <Label className="text-sm font-medium text-foreground mb-1">Nova Senha</Label>
                <Input {...field} type="password" placeholder="Digite a nova senha" />
                {passwordErrors.newPassword && <FieldError>{passwordErrors.newPassword.message}</FieldError>}
              </TextField>
            )}
          />
          <Controller
            name="confirmPassword"
            control={passwordForm.control}
            render={({ field }) => (
              <TextField className="w-full" isInvalid={!!passwordErrors.confirmPassword}>
                <Label className="text-sm font-medium text-foreground mb-1">Confirmar Nova Senha</Label>
                <Input {...field} type="password" placeholder="Confirme a nova senha" />
                {passwordErrors.confirmPassword && <FieldError>{passwordErrors.confirmPassword.message}</FieldError>}
              </TextField>
            )}
          />
          {passwordError && (
            <p className="text-sm text-red-500">{passwordError}</p>
          )}
          <div className="flex items-center gap-3">
            <button className="btn-neu text-sm" type="submit" disabled={isLoading}>
              Alterar Senha
            </button>
            {passwordChanged && (
              <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                Senha alterada com sucesso!
              </span>
            )}
          </div>
        </Form>
      </Card>

      {/* Danger Zone */}
      <Card className="p-6 border border-red-300 dark:border-red-800/50">
        <h2 className="text-lg font-semibold text-red-600 dark:text-red-400 mb-2">Zona de Perigo</h2>
        <p className="text-sm text-muted mb-4">
          Ao remover sua conta, todos os seus dados, assistentes, integrações e histórico de mensagens serão permanentemente excluídos. Esta ação não pode ser desfeita.
        </p>
        <button type="button" className="btn-neu text-sm !text-red-400 hover:!text-red-300" onClick={() => setShowDeleteModal(true)}>
          Remover Minha Conta
        </button>
      </Card>

      {/* Delete Confirmation Modal */}
      <Modal>
        <Modal.Backdrop isOpen={showDeleteModal} onOpenChange={(open: boolean) => {
          if (!open) {
            setShowDeleteModal(false)
            setDeleteError(null)
            deleteForm.reset()
          }
        }}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[480px] w-full bg-overlay p-6 rounded-2xl shadow-xl">
              <Modal.Header>
                <Modal.Heading className="text-xl font-semibold text-foreground">
                  Confirmar Remoção da Conta
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted mb-4">
                  Tem certeza que deseja remover sua conta? Esta ação é irreversível. Digite sua senha para confirmar.
                </p>
                <Form onSubmit={deleteForm.handleSubmit(onDeleteSubmit)} className="flex flex-col gap-4">
                  <Controller
                    name="password"
                    control={deleteForm.control}
                    render={({ field }) => (
                      <TextField className="w-full" isInvalid={!!deleteErrors.password}>
                        <Input {...field} type="password" placeholder="Digite sua senha" />
                        {deleteErrors.password && <FieldError>{deleteErrors.password.message}</FieldError>}
                      </TextField>
                    )}
                  />
                  {deleteError && (
                    <p className="text-sm text-red-500">{deleteError}</p>
                  )}
                  <div className="flex items-center gap-3 justify-end">
                    <button
                      type="button"
                      className="btn-neu-ghost text-sm"
                      onClick={() => {
                        setShowDeleteModal(false)
                        setDeleteError(null)
                        deleteForm.reset()
                      }}
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn-neu text-sm !text-red-400 hover:!text-red-300" disabled={isLoading}>
                      Remover Conta Permanentemente
                    </button>
                  </div>
                </Form>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Delete Avatar Confirmation Modal */}
      <Modal>
        <Modal.Backdrop isOpen={showDeleteAvatarModal} onOpenChange={(open: boolean) => {
          if (!open) setShowDeleteAvatarModal(false)
        }}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[400px] w-full bg-overlay p-6 rounded-2xl shadow-xl">
              <Modal.Header>
                <Modal.Heading className="text-lg font-semibold text-foreground">
                  Remover Foto de Perfil
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm text-muted mb-5">
                  Tem certeza que deseja remover sua foto de perfil? Suas iniciais serão exibidas no lugar.
                </p>
                <div className="flex items-center gap-3 justify-end">
                  <button
                    type="button"
                    className="btn-neu-ghost text-sm"
                    onClick={() => setShowDeleteAvatarModal(false)}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn-neu text-sm !text-red-400 hover:!text-red-300"
                    disabled={avatarDeleting}
                    onClick={async () => {
                      setAvatarDeleting(true)
                      try {
                        await deleteAvatar()
                        setAvatarKey((k) => k + 1)
                        setShowDeleteAvatarModal(false)
                      } catch {
                        setProfileError('Erro ao remover foto')
                      } finally {
                        setAvatarDeleting(false)
                      }
                    }}
                  >
                    {avatarDeleting ? 'Removendo...' : 'Remover Foto'}
                  </button>
                </div>
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  )
}
