// =============================================================
//  find-dead-css.mjs — report CSS class selectors that nothing uses
// =============================================================
//  Usage:  node tools/find-dead-css.mjs garden
//          node tools/find-dead-css.mjs nursery
//
//  Why this exists: Nursery's stylesheet is a fork of Garden's, so it
//  inherited every irrigation, blog and task rule Garden has and Nursery
//  will never use. Deleting them by eye is how you delete a live one by
//  mistake.
//
//  The part that matters is DYNAMIC class names. Both apps build class
//  strings at runtime:
//
//      class="stage-badge stage-${batch.stage}"
//      class="origin-tag origin-${isAcquired ? 'acquired' : 'created'}"
//
//  A naive "is the literal string .stage-propagating anywhere in the JS"
//  check says no and happily deletes a class that is very much in use. So
//  every `foo-${` occurrence in the source registers `foo-` as a live
//  prefix, and any class starting with it is treated as used.
//
//  Exit code is always 0 — this reports, it does not gate.
// =============================================================

import fs from 'node:fs';
import path from 'node:path';

const app = process.argv[2];
if (!['garden', 'nursery'].includes(app)) {
    console.error('usage: node tools/find-dead-css.mjs <garden|nursery>');
    process.exit(2);
}

const root    = path.resolve('apps', app);
const cssFile = path.join(root, 'styles.css');

// Source the class could legitimately be referenced from: this app's JS and
// HTML, plus the shared layer both apps load.
const sources = [
    ...fs.readdirSync(path.join(root, 'js')).map(f => path.join(root, 'js', f)),
    path.join(root, 'index.html'),
    'shared/base.css',
    'shared/tokens.css',
].filter(p => fs.existsSync(p) && fs.statSync(p).isFile());

const source = sources.map(p => fs.readFileSync(p, 'utf8')).join('\n');
const css    = fs.readFileSync(cssFile, 'utf8');

// ---- every class selector declared in this stylesheet -------------------
const declared = new Set();
for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    declared.add(m[1]);
}

// ---- live prefixes from runtime-built class names -----------------------
// `stage-${…}` in a template literal means anything starting "stage-" is live.
const livePrefixes = new Set();
for (const m of source.matchAll(/([_a-zA-Z][\w-]*-)\$\{/g)) livePrefixes.add(m[1]);

// ---- classify -----------------------------------------------------------
const used = [], dynamic = [], dead = [];
for (const cls of [...declared].sort()) {
    if (new RegExp(`[."'\\s\`]${cls}[\\s"'\`.,)\\]]|\\b${cls}\\b`).test(source)) { used.push(cls); continue; }
    const prefix = [...livePrefixes].find(p => cls.startsWith(p));
    if (prefix) { dynamic.push(`${cls}  (matches runtime prefix "${prefix}")`); continue; }
    dead.push(cls);
}

console.log(`\n${app}: ${declared.size} classes declared in styles.css`);
console.log(`  ${used.length} referenced directly`);
console.log(`  ${dynamic.length} referenced via a runtime-built name`);
console.log(`  ${dead.length} with no reference found\n`);

if (dynamic.length) {
    console.log('KEPT — built at runtime, a literal search would miss these:');
    for (const d of dynamic) console.log('  ' + d);
    console.log('');
}

if (dead.length) {
    console.log('NO REFERENCE FOUND:');
    for (const d of dead) console.log('  .' + d);
    console.log('\nCheck a sample by hand before deleting. This tool cannot see');
    console.log('a class name assembled from pieces or held in a variable.\n');
}
