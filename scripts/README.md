# Build scripts

## `build.mjs`

Concatenates and minifies the IIFE modules referenced by
`sidepanel.html` (and the service-worker entry from `manifest.json`)
into single bundles in `dist/`.

```bash
npm install            # one-time
npm run build          # one-shot
npm run build:watch    # rebuild on save
```

The bundler is **non-invasive**: source files keep their IIFE pattern
and load order is preserved. Dev workflow stays the loose-files mode
(load `sidepanel.html` directly). Use the bundles for distribution.

To ship the bundle, replace the multiple `<script src="…">` lines in
`sidepanel.html` with a single `<script src="dist/sidepanel.bundle.js">`
and update `manifest.json` accordingly.
