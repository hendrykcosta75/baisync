'use client'

import React, { useState } from 'react'
import { Modal, Button, Select, ListBox } from '@heroui/react'
import { useCalendarStore } from '@/store/useCalendarStore'
import type { Appointment, AppointmentStatus } from '@/types/appointment'
import type { Assistant } from '@/types/assistant'

interface Props {
  appointment: Appointment | null
  isOpen: boolean
  onClose: () => void
  assistants: Assistant[]
}

const STATUS_OPTIONS: { id: AppointmentStatus; label: string }[] = [
  { id: 'confirmed', label: 'Confirmado' },
  { id: 'pending', label: 'Pendente' },
  { id: 'completed', label: 'Concluído' },
  { id: 'no_show', label: 'Não compareceu' },
  { id: 'cancelled', label: 'Cancelado' },
  { id: 'rescheduled', label: 'Reagendado' },
]

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export function AppointmentDetailModal({ appointment, isOpen, onClose, assistants }: Props) {
  const { update, cancel, remove, fetch } = useCalendarStore()
  const [loading, setLoading] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!appointment) return null

  const assistantName = appointment.assistantId
    ? assistants.find(a => a.id === appointment.assistantId)?.name || 'Assistente'
    : null

  const handleStatusChange = async (newStatus: string) => {
    if (!newStatus || newStatus === appointment.status) return
    setLoading(true)
    try {
      await update(appointment.id, { status: newStatus as AppointmentStatus })
      await fetch()
      onClose()
    } catch (e) {
      console.error('Failed to update status', e)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    setLoading(true)
    try {
      await cancel(appointment.id)
      await fetch()
      onClose()
    } catch (e) {
      console.error('Failed to cancel', e)
    } finally {
      setLoading(false)
      setConfirmCancel(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      await remove(appointment.id)
      onClose()
    } catch (e) {
      console.error('Failed to delete', e)
    } finally {
      setLoading(false)
      setConfirmDelete(false)
    }
  }

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={(open: boolean) => { if (!open) { onClose(); setConfirmCancel(false); setConfirmDelete(false) } }}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[420px] w-full bg-overlay p-5 rounded-2xl shadow-xl flex flex-col gap-4">
            <div>
              <h3 className="text-base font-semibold text-foreground">Detalhes</h3>
              <p className="text-sm text-muted mt-1">
                {appointment.isManual ? 'Evento manual' : 'Agendado via IA'}
                {assistantName && <> &middot; {assistantName}</>}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted text-xs">Cliente</p>
                <p className="font-medium text-foreground">{appointment.clientName || '-'}</p>
              </div>
              <div>
                <p className="text-muted text-xs">Telefone</p>
                <p className="font-medium text-foreground">{appointment.clientPhone || '-'}</p>
              </div>
              {appointment.clientEmail && (
                <div className="col-span-2">
                  <p className="text-muted text-xs">Email</p>
                  <p className="font-medium text-foreground">{appointment.clientEmail}</p>
                </div>
              )}
              <div>
                <p className="text-muted text-xs">Data/Hora</p>
                <p className="font-medium text-foreground">{formatDateTime(appointment.dateTime)}</p>
              </div>
              <div>
                <p className="text-muted text-xs">Duração</p>
                <p className="font-medium text-foreground">{appointment.durationMinutes} min</p>
              </div>
              {appointment.appointmentType && (
                <div>
                  <p className="text-muted text-xs">Tipo</p>
                  <p className="font-medium text-foreground">{appointment.appointmentType}</p>
                </div>
              )}
              {appointment.originChannel && (
                <div>
                  <p className="text-muted text-xs">Canal</p>
                  <p className="font-medium text-foreground capitalize">{appointment.originChannel}</p>
                </div>
              )}
              {appointment.notes && (
                <div className="col-span-2">
                  <p className="text-muted text-xs">Observações</p>
                  <p className="text-foreground">{appointment.notes}</p>
                </div>
              )}
            </div>

            {appointment.status !== 'cancelled' && (
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-xs text-muted mb-1.5">Alterar Status</p>
                  <Select
                    className="w-full"
                    selectedKey={appointment.status}
                    onSelectionChange={(key) => handleStatusChange(key as string)}
                    isDisabled={loading}
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {STATUS_OPTIONS.map(opt => (
                          <ListBox.Item key={opt.id} id={opt.id} textValue={opt.label}>{opt.label}</ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex justify-between items-center pt-2">
              <div className="flex flex-col gap-1">
                {appointment.status !== 'cancelled' && !confirmCancel && !confirmDelete && (
                  <Button variant="ghost" className="text-red-500 border-none" onPress={() => setConfirmCancel(true)} isDisabled={loading}>
                    Cancelar Agendamento
                  </Button>
                )}
                {confirmCancel && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-500">Confirmar cancelamento?</span>
                    <Button size="sm" variant="ghost" className="text-red-600 border-none" onPress={handleCancel} isDisabled={loading}>
                      Sim
                    </Button>
                    <Button size="sm" variant="ghost" className="border-none" onPress={() => setConfirmCancel(false)}>
                      Não
                    </Button>
                  </div>
                )}
                {!confirmCancel && !confirmDelete && (
                  <Button variant="ghost" className="text-muted border-none text-xs" onPress={() => setConfirmDelete(true)} isDisabled={loading}>
                    Remover da agenda
                  </Button>
                )}
                {confirmDelete && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-red-500">Remover permanentemente?</span>
                    <Button size="sm" variant="ghost" className="text-red-600 border-none" onPress={handleDelete} isDisabled={loading}>
                      Sim
                    </Button>
                    <Button size="sm" variant="ghost" className="border-none" onPress={() => setConfirmDelete(false)}>
                      Não
                    </Button>
                  </div>
                )}
              </div>
              <button type="button" className="btn-neu text-sm" onClick={onClose}>
                Fechar
              </button>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
