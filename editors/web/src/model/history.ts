/**
 * The editor's whole document state is one source string. Every comment
 * operation produces a new string; history is the list of strings.
 */

export interface History {
  /** Source strings, oldest first. */
  readonly entries: readonly string[]
  /** Index of the current entry. */
  readonly index: number
  /** The source as last opened or saved, for the unsaved-changes indicator. */
  readonly saved: string
}

const LIMIT = 200

export function createHistory(source: string): History {
  return {entries: [source], index: 0, saved: source}
}

export function current(history: History): string {
  return history.entries[history.index]!
}

/** Record a new source. Drops any redo entries. No-op if nothing changed. */
export function commit(history: History, source: string): History {
  if (source === current(history)) return history
  const entries = [...history.entries.slice(0, history.index + 1), source]
  const overflow = Math.max(0, entries.length - LIMIT)
  return {entries: entries.slice(overflow), index: entries.length - 1 - overflow, saved: history.saved}
}

export function canUndo(history: History): boolean {
  return history.index > 0
}

export function canRedo(history: History): boolean {
  return history.index < history.entries.length - 1
}

export function undo(history: History): History {
  return canUndo(history) ? {...history, index: history.index - 1} : history
}

export function redo(history: History): History {
  return canRedo(history) ? {...history, index: history.index + 1} : history
}

export function markSaved(history: History, source: string): History {
  return {...history, saved: source}
}

export function isDirty(history: History): boolean {
  return current(history) !== history.saved
}
