#!/usr/bin/env node
/**
 * BIAIF — i18n coverage audit
 *
 * Scans shared/i18n.js and reports:
 *   1. keys with a missing locale (any of fr/en/es/de/it/pt/nl)
 *   2. keys referenced from JS source files that are NOT declared
 *      in TRANSLATIONS (would render as the key itself at runtime)
 *
 * Exits non-zero if either issue is found, so it can gate CI.
 *
 *   node scripts/i18n-coverage.mjs           # report
 *   node scripts/i18n-coverage.mjs --strict  # also fail if extra keys
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const LOCALES   = ['fr', 'en', 'es', 'de', 'it', 'pt', 'nl'];

// Parse the TRANSLATIONS dictionary out of shared/i18n.js by eval'ing
// the file in a sandbox-ish context (Node Function constructor — no
// network / filesystem access from within).
async function loadTranslations() {
  const src = await readFile(path.join(ROOT, 'shared/i18n.js'), 'utf8');
  const m = src.match(/var\s+TRANSLATIONS\s*=\s*(\{[\s\S]+?\n\s\s\});/);
  if (!m) throw new Error('Could not extract TRANSLATIONS block from shared/i18n.js');
  // eslint-disable-next-line no-new-func
  const fn = new Function('return ' + m[1] + ';');
  return fn();
}

// Walk a directory recursively, returning .js files only.
// Skips test/ build/ vendor noise.
async function walk(dir, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'coverage' ||
        e.name === 'tests' || e.name === 'scripts' || e.name === 'vscode-extension' ||
        e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.name.endsWith('.js') || e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

// Collect i18n keys referenced in the codebase. We pick up:
//   - data-i18n="key.path"
//   - t('key.path', ...)  /  _t('key.path', ...)  /  utils.t('key.path', ...)
//   - tn('base.key', n, ...)
//   - i18n.t('key', ...)
function extractKeys(src) {
  const out = new Set();
  const tnRe = /\btn\s*\(\s*['"]([\w.-]+)['"]/g;
  const tRe  = /(?:\b|\.)t\s*\(\s*['"]([\w.-]+)['"]/g;
  const dRe  = /data-i18n(?:-placeholder)?\s*=\s*"([\w.-]+)"/g;
  let m;
  while ((m = tnRe.exec(src)) !== null) out.add(m[1] + '__plural_family');
  while ((m = tRe.exec(src))  !== null) out.add(m[1]);
  while ((m = dRe.exec(src))  !== null) out.add(m[1]);
  return out;
}

async function main() {
  const strict = process.argv.includes('--strict');
  const trans  = await loadTranslations();
  const all    = await walk(ROOT);

  const missingLocales = []; // { key, locales: [] }
  for (const [key, entry] of Object.entries(trans)) {
    const missing = LOCALES.filter((loc) => typeof entry[loc] !== 'string');
    if (missing.length) missingLocales.push({ key, locales: missing });
  }

  // Build the live "used keys" set
  const used = new Set();
  for (const f of all) {
    // Skip the i18n.js itself (so the dictionary doesn't self-match)
    if (f.endsWith('shared/i18n.js')) continue;
    if (f.includes('/dist/'))         continue;
    if (f.includes('/coverage/'))     continue;
    const src = await readFile(f, 'utf8');
    for (const k of extractKeys(src)) used.add(k);
  }

  // Plural families: a tn('base.foo', n) → expect base.foo_one / _other
  // (CLDR categories) OR base.foo_singular / _plural (legacy).
  const pluralUsed = new Set();
  for (const k of used) if (k.endsWith('__plural_family')) pluralUsed.add(k.replace('__plural_family', ''));

  const flatUsed = new Set();
  for (const k of used) if (!k.endsWith('__plural_family')) flatUsed.add(k);

  const declared = new Set(Object.keys(trans));

  const undeclared = [];
  for (const k of flatUsed) if (!declared.has(k)) undeclared.push(k);

  const orphans = [];
  if (strict) {
    for (const k of declared) {
      // A plural family may have its base key absent; allow that.
      if (k.endsWith('_singular') || k.endsWith('_plural') ||
          k.endsWith('_one') || k.endsWith('_few') ||
          k.endsWith('_many') || k.endsWith('_other')) continue;
      if (!flatUsed.has(k)) orphans.push(k);
    }
  }

  // Plural family check — at least singular+plural OR _one+_other must exist
  const pluralIncomplete = [];
  for (const base of pluralUsed) {
    const hasLegacy = declared.has(base + '_singular') && declared.has(base + '_plural');
    const hasCldr   = declared.has(base + '_one')      && declared.has(base + '_other');
    const hasBase   = declared.has(base);
    if (!hasLegacy && !hasCldr && !hasBase) pluralIncomplete.push(base);
  }

  // ── Report ───────────────────────────────────────────────────────
  let fail = false;
  console.log('[biaif i18n] dictionary keys:', declared.size);
  console.log('[biaif i18n] referenced keys:', flatUsed.size + pluralUsed.size);

  if (missingLocales.length) {
    fail = true;
    console.log('\n❌ Missing locale entries (' + missingLocales.length + '):');
    for (const { key, locales } of missingLocales) console.log('   ', key, '→ missing', locales.join(', '));
  } else {
    console.log('\n✅ All keys translated in', LOCALES.join('/'));
  }

  if (undeclared.length) {
    fail = true;
    console.log('\n❌ Keys referenced in code but NOT declared (' + undeclared.length + '):');
    for (const k of undeclared) console.log('   ', k);
  } else {
    console.log('\n✅ Every referenced key has a translation entry');
  }

  if (pluralIncomplete.length) {
    fail = true;
    console.log('\n❌ tn() families with no resolvable variants (' + pluralIncomplete.length + '):');
    for (const k of pluralIncomplete) console.log('   ', k, '→ need _one+_other or _singular+_plural');
  }

  if (strict && orphans.length) {
    fail = true;
    console.log('\n⚠️  Declared but never referenced (' + orphans.length + ', --strict):');
    for (const k of orphans) console.log('   ', k);
  }

  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('[biaif i18n] FAILED:', e); process.exit(2); });
