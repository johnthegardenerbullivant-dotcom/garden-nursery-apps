# garden-apps 🌿

A monorepo for two Progressive Web Apps that share one Firebase project:

- **Garden Management** (`apps/garden`) — plant collection by area, tasks, irrigation, a garden
  journal/blog, and a compost-bin log of plants that didn't make it.
- **Nursery Management** (`apps/nursery`) — propagation batches from first sowing through to
  planted-out, given away, retired or lost.

They're companions: plant out a batch in Nursery and it appears as a specimen in Garden
automatically. Either runs on its own.

Each installation runs its own copy — its own Firebase project, its own data, its own web address.
Nothing in this repository is specific to any one of them; see [`SETUP.md`](SETUP.md) to stand one
up.

## Layout

```
apps/garden/     Netlify site #1 — base and publish directory
apps/nursery/    Netlify site #2 — same
firebase/        firestore.rules, storage.rules, cors.json — one copy, deployed by CLI
docs/            design notes, the label-scan spec, the restructure plan
tools/           build.mjs, check-drift.mjs, check-public.mjs, find-dead-css.mjs
SETUP.md         how to stand up your own copy, from nothing
CHANGELOG.md     what each release asks of you if you run a copy
```

## Deploying

Both Netlify sites build from this repo. The app itself is plain HTML, CSS and native ES modules
with Firebase and Quill loaded from CDNs — no bundler, no npm, no `node_modules`. The only build is
`tools/build.mjs`, which copies the shared design layer into the app folder and generates
`firebase-config.js` and `app-config.js` from environment variables:

```bash
node tools/build.mjs garden
```

Run that once after a fresh clone, or the app opens unstyled and unconfigured. It reads a gitignored
`.env` at the repo root locally, and the site's environment variables on Netlify.

```bash
git switch -c feature/thing && git commit -am "feat: thing" && git push -u origin feature/thing
```

Netlify builds a deploy preview for the branch. Check the real working site there, then merge to
`main` for production. A push only rebuilds the site whose folder changed. Tag releases with
`git tag v2.2 && git push --tags`.

Security rules deploy separately, from `firebase/`:

```bash
firebase deploy --only firestore:rules,storage
```

## Before you push

```bash
node --check apps/garden/js/*.js apps/nursery/js/*.js apps/*/functions/*.js tools/*.mjs
node tools/check-drift.mjs
```

`check-drift.mjs` guards the files that are duplicated between the two apps on purpose — `auth.js`,
`ui-utils.js` and `scan-label.js` — and fails if the ones meant to be identical have diverged.

## Notes

As of 2026-08-20 this repository contains **no** Firebase credentials — they are generated at build
time from environment variables. That config was never really a secret (anyone can read it from a
live site's source, and Firestore rules are what protect the data); it is out of git so that a copy
has **no file its owner must edit**, and can therefore take updates as a clean fast-forward. See
[`docs/distribution-plan.md`](docs/distribution-plan.md).

Backups, `plant-import.json`, the backlog and archived material live **outside** the repo. In a
working checkout, a gitignored `LOCAL.md` records where — along with the project ID and live URLs,
which are deliberately not tracked so a fork doesn't inherit another installation's details.
Never commit any of it.

Architecture and working conventions are in **[`CLAUDE.md`](CLAUDE.md)**, the Firestore data model in
[`docs/data-model.md`](docs/data-model.md), and per-app module maps in
[`apps/garden/CLAUDE.md`](apps/garden/CLAUDE.md) and
[`apps/nursery/CLAUDE.md`](apps/nursery/CLAUDE.md).

## Copies and support

You're welcome to run your own copy — **[`SETUP.md`](SETUP.md)** takes you from nothing to a working
installation. Fork **https://github.com/johnthegardenerbullivant-dotcom/garden-nursery-apps** rather
than downloading it: a fork keeps the link upstream, so GitHub's **Sync fork** button pulls in later
releases with one click. Nothing in this repository is installation-specific, so a sync is always a
clean fast-forward.

Read **[`CHANGELOG.md`](CHANGELOG.md)** after syncing. Netlify rebuilds your sites for you, but it
cannot deploy security rules or add environment variables, and both fail *quietly* — every entry
carries an **Action required** line for exactly that reason.

**No warranty and no promise of support.** This is a personal project shared in the hope it's
useful, not a product. It is offered under the [MIT license](LICENSE), which means you can do
essentially what you like with it and it comes with no guarantees. Your copy is yours: your Firebase
project, your data, your bill. Bug reports and questions are welcome and may go unanswered.

**If something's wrong, start with [`SUPPORT.md`](SUPPORT.md)** — most problems are one of about
five things, and the commonest of them (every list empty, no error) is security rules that haven't
been deployed. Bugs go in [Issues](../../issues/new/choose); questions and ideas belong in
[Discussions](../../discussions).
