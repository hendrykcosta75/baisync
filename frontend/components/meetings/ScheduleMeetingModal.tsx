'use client'

import React from 'react'
import { Modal, Input, Label, TextField, Button } from '@heroui/react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMeetingStore } from '@/store/useMeetingStore'

interface Props {
  isOpen: boolean
  onClose: () => void
}

const schema = z.object({
  title: z.string().min(1, 'Título é obrigatório'),
  date: z.string().min(1, 'Data é obrigatória'),
  time: z.string().min(1, 'Horário é obrigatório'),
  linkExpiry: z.enum(['never', 'single_use', '24h', '7d']),
})

type FormData = z.infer<typeof schema>

export function ScheduleMeetingModal({ isOpen, onClose }: Props) {
  const schedule = useMeetingStore((s) => s.schedule)

  const defaultDate = new Date().toISOString().split('T')[0]
  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', date: defaultDate, time: '09:00', linkExpiry: 'never' },
  })

  const onSubmit = async (data: FormData) => {
    const dateTime = new Date(`${data.date}T${data.time}:00`).toISOString()
    try {
      await schedule({
        title: data.title,
        scheduledStart: dateTime,
        participantMode: 'workspace',
        linkExpiry: data.linkExpiry,
      })
      reset()
      onClose()
    } catch (e) {
      console.error('Failed to schedule meeting', e)
    }
  }

  return (
    <Modal>
      <Modal.Backdrop
        isOpen={isOpen}
        onOpenChange={(open: boolean) => {
          if (!open) onClose()
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[440px] w-full bg-overlay p-5 rounded-2xl shadow-xl flex flex-col gap-4">
            <h3 className="text-base font-semibold text-foreground">Agendar reunião</h3>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3">
              <Controller
                name="title"
                control={control}
                render={({ field }) => (
                  <TextField>
                    <Label className="text-xs">Título</Label>
                    <Input {...field} placeholder="Ex: Revisão trimestral" />
                    {errors.title && (
                      <p className="text-xs text-red-500 mt-0.5">{errors.title.message}</p>
                    )}
                  </TextField>
                )}
              />

              <div className="grid grid-cols-2 gap-2">
                <Controller
                  name="date"
                  control={control}
                  render={({ field }) => (
                    <TextField>
                      <Label className="text-xs">Data</Label>
                      <Input type="date" {...field} />
                      {errors.date && (
                        <p className="text-xs text-red-500 mt-0.5">{errors.date.message}</p>
                      )}
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
                      {errors.time && (
                        <p className="text-xs text-red-500 mt-0.5">{errors.time.message}</p>
                      )}
                    </TextField>
                  )}
                />
              </div>

              <Controller
                name="linkExpiry"
                control={control}
                render={({ field }) => (
                  <TextField>
                    <Label className="text-xs">Expiração do link</Label>
                    <select
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      className="w-full px-3 py-2 rounded-md bg-[#111] border border-[#222] text-sm text-foreground"
                    >
                      <option value="never">Sem expiração</option>
                      <option value="24h">24 horas</option>
                      <option value="7d">7 dias</option>
                      <option value="single_use">Uso único</option>
                    </select>
                  </TextField>
                )}
              />

              <div className="flex items-center justify-end gap-2 mt-2">
                <Button variant="ghost" onPress={onClose} isDisabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  isDisabled={isSubmitting}
                  className="bg-[#ff6b2c] hover:bg-[#ff8533] text-white"
                >
                  {isSubmitting ? 'Salvando…' : 'Agendar'}
                </Button>
              </div>
            </form>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
