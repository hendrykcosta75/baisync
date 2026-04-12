export type AppointmentStatus = 'confirmed' | 'pending' | 'cancelled' | 'rescheduled' | 'completed' | 'no_show'

export interface Appointment {
  id: string
  assistantId: string | null
  clientName: string
  clientEmail: string
  clientPhone: string
  dateTime: string
  durationMinutes: number
  appointmentType: string
  notes: string
  originChannel: string
  status: AppointmentStatus
  conversationId?: string
  isManual: boolean
  createdAt: string
  updatedAt: string
}

export interface AvailabilityConfig {
  assistantId: string
  timezone: string
  defaultDurationMinutes: number
  bufferMinutes: number
  maxPerDay: number
  blockedDates: string[]
  schedule: Record<string, { start: string; end: string }[]>
}

export interface TimeSlot {
  start: string
  end: string
}
