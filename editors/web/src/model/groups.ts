/**
 * How threads are grouped and shown (SPEC §10), derived from a parsed
 * document. Pure functions, no DOM.
 */
import type {Nodes} from 'mdast'
import type {CommentMarkDocument, SourceRange, Thread} from '@commentmark/core'
import type {Highlight} from '../body/render'

/** Pseudo highlight ID for the range of a comment being written. */
export const PENDING_ID = 'pending'

export interface ThreadGroups {
  /** Anchored threads to show beside the text, in document order. */
  anchored: Thread[]
  /** Orphaned threads (§8): shown in the "Detached" group with their Quote. */
  detached: Thread[]
  /** Document-level threads (§8). */
  document: Thread[]
  /** Resolved threads currently hidden, per group. */
  hiddenResolved: {anchored: number; detached: number; document: number; total: number}
}

export function groupThreads(doc: CommentMarkDocument, showResolved: boolean): ThreadGroups {
  const anchored: Thread[] = []
  const detached: Thread[] = []
  const document: Thread[] = []
  const hiddenResolved = {anchored: 0, detached: 0, document: 0, total: 0}
  for (const thread of doc.threads) {
    const kind = thread.attachment.kind === 'orphaned' ? 'detached' : thread.attachment.kind
    if (thread.state === 'resolved' && !showResolved) {
      hiddenResolved[kind]++
      hiddenResolved.total++
      continue
    }
    ;({anchored, detached, document})[kind].push(thread)
  }
  anchored.sort((a, b) => rangeOf(a)!.start - rangeOf(b)!.start || rangeOf(a)!.end - rangeOf(b)!.end)
  return {anchored, detached, document, hiddenResolved}
}

/** Source range of an anchored thread's commented text, else `null`. */
export function rangeOf(thread: Thread): SourceRange | null {
  return thread.attachment.kind === 'anchored' ? thread.attachment.range : null
}

/** Highlights for the visible anchored threads, plus the pending selection. */
export function highlightsFor(groups: ThreadGroups, pending: SourceRange | null): Highlight[] {
  const highlights: Highlight[] = groups.anchored.map((t) => ({id: t.id, range: rangeOf(t)!}))
  if (pending) highlights.push({id: PENDING_ID, range: pending})
  return highlights
}

/**
 * Body nodes the document view hides: the comments table and, per §10, a
 * default `Comments` heading directly above it. A renamed heading stays
 * visible (it is the author's text), although core leaves it out of the
 * text projection.
 */
export function hiddenNodes(doc: CommentMarkDocument): Set<Nodes> {
  const hidden = new Set<Nodes>()
  if (!doc.table) return hidden
  hidden.add(doc.table.node)
  // The pointer to the specification (§6.7) is for people reading the raw file.
  if (doc.table.pointer) hidden.add(doc.table.pointer.node)
  const heading = doc.table.heading
  if (heading && heading.text.trim().toLowerCase() === 'comments') hidden.add(heading.node)
  return hidden
}

export interface PurgeCandidates {
  resolved: Thread[]
  orphaned: Thread[]
}

/** Threads that `purge` would remove for each option (§9.5). */
export function purgeCandidates(doc: CommentMarkDocument): PurgeCandidates {
  return {
    resolved: doc.threads.filter((t) => t.state === 'resolved'),
    orphaned: doc.threads.filter((t) => t.attachment.kind === 'orphaned')
  }
}

/** Number of distinct threads removed by a purge with these options. */
export function purgeCount(candidates: PurgeCandidates, options: {resolved: boolean; orphaned: boolean}): number {
  const ids = new Set<string>()
  if (options.resolved) for (const t of candidates.resolved) ids.add(t.id)
  if (options.orphaned) for (const t of candidates.orphaned) ids.add(t.id)
  return ids.size
}

/**
 * Short display text for a thread's quote: the anchored text when it is
 * anchored, else the Quote cell's quote (§7.3).
 */
export function quoteText(thread: Thread): string {
  if (thread.attachment.kind === 'anchored') return thread.attachment.text
  return thread.quote?.quote ?? ''
}
