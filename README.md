# garden-apps 🌿

Private monorepo for two Progressive Web Apps that share one Firebase project:

- **Garden Management** (`apps/garden`) — plant collection by area, tasks, irrigation, a garden
  journal/blog, and a compost-bin log of plants that didn't make it.
- **Nursery Management** (`apps/nursery`) — propagation batches from first sowing through to
  planted-out, given away, retired or lost.

They're companions: plant out a batch in Nursery and it appears as a specimen in Garden
automatically. Either runs on its own.

**Live sites:** [johnandkath.garden](https://johnandkath.garden/) ·
[nursery.johnandkath.garden](https://nursery.johnandkath.garden/)

## Layout

```
apps/garden/     Netlify site #1 — base and publish directory
apps/nursery/    Netlify site #2 — same
firebase/        firestore.rules, storage.rules, cors.json — one copy, deployed by CLI
docs/            design notes, the label-scan spec, the restructure plan
tools/           build.mjs, check-drift.mjs, find-dead-css.mjs
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

This repo is **private**, and as of 2026-08-20 it contains **no** Firebase credentials — they are
generated at build time from environment variables. That config was never really a secret (anyone
can read it from the live site's source, and Firestore rules are what protect the data); it is out
of git so that a copy of this repo has no file its owner must edit, and can therefore take updates
as a clean fast-forward. See [`docs/distribution-plan.md`](docs/distribution-plan.md).

Backups, `plant-import.json` and archived material live **outside** the repo, in
`C:\Users\johnb\Documents\Claude\Garden Data\`. Never commit them.

Architecture and working conventions are in **[`CLAUDE.md`](CLAUDE.md)**, the Firestore data model in
[`docs/data-model.md`](docs/data-model.md), and per-app module maps in
[`apps/garden/CLAUDE.md`](apps/garden/CLAUDE.md) and
[`apps/nursery/CLAUDE.md`](apps/nursery/CLAUDE.md).
