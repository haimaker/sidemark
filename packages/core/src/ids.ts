/** Thread IDs (§4). */

/** §4: `c-` and 1 to 32 characters from `0-9a-z`. */
export const THREAD_ID = /^c-[0-9a-z]{1,32}$/

/** §4: a thread ID is `c-[0-9a-z]{1,32}`, everywhere (anchors, Ref cells). */
export function isThreadId(value: string): boolean {
  return THREAD_ID.test(value)
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** A new random ID: `c-` and 6 characters chosen uniformly from `0-9a-z` (§4). */
export function randomThreadId(): string {
  let id = 'c-'
  const bytes = new Uint8Array(1)
  while (id.length < 8) {
    crypto.getRandomValues(bytes)
    // Rejection sampling keeps the choice uniform: 252 = 7 × 36.
    if (bytes[0]! < 252) id += ALPHABET[bytes[0]! % 36]
  }
  return id
}
