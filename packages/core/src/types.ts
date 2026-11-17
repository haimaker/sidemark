/**
 * Public data model returned by `parse()`.
 *
 * All offsets are UTF-16 code unit indexes into the original source string
 * (the same unit as JavaScript string indexes), half-open: `[start, end)`.
 */
import type {Heading, Root, Table, TableRow as MdastTableRow} from 'mdast'
import type {SourceMapper} from './source-map.js'
import type {TextProjection} from './projection.js'

export interface SourceRange {
  start: number
  end: number
}

/** A thread's state (§6.4 Status). */
export type ThreadState = 'open' | 'resolved'

/** Recognised Status values (§6.4). Anything else is preserved but ignored. */
export type StatusValue = 'open' | 'resolved'

/** Why an anchor is stray (§5.5). See `fixtures/README.md` for exact definitions. */
export type StrayReason =
  | 'unknown-thread'
  | 'empty'
  | 'unmatched'
  | 'duplicate'

/** One recognised anchor element in the body (§5.1). */
export interface Anchor {
  /** Thread ID, without any `-end` suffix. */
  threadId: string
  /** `true` for an end anchor (`id="c-…-end"`). */
  isEnd: boolean
  /** Source range of the whole element, `<a …>` through `</a>`. */
  range: SourceRange
  /** The element exactly as written in the source. */
  raw: string
  /** `null` when the anchor is part of a thread's valid pair. */
  stray: StrayReason | null
}

/** Prefix, quote and suffix read from a Quote cell (§7.3), whitespace collapsed. */
export interface ParsedQuote {
  prefix: string
  quote: string
  suffix: string
  /** How the quote was marked in the cell. */
  marker: 'strong' | 'html' | 'none'
}

export type Attachment =
  | {
      kind: 'anchored'
      /** `anchors`: a valid anchor pair (§8 step 1). `quote`: the fallback (§8 step 3). */
      via: 'anchors' | 'quote'
      /**
       * Source range of the commented content. For `anchors` this is the
       * source between the end of the start anchor and the start of the end
       * anchor. For `quote` it runs from the first to the last source
       * character of the matched text.
       */
      range: SourceRange
      /** Text projection (§7.1) of the range, trimmed. */
      text: string
    }
  | {kind: 'orphaned'}
  | {kind: 'document'}

export interface ParsedDate {
  /** Cell text, trimmed. */
  raw: string
  /** Parsed instant, or `null` when the cell is empty or unparseable. */
  value: Date | null
}

export interface ParsedStatus {
  /** Cell text, trimmed, exactly as written. */
  raw: string
  /** `open` / `resolved` when recognised (ASCII case-insensitive), else `null`. */
  value: StatusValue | null
}

/** A cell of a comments table row. */
export interface Cell {
  /** Range between the delimiting pipes (or line edges). */
  range: SourceRange
  /** `range` with surrounding whitespace removed. */
  contentRange: SourceRange
  /** Source of `contentRange`. */
  source: string
}

/** A body row of the comments table. */
export interface Row {
  /** Index among the table's body rows (0 = first row after the delimiter row). */
  index: number
  /** Range of the row's text on its line (no line ending). */
  range: SourceRange
  cells: Cell[]
  node: MdastTableRow
  /** Thread ID from a valid Ref cell (§6.4), or `null` for a malformed row (§6.5). */
  threadId: string | null
}

export interface Comment {
  threadId: string
  /** Position within the thread; 0 is the root. */
  index: number
  row: Row
  /** Author cell as plain text, trimmed (§6.4). Empty means unknown. */
  author: string
  date: ParsedDate
  /**
   * The comment as Markdown suitable for an edit box: table pipe escapes
   * removed and each `<br>` turned into a newline.
   */
  comment: string
  /** The Comment cell's source exactly as written (trimmed). */
  commentSource: string
  status: ParsedStatus
  /** Raw source of cells after the sixth column (§6.6). */
  extraCells: string[]
}

export interface Thread {
  id: string
  comments: Comment[]
  /** §6.4: last recognised non-empty Status, defaulting to `open`. */
  state: ThreadState
  attachment: Attachment
  /** Root row's Quote cell, parsed (§7.3). `null` when the cell is empty. */
  quote: ParsedQuote | null
  /** The valid anchor pair (§5.5), if any. */
  anchors: {start: Anchor; end: Anchor} | null
}

export interface CommentsTable {
  node: Table
  range: SourceRange
  /** The heading immediately above the table, if any (§6.2). */
  heading: {node: Heading; range: SourceRange; text: string} | null
  /** Header cell texts, trimmed, in order (may have more than six). */
  columns: string[]
  rows: Row[]
}

export interface SidemarkDocument {
  source: string
  /**
   * mdast tree of everything after the BOM and front matter, with positions
   * expressed as offsets into `source`. Includes the comments table.
   */
  root: Root
  /** Offset where Markdown parsing starts (after a BOM and front matter). */
  bodyStart: number
  frontMatter: SourceRange | null
  /** The comments table (§6.1), or `null` if the document has none. */
  table: CommentsTable | null
  /** Threads in table order (order of each thread's first row). */
  threads: Thread[]
  /** Every recognised anchor in the body, in document order. */
  anchors: Anchor[]
  /** The subset of `anchors` that are stray (§5.5). */
  strayAnchors: Anchor[]
  /** Body rows of the comments table without a valid Ref cell (§6.5). */
  malformedRows: Row[]
  /** Text projection of the body (§7.1) with a source map. */
  projection: TextProjection
  /** Maps between characters of mdast text nodes and source offsets. */
  sourceMap: SourceMapper
  /** The line ending the document uses most (`\n` when it has none). */
  lineEnding: string
}
