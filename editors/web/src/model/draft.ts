/**
 * The new-comment box that follows the selection.
 *
 * - A valid, non-empty selection in the body shows a box beside it, without
 *   taking focus (so the selection stays and copy still works).
 * - Focusing the box *engages* it: it then stays when the selection goes
 *   away, and its range is highlighted in the body instead.
 * - A box that has draft text is never replaced or dropped by selection
 *   changes; only Cancel, Escape or submitting removes it.
 * - An unengaged, empty box follows the selection and disappears with it.
 *
 * Pure functions; the app holds a `Draft | null` in state.
 */
import type {SourceRange} from '@commentmark/core'

export interface Draft {
  /** Source range the comment is for, in the current source. */
  range: SourceRange
  /** Why core refuses this range (shown instead of an input), or `null`. */
  error: string | null
  /** The box has been focused; it no longer follows or disappears with the selection. */
  engaged: boolean
  /** Draft text. */
  text: string
  /** The document changed so that `range` could not be mapped; select the text again. */
  stale: boolean
}

/** Holds onto the person's work: the box keeps its text whatever the selection does. */
export function hasText(draft: Draft | null): boolean {
  return draft !== null && draft.text.trim() !== ''
}

/**
 * The draft after the body selection changed to `selection` (`null` when it
 * was cleared or left the body). `check` returns core's refusal message for
 * a range, or `null`; it is only called for a range the box will adopt.
 */
export function followSelection(
  draft: Draft | null,
  selection: SourceRange | null,
  check: (range: SourceRange) => string | null
): Draft | null {
  if (!selection) {
    if (!draft) return null
    return draft.engaged || hasText(draft) ? draft : null
  }
  if (draft && sameRange(draft.range, selection) && !draft.stale) return draft
  if (hasText(draft) && !draft!.stale) return draft
  // A stale draft keeps its text and moves to the new selection.
  const text = draft?.stale ? draft.text : ''
  return {range: selection, error: check(selection), engaged: false, text, stale: false}
}

/**
 * Map a range in `before` to the same text in `after`, when the two differ
 * by one contiguous change outside the range (the common case: a row added
 * to the comments table, or anchors added or removed elsewhere before or
 * after it). Returns `null` when the change touches the range.
 */
export function mapRange(before: string, after: string, range: SourceRange): SourceRange | null {
  if (before === after) return range
  const max = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++
  let suffix = 0
  while (
    suffix < max - prefix &&
    before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix++
  }
  const changeEnd = before.length - suffix
  const delta = after.length - before.length
  if (range.end <= prefix) return range
  if (range.start >= changeEnd) return {start: range.start + delta, end: range.end + delta}
  return null
}

export function sameRange(a: SourceRange, b: SourceRange): boolean {
  return a.start === b.start && a.end === b.end
}
