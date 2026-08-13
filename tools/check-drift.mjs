#!/usr/bin/env node
/**
 * check-drift.mjs
 *
 * There is no build step in this repo, so a handful of files are deliberately
 * duplicated between apps/garden and apps/nursery rather than shared from a
 * common folder (a folder outside the publish directory is not served to the
 * browser). This script is the safety net for that decision: it diffs the
 * files that are meant to match and reports any divergence.
 *
 * It also checks that firestore.rules / storage.rules have not crept back
 * into an app folder — they live in firebase/ now, in exactly one copy.
 *
 * Usage, from anywhere in the repo:
 *     node tools/check-drift.mjs
 *
 * Exit codes:  0 = clean (warnings allowed)   1 = drift that needs fixing
 *
 * Run this before pushing changes to auth.js, ui-utils.js, scan-label.js or
 * lookup-plant.js.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['garden', 'nursery'];

/**
 * Files that exist once per app and are supposed to be identical.
 *   severity 'error' — divergence is a bug; fails the check.
 *   severity 'warn'  — divergence is known and tolerated for now; reported
 *                      loudly but does not fail.
 */
const PAIRS = [
  {
    path: 'js/auth.js',
    severity: 'error',
    note: 'Auth and the three-role model must behave identically in both apps.',
  },
  {
    path: 'functions/scan-label.js',
    severity: 'error',
    note: 'One Gemini label-scan function, deployed as a Netlify function by both sites.',
  },
  {
    path: 'functions/lookup-plant.js',
    severity: 'error',
    note: 'One Gemini plant-lookup function, deployed as a Netlify function by both sites.',
  },
  {
    path: 'js/plant-lookup.js',
    severity: 'error',
    note: 'Client half of the plant lookup. Field IDs differ per app, so they are passed '
        + 'in by the caller rather than hard-coded — the module itself must stay identical.',
  },
  {
    path: 'js/ui-utils.js',
    severity: 'warn',
    note: 'Known delta: Nursery has isValidDateStr(), Garden does not. Port it to Garden to clear this.',
  },
];

/** Files that must NOT exist inside an app folder — single copy lives in firebase/. */
const SINGLE_COPY_ONLY = ['firestore.rules', 'storage.rules'];

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

function lineReport(aText, bText) {
  const a = aText.split(/\r?\n/);
  const b = bText.split(/\r?\n/);
  const aSet = new Set(a);
  const bSet = new Set(b);
  return {
    aLines: a.length,
    bLines: b.length,
    onlyGarden: a.filter((l) => l.trim() && !bSet.has(l)),
    onlyNursery: b.filter((l) => l.trim() && !aSet.has(l)),
  };
}

function show(label, lines, limit = 8) {
  if (lines.length === 0) return;
  console.log(`      only in ${label} (${lines.length} line${lines.length === 1 ? '' : 's'}):`);
  for (const l of lines.slice(0, limit)) console.log(`        ${l.trim().slice(0, 100)}`);
  if (lines.length > limit) console.log(`        … and ${lines.length - limit} more`);
}

let errors = 0;
let warnings = 0;

console.log('check-drift — files duplicated between apps/garden and apps/nursery\n');

for (const pair of PAIRS) {
  const paths = APPS.map((app) => join(REPO, 'apps', app, pair.path));
  const missing = paths.filter((p) => !existsSync(p));

  if (missing.length > 0) {
    errors++;
    console.log(`  MISSING  ${pair.path}`);
    for (const m of missing) console.log(`      not found: ${m.replace(REPO + '\\', '').replace(REPO + '/', '')}`);
    console.log('');
    continue;
  }

  const [gardenBuf, nurseryBuf] = paths.map((p) => readFileSync(p));

  if (md5(gardenBuf) === md5(nurseryBuf)) {
    console.log(`  OK       ${pair.path}  (identical, ${gardenBuf.length} bytes)`);
    continue;
  }

  const isError = pair.severity === 'error';
  if (isError) errors++;
  else warnings++;

  const r = lineReport(gardenBuf.toString('utf8'), nurseryBuf.toString('utf8'));
  console.log(`  ${isError ? 'DRIFT   ' : 'WARN    '} ${pair.path}  (garden ${r.aLines} lines, nursery ${r.bLines} lines)`);
  console.log(`      ${pair.note}`);
  show('garden', r.onlyGarden);
  show('nursery', r.onlyNursery);
  console.log('');
}

console.log('\nsingle-copy files (must live only in firebase/)\n');

for (const name of SINGLE_COPY_ONLY) {
  const strays = APPS
    .map((app) => join(REPO, 'apps', app, name))
    .filter((p) => existsSync(p));
  const canonical = join(REPO, 'firebase', name);

  if (!existsSync(canonical)) {
    errors++;
    console.log(`  MISSING  firebase/${name} — the canonical copy is gone`);
  }
  if (strays.length > 0) {
    errors++;
    console.log(`  STRAY    ${name} has reappeared inside an app folder:`);
    for (const s of strays) console.log(`        ${s}`);
    console.log('      Delete it. The one copy lives at firebase/' + name + ' and is deployed');
    console.log('      with: firebase deploy --only firestore:rules,storage');
  }
  if (strays.length === 0 && existsSync(canonical)) {
    console.log(`  OK       firebase/${name}  (single copy, no strays)`);
  }
}

console.log('');
if (errors > 0) {
  console.log(`FAILED — ${errors} problem${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`clean — 0 problems, ${warnings} warning${warnings === 1 ? '' : 's'}`);
process.exit(0);
