'use client'

import React from 'react'
import { Modal, Button, Input, TextArea, Select, ListBox, TextField, Label } from '@heroui/react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCalendarStore } from '@/store/useCalendarStore'
import type { Assistant } from '@/types/assistant'

interface Props {
  isOpen: boolean
  onClose: () => void
  assistants: Assistant[]
  initialDate?: string | null
}

const schema = z.object({
  assistantId: z.string().optional(),
  clientName: z.string().min(1, 'Nome é obrigatório'),
  clientEmail: z.string().email('Email inválido').or(z.literal('')).optional(),
  clientPhone: z.string().optional(),
  date: z.string().min(1, 'Data é obrigatória'),
  time: z.string().min(1, 'Horário é obrigatório'),
  durationMinutes: z.number().min(5).max(480),
  appointmentType: z.string().optional(),
  notes: z.string().optional(),
})

type FormData = z.infer<typeof schema>

export function CreateEventModal({ isOpen, onClose, assistants, initialDate }: Props) {
  const { create, fetch } = useCalendarStore()

  const defaultDate = initialDate
    ? initialDate.includes('T') ? initialDate.split('T')[0] : initialDate
    : new Date().toISOString().split('T')[0]

  const { control, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      assistantId: '',
      clientName: '',
      clientEmail: '',
      clientPhone: '',
      date: defaultDate,
      time: '09:00',
      durationMinutes: 30,
      appointmentType: '',
      notes: '',
    },
  })

  const onSubmit = async (data: FormData) => {
    const dateTime = `${data.date}T${data.time}:00`
    try {
      await create({
        assistantId: data.assistantId || null,
        clientName: data.clientName,
        clientEmail: data.clientEmail || undefined,
        clientPhone: data.clientPhone || '',
        dateTime,
        durationMinutes: data.durationMinutes,
        appointmentType: data.appointmentType || undefined,
        notes: data.notes || undefined,
        isManual: true,
      })
      await fetch()
      reset()
      onClose()
    } catch (e) {
      console.error('Failed to create appointment', e)
    }
  }

  return (
    <Modal>
      <Modal.Backdrop isOpen={isOpen} onOpenChange={(open: boolean) => { if (!open) onClose() }}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[460px] w-full bg-overlay p-5 rounded-2xl shadow-xl flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-foreground">Novo evento</h3>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
              <Controller
                name="clientName"
                control={control}
                render={({ field }) => (
                  <TextField>
                    <Label className="text-xs">Titulo / Nome do cliente</Label>
                    <Input {...field} placeholder="Ex: Reunião com João" />
                    {errors.clientName && <p className="text-xs text-red-500 mt-0.5">{errors.clientName.message}</p>}
                  </TextField>
                )}
              />

              <div className="grid grid-cols-3 gap-2">
                <Controller
                  name="date"
                  control={control}
                  render={({ field }) => (
                    <TextField>
                      <Label className="text-xs">Data</Label>
                      <Input type="date" {...field} />
                    </TextField>
                  )}
                />
                <Controller
                  name="time"
                  control={control}
                  render={({ field }) => (
                    <TextField>
                      <Label className="text-xs">Horário</Label>
                      <Input type="time" {...field} />
                    </TextField>
                  )}
                />
                <Controller
                  name="durationMinutes"
                  control={control}
                  render={({ field }) => (
                    <TextField>
                      <Label className="text-xs">Duração (min)</Label>
                      <Input type="number" {...field} onChange={(e: React.ChangeEvent<HTMLInputElement>) => field.onChange(Number(e.target.value))} />
                    </TextField>
                  )}
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Controller
                  name="clientPhone"
                  control={control}
                  render={({ field }) => (
                    <TextField>
                      <Label className="text-xs">Telefone (opcional)</Label>
                      <Input {...field} placeholder="+55..." />
                    </TextField>
                  )}
                />
                <Controller
                  name="clientEmail"
                  control={control}
                  render={({ field }) => (
                    <TextField>
                      <Label className="text-xs">Email (opcional)</Label>
                      <Input {...field} placeholder="email@..." />
                      {errors.clientEmail && <p className="text-xs text-red-500 mt-0.5">{errors.clientEmail.message}</p>}
                    </TextField>
                  )}
                />
              </div>

              <Controller
                name="appointmentType"
                control={control}
                render={({ field }) => (
                  <TextField>
                    <Label className="text-xs">Tipo (opcional)</Label>
                    <Input {...field} placeholder="Ex: consulta, reunião" />
                  </TextField>
                )}
              />

              {assistants.length > 0 && (
                <Controller
                  name="assistantId"
                  control={control}
                  render={({ field }) => (
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs">Assistente (opcional)</Label>
                      <Select
                        className="w-full"
                        selectedKey={field.value || ''}
                        onSelectionChange={(key) => field.onChange(key === '' ? '' : key as string)}
                      >
                        <Select.Trigger>
                          <Select.Value />
                          <Select.Indicator />
                        </Select.Trigger>
                        <Select.Popover>
                          <ListBox>
                            <ListBox.Item id="" textValue="Nenhum">Nenhum</ListBox.Item>
                            {assistants.map(a => (
                              <ListBox.Item key={a.id} id={a.id} textValue={a.name}>{a.name}</ListBox.Item>
                            ))}
                          </ListBox>
                        </Select.Popover>
                      </Select>
                    </div>
                  )}
                />
              )}

              <Controller
                name="notes"
                control={control}
                render={({ field }) => (
                  <div className="flex flex-col gap-1">
                    <Label className="text-xs">Notas (opcional)</Label>
                    <TextArea {...field} placeholder="Observações..." rows={2} />
                  </div>
                )}
              />

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onPress={onClose} type="button" size="sm" className="border-none">Cancelar</Button>
                <Button variant="primary" type="submit" isDisabled={isSubmitting} size="sm">
                  {isSubmitting ? 'Criando...' : 'Criar'}
                </Button>
              </div>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
