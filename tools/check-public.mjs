#!/usr/bin/env node
/**
 * check-public.mjs
 *
 * Answers one question: "have I actually released what I merged?"
 *
 * Development happens on a private `origin`. Releases are published by pushing
 * to a separate public remote that people fork:
 *
 *     git push public main
 *
 * Merging a pull request publishes NOTHING. That separation is deliberate — it
 * is what lets changes live on the author's own sites for a while before anyone
 * else sees them — but it means "merged" and "released" are different states,
 * and the gap is invisible unless you go looking. It has caused a public copy of
 * SETUP.md to sit for hours with figures the author had already corrected.
 *
 * Usage, from anywhere in the repo:
 *     node tools/check-public.mjs
 *
 * Exit codes:  0 = in sync, or nothing to compare   1 = unreleased commits
 *
 * In a fork there is no `public` remote, so this reports that and exits 0.
 * It is a maintainer's tool and harmless everywhere else.
 */

import { execSync } from 'node:child_process';

const BRANCH = 'main';

function git(args, { allowFail = false } = {}) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

// ---------------------------------------------------------------
//  Is there a public remote at all?
// ---------------------------------------------------------------

const remotes = (git('remote', { allowFail: true }) || '').split('\n').filter(Boolean);

if (!remotes.includes('public')) {
  console.log('check-public: no "public" remote is configured.');
  console.log('  Nothing to compare — this is normal in a fork, or before a public');
  console.log('  release repo exists. See docs/distribution-plan.md.');
  process.exit(0);
}

// ---------------------------------------------------------------
//  Refresh both sides, so the answer is about now and not last week
// ---------------------------------------------------------------

console.log('check-public: fetching…');
const fetchedOrigin = git(`fetch --quiet origin ${BRANCH}`, { allowFail: true }) !== null;
const fetchedPublic = git(`fetch --quiet public ${BRANCH}`, { allowFail: true }) !== null;

if (!fetchedOrigin || !fetchedPublic) {
  console.log('  ⚠ Could not reach one of the remotes — offline? The comparison below');
  console.log('    uses whatever was last fetched and may be stale.');
}

// ---------------------------------------------------------------
//  Compare
// ---------------------------------------------------------------

const originRef = `origin/${BRANCH}`;
const publicRef = `public/${BRANCH}`;

if (git(`rev-parse --verify --quiet ${publicRef}`, { allowFail: true }) === null) {
  console.log(`check-public: ${publicRef} does not exist yet — nothing has been published.`);
  console.log(`  Publish with:  git push public ${BRANCH}`);
  process.exit(1);
}

const counts = git(`rev-list --left-right --count ${originRef}...${publicRef}`);
const [unreleased, aheadOfOrigin] = counts.split(/\s+/).map(Number);

// Local work that has not even reached origin yet is worth mentioning, because
// it is a different problem with a different fix.
const localUnpushed = Number(
  git(`rev-list --count ${originRef}..${BRANCH}`, { allowFail: true }) || 0
);

console.log('');

if (aheadOfOrigin > 0) {
  console.log(`  ⚠ ${publicRef} is ${aheadOfOrigin} commit(s) AHEAD of ${originRef}.`);
  console.log('    Something was published that is not on the private main. Investigate');
  console.log('    before pushing anything else.');
}

if (unreleased === 0) {
  console.log(`  ✅ Released. ${publicRef} matches ${originRef}.`);
} else {
  console.log(`  ${unreleased} commit(s) merged but NOT published:`);
  console.log('');
  console.log(git(`log --oneline ${publicRef}..${originRef}`).split('\n').map(l => '    ' + l).join('\n'));
  console.log('');
  console.log(`  Publish with:  git push public ${BRANCH}`);
}

if (localUnpushed > 0) {
  console.log('');
  console.log(`  Note: ${localUnpushed} local commit(s) on ${BRANCH} have not reached ${originRef} either.`);
}

process.exit(unreleased > 0 ? 1 : 0);
