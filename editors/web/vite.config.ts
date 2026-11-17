import {defineConfig} from 'vitest/config'

export default defineConfig({
  // Relative base: the built app works from any path on any static host.
  base: './',
  oxc: {
    jsx: {runtime: 'automatic', importSource: 'preact'}
  },
  build: {
    target: 'es2022',
    sourcemap: true
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node'
  }
})
