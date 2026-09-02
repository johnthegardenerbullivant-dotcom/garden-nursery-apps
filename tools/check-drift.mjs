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
 * And it checks the one deliberate duplication of PROSE: QUICKSTART.md is the
 * same setup journey as SETUP.md with the reasoning stripped out, and every
 * step of it deep-links to the SETUP.md section it condenses. Renaming a
 * heading in SETUP.md breaks those links without touching QUICKSTART.md, so
 * nothing but a check like this one would notice.
 *
 * Usage, from anywhere in the repo:
 *     node tools/check-drift.mjs
 *
 * Exit codes:  0 = clean (warnings allowed)   1 = drift that needs fixing
 *
 * Run this before pushing changes to auth.js, ui-utils.js, scan-label.js,
 * lookup-plant.js, SETUP.md or QUICKSTART.md.
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

/**
 * Documents that deliberately say the same thing twice, where one deep-links
 * into the other's headings.
 *
 * SETUP.md is the authority on the WHY; QUICKSTART.md is the same journey as a
 * checklist with the reasoning stripped out, and every step of it links to the
 * SETUP.md section it condenses. That is the repo's one deliberate duplication
 * of prose, and it has a failure mode nothing else here has: **renaming a
 * heading in SETUP.md silently breaks the links without changing a byte of
 * QUICKSTART.md.** Markdown anchors are generated from heading text, so the
 * link and the thing it points at are coupled through a string that appears in
 * neither file.
 *
 *   `anchors`  — every SETUP.md#… link in QUICKSTART.md must resolve to a real
 *                heading. A broken one is an ERROR: it is unambiguously wrong
 *                and there is no judgement to make.
 *   `sections` — every numbered section in SETUP.md should be linked from
 *                QUICKSTART.md. A missing one is a WARNING rather than an
 *                error, because a new section is not always a new checklist
 *                step — but a B11 that the checklist never mentions is usually
 *                a step someone will skip.
 */
const CROSS_DOC_LINKS = [
  {
    from: 'QUICKSTART.md',
    to: 'SETUP.md',
    // Numbered setup steps: "## B1. Create your Firebase project (the database)"
    sectionPattern: /^#{2,3}\s+(B\d+)\.\s/,
    note: 'The checklist deep-links to SETUP.md\'s headings. Renaming one silently breaks them.',
  },
];

/**
 * GitHub's heading-anchor rules: lower-case, drop anything that is not a word
 * character, whitespace or a hyphen, then whitespace to hyphens. Repeated
 * headings get -1, -2, … appended in document order, which is why this returns
 * a Set built in one pass rather than a plain map.
 */
function anchorsOf(markdown) {
  const seen = new Map();
  const anchors = new Set();
  for (const m of markdown.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const base = m[1]
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s/g, '-');
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/** Every `<file>#anchor` link in `markdown`, deduplicated, in first-seen order. */
function linksInto(markdown, targetFile) {
  const escaped = targetFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}#([A-Za-z0-9_-]+)`, 'g');
  return [...new Set([...markdown.matchAll(re)].map((m) => m[1]))];
}

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


console.log('\ncross-document links (deliberately duplicated prose)\n');

for (const doc of CROSS_DOC_LINKS) {
  const fromPath = join(REPO, doc.from);
  const toPath = join(REPO, doc.to);

  // A checkout without the checklist is a legitimate state, not a fault: it is
  // optional, and a fork may never have taken it. Nothing to compare, so say so
  // and move on rather than manufacturing an error.
  if (!existsSync(fromPath)) {
    console.log(`  SKIP     ${doc.from} — not in this checkout, nothing to check against ${doc.to}`);
    continue;
  }
  if (!existsSync(toPath)) {
    errors++;
    console.log(`  MISSING  ${doc.to} — but ${doc.from} links into it`);
    continue;
  }

  const fromText = readFileSync(fromPath, 'utf8');
  const toText = readFileSync(toPath, 'utf8');

  const anchors = anchorsOf(toText);
  const links = linksInto(fromText, doc.to);
  const broken = links.filter((a) => !anchors.has(a));

  if (links.length === 0) {
    warnings++;
    console.log(`  WARN     ${doc.from} has no links into ${doc.to}`);
    console.log(`      ${doc.note}`);
    console.log('      Either the checklist stopped deep-linking, or the link format changed');
    console.log('      and this check is now blind. Both are worth a look.');
    console.log('');
  } else if (broken.length === 0) {
    console.log(`  OK       ${doc.from} → ${doc.to}  (${links.length} link${links.length === 1 ? '' : 's'}, all resolve)`);
  } else {
    errors++;
    console.log(`  BROKEN   ${doc.from} → ${doc.to}  (${broken.length} of ${links.length} link${links.length === 1 ? '' : 's'} dead)`);
    console.log(`      ${doc.note}`);
    for (const a of broken) console.log(`        ${doc.to}#${a}`);
    console.log(`      Fix by restoring the heading in ${doc.to}, or updating the link in ${doc.from}.`);
    console.log('');
  }

  // Coverage: numbered sections that the checklist never points at.
  if (doc.sectionPattern) {
    const sections = [...toText.matchAll(new RegExp(doc.sectionPattern.source, 'gm'))].map((m) => m[1]);
    const linked = new Set(links);
    const unlinked = sections.filter(
      (id) => ![...linked].some((a) => a.startsWith(`${id.toLowerCase()}-`) || a === id.toLowerCase()),
    );
    if (unlinked.length > 0) {
      warnings++;
      console.log(`  WARN     ${doc.to} has ${unlinked.length} numbered section${unlinked.length === 1 ? '' : 's'} ${doc.from} never links to:`);
      console.log(`        ${unlinked.join(', ')}`);
      console.log(`      A step in the guide with no line in the checklist is a step someone skips.`);
      console.log('');
    } else if (sections.length > 0) {
      console.log(`  OK       all ${sections.length} numbered ${doc.to} sections are linked from ${doc.from}`);
    }
  }
}
console.log('');
if (errors > 0) {
  console.log(`FAILED — ${errors} problem${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`);
  process.exit(1);
}
console.log(`clean — 0 problems, ${warnings} warning${warnings === 1 ? '' : 's'}`);
process.exit(0);
