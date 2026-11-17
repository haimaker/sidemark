import {describe, expect, it} from 'vitest'
import {applyTheme, otherTheme, saveTheme, storedTheme, THEME_KEY} from '../src/model/theme'

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  }
}

describe('theme', () => {
  it('has no stored theme until one is chosen, then remembers it', () => {
    const storage = memoryStorage()
    expect(storedTheme(storage)).toBeNull()
    saveTheme('dark', storage)
    expect(storage.getItem(THEME_KEY)).toBe('dark')
    expect(storedTheme(storage)).toBe('dark')
  })

  it('ignores a stored value that is not a theme', () => {
    expect(storedTheme(memoryStorage({[THEME_KEY]: 'sepia'}))).toBeNull()
  })

  it('treats unavailable or throwing storage as no choice', () => {
    expect(storedTheme(null)).toBeNull()
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      }
    }
    expect(storedTheme(broken)).toBeNull()
  })

  it('pins the root element to a theme, and releases it to follow the system', () => {
    // Only `dataset` is touched, so a plain object stands in for the element.
    const root = {dataset: {} as Record<string, string>} as unknown as HTMLElement
    applyTheme('dark', root)
    expect(root.dataset.theme).toBe('dark')
    applyTheme('light', root)
    expect(root.dataset.theme).toBe('light')
    applyTheme(null, root)
    expect('theme' in root.dataset).toBe(false)
  })

  it('toggles between the two themes', () => {
    expect(otherTheme('light')).toBe('dark')
    expect(otherTheme('dark')).toBe('light')
  })
})
