import { create } from 'zustand'

interface ErrorState {
  isOpen: boolean
  title: string
  message: string
  showError: (message: string, title?: string) => void
  close: () => void
}

export const useErrorStore = create<ErrorState>((set) => ({
  isOpen: false,
  title: 'Erro',
  message: '',
  showError: (message: string, title = 'Erro') => set({ isOpen: true, title, message }),
  close: () => set({ isOpen: false, title: 'Erro', message: '' }),
}))
