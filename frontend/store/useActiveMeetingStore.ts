import { create } from 'zustand'

export interface ActiveMeeting {
  meetingId: string
  code: string
  title: string
  token: string
  livekitUrl: string
  isHost: boolean
  isGuest: boolean
  displayName: string
  audioEnabled: boolean
  videoEnabled: boolean
}

interface ActiveMeetingState {
  active: ActiveMeeting | null
  isMinimized: boolean
  start: (m: ActiveMeeting) => void
  stop: () => void
  minimize: () => void
  restore: () => void
  updateMediaPrefs: (patch: Partial<Pick<ActiveMeeting, 'audioEnabled' | 'videoEnabled'>>) => void
}

export const useActiveMeetingStore = create<ActiveMeetingState>((set, get) => ({
  active: null,
  isMinimized: false,

  start: (m) => set({ active: m, isMinimized: false }),

  stop: () => set({ active: null, isMinimized: false }),

  minimize: () => {
    if (!get().active) return
    set({ isMinimized: true })
  },

  restore: () => set({ isMinimized: false }),

  updateMediaPrefs: (patch) => {
    const current = get().active
    if (!current) return
    set({ active: { ...current, ...patch } })
  },
}))
