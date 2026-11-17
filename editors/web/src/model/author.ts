/**
 * The author string (SPEC §6.4 Author, §10): asked for once, remembered in
 * localStorage. Storage can be unavailable (private windows, blocked site
 * data), so every access is wrapped and failure just means "not remembered".
 */

const KEY = 'sidemark.author'

export function loadAuthor(storage: Pick<Storage, 'getItem'> | null = safeStorage()): string {
  try {
    return storage?.getItem(KEY)?.trim() ?? ''
  } catch {
    return ''
  }
}

export function saveAuthor(author: string, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, author)
  } catch {
    // Not remembered; the editor still works for this session.
  }
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

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}
