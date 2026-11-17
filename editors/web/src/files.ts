/**
 * Opening and saving local files.
 *
 * - Open: the File System Access API (`showOpenFilePicker`) where available,
 *   so the file can be written back in place; an `<input type="file">`
 *   elsewhere; and drag-and-drop (which also yields a writable handle in
 *   Chromium).
 * - Save: write back through the handle when there is one, otherwise
 *   download.
 *
 * Text is decoded as UTF-8 *keeping* a byte order mark, and encoded back
 * unchanged, so a save never changes bytes the user did not edit (§9.1).
 */

/** Minimal typings for the parts of the File System Access API we use. */
export interface WritableHandle {
  readonly kind: 'file'
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<{write(data: Blob | string): Promise<void>; close(): Promise<void>}>
  queryPermission?(options: {mode: 'readwrite'}): Promise<PermissionState>
  requestPermission?(options: {mode: 'readwrite'}): Promise<PermissionState>
}

export interface OpenedFile {
  name: string
  source: string
  handle: WritableHandle | null
  /** `lastModified` when read, to detect changes on disk before saving. */
  lastModified: number | null
}

type PickerWindow = Window & {
  showOpenFilePicker?: (options: unknown) => Promise<WritableHandle[]>
}

export const MARKDOWN_ACCEPT = '.md,.markdown,.mdown,.mkd,.txt,text/markdown,text/plain'

export function canPickWithHandle(win: Window = window): boolean {
  return typeof (win as PickerWindow).showOpenFilePicker === 'function'
}

/** Show the native picker. Resolves `null` if the user cancels. */
export async function pickWithHandle(win: Window = window): Promise<OpenedFile | null> {
  const picker = (win as PickerWindow).showOpenFilePicker!
  let handles: WritableHandle[]
  try {
    handles = await picker({
      multiple: false,
      types: [{description: 'Markdown', accept: {'text/markdown': ['.md', '.markdown', '.mdown', '.mkd'], 'text/plain': ['.txt']}}]
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null
    throw error
  }
  const handle = handles[0]
  return handle ? fromHandle(handle) : null
}

export async function fromHandle(handle: WritableHandle): Promise<OpenedFile> {
  const file = await handle.getFile()
  return {name: file.name, source: await readText(file), handle, lastModified: file.lastModified}
}

export async function fromFile(file: File): Promise<OpenedFile> {
  return {name: file.name, source: await readText(file), handle: null, lastModified: null}
}

/** A dropped file, with a writable handle when the browser offers one. */
export async function fromDataTransfer(data: DataTransfer): Promise<OpenedFile | null> {
  const item = [...data.items].find((i) => i.kind === 'file')
  const getHandle = (item as {getAsFileSystemHandle?: () => Promise<WritableHandle | null>} | undefined)
    ?.getAsFileSystemHandle
  if (item && getHandle) {
    try {
      const handle = await getHandle.call(item)
      if (handle && handle.kind === 'file') return fromHandle(handle)
    } catch {
      // Fall back to the plain file below.
    }
  }
  const file = data.files[0]
  return file ? fromFile(file) : null
}

export async function readText(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer()
  return new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
}

/** Has the file changed on disk since it was read? */
export async function changedOnDisk(file: OpenedFile): Promise<boolean> {
  if (!file.handle || file.lastModified === null) return false
  try {
    return (await file.handle.getFile()).lastModified !== file.lastModified
  } catch {
    return false
  }
}

/** Write through the handle. Returns the new `lastModified`. */
export async function writeToHandle(handle: WritableHandle, source: string): Promise<number | null> {
  if (handle.requestPermission) {
    const state = (await handle.queryPermission?.({mode: 'readwrite'})) ?? 'prompt'
    if (state !== 'granted' && (await handle.requestPermission({mode: 'readwrite'})) !== 'granted') {
      throw new Error('Permission to write the file was not granted.')
    }
  }
  const writable = await handle.createWritable()
  await writable.write(new Blob([source], {type: 'text/markdown'}))
  await writable.close()
  try {
    return (await handle.getFile()).lastModified
  } catch {
    return null
  }
}

export function download(name: string, source: string, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([source], {type: 'text/markdown;charset=utf-8'}))
  const a = doc.createElement('a')
  a.href = url
  a.download = name
  a.style.display = 'none'
  doc.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
