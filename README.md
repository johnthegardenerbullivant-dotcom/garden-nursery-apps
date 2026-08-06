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
tools/           check-drift.mjs
```

## Deploying

Both Netlify sites build from this repo. There is **no build step** — plain HTML, CSS and native ES
modules, with Firebase and Quill loaded from CDNs. Netlify just serves the app folder.

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
node --check apps/garden/js/*.js apps/nursery/js/*.js apps/*/functions/scan-label.js
node tools/check-drift.mjs
```

`check-drift.mjs` guards the files that are duplicated between the two apps on purpose — `auth.js`,
`ui-utils.js` and `scan-label.js` — and fails if the ones meant to be identical have diverged.

## Notes

This repo is **private** and contains real Firebase credentials in `apps/*/firebase-config.js`. That
config is already public in the sense that anyone can read it from the live site's source — Firestore
security rules are what protect the data. Keep the repo private anyway.

Backups, `plant-import.json` and archived material live **outside** the repo, in
`C:\Users\johnb\Documents\Claude\Garden Data\`. Never commit them.

Architecture and working conventions are in **[`CLAUDE.md`](CLAUDE.md)**, the Firestore data model in
[`docs/data-model.md`](docs/data-model.md), and per-app module maps in
[`apps/garden/CLAUDE.md`](apps/garden/CLAUDE.md) and
[`apps/nursery/CLAUDE.md`](apps/nursery/CLAUDE.md).
