/**
 * Light and dark themes. With no stored choice the page follows the
 * operating system (`color-scheme: light dark` in styles.css). A choice made
 * with the toolbar toggle is remembered in this browser and pins the scheme
 * through a `data-theme` attribute on the root element.
 */
import {readPref, writePref, type PrefStorage} from './prefs'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'commentmark.theme'

export function storedTheme(storage?: Pick<Storage, 'getItem'> | null): Theme | null {
  const value = storage === undefined ? readPref(THEME_KEY) : readPref(THEME_KEY, storage)
  return value === 'light' || value === 'dark' ? value : null
}

export function saveTheme(theme: Theme, storage?: PrefStorage | null): void {
  if (storage === undefined) writePref(THEME_KEY, theme)
  else writePref(THEME_KEY, theme, storage)
}

export function systemTheme(): Theme {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Pin the page to `theme`, or follow the system when it is null. */
export function applyTheme(theme: Theme | null, root: HTMLElement = document.documentElement): void {
  if (theme) root.dataset.theme = theme
  else delete root.dataset.theme
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark'
}
