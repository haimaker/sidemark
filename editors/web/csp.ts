/**
 * The Content Security Policy, injected into index.html at build time.
 *
 * It is what makes "your file never leaves this device" enforced by the
 * browser rather than only promised by our code:
 *
 * - `connect-src 'none'`: no fetch, XHR, WebSocket, EventSource or beacon.
 * - `img-src 'self' data: blob:`: no remote images (loading one would tell
 *   its server that the document is open).
 * - `default-src 'none'`: no fonts, media, frames, workers, manifests or
 *   plugins from anywhere.
 * - Scripts and stylesheets only from the page's own origin; inline style
 *   attributes are allowed (they cannot make requests: `url()` in them is
 *   governed by `img-src` and `font-src`).
 * - `form-action 'none'` and `base-uri 'none'`.
 *
 * The development server needs a WebSocket back to itself for hot reload,
 * so dev (and only dev) allows `connect-src 'self' ws: wss:`.
 */
export function contentSecurityPolicy(mode: 'production' | 'development'): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    mode === 'development' ? "connect-src 'self' ws: wss:" : "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
}
