import {SidemarkError} from '@sidemark/core'

/** A short, user-facing explanation of a failed core operation. */
export function describeError(error: unknown): string {
  if (error instanceof SidemarkError) {
    switch (error.code) {
      case 'INVALID_RANGE':
        return 'That selection can’t be commented on. Select text in the body of the document.'
      case 'UNSAFE_PLACEMENT':
        return 'A comment can’t be anchored to exactly that selection without changing how the Markdown renders. Try selecting a slightly larger or smaller range.'
      case 'EMPTY_COMMENT':
        return 'Write a comment first.'
      case 'THREAD_NOT_FOUND':
      case 'COMMENT_NOT_FOUND':
        return 'That comment no longer exists in the file.'
      case 'UNSAFE_EDIT':
        return 'The change was cancelled because the file would not read back as expected.'
      default:
        return error.message
    }
  }
  return error instanceof Error ? error.message : String(error)
}
