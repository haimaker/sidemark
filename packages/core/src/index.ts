/**
 * @sidemark/core — reference Reader and Writer for Sidemark, a convention for
 * storing comment threads inside Markdown files. See SPEC.md.
 */

// Reading
export {parse, getThread} from './parse.js'
export {
  indexAtOrAfter,
  projectionSpan,
  projectRange,
  sourceRangeOf,
  type TextProjection
} from './projection.js'
export {SourceMapper, type CharMap} from './source-map.js'
export {findQuote} from './resolve.js'

// Writing
export {
  createThread,
  addReply,
  setStatus,
  editComment,
  deleteComment,
  deleteThread,
  purge,
  type CommentRef,
  type CreateThreadInput,
  type NewComment,
  type PurgeOptions,
  type StatusChange,
  type WriterOptions
} from './writer.js'
export {maintain} from './maintain.js'

// Building blocks
export {anchorHtml} from './anchors.js'
export {buildQuote, readQuoteCell, writeQuoteCell, type QuoteParts} from './quote.js'
export {escapeCellMarkdown, commentFromCell} from './cells.js'
export {formatDate, parseDate} from './dates.js'
export {isThreadId, randomThreadId, THREAD_ID} from './ids.js'
export {SidemarkError, PlacementError, type SidemarkErrorCode} from './errors.js'

export type {
  Anchor,
  Attachment,
  Cell,
  Comment,
  CommentsTable,
  ParsedDate,
  ParsedQuote,
  ParsedStatus,
  Row,
  SidemarkDocument,
  SourceRange,
  StatusValue,
  StrayReason,
  Thread,
  ThreadState
} from './types.js'
