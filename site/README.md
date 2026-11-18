# commentmark.com

The landing page: plain HTML and CSS, no JavaScript and no build step. Everything in
`public/` is served as it is.

The page is one CommentMark file, `public/commentmark.md`, shown three ways (Editor, Other
tools, Source). `public/index.html` holds that file rendered twice and, in the Source view,
verbatim. If you change `commentmark.md`, update all three views in `index.html` to match.

- Preview: `python3 -m http.server 4318 --directory site/public`, then open http://localhost:4318/
- Check (from the repository root, after building `packages/core`): `node site/check.mjs`
- Deploy (Cloudflare Pages): `npx wrangler pages deploy site/public --project-name commentmark`

Archivo (`public/fonts/`) is under the SIL Open Font License; see `public/fonts/OFL.txt`.
