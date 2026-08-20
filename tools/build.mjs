#!/usr/bin/env node
/**
 * build.mjs
 *
 * The whole build, for one app. Run by each site's netlify.toml, and by hand
 * for local work.
 *
 * It does three things, all of which produce GENERATED, GITIGNORED files:
 *
 *   1. Copies /shared into apps/<app>/shared, because a folder outside the
 *      publish directory is not served to the browser.
 *   2. Writes apps/<app>/firebase-config.js from six environment variables.
 *   3. Writes apps/<app>/app-config.js from GARDEN_URL.
 *
 * Steps 2 and 3 are why this file exists at all. Keeping the Firebase
 * credentials and the cross-app link OUT of git means a copy of this repo
 * never has to edit a tracked file — which in turn means an update is always a
 * clean fast-forward and GitHub's "Sync fork" button just works. Every tracked
 * file a copy owner has to edit is a merge conflict on every future update.
 * See docs/distribution-plan.md.
 *
 * Usage, from anywhere in the repo:
 *     node tools/build.mjs garden
 *     node tools/build.mjs nursery
 *
 * Environment variables (set per Netlify site — Netlify env is NOT shared
 * between sites, so each one needs its own copy):
 *
 *   FIREBASE_API_KEY              ─┐
 *   FIREBASE_AUTH_DOMAIN           │  All six come straight from the Firebase
 *   FIREBASE_PROJECT_ID            │  console: Project settings → Your apps.
 *   FIREBASE_STORAGE_BUCKET        │  Both apps take the SAME six values —
 *   FIREBASE_MESSAGING_SENDER_ID   │  they deliberately share one project.
 *   FIREBASE_APP_ID               ─┘
 *
 *   GARDEN_URL   Optional. The Garden site's address, e.g. https://example.garden
 *                Nursery links back to Garden in two places and hides those
 *                links when this is unset. Nursery-only; harmless in Garden.
 *
 * For local work, put the same values in a .env file at the repo root (it is
 * gitignored). Real environment variables win over the file.
 *
 * A MISSING VARIABLE IS NOT A BUILD FAILURE. The placeholder written instead
 * starts with REPLACE_WITH, which is exactly what db.js tests for before it
 * calls initializeApp() — so an unconfigured copy shows the "Setup required"
 * overlay rather than a white screen or a stack trace. Failing the build here
 * would tell a first-time copy owner far less than the app itself does.
 *
 * Exit codes:  0 = built (with or without config)   1 = bad usage / IO error
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync,
  readdirSync, copyFileSync
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS = ['garden', 'nursery'];

// The six Firebase config keys, and the environment variable each is read from.
// Order matters only in that it is the order they appear in the generated file.
const FIREBASE_KEYS = {
  apiKey:            'FIREBASE_API_KEY',
  authDomain:        'FIREBASE_AUTH_DOMAIN',
  projectId:         'FIREBASE_PROJECT_ID',
  storageBucket:     'FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId:             'FIREBASE_APP_ID',
};

// ---------------------------------------------------------------
//  Arguments
// ---------------------------------------------------------------

const app = process.argv[2];

if (!APPS.includes(app)) {
  console.error(`build.mjs: expected one of ${APPS.join(' | ')}, got ${app ? `"${app}"` : 'nothing'}`);
  console.error('Usage: node tools/build.mjs <garden|nursery>');
  process.exit(1);
}

const APP_DIR = join(REPO, 'apps', app);

if (!existsSync(APP_DIR)) {
  console.error(`build.mjs: no such app folder: ${APP_DIR}`);
  process.exit(1);
}

// ---------------------------------------------------------------
//  .env (local convenience only — Netlify sets real env vars)
// ---------------------------------------------------------------

/**
 * Reads KEY=value lines from .env at the repo root into a plain object.
 * Deliberately minimal: no dependencies (this repo has no node_modules), no
 * interpolation, no multi-line values. Blank lines and # comments are skipped,
 * and one matching pair of surrounding quotes is stripped.
 */
function readDotEnv() {
  const path = join(REPO, '.env');
  if (!existsSync(path)) return {};

  const out = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value  = line.slice(eq + 1).trim();

    if (value.length >= 2 &&
        ((value.startsWith('"')  && value.endsWith('"')) ||
         (value.startsWith("'")  && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const dotEnv = readDotEnv();

/** A real environment variable always beats the .env file. */
function env(name) {
  const value = process.env[name] ?? dotEnv[name];
  return value === undefined || value === '' ? null : value;
}

// ---------------------------------------------------------------
//  1. Copy the shared design layer
// ---------------------------------------------------------------

/**
 * Recursive directory copy. Hand-rolled rather than fs.cpSync() because that
 * is still flagged experimental on some Node versions and prints a warning
 * into every build log.
 */
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}

function copyShared() {
  const from = join(REPO, 'shared');
  const to   = join(APP_DIR, 'shared');

  if (!existsSync(from)) {
    console.error(`build.mjs: /shared is missing at ${from} — nothing to copy.`);
    process.exit(1);
  }

  // Remove first: Netlify may restore a cached working directory, and copying
  // into an existing folder would leave behind files deleted upstream.
  rmSync(to, { recursive: true, force: true });
  copyDir(from, to);

  const count = readdirSync(to).length;
  console.log(`  shared/         ${count} file(s) copied from /shared`);
}

// ---------------------------------------------------------------
//  2. firebase-config.js
// ---------------------------------------------------------------

function writeFirebaseConfig() {
  const missing = [];
  const values  = {};

  for (const [key, name] of Object.entries(FIREBASE_KEYS)) {
    const value = env(name);
    if (value === null) missing.push(name);
    // The placeholder MUST start with REPLACE_WITH — db.js checks for exactly
    // that prefix to decide whether to show the "Setup required" overlay.
    values[key] = value ?? `REPLACE_WITH_YOUR_${name}`;
  }

  const width = Math.max(...Object.keys(values).map(k => k.length));
  const body  = Object.entries(values)
    .map(([k, v]) => `    ${k}:${' '.repeat(width - k.length)} ${JSON.stringify(v)}`)
    .join(',\n');

  const file = `// =============================================================
//  GENERATED FILE — DO NOT EDIT, AND DO NOT COMMIT.
//  Written by tools/build.mjs from environment variables.
//  Anything you type here is overwritten by the next build.
//
//  To change these values, change the FIREBASE_* environment
//  variables on the Netlify site (or in .env for local work).
// =============================================================

export const firebaseConfig = {
${body}
};
`;

  writeFileSync(join(APP_DIR, 'firebase-config.js'), file);

  if (missing.length) {
    console.log('  firebase-config.js  ⚠ written with PLACEHOLDERS');
    console.log(`                      missing: ${missing.join(', ')}`);
  } else {
    console.log(`  firebase-config.js  project ${values.projectId}`);
  }
  return missing;
}

// ---------------------------------------------------------------
//  3. app-config.js
// ---------------------------------------------------------------

function writeAppConfig() {
  // Trailing slashes are stripped so call sites can append a path safely —
  // batch-detail.js builds `${GARDEN_URL}/#plant-detail/${id}`.
  const gardenUrl = (env('GARDEN_URL') ?? '').replace(/\/+$/, '');

  const file = `// =============================================================
//  GENERATED FILE — DO NOT EDIT, AND DO NOT COMMIT.
//  Written by tools/build.mjs from environment variables.
//
//  GARDEN_URL is the companion Garden site's address. Nursery
//  links back to Garden in two places and hides those links when
//  this is an empty string, so a Nursery-only installation shows
//  no links to a site that does not exist.
// =============================================================

export const GARDEN_URL = ${JSON.stringify(gardenUrl)};
`;

  writeFileSync(join(APP_DIR, 'app-config.js'), file);
  console.log(`  app-config.js       GARDEN_URL ${gardenUrl || '(unset — cross-app links hidden)'}`);
}

// ---------------------------------------------------------------
//  Run
// ---------------------------------------------------------------

console.log(`build.mjs: building apps/${app}`);

copyShared();
const missing = writeFirebaseConfig();
writeAppConfig();

if (missing.length) {
  console.log('');
  console.log('  ⚠  This app will show the "Setup required" screen until the');
  console.log('     missing variables above are set on this Netlify site.');
  console.log('     Environment variables are per site — set them on each.');
}

console.log('build.mjs: done');
