'use client'

import React, { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Input, Switch, TextField, Label, Select, ListBox, Button } from '@heroui/react'
import { Plus, X } from 'lucide-react'
import { apiFetch } from '@/lib/api'
import type { AvailabilityConfig, TimeSlot } from '@/types/appointment'

interface Props {
  assistantId: string
  shareToken?: string
}

export interface AvailabilityConfigRef {
  save: () => Promise<void>
}

const DAYS = [
  { key: 'monday', label: 'Segunda' },
  { key: 'tuesday', label: 'Terça' },
  { key: 'wednesday', label: 'Quarta' },
  { key: 'thursday', label: 'Quinta' },
  { key: 'friday', label: 'Sexta' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' },
]

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Bahia',
  'America/Recife',
  'America/Fortaleza',
  'America/Belem',
  'America/Cuiaba',
  'America/Porto_Velho',
  'America/Rio_Branco',
  'America/Noronha',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'UTC',
]

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120]

type DaySchedule = Record<string, TimeSlot[]>

export const AvailabilityConfigPanel = forwardRef<AvailabilityConfigRef, Props>(
  function AvailabilityConfigPanel({ assistantId, shareToken }, ref) {
  const qs = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : ''

  const [loading, setLoading] = useState(true)
  const [hasConfig, setHasConfig] = useState(false)

  const [timezone, setTimezone] = useState('America/Sao_Paulo')
  const [defaultDuration, setDefaultDuration] = useState(30)
  const [bufferMinutes, setBufferMinutes] = useState(0)
  const [maxPerDay, setMaxPerDay] = useState(0)
  const [blockedDates, setBlockedDates] = useState<string[]>([])
  const [schedule, setSchedule] = useState<DaySchedule>({})
  const [newBlockedDate, setNewBlockedDate] = useState('')

  const fetchConfig = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch<AvailabilityConfig | null>(`/api/assistants/${assistantId}/availability${qs}`)
      if (data) {
        setHasConfig(true)
        setTimezone(data.timezone || 'America/Sao_Paulo')
        setDefaultDuration(data.defaultDurationMinutes || 30)
        setBufferMinutes(data.bufferMinutes || 0)
        setMaxPerDay(data.maxPerDay || 0)
        setBlockedDates(data.blockedDates || [])
        setSchedule(data.schedule || {})
      }
    } catch {
      // No config yet
    } finally {
      setLoading(false)
    }
  }, [assistantId, qs])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  const handleSave = useCallback(async () => {
    await apiFetch(`/api/assistants/${assistantId}/availability${qs}`, {
      method: 'PUT',
      body: JSON.stringify({
        timezone,
        default_duration_minutes: defaultDuration,
        buffer_minutes: bufferMinutes,
        max_per_day: maxPerDay,
        blocked_dates: blockedDates,
        schedule,
      }),
    })
    setHasConfig(true)
  }, [assistantId, qs, timezone, defaultDuration, bufferMinutes, maxPerDay, blockedDates, schedule])

  useImperativeHandle(ref, () => ({
    save: handleSave,
  }), [handleSave])

  const toggleDay = (day: string) => {
    setSchedule(prev => {
      const copy = { ...prev }
      if (copy[day] && copy[day].length > 0) {
        delete copy[day]
      } else {
        copy[day] = [{ start: '08:00', end: '18:00' }]
      }
      return copy
    })
  }

  const addSlot = (day: string) => {
    setSchedule(prev => ({
      ...prev,
      [day]: [...(prev[day] || []), { start: '08:00', end: '18:00' }],
    }))
  }

  const removeSlot = (day: string, index: number) => {
    setSchedule(prev => {
      const slots = [...(prev[day] || [])]
      slots.splice(index, 1)
      if (slots.length === 0) {
        const copy = { ...prev }
        delete copy[day]
        return copy
      }
      return { ...prev, [day]: slots }
    })
  }

  const updateSlot = (day: string, index: number, field: 'start' | 'end', value: string) => {
    setSchedule(prev => {
      const slots = [...(prev[day] || [])]
      slots[index] = { ...slots[index], [field]: value }
      return { ...prev, [day]: slots }
    })
  }

  const addBlockedDate = () => {
    if (newBlockedDate && !blockedDates.includes(newBlockedDate)) {
      setBlockedDates(prev => [...prev, newBlockedDate].sort())
      setNewBlockedDate('')
    }
  }

  const removeBlockedDate = (date: string) => {
    setBlockedDates(prev => prev.filter(d => d !== date))
  }

  if (loading) {
    return <p className="text-xs text-muted py-2">Carregando configuração...</p>
  }

  return (
    <div className="flex flex-col gap-4 border-t border-dim pt-4 mt-1">
      <div>
        <p className="text-sm font-medium text-foreground">Configurar Disponibilidade</p>
        <p className="text-xs text-muted mt-0.5">
          {hasConfig
            ? 'O agente validará horários conforme sua disponibilidade.'
            : 'Opcional — sem configuração, o agente aceita qualquer horário (agenda aberta).'}
        </p>
      </div>

      {/* Timezone */}
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Fuso horário</Label>
        <Select
          className="w-full"
          selectedKey={timezone}
          onSelectionChange={(key) => setTimezone(key as string)}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {TIMEZONES.map(tz => (
                <ListBox.Item key={tz} id={tz} textValue={tz}>{tz.replace(/_/g, ' ')}</ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      {/* Duration + Buffer + Max */}
      <div className="grid grid-cols-3 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">Duração padrão</Label>
          <Select
            selectedKey={String(defaultDuration)}
            onSelectionChange={(key) => setDefaultDuration(Number(key))}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {DURATION_OPTIONS.map(d => (
                  <ListBox.Item key={String(d)} id={String(d)} textValue={`${d} min`}>{d} min</ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <TextField>
          <Label className="text-xs">Intervalo (min)</Label>
          <Input
            type="number"
            value={String(bufferMinutes)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBufferMinutes(Number(e.target.value))}
            placeholder="0"
          />
        </TextField>

        <TextField>
          <Label className="text-xs">Máx/dia</Label>
          <Input
            type="number"
            value={String(maxPerDay)}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxPerDay(Number(e.target.value))}
            placeholder="0 = ilimitado"
          />
        </TextField>
      </div>

      {/* Weekly schedule */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs">Horários por dia</Label>
        <div className="flex flex-col gap-1.5">
          {DAYS.map(day => {
            const isActive = schedule[day.key] && schedule[day.key].length > 0
            const slots = schedule[day.key] || []
            return (
              <div key={day.key} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <Switch
                    isSelected={isActive}
                    onChange={(isChecked: React.ChangeEvent<HTMLInputElement> | boolean) => {
                      toggleDay(day.key)
                    }}
                  >
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                  <span className={`text-xs font-medium ${isActive ? 'text-foreground' : 'text-muted'}`}>
                    {day.label}
                  </span>
                  {isActive && (
                    <button
                      type="button"
                      className="text-muted hover:text-foreground ml-auto"
                      onClick={() => addSlot(day.key)}
                    >
                      <Plus size={12} />
                    </button>
                  )}
                </div>
                {isActive && slots.map((slot, i) => (
                  <div key={i} className="flex items-center gap-1.5 ml-8">
                    <input
                      type="time"
                      value={slot.start}
                      onChange={(e) => updateSlot(day.key, i, 'start', e.target.value)}
                      className="bg-raised rounded px-2 py-1 text-xs text-foreground w-24"
                    />
                    <span className="text-xs text-muted">—</span>
                    <input
                      type="time"
                      value={slot.end}
                      onChange={(e) => updateSlot(day.key, i, 'end', e.target.value)}
                      className="bg-raised rounded px-2 py-1 text-xs text-foreground w-24"
                    />
                    {slots.length > 1 && (
                      <button
                        type="button"
                        className="text-muted hover:text-red-400"
                        onClick={() => removeSlot(day.key, i)}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Blocked dates */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Datas bloqueadas / feriados</Label>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={newBlockedDate}
            onChange={(e) => setNewBlockedDate(e.target.value)}
            className="bg-raised rounded px-2 py-1 text-xs text-foreground flex-1"
          />
          <Button size="sm" variant="secondary" onPress={addBlockedDate} isDisabled={!newBlockedDate}>
            <Plus size={12} />
          </Button>
        </div>
        {blockedDates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {blockedDates.map(date => (
              <span
                key={date}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/10 text-red-400 text-[11px] font-medium"
              >
                {date.split('-').reverse().join('/')}
                <button onClick={() => removeBlockedDate(date)} className="hover:text-red-300">
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})
