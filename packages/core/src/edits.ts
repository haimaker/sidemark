/**
 * Every write in this library is a list of splices applied to the original
 * source. Nothing is ever re-serialised from a syntax tree (§9.1), so bytes
 * outside the edited ranges are preserved exactly.
 */

export interface Edit {
  start: number
  end: number
  text: string
}

export function insertion(at: number, text: string): Edit {
  return {start: at, end: at, text}
}

export function deletion(start: number, end: number): Edit {
  return {start, end, text: ''}
}

/**
 * Apply non-overlapping edits. Insertions at the same offset keep the order
 * in which they were given.
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = edits
    .map((edit, index) => ({edit, index}))
    .sort((a, b) => a.edit.start - b.edit.start || a.edit.end - b.edit.end || a.index - b.index)
  let out = ''
  let cursor = 0
  for (const {edit} of ordered) {
    if (edit.start < cursor || edit.end < edit.start || edit.end > source.length) {
      throw new Error(`Internal error: overlapping or invalid edit [${edit.start}, ${edit.end})`)
    }
    out += source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return out + source.slice(cursor)
}
