/**
 * Real-browser smoke tests against the production build (`vite preview`).
 * Every check of what the editor wrote goes through `@sidemark/core`'s
 * parser, reading the source from the Source view or a downloaded file.
 */
import {readFile} from 'node:fs/promises'
import {expect, test, type Page} from '@playwright/test'
import {maintain, parse} from '@sidemark/core'

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

test('select, comment, reply, resolve, undo, redo, download', async ({page}) => {
  const errors = collectErrors(page)
  await page.goto('./')
  await expect(page.locator('.doc-body h1')).toHaveText('Welcome to Sidemark')
  const initialThreads = parse(await readSource(page)).threads.length

  // New comment on a selection.
  await selectText(page, 'Select a phrase on this page')
  await page.locator('.add-comment').click()
  const composer = margin(page).locator('.composer textarea')
  await composer.fill('Is *this* the first step?')
  await margin(page).locator('.composer').getByRole('button', {name: 'Comment', exact: true}).click()

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
  expect(download.suggestedFilename()).toBe('sidemark-sample.md')
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
  await page.addInitScript(() => localStorage.setItem('sidemark.author', '@robot'))
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
  await page.getByRole('button', {name: 'Comment on the document'}).click()
  await page.getByRole('textbox', {name: 'New comment on the whole document'}).fill('Overall fine.')
  await page.locator('.group .composer').getByRole('button', {name: 'Comment', exact: true}).click()
  await expect(page.locator('section', {has: page.getByRole('heading', {name: /whole document/})})).toContainText('Overall fine.')

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
  await page.addInitScript(() => localStorage.setItem('sidemark.author', '@robot'))
  await page.goto('./')
  const source = '# T\n\nSome text.\n\n## Discussion\n\n| Ref | Quote | Author | Date | Comment | Status |\n|---|---|---|---|---|---|\n| c-1 | | @a | | Hi | |\n'
  await page.getByTestId('file-input').setInputFiles({name: 't.md', mimeType: 'text/markdown', buffer: Buffer.from(source)})
  // The heading above the table is shown but is not part of the body (§6.2).
  await selectText(page, 'Discussion')
  await page.locator('.add-comment').click()
  await expect(page.getByRole('status')).toContainText('can’t be commented on')
  await expect(page.locator('.composer')).toHaveCount(0)
})

test('phone width: threads open in a bottom sheet', async ({browser}) => {
  const page = await browser.newPage({viewport: {width: 390, height: 844}})
  await page.goto('./')
  await expect(page.locator('.margin')).toHaveCount(0)
  await page.locator('mark[data-threads~="c-intro1"]').first().click()
  const sheet = page.getByRole('dialog', {name: 'Comment thread'})
  await expect(sheet).toContainText('This is the whole idea')
  await sheet.getByRole('button', {name: 'Close'}).click()
  await expect(sheet).toHaveCount(0)
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
  await page.addInitScript(() => localStorage.setItem('sidemark.author', '@mouse'))
  await page.goto('./')
  const from = await textPoint(page, 'Reply to a thread', 'left')
  const to = await textPoint(page, 'Switch to', 'right')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, {steps: 5})
  await page.mouse.move(to.x, to.y, {steps: 5})
  await page.mouse.up()
  await page.locator('.add-comment').click()
  await page.keyboard.type('Two steps in one.')
  await page.keyboard.press('ControlOrMeta+Enter')
  const doc = parse(await readSource(page))
  const thread = doc.threads.find((t) => t.comments[0]?.author === '@mouse')!
  expect(thread.attachment).toMatchObject({kind: 'anchored', text: 'Reply to a thread, resolve it, then press Undo. Switch to'})
  const marks = page.locator(`mark[data-threads~="${thread.id}"]`)
  await expect(marks).toHaveCount(2)
})

test('mouse: double-click a word and comment', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('sidemark.author', '@mouse'))
  await page.goto('./')
  const word = await textPoint(page, 'sidecar', 'left')
  await page.mouse.dblclick(word.x + 4, word.y)
  await page.locator('.add-comment').click()
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
    localStorage.setItem('sidemark.author', '@disk')
  })
  await page.goto('./')
  await page.getByRole('button', {name: 'Open'}).click()
  await expect(page.locator('.file-name')).toHaveText('disk.md')
  await expect(page.getByRole('button', {name: 'Save', exact: true})).toBeVisible()

  await selectText(page, 'in place')
  await page.locator('.add-comment').click()
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
  await page.addInitScript(() => localStorage.setItem('sidemark.author', '@drop'))
  await page.goto('./')
  // Make the sample dirty.
  await page.getByRole('button', {name: 'Comment on the document'}).click()
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
