import { create } from 'zustand'
import { apiFetch } from '@/lib/api'
import type { Appointment, AppointmentStatus } from '@/types/appointment'

interface CreateAppointmentData {
  assistantId?: string | null
  clientName: string
  clientEmail?: string
  clientPhone: string
  dateTime: string
  durationMinutes?: number
  appointmentType?: string
  notes?: string
  isManual?: boolean
}

interface UpdateAppointmentData {
  status?: AppointmentStatus
  dateTime?: string
  notes?: string
  durationMinutes?: number
  appointmentType?: string
}

function mapApiAppointment(a: Record<string, unknown>): Appointment {
  return {
    id: a.id as string,
    assistantId: (a.assistant_id ?? a.assistantId ?? null) as string | null,
    clientName: (a.client_name ?? a.clientName ?? '') as string,
    clientEmail: (a.client_email ?? a.clientEmail ?? '') as string,
    clientPhone: (a.client_phone ?? a.clientPhone ?? '') as string,
    dateTime: (a.date_time ?? a.dateTime ?? '') as string,
    durationMinutes: (a.duration_minutes ?? a.durationMinutes ?? 30) as number,
    appointmentType: (a.appointment_type ?? a.appointmentType ?? '') as string,
    notes: (a.notes ?? '') as string,
    originChannel: (a.origin_channel ?? a.originChannel ?? '') as string,
    status: (a.status ?? 'pending') as AppointmentStatus,
    conversationId: (a.conversation_id ?? a.conversationId) as string | undefined,
    isManual: (a.is_manual ?? a.isManual ?? false) as boolean,
    createdAt: (a.created_at ?? a.createdAt ?? '') as string,
    updatedAt: (a.updated_at ?? a.updatedAt ?? '') as string,
    meetingId: (a.meeting_id ?? a.meetingId ?? null) as string | null,
    meetingCode: (a.meeting_code ?? a.meetingCode ?? null) as string | null,
    meetingUrl: (a.meeting_url ?? a.meetingUrl ?? null) as string | null,
  }
}

interface CalendarState {
  appointments: Appointment[]
  isLoading: boolean
  selectedAssistantId: string | null
  fetch: () => Promise<void>
  create: (data: CreateAppointmentData) => Promise<Appointment>
  update: (id: string, data: UpdateAppointmentData) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setFilter: (assistantId: string | null) => void
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  appointments: [],
  isLoading: false,
  selectedAssistantId: null,

  fetch: async () => {
    set({ isLoading: true })
    try {
      const data = await apiFetch<Record<string, unknown>[]>('/api/appointments')
      set({ appointments: data.map(mapApiAppointment) })
    } catch (e) {
      console.error('Failed to fetch appointments', e)
    } finally {
      set({ isLoading: false })
    }
  },

  create: async (data) => {
    const body = {
      assistant_id: data.assistantId || null,
      client_name: data.clientName,
      client_email: data.clientEmail || null,
      client_phone: data.clientPhone,
      date_time: data.dateTime,
      duration_minutes: data.durationMinutes ?? 30,
      appointment_type: data.appointmentType || null,
      notes: data.notes || null,
      is_manual: data.isManual ?? true,
    }
    const result = await apiFetch<Record<string, unknown>>('/api/appointments', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const appointment = mapApiAppointment(result)
    set({ appointments: [appointment, ...get().appointments] })
    return appointment
  },

  update: async (id, data) => {
    const body: Record<string, unknown> = {}
    if (data.status) body.status = data.status
    if (data.dateTime) body.date_time = data.dateTime
    if (data.notes !== undefined) body.notes = data.notes
    if (data.durationMinutes) body.duration_minutes = data.durationMinutes
    if (data.appointmentType) body.appointment_type = data.appointmentType

    const result = await apiFetch<Record<string, unknown>>(`/api/appointments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
    const updated = mapApiAppointment(result)
    set({
      appointments: get().appointments.map(a => a.id === id ? updated : a),
    })
  },

  cancel: async (id) => {
    await apiFetch<Record<string, unknown>>(`/api/appointments/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'cancelled' }),
    })
    set({
      appointments: get().appointments.map(a =>
        a.id === id ? { ...a, status: 'cancelled' as AppointmentStatus } : a
      ),
    })
  },

  remove: async (id) => {
    await apiFetch(`/api/appointments/${id}`, { method: 'DELETE' })
    set({ appointments: get().appointments.filter(a => a.id !== id) })
  },

  setFilter: (assistantId) => {
    set({ selectedAssistantId: assistantId })
  },
}))
