import {useLayoutEffect, useRef} from 'preact/hooks'
import type {TableCell} from 'mdast'
import type {Comment, SidemarkDocument} from '@sidemark/core'
import {renderCell} from '../body/render'

/** Index of the Comment column (SPEC §6.1: Ref, Quote, Author, Date, Comment, Status). */
const COMMENT_COLUMN = 4

/**
 * A comment's text, rendered from the GFM parse of its table cell: inline
 * Markdown only, links sanitised, raw HTML shown as text (SPEC §12).
 */
export function CellView({comment, doc}: {comment: Comment; doc: SidemarkDocument}) {
  const ref = useRef<HTMLDivElement>(null)
  const cell = comment.row.node.children[COMMENT_COLUMN] as TableCell | undefined
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (cell) el.replaceChildren(renderCell(el.ownerDocument, cell, doc))
    else el.textContent = comment.comment
  }, [cell, doc, comment])
  return <div class="comment-text" ref={ref} />
}
