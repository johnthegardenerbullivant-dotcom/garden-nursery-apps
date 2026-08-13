# CLAUDE.md — garden-apps monorepo

Loaded automatically when Claude works anywhere in this repo. Shared conventions, the Firebase
data model, and the deploy workflow. Each app has its own `CLAUDE.md` with its module map:
[`apps/garden/CLAUDE.md`](apps/garden/CLAUDE.md) · [`apps/nursery/CLAUDE.md`](apps/nursery/CLAUDE.md).

---

## Snapshot

Two Progressive Web Apps, one Firebase project, one private repo, two Netlify sites.

| | Garden Management | Nursery Management |
|---|---|---|
| What it does | Plant collection, areas, tasks, irrigation, blog/journal, compost bin | Propagation batches from sowing to planted-out, given-away or lost |
| Folder | `apps/garden/` | `apps/nursery/` |
| JS modules | 14 | 19 |
| Live URL | https://johnandkath.garden/ | https://nursery.johnandkath.garden/ |

- **Owner:** John Bullivant
- **Firebase project:** `bbg-garden-inventory` — Firestore + Storage + Auth, shared by both apps
- **They are companions.** Planting out a Nursery batch writes a `plants` record (if needed) and an
  `instances` record straight into Garden's collections — see `plantOutToGarden()` in
  `apps/nursery/js/db.js`. Either app runs standalone; together they share one database.

---

## Repo layout

```
garden-apps/
├── CLAUDE.md                 ← this file: shared conventions + data model
├── README.md
├── .gitignore  .gitattributes
│
├── shared/                   ← ONE copy of the design layer, used by both apps
│   ├── tokens.css            ← :root — colour ramps, spacing, radii, shadows, type
│   ├── base.css              ← reset, header, account menu, main, loading, bottom nav
│   └── components.css        ← buttons, cards, forms, modal, toast, photos, search,
│                                filter chips, empty states, user-management rows
│                                Copied into each app at build time; never served from here.
│                                Load order is tokens → base → components → the app's own
│                                styles.css, so an app can still override any of it.
│
├── apps/
│   ├── garden/               ← Netlify site #1. Base AND publish directory.
│   │   ├── CLAUDE.md         ← Garden module map
│   │   ├── netlify.toml      ← functions/ + the `cp ../../shared` build command
│   │   ├── shared/           ← GENERATED at build time. Gitignored. Never edit.
│   │   ├── firebase-config.js ← REAL credentials (this repo is private)
│   │   ├── index.html  styles.css  manifest.json  sw.js  robots.txt  _headers
│   │   ├── compress-photos.html  ← standalone one-off photo-compression utility
│   │   ├── icons/            ← 3 PNGs
│   │   ├── functions/scan-label.js  ← Netlify function, Gemini label scan
│   │   └── js/               ← 14 ES modules
│   │
│   └── nursery/              ← Netlify site #2. Same shape, 19 JS modules.
│
├── firebase/                 ← deployed by the Firebase CLI, NOT served by Netlify
│   ├── firebase.json  .firebaserc
│   ├── firestore.rules       ← the ONLY copy
│   ├── storage.rules         ← the ONLY copy
│   └── cors.json
│
├── docs/                     ← design notes, specs, the restructure plan
└── tools/
    ├── check-drift.mjs       ← guards the deliberately-duplicated files
    └── find-dead-css.mjs     ← reports unused class selectors; understands
                                 runtime-built names like `stage-${…}`
```

**Private data lives outside the repo** at `C:\Users\johnb\Documents\Claude\Garden Data\` —
`Backups/`, `plant-import.json`, and `Archive/`. Never commit any of it; `.gitignore` covers the
obvious names but the rule is the habit, not the file.

---

## Shared architecture

**Almost no build step.** Native ES modules loaded directly by the browser. No Webpack, no Vite, no
npm, no `node_modules`, no `package.json`. For everything in `apps/garden` and `apps/nursery`, an
edited file is the deployed file.

The one exception, added 2026-08-10: each site's build command is

```
rm -rf shared && cp -r ../../shared shared
```

A folder outside the publish directory is not served to the browser, so the shared design layer at
`/shared` has to be copied inside each app before deploy. Consequences worth knowing:

- **`apps/*/shared/` is generated build output and is gitignored.** Edit `/shared`, never a copy.
  A copy you edit will be silently overwritten by the next build.
- **A fresh checkout has no `apps/*/shared/`**, so opening `apps/garden/index.html` straight off
  disk gives an unstyled page. Run the `cp` line above from the app folder first.
- **Both `netlify.toml` ignore commands watch `../../shared`** as well as `.`, so a change to the
  shared layer rebuilds both sites. Without that a site would skip its build and keep serving the
  previous copy.

Everything third-party comes from a CDN:

| Dependency | Version | Used by |
|---|---|---|
| Firebase SDK (`app`, `firestore`, `storage`, `auth`) | 10.12.0, from `gstatic.com` | both |
| `browser-image-compression` | 2.x, from jsdelivr | both |
| Quill | 1.3.7, from `cdn.quilljs.com` | **Garden only** (blog editor) |

Import paths in JS are either relative (`./db.js`) or full CDN URLs.

**Shared CSS is hoisted; shared JS is still duplicated.** `/shared/tokens.css` and
`/shared/base.css` are the single source for the design tokens and the app shell — that move is
done. `js/auth.js` and `functions/scan-label.js` are still byte-identical copies in both apps, and
`js/ui-utils.js` is close, with `tools/check-drift.mjs` diffing them and reporting divergence. The
`cp` build command now exists, so hoisting those into `/shared` too is a small follow-on whenever
it is worth doing.

### Role system

Three roles, enforced by `isAtLeast()` in each app's `js/auth.js`:

```
viewer  (rank 1) — read-only; auto-assigned to anonymous (guest) users
editor  (rank 2) — can add/edit content
admin   (rank 3) — full access including delete, backup/restore, admin panel
```

Stored at `users/{uid}` as `{ role, blocked }`. Anonymous users are assigned `viewer` in memory
with no Firestore document. Both apps read the same `users` collection, so a role granted in one
applies to both.

There is also an implicit fourth state: a user document with **no `role` and not `blocked`** is
*pending* — someone who has signed in but hasn't been granted access yet. Both Admin panels surface
these separately so they can be granted a role or blocked.

---

## Firestore data model

**→ [`docs/data-model.md`](docs/data-model.md)** — all 18 collections with their document shapes, the
enumerated values (stages, methods, outcomes, loss reasons), the Storage layout, and the two
cross-app write paths.

Short version: one project, 18 collections. Garden owns twelve, Nursery owns the six `nursery_*`
ones, and `users` is shared so a role granted in one app applies to both. Nursery also reads and
writes Garden's `plants`, `instances` and `areas` when planting out.

---

## Deploying

### App code — push to `main`, Netlify builds

Both Netlify sites are linked to this repo with a **base directory** (`apps/garden` /
`apps/nursery`) and an empty build command. A push only rebuilds the site whose folder changed.

```
git switch -c feature/thing     # main is always deployable
# …edit, then node --check every JS file you touched…
git commit -m "feat: thing"
git push -u origin feature/thing
```

Netlify builds a **deploy preview**, but only for a **pull request** against `main` — pushing a
branch on its own produces nothing. Open the PR, then take the preview URL from the Netlify bot's
comment or the `netlify/…/deploy-preview` checks at the foot of the PR. Look at the working site
there, then merge to `main` for production. Tag releases instead of copying folders:

```
git tag v2.2 && git push --tags
```

#### Signing in to a deploy preview — use email/password, not Google

**Google sign-in always fails on a preview.** The popup opens and closes instantly. This is not a
broken build: Firebase Auth only permits OAuth popups from hosts on its **Authorized domains** list
(Console → Authentication → Settings), preview URLs are `deploy-preview-<PR>--<site>.netlify.app`,
and that host changes with every PR. Firebase does not accept wildcards, so no single entry covers
them. The error behind the flash is `auth/unauthorized-domain`.

Email/password sign-in is **not** domain-restricted, so it works on any preview. As of August 2026
there is a dedicated email/password admin account for exactly this. On a preview, scroll past the
Google button and use the **Email** form.

Anonymous *Continue as Guest* also works, but guests are `viewer` — read-only, so no add or edit
forms. It is only good enough for checking list and detail layouts.

Adding each preview host to Authorized domains by hand is the alternative, but it is two entries
per PR (one per site) and they accumulate. Prefer the email account.

**Rollback:** Netlify → Deploys → pick the last good deploy → *Publish deploy*. Instant.

Netlify's secret scanner trips on the `AIza…` Firebase key format, so both sites set
`SECRETS_SCAN_OMIT_PATHS = firebase-config.js`. That key is already readable by anyone who views
source on the live site — Firestore rules are what protect the data, not the key's obscurity.

### Security rules — one file, one CLI command

`firestore.rules` and `storage.rules` exist in **exactly one place**, `firebase/`. They are
deployed by the Firebase CLI, never served by Netlify, and never pasted into the Console:

```
cd firebase
firebase deploy --only firestore:rules,storage
```

`.firebaserc` already pins the project, so `firebase use` isn't needed. `firebase.json` deliberately
omits `indexes` and `hosting`, so deploying rules can't clobber composite indexes or fight Netlify.

---

## Standing rules

1. **`node --check` every JS file after generating or moving any of them.** All 39: 15 Garden
   modules, 20 Nursery modules, 2 `functions/scan-label.js`, 2 `functions/lookup-plant.js`. If it
   reports an error, treat it as real — never dismiss it as a false alarm.
2. **No AI-authored production deploys without John's review.** Push to a branch, look at the
   Netlify deploy preview, then merge. Never straight to `main`.
3. **A new Firestore collection in a `db.js` needs its rule block in `firebase/firestore.rules` in
   the same commit.** Firestore denies anything not explicitly matched, and it fails *silently* in
   the app. This has bitten before: in May 2026 `irrigationZones` and `irrigationLogs` were in
   `db.js` but missing from the rules, and the Admin panel broke.
4. **Run `node tools/check-drift.mjs` before pushing changes to `auth.js`, `ui-utils.js`,
   `scan-label.js`, `functions/lookup-plant.js` or `js/plant-lookup.js`.** Exit 0 is clean;
   warnings are known deltas.
5. **Never commit a backup JSON or `plant-import.json`.** They belong in `Garden Data\`.
6. **Commit style:** conventional prefixes — `feat:`, `fix:`, `chore:`, `docs:`. Branches:
   `feature/…`, `fix/…`.

---

## Known issues

**→ [`docs/backlog.md`](docs/backlog.md)** — agreed future changes, deferred deliberately. Currently:
the Storage rules don't exclude anonymous guests; `nursery_wishlist` needs to match Garden's
`suggestions` behaviour; and each app's `CLAUDE.md` is served publicly. Read it before assuming
something is a new bug.

## Build skipping

Each app's `netlify.toml` carries an `ignore` command so a push only rebuilds the site whose folder
changed. **A base directory does not scope builds on its own** — Netlify rebuilds every connected
site on any push unless you add this. If you ever change one, verify both directions: touch a Garden
file and confirm Nursery skips, then the reverse.

---

## History

Both sites serve from the custom domain `johnandkath.garden`, so Netlify's own
`*.netlify.app` site names aren't recorded here — identify each site in the Netlify dashboard by its
domain.

Repo history before 2026-08 is in `Garden Data\Archive\CHANGELOG.md`, outside git — it was archived
during the restructure on the grounds that git history supersedes it. From 2026-08 onward, per-change
detail lives in commit messages. The restructure itself is documented in
[`docs/restructure-plan.md`](docs/restructure-plan.md).
