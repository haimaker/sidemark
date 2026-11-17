import {useEffect, useRef} from 'preact/hooks'

/**
 * "How do I know?": what the page sends and what it does not, in plain
 * words. Every claim here is enforced by the Content Security Policy in
 * csp.ts or follows from the code having no network calls at all; the e2e
 * test "nothing leaves the device" checks it.
 */
export function PrivacyPanel({onClose}: {onClose(): void}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const host = location.host || 'the site hosting it'
  return (
    <section
      id="privacy-panel"
      class="privacy-panel"
      ref={ref}
      tabIndex={-1}
      aria-labelledby="privacy-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      <div class="privacy-inner">
        <h2 id="privacy-title">Local only: how do I know?</h2>
        <p>
          <strong>Your documents and comments stay on this device.</strong> Sidemark is a static web page. When you open it, your
          browser downloads the page itself (its HTML, JavaScript and styles) from {host}. That is the only thing it downloads, and
          nothing about your files is sent back.
        </p>
        <ul>
          <li>There is no server behind the editor, no account and no analytics or tracking.</li>
          <li>
            Files are opened, read and saved by your browser. A file you open with <em>Open</em> or by dropping it is read on your
            computer; <em>Save</em> writes it back on your computer, and <em>Download</em> saves a copy there.
          </li>
          <li>
            The page's Content Security Policy tells your browser to block every network connection the page could try to make
            (fetch, XHR, WebSockets, beacons), and to load scripts and styles only from {host}. You can see it in the page source:
            look for <code>Content-Security-Policy</code>.
          </li>
          <li>
            Remote images in a document are not loaded, because loading one would tell that image's server that the document is
            open. Each shows its description and a link you can choose to open in a new tab.
          </li>
          <li>Your name for comments and dismissed tips are kept in this browser's own storage, on this device.</li>
        </ul>
        <p class="privacy-limits">
          What this does not cover: clicking a link in a document opens that site, like any link. Browser extensions can read any page
          you open. A file you save or download is an ordinary file, as private as the place you keep it.
        </p>
        <button type="button" class="button" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  )
}
