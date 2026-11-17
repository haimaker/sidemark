/**
 * URL policy for links and images in the document body and in comments.
 *
 * Both are untrusted (SPEC §12). Only absolute http(s) and mailto links and
 * in-page fragments become real links; everything else (javascript:, data:,
 * relative paths that would resolve against this app rather than the file)
 * is shown as plain text. The URL parser normalises the scheme first, so
 * tricks like `java\tscript:` or leading control characters are caught.
 */

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const IMAGE_PROTOCOLS = new Set(['http:', 'https:'])

/** A safe `href` for a Markdown link destination, or `null`. */
export function safeHref(url: string): string | null {
  const trimmed = url.trim()
  if (/^#[^\s]*$/.test(trimmed)) return trimmed
  return absolute(trimmed, LINK_PROTOCOLS)
}

/** A safe `src` for a Markdown image, or `null` (remote http(s) only). */
export function safeImageSrc(url: string): string | null {
  return absolute(url.trim(), IMAGE_PROTOCOLS)
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
