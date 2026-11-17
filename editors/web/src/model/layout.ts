/**
 * Margin layout: place thread cards beside their ranges without overlap,
 * the way Google Docs does.
 *
 * Each card wants to sit at the top of its range. Cards are stacked in order
 * of their desired top; a card that would overlap the one above is pushed
 * down. When a card is focused it gets exactly its desired top, cards below
 * it are pushed down from there, and cards above it are pushed *up* so the
 * focused card never moves away from its text.
 */

export interface CardBox {
  id: string
  /** Desired top (the top of the commented range), in px. */
  top: number
  /** Measured card height, in px. */
  height: number
}

export function layoutCards(cards: readonly CardBox[], focusedId: string | null, gap = 8): Map<string, number> {
  const sorted = [...cards].sort((a, b) => a.top - b.top)
  const tops = new Map<string, number>()
  const focus = focusedId === null ? -1 : sorted.findIndex((c) => c.id === focusedId)

  // Downwards from the focused card (or from the first card).
  let floor = -Infinity
  for (let i = Math.max(focus, 0); i < sorted.length; i++) {
    const card = sorted[i]!
    const top = i === focus ? card.top : Math.max(card.top, floor)
    tops.set(card.id, top)
    floor = top + card.height + gap
  }
  // Upwards from the focused card.
  if (focus > 0) {
    let ceiling = tops.get(sorted[focus]!.id)!
    for (let i = focus - 1; i >= 0; i--) {
      const card = sorted[i]!
      const top = Math.min(card.top, ceiling - gap - card.height)
      tops.set(card.id, top)
      ceiling = top
    }
  }
  return tops
}
