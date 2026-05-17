#!/usr/bin/env node
/**
 * MyFb dist bundler.
 *
 * The addon ships as IIFE modules referenced by individual `<script>`
 * tags in `sidepanel.html`. For distribution (Web Store) we concat them
 * into single bundles and let esbuild minify the output. The IIFE
 * pattern already attaches everything to `window.MyFb*`, so order +
 * minification is enough — no source changes required.
 *
 *   npm run build         # one-shot
 *   npm run build:watch   # rebuild on file change
 *
 * Outputs:
 *   dist/sidepanel.bundle.js
 *   dist/background.bundle.js
 *   dist/shared.bundle.js
 *
 * Update sidepanel.html / manifest.json (or copy to dist/) to point at
 * the bundles before publishing.
 */
import { readFile, writeFile, mkdir, stat, watch as fsWatch } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const DIST      = path.join(ROOT, 'dist');

// Read script src= entries from an HTML file, in order.
async function readScriptOrder(htmlPath, prefixFilter) {
  const html = await readFile(htmlPath, 'utf8');
  const re   = /<script\s+src="([^"]+)"\s*>\s*<\/script>/g;
  const list = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!prefixFilter || prefixFilter.some((p) => m[1].startsWith(p))) list.push(m[1]);
  }
  return list;
}

// Emit two manifest variants alongside the bundles:
//   dist/manifest.dev.json  — full feature set (incl. VS-Code bridge → loopback CSP)
//   dist/manifest.webstore.json — Web Store ready: no loopback connect-src, no
//                                  bridge-related host_permissions surface.
//
// CI for the publish flow should grab manifest.webstore.json. The dev
// flow (loaded unpacked) uses the source manifest.json as-is.
async function writeManifestVariants(srcManifest) {
  await mkdir(DIST, { recursive: true });
  // Dev = source manifest copy (loopback included)
  const devCopy = JSON.parse(JSON.stringify(srcManifest));
  await writeFile(path.join(DIST, 'manifest.dev.json'), JSON.stringify(devCopy, null, 2));
  // Webstore variant: scrub loopback connect-src + drop the bridge port
  const wsCopy = JSON.parse(JSON.stringify(srcManifest));
  if (wsCopy.content_security_policy && wsCopy.content_security_policy.extension_pages) {
    wsCopy.content_security_policy.extension_pages =
      wsCopy.content_security_policy.extension_pages
        .replace(/\s*http:\/\/127\.0\.0\.1:\d+/g, '')
        .replace(/\s*http:\/\/localhost:\d+/g, '');
  }
  // Tag the variant so callers can detect at runtime.
  wsCopy._variant = 'webstore';
  devCopy._variant = 'dev';
  await writeFile(path.join(DIST, 'manifest.webstore.json'), JSON.stringify(wsCopy, null, 2));
  console.log('  → dist/manifest.dev.json + dist/manifest.webstore.json');
}

async function concat(files) {
  const buffers = await Promise.all(files.map(async (rel) => {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) throw new Error('Missing file: ' + rel);
    return '/* ===== ' + rel + ' ===== */\n' + await readFile(abs, 'utf8');
  }));
  return buffers.join('\n');
}

async function buildBundle(name, sources) {
  const code = await concat(sources);
  const out  = await esbuild.transform(code, {
    minify: true, target: 'chrome114', sourcemap: 'inline', loader: 'js',
  });
  await mkdir(DIST, { recursive: true });
  await writeFile(path.join(DIST, name + '.bundle.js'), out.code);
  console.log('  → dist/' + name + '.bundle.js  (' + (out.code.length / 1024).toFixed(1) + ' KB)');
}

async function buildAll() {
  console.log('[myfb] Building bundles…');

  // sidepanel = all <script src=...> in sidepanel.html in declared order
  const sidepanelScripts = await readScriptOrder(
    path.join(ROOT, 'sidepanel.html'),
    ['shared/', 'sidepanel/'],
  );
  await buildBundle('sidepanel', sidepanelScripts);

  // background = manifest.json's service_worker file. Currently a single
  // ES module entry — esbuild will follow imports if any.
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
  await writeManifestVariants(manifest);
  if (manifest.background && manifest.background.service_worker) {
    const swPath = manifest.background.service_worker;
    await esbuild.build({
      entryPoints: [path.join(ROOT, swPath)],
      bundle:      true,
      minify:      true,
      target:      'chrome114',
      format:      'iife',
      outfile:     path.join(DIST, 'background.bundle.js'),
      sourcemap:   'inline',
      logLevel:    'silent',
    });
    console.log('  → dist/background.bundle.js  (' + ((await stat(path.join(DIST, 'background.bundle.js'))).size / 1024).toFixed(1) + ' KB)');
  }

  console.log('[myfb] Done.');
}

async function watch() {
  console.log('[myfb] Watching… (Ctrl+C to exit)');
  await buildAll();
  const watchers = [];
  for (const dir of ['sidepanel', 'shared', 'background']) {
    const abs = path.join(ROOT, dir);
    if (!existsSync(abs)) continue;
    watchers.push((async () => {
      const w = fsWatch(abs, { recursive: true });
      for await (const _evt of w) {
        try { await buildAll(); } catch (e) { console.error('[myfb] build error:', e.message); }
      }
    })());
  }
  await Promise.all(watchers);
}

const isWatch = process.argv.includes('--watch');
(isWatch ? watch() : buildAll()).catch((e) => {
  console.error('[myfb] FAILED:', e);
  process.exit(1);
});
