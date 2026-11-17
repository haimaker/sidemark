import {describe, expect, test} from 'vitest'
import {
  addReply,
  createThread,
  deleteComment,
  deleteThread,
  editComment,
  parse,
  purge,
  setStatus,
  SidemarkError
} from '../src/index.js'

const clock = {now: () => new Date('2026-11-17T10:32:00Z')}

function ids(...list: string[]) {
  let i = 0
  return {...clock, generateId: () => list[i++] ?? 'c-zzzzzz'}
}

function codeOf(fn: () => unknown): string | null {
  try {
    fn()
  } catch (error) {
    if (error instanceof SidemarkError) return error.code
    throw error
  }
  return null
}

/**
 * The bytes the writer did not intend to touch are untouched: removing the
 * inserted anchors and the comments table from the output gives back the
 * input exactly.
 */
function stripAdditions(output: string, id: string, input: string): string {
  const withoutAnchors = output.replaceAll(`<a id="${id}"></a>`, '').replaceAll(`<a id="${id}-end"></a>`, '')
  return withoutAnchors.slice(0, input.length)
}

describe('byte preservation (§9.1)', () => {
  const awkward =
    'Title  \r\nwith\ttabs   and trailing spaces   \r\n\r\n' +
    '|  left |   right |\r\n|:------|-------:|\r\n|  a    |      b |\r\n\r\n' +
    '* star list\n+ plus list\n\nMixed\rendings\n__underscore strong__ and _em_.'

  test('inline anchors change nothing else', () => {
    const range = {start: awkward.indexOf('tabs'), end: awkward.indexOf('tabs') + 4}
    const {source} = createThread(awkward, {range, author: '@a', comment: 'x'}, ids('c-aaaaaa'))
    expect(stripAdditions(source, 'c-aaaaaa', awkward)).toBe(awkward)
    // No final newline before, none after.
    expect(source.endsWith('|')).toBe(true)
  })

  test('create then delete restores the input exactly', () => {
    for (const word of ['tabs', 'right', 'plus', 'underscore', 'endings']) {
      const at = awkward.indexOf(word)
      const {source, id} = createThread(awkward, {range: {start: at, end: at + word.length}, author: '@a', comment: 'x'}, ids('c-bbbbbb'))
      expect(deleteThread(source, id)).toBe(awkward)
    }
  })

  test('new rows use the line ending of the row they follow', () => {
    const doc =
      'Text.\r\n\r\n## Comments\r\n\r\n| Ref | Quote | Author | Date | Comment | Status |\r\n|---|---|---|---|---|---|\r\n| c-1 | | @a | | hi | |\r\n'
    const out = addReply(doc, 'c-1', {author: '@b', comment: 'reply', date: '2026-11-17T10:32Z'})
    expect(out).toBe(doc + '| c-1 | | @b | 2026-11-17T10:32Z | reply | |\r\n')
  })

  test('padded rows are not re-padded and other rows are untouched', () => {
    const doc =
      'Text.\n\n## Comments\n\n| Ref  | Quote | Author | Date | Comment     | Status |\n|------|-------|--------|------|-------------|--------|\n| c-1  |       | @a     |      | hello       |        |\n| c-2  |       | @b     |      | world       |        |\n'
    const edited = editComment(doc, {threadId: 'c-1', index: 0}, 'changed')
    expect(edited).toBe(doc.replace('| hello       |', '| changed       |'))
    const resolved = setStatus(doc, 'c-2', {status: 'resolved', author: '@c', date: '2026-11-17T10:32Z'})
    expect(resolved).toBe(doc + '| c-2 | | @c | 2026-11-17T10:32Z | | resolved |\n')
  })
})

describe('creating threads', () => {
  test('IDs that already appear in the document are regenerated (§4)', () => {
    const doc = 'Mentions c-aaaaaa in text.\n'
    const {id} = createThread(doc, {range: null, author: '@a', comment: 'x'}, ids('c-aaaaaa', 'c-bbbbbb'))
    expect(id).toBe('c-bbbbbb')
  })

  test('default IDs are c- and 6 characters from 0-9a-z', () => {
    const {id} = createThread('Text.\n', {range: null, author: '@a', comment: 'x'}, clock)
    expect(id).toMatch(/^c-[0-9a-z]{6}$/)
  })

  test('the injected clock is used and formatted as YYYY-MM-DDThh:mmZ', () => {
    const {source} = createThread('Text.\n', {range: null, author: '@a', comment: 'x'}, ids('c-aaaaaa'))
    expect(source).toContain('| c-aaaaaa | | @a | 2026-11-17T10:32Z | x | |')
  })

  test('invalid input is rejected with typed errors', () => {
    expect(codeOf(() => createThread('Text.\n', {range: null, author: '@a', comment: ' '}, clock))).toBe('EMPTY_COMMENT')
    expect(codeOf(() => createThread('Text.\n', {range: null, author: '@a', comment: 'x'}, {generateId: () => 'X'}))).toBe(
      'INVALID_ID'
    )
    expect(codeOf(() => createThread('Text.\n', {range: null, author: '@a', comment: 'x', date: '2026-11-17'}))).toBe(
      'INVALID_DATE'
    )
    expect(codeOf(() => createThread('Text.\n', {range: {start: 3, end: 2}, author: '@a', comment: 'x'}))).toBe(
      'INVALID_RANGE'
    )
    expect(codeOf(() => createThread('Text.\n', {range: {start: 0, end: 99}, author: '@a', comment: 'x'}))).toBe(
      'INVALID_RANGE'
    )
    expect(
      codeOf(() => createThread('c-aaaaaa\n', {range: null, author: '@a', comment: 'x'}, {generateId: () => 'c-aaaaaa'}))
    ).toBe('ID_COLLISION')
  })

  test('authors are escaped so they read back exactly', () => {
    const {source} = createThread('Text.\n', {range: null, author: '*bob* | the_builder', comment: 'x'}, ids('c-aaaaaa'))
    expect(parse(source).threads[0]!.comments[0]!.author).toBe('*bob* | the_builder')
  })

  test('two threads on the same text nest cleanly', () => {
    const doc = 'The quick fox.\n'
    const range = {start: 4, end: 9}
    const one = createThread(doc, {range, author: '@a', comment: 'one'}, ids('c-aaaaaa')).source
    const at = one.indexOf('quick')
    const two = createThread(one, {range: {start: at, end: at + 5}, author: '@b', comment: 'two'}, ids('c-bbbbbb')).source
    const threads = parse(two).threads
    expect(threads.map((t) => t.attachment.kind === 'anchored' && t.attachment.text)).toEqual(['quick', 'quick'])
  })
})

describe('replies, status, edits, deletes', () => {
  const doc = createThread(
    'The quick brown fox.\n',
    {range: {start: 4, end: 9}, author: '@a', comment: 'root'},
    ids('c-aaaaaa')
  ).source

  test('status rows may have an empty comment; plain rows may not', () => {
    const resolved = setStatus(doc, 'c-aaaaaa', {status: 'resolved', author: '@b'}, clock)
    expect(parse(resolved).threads[0]!.state).toBe('resolved')
    expect(codeOf(() => addReply(doc, 'c-aaaaaa', {author: '@b', comment: ''}))).toBe('EMPTY_COMMENT')
    expect(codeOf(() => editComment(doc, {threadId: 'c-aaaaaa', index: 0}, ''))).toBe('EMPTY_COMMENT')
    // Emptying the comment of a status row is fine.
    expect(codeOf(() => editComment(resolved, {threadId: 'c-aaaaaa', index: 1}, ''))).toBeNull()
  })

  test('unknown threads and comments', () => {
    expect(codeOf(() => addReply(doc, 'c-nope', {author: '@b', comment: 'x'}))).toBe('THREAD_NOT_FOUND')
    expect(codeOf(() => deleteComment(doc, {threadId: 'c-aaaaaa', index: 5}))).toBe('COMMENT_NOT_FOUND')
    expect(codeOf(() => setStatus(doc, 'c-aaaaaa', {status: 'done' as 'open', author: '@b'}))).toBe('INVALID_ARGUMENT')
  })

  test('edited comments keep line breaks and pipes', () => {
    const edited = editComment(doc, {threadId: 'c-aaaaaa', index: 0}, 'a | b\nnext `x|y`')
    const comment = parse(edited).threads[0]!.comments[0]!
    expect(comment.commentSource).toBe('a \\| b<br>next `x\\|y`')
    expect(comment.comment).toBe('a | b\nnext `x|y`')
  })

  test('deleting the only comment removes table, heading and anchors', () => {
    expect(deleteComment(doc, {threadId: 'c-aaaaaa', index: 0})).toBe('The quick brown fox.\n')
  })

  test('purge without matches returns the input unchanged', () => {
    expect(purge(doc, {resolved: true, orphaned: true})).toBe(doc)
  })
})
