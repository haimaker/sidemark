export type SidemarkErrorCode =
  /** The requested range is out of bounds, empty, or outside the body. */
  | 'INVALID_RANGE'
  /** No anchor placement could be found that leaves the body parsing unchanged. */
  | 'UNSAFE_PLACEMENT'
  /** An edit would have produced a document that does not read back as intended. */
  | 'UNSAFE_EDIT'
  | 'THREAD_NOT_FOUND'
  | 'COMMENT_NOT_FOUND'
  /** A row would have both Comment and Status empty (§6.4). */
  | 'EMPTY_COMMENT'
  /** An injected ID generator returned something that is not a thread ID. */
  | 'INVALID_ID'
  /** The ID generator kept returning IDs that already appear in the document. */
  | 'ID_COLLISION'
  | 'INVALID_DATE'
  /** Any other invalid argument, such as an unknown status. */
  | 'INVALID_ARGUMENT'

/** Every error thrown on purpose by this library. Check `code`. */
export class SidemarkError extends Error {
  readonly code: SidemarkErrorCode

  constructor(code: SidemarkErrorCode, message: string) {
    super(message)
    this.name = 'SidemarkError'
    this.code = code
  }
}

/** Thrown by `createThread` (and skipped by `maintain`) when anchors cannot be placed safely. */
export class PlacementError extends SidemarkError {
  constructor(message: string) {
    super('UNSAFE_PLACEMENT', message)
    this.name = 'PlacementError'
  }
}
