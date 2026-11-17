/**
 * Per-browser preferences in localStorage. Storage can be unavailable
 * (private windows, blocked site data) or throw, so every access is wrapped
 * and failure just means "not remembered".
 */

export type PrefStorage = Pick<Storage, 'getItem' | 'setItem'>

export function readPref(key: string, storage: Pick<Storage, 'getItem'> | null = defaultStorage()): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function writePref(key: string, value: string, storage: Pick<Storage, 'setItem'> | null = defaultStorage()): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Not remembered; the editor still works for this session.
  }
}

export const INTRO_DISMISSED = 'commentmark.introDismissed'

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
