import {useEffect, useRef} from 'preact/hooks'

/**
 * What "Local only" means, in one sentence. The claim is enforced by the
 * Content Security Policy in csp.ts and checked by the e2e test "nothing
 * leaves the device"; the details are in the README.
 */
export function PrivacyPanel({onClose}: {onClose(): void}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
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
        <h2 id="privacy-title">Local only</h2>
        <p>The contents of your Markdown file and your edits never leave this device.</p>
        <button type="button" class="button" onClick={onClose}>
          Close
        </button>
      </div>
    </section>
  )
}
