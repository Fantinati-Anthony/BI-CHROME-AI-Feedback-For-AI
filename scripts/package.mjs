#!/usr/bin/env node
/**
 * My-Feedbacks — Chrome Web Store packaging script
 *
 *   node scripts/package.mjs            # produces my-feedbacks-<version>.zip
 *   node scripts/package.mjs --dev      # uses manifest.dev.json (loopback CSP)
 *
 * Builds the bundles via scripts/build.mjs first, then assembles a
 * minimal directory containing ONLY the files the runtime needs, and
 * zips it. The dist/ produced by build.mjs already contains the right
 * manifests + bundles; this script just curates the rest.
 */

import { execSync }            from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, cpSync, rmSync, readdirSync }
                               from 'node:fs';
import { fileURLToPath }       from 'node:url';
import { dirname, join, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const DIST      = join(ROOT, 'dist');
const STAGE     = join(ROOT, 'dist', 'package');

const dev = process.argv.includes('--dev');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ver = pkg.version;
const out = join(ROOT, `my-feedbacks-${ver}${dev ? '-dev' : ''}.zip`);

function log(msg) { console.log('[package]', msg); }

log(`Packaging my-feedbacks v${ver} (${dev ? 'dev' : 'webstore'})…`);

// 1. Clean + build
if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
log('Building bundles…');
execSync('node scripts/build.mjs', { cwd: ROOT, stdio: 'inherit' });

// 2. Stage the files that ship
mkdirSync(STAGE, { recursive: true });

// Manifest — pick dev or webstore variant
const manifestSrc = dev ? 'manifest.dev.json' : 'manifest.webstore.json';
const manifestPath = join(DIST, manifestSrc);
if (!existsSync(manifestPath)) {
  console.error(`[package] FATAL: ${manifestSrc} missing in dist/ — did build run?`);
  process.exit(1);
}
cpSync(manifestPath, join(STAGE, 'manifest.json'));

// Bundles
cpSync(join(DIST, 'sidepanel.bundle.js'),  join(STAGE, 'sidepanel.bundle.js'));
cpSync(join(DIST, 'background.bundle.js'), join(STAGE, 'background.bundle.js'));

// Source files referenced from manifest content_scripts
//  → we keep the source layout under shared/ and content/ for clarity.
//  → the side panel HTML loads scripts directly, so we ship those too.
const RUNTIME_DIRS = ['shared', 'content', 'sidepanel'];
RUNTIME_DIRS.forEach((d) => {
  cpSync(join(ROOT, d), join(STAGE, d), { recursive: true });
});

// Side-panel HTML, CSS entry
cpSync(join(ROOT, 'sidepanel.html'), join(STAGE, 'sidepanel.html'));
cpSync(join(ROOT, 'sidepanel.css'),  join(STAGE, 'sidepanel.css'));
cpSync(join(ROOT, 'sidepanel.js'),   join(STAGE, 'sidepanel.js'));

// Reviewer / store assets
['PRIVACY.md', 'LICENSE'].forEach((f) => {
  if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(STAGE, f));
});

// 3. Strip dev-only files from the staged tree
const STRIP_PATTERNS = [
  /\.test\.js$/,
  /__tests__/,
  /\.map$/,
  /\.DS_Store$/,
];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) { walk(p); continue; }
    if (STRIP_PATTERNS.some((r) => r.test(entry.name))) {
      rmSync(p, { force: true });
    }
  }
}
walk(STAGE);

// 4. Zip the staged directory
log(`Zipping → ${basename(out)}`);
if (existsSync(out)) rmSync(out, { force: true });
try {
  execSync(`cd "${STAGE}" && zip -r -q "${out}" .`, { stdio: 'inherit' });
} catch (e) {
  console.error('[package] zip failed — make sure the `zip` CLI is installed.');
  process.exit(1);
}

// 5. Cleanup
rmSync(STAGE, { recursive: true, force: true });

log(`Done → ${out}`);
log(`Next: upload that ZIP to https://chrome.google.com/u/0/webstore/devconsole/`);
