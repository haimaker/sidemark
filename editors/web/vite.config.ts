import {defineConfig, type Plugin} from 'vitest/config'
import {contentSecurityPolicy} from './csp'

/** Put the Content Security Policy (see csp.ts) at the top of <head>. */
function csp(): Plugin {
  return {
    name: 'sidemark-csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const mode = context.server ? 'development' : 'production'
        const tag = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(mode)}" />`
        return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    ${tag}`)
      }
    }
  }
}

export default defineConfig({
  // Relative base: the built app works from any path on any static host.
  base: './',
  plugins: [csp()],
  oxc: {
    jsx: {runtime: 'automatic', importSource: 'preact'}
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The polyfill would use fetch(), which the policy forbids; modern browsers do not need it.
    modulePreload: {polyfill: false}
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
