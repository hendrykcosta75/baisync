import { describe, it, expect, beforeEach } from 'vitest'
import { useThemeStore } from '@/store/useThemeStore'

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'dark' })
  })

  it('defaults to dark theme', () => {
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('toggleTheme switches from dark to light', () => {
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')
    expect(localStorage.getItem('theme')).toBe('light')
  })

  it('toggleTheme switches from light to dark', () => {
    useThemeStore.setState({ theme: 'light' })
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
  })

  it('toggleTheme twice returns to original theme', () => {
    useThemeStore.getState().toggleTheme()
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })
})
