/**
 * URL policy for links and images in the document body and in comments.
 *
 * Both are untrusted (SPEC §12). Only absolute http(s) and mailto links and
 * in-page fragments become real links; everything else (javascript:, data:,
 * relative paths that would resolve against this app rather than the file)
 * is shown as plain text. The URL parser normalises the scheme first, so
 * tricks like `java\tscript:` or leading control characters are caught.
 *
 * Images are a privacy question as well as a security one: displaying a
 * remote image makes the browser contact that image's server as soon as the
 * document is opened. So only images embedded in the document itself
 * (`data:image/…`) are displayed; remote ones become a placeholder with a
 * link the person can open in a new tab. The page's Content Security Policy
 * (`img-src 'self' data: blob:`) enforces the same rule.
 */

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const REMOTE_PROTOCOLS = new Set(['http:', 'https:'])

/** A safe `href` for a Markdown link destination, or `null`. */
export function safeHref(url: string): string | null {
  const trimmed = url.trim()
  if (/^#[^\s]*$/.test(trimmed)) return trimmed
  return absolute(trimmed, LINK_PROTOCOLS)
}

/**
 * A `src` that displays an image without any network request: a `data:`
 * image embedded in the document. `null` for everything else.
 */
export function embeddedImageSrc(url: string): string | null {
  const trimmed = url.trim()
  return /^data:image\/(png|gif|jpeg|webp|avif|svg\+xml)[;,]/i.test(trimmed) ? trimmed : null
}

/** An http(s) image URL, which is never loaded in the page, or `null`. */
export function remoteImageUrl(url: string): string | null {
  return absolute(url.trim(), REMOTE_PROTOCOLS)
}

function absolute(url: string, allowed: ReadonlySet<string>): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return allowed.has(parsed.protocol) ? parsed.href : null
}
