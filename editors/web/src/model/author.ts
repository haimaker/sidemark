/**
 * The author string (SPEC §6.4 Author, §10): asked for once, remembered in
 * localStorage (see `prefs.ts`).
 */
import {readPref, writePref} from './prefs'

const KEY = 'sidemark.author'

export function loadAuthor(storage?: Pick<Storage, 'getItem'> | null): string {
  return readPref(KEY, storage)?.trim() ?? ''
}

export function saveAuthor(author: string, storage?: Pick<Storage, 'setItem'> | null): void {
  writePref(KEY, author, storage)
}

/** Collapse whitespace, as core does when writing the Author cell. */
export function normaliseAuthor(input: string): string {
  return input.replace(/\s+/g, ' ').trim()
}

/**
 * The recommended `@handle` form (§6.4) for a single bare word, so the UI
 * can offer it; `null` when the input already has that form or is not a
 * single word.
 */
export function suggestHandle(input: string): string | null {
  const author = normaliseAuthor(input)
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(author) ? `@${author}` : null
}

/** Emails are discouraged as authors in shared documents (SPEC §12). */
export function looksLikeEmail(author: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(author)
}
