# CLAUDE.md — garden-apps monorepo

Loaded automatically when Claude works anywhere in this repo. Shared conventions, the Firebase
data model, and the deploy workflow. Each app has its own `CLAUDE.md` with its module map:
[`apps/garden/CLAUDE.md`](apps/garden/CLAUDE.md) · [`apps/nursery/CLAUDE.md`](apps/nursery/CLAUDE.md).

---

## Snapshot

Two Progressive Web Apps, one Firebase project, one repo, two Netlify sites.

| | Garden Management | Nursery Management |
|---|---|---|
| What it does | Plant collection, areas, tasks, irrigation, blog/journal, compost bin | Propagation batches from sowing to planted-out, given-away or lost |
| Folder | `apps/garden/` | `apps/nursery/` |
| JS modules | 15 | 20 |
| Netlify site | #1 | #2 |

- **Firebase project:** one project — Firestore + Storage + Auth — **shared by both apps**. Which
  project is set per installation, via the `FIREBASE_*` environment variables on each Netlify site;
  nothing in this repo names it.
- **Installation-specific details** — project ID, live URLs, where the private data folder is on
  this machine — live in **`LOCAL.md`** at the repo root, which is gitignored. If this checkout has
  one, read it. A fresh clone won't, and nothing breaks without it.
- **They are companions, and they write into each other in both directions.** Planting out a Nursery
  batch writes a `plants` record (if needed) and an `instances` record straight into Garden's
  collections (`plantOutToGarden()`, `apps/nursery/js/db.js`); transferring a garden plant to the
  nursery writes a `nursery_batches` document (`transferToNursery()`, `apps/garden/js/db.js`).
  Both are plain Firestore writes inside the shared project, not network calls between the sites.
  Either app runs standalone; together they share one database.

---

## Repo layout

```
garden-apps/
├── CLAUDE.md                 ← this file: shared conventions + data model
├── README.md
├── SETUP.md                  ← friend-facing: stand up a copy from nothing. The
│                                authority on the WHY — docs/making-a-copy.md points
│                                here rather than repeating it.
├── QUICKSTART.md             ← the same journey as a checklist, no reasoning.
│                                DELIBERATE DUPLICATION, and the only place in this
│                                repo where instructions are stated twice. If you
│                                change a step, a value or a section number in
│                                SETUP.md, change it here in the same commit — the
│                                checklist deep-links to SETUP.md's anchors, so a
│                                renamed heading silently breaks them. SETUP.md wins
│                                any disagreement.
├── CHANGELOG.md              ← one entry per release, each with an "Action required"
│                                line. A fork owner's sync updates files but cannot
│                                deploy rules or add env vars; both fail silently.
├── SUPPORT.md                ← what to try first, and where to report. The
│                                "every list is empty" entry is the one that
│                                matters: rules not deployed, and it is silent.
├── LICENSE                   ← MIT
├── .github/ISSUE_TEMPLATE/   ← bug + feature forms, and links to Discussions.
│                                The bug form REQUIRES answering whether the
│                                CHANGELOG "Action required" steps were done.
├── .gitignore  .gitattributes
│
├── shared/                   ← ONE copy of the design layer, used by both apps
│   ├── tokens.css            ← :root — color ramps, spacing, radii, shadows, type
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
│   │   ├── netlify.toml      ← functions/, the build.mjs command, secret-scan settings
│   │   ├── shared/           ← GENERATED at build time. Gitignored. Never edit.
│   │   ├── firebase-config.js ← GENERATED at build time from FIREBASE_*. Gitignored.
│   │   ├── app-config.js     ← GENERATED at build time from GARDEN_URL. Gitignored.
│   │   ├── index.html  styles.css  manifest.json  sw.js  robots.txt  _headers
│   │   ├── compress-photos.html  ← standalone one-off photo-compression utility
│   │   ├── icons/            ← 3 PNGs
│   │   ├── functions/         ← 2 Netlify functions, both calling Gemini:
│   │   │                        scan-label.js · lookup-plant.js
│   │   └── js/               ← 15 ES modules
│   │
│   └── nursery/              ← Netlify site #2. Same shape, 20 JS modules.
│
├── firebase/                 ← deployed by the Firebase CLI, NOT served by Netlify
│   ├── firebase.json         ← .firebaserc sits here too, but is gitignored:
│   │                            `firebase use --add` writes it per checkout
│   ├── firestore.rules       ← the ONLY copy
│   ├── storage.rules         ← the ONLY copy
│   └── cors.json
│
├── docs/                     ← design notes, specs, the restructure plan
└── tools/
    ├── build.mjs             ← THE build: copies /shared, generates the two config files
    ├── check-public.mjs      ← "have I released what I merged?" Merging publishes
    │                            NOTHING; a separate push to the public remote does.
    ├── check-drift.mjs       ← guards the deliberately-duplicated files
    └── find-dead-css.mjs     ← reports unused class selectors; understands
                                 runtime-built names like `stage-${…}`
```

**Private data lives outside the repo entirely** — backups, the bulk plant import, the backlog and
archived material. `LOCAL.md` says where, on this machine. Never commit any of it; `.gitignore`
covers the obvious names but the rule is the habit, not the file.

---

## Shared architecture

**Almost no build step.** Native ES modules loaded directly by the browser. No Webpack, no Vite, no
npm, no `node_modules`, no `package.json`. For everything in `apps/garden` and `apps/nursery`, an
edited file is the deployed file.

The exception is `tools/build.mjs`, which is each site's entire build command:

```
node ../../tools/build.mjs garden      # `nursery` on the other site
```

It began (2026-08-10) as a one-line `cp` of the shared design layer, and grew (2026-08-20) to
generate the config files too. It does three things, and **all three outputs are gitignored build
artefacts**:

| Output | From | Why it is generated |
|---|---|---|
| `apps/*/shared/` | `/shared` | A folder outside the publish directory is not served to the browser |
| `apps/*/firebase-config.js` | six `FIREBASE_*` env vars | Keeps credentials out of git |
| `apps/*/app-config.js` | `GARDEN_URL` | Keeps the cross-app link out of git |

Consequences worth knowing:

- **Never edit any of those three.** Edit `/shared` or the environment variable; a hand-edit is
  silently overwritten by the next build.
- **A fresh checkout has none of them**, so opening `apps/garden/index.html` straight off disk gives
  an unstyled, unconfigured page. Run `node tools/build.mjs garden` first. Locally the script reads
  a gitignored `.env` at the repo root; on Netlify it reads the site's environment variables.
- **Both `netlify.toml` ignore commands watch `../../shared` and `../../tools/build.mjs`** as well
  as `.`, so a change to either rebuilds both sites. Without that a site would skip its build and
  keep serving output from the previous version.
- **A missing variable is not a build failure** — the placeholder written instead starts with
  `REPLACE_WITH`, which is what `db.js` tests for before calling `initializeApp()`, so the app shows
  its "Setup required" overlay. **A corrupt one is** a build failure: leading/trailing whitespace,
  any non-ASCII character, or an `apiKey` not shaped like `AIza` + 35 characters stops the build.
  That guard exists because a masked paste of the API key once sailed through a green build and
  only surfaced as `auth/api-key-not-valid` at sign-in.

**Why generate rather than commit?** So that a copy of this repo contains no file its owner has to
edit, and can therefore take updates as a clean fast-forward instead of a merge conflict in the same
three files every time. See [`docs/distribution-plan.md`](docs/distribution-plan.md).

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
`apps/nursery`) and the `tools/build.mjs` command from their `netlify.toml`. A push only rebuilds
the site whose folder changed.

Each site needs the six `FIREBASE_*` variables set on it — the same six values on both, since the
two apps share one Firebase project — plus `GARDEN_URL` on Nursery. Netlify environment variables
are **per site**, not shared between them, and only take effect on the next build.

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

Netlify's secret scanner stops a build when it finds the **value of an environment variable** in the
build output — which, since the config is generated from `FIREBASE_*`, is exactly what
`firebase-config.js` is. Both `netlify.toml` therefore set `SECRETS_SCAN_OMIT_PATHS` and
`SECRETS_SCAN_OMIT_KEYS` under `[build.environment]`. They live in the repo rather than the Netlify
UI so that a fresh copy builds first time without anyone having to be told about the setting. That
key is already readable by anyone who views source on the live site — Firestore rules are what
protect the data, not the key's obscurity.

### Security rules — one file, one CLI command

`firestore.rules` and `storage.rules` exist in **exactly one place**, `firebase/`. They are
deployed by the Firebase CLI, never served by Netlify, and never pasted into the Console:

```
cd firebase
firebase deploy --only firestore:rules,storage
```

`.firebaserc` pins the project so `firebase use` isn't needed — but it is **gitignored** as of
2026-08-20, because it names one specific Firebase project and a copy of this repo needs its own.
It is still present in this checkout; a fresh clone creates it with `firebase use --add`.
`firebase.json` deliberately omits `indexes` and `hosting`, so deploying rules can't clobber
composite indexes or fight Netlify.

---

## Standing rules

1. **`node --check` every JS file after generating or moving any of them.** All 42: 15 Garden
   modules, 20 Nursery modules, 2 `functions/scan-label.js`, 2 `functions/lookup-plant.js`, and the
   3 scripts in `tools/`. If it reports an error, treat it as real — never dismiss it as a false
   alarm. One command covers the lot:

   ```
   node --check apps/garden/js/*.js apps/nursery/js/*.js apps/*/functions/*.js tools/*.mjs
   ```
2. **No AI-authored production deploys without the repo owner's review.** Push to a branch, look at the
   Netlify deploy preview, then merge. Never straight to `main`.
3. **A new Firestore collection in a `db.js` needs its rule block in `firebase/firestore.rules` in
   the same commit.** Firestore denies anything not explicitly matched, and it fails *silently* in
   the app. This has bitten before: in May 2026 `irrigationZones` and `irrigationLogs` were in
   `db.js` but missing from the rules, and the Admin panel broke.
4. **Run `node tools/check-drift.mjs` before pushing changes to `auth.js`, `ui-utils.js`,
   `scan-label.js`, `functions/lookup-plant.js` or `js/plant-lookup.js`.** Exit 0 is clean;
   warnings are known deltas.
5. **Never commit a backup JSON or `plant-import.json`.** They belong in the private data folder
   outside the repo — `LOCAL.md` says where.
6. **Commit style:** conventional prefixes — `feat:`, `fix:`, `chore:`, `docs:`. Branches:
   `feature/…`, `fix/…`.
7. **Verify by running it, not by reading it.** "The diff looks right" and "the thing works" are
   different claims, and this repo has a habit of punishing the gap between them. Before saying
   something works: run the command, load the page over HTTP, fetch the deployed file. Two examples
   from 2026-08-20, both invisible to review and both obvious within seconds of execution:
   - A masked paste put bullet characters into `FIREBASE_API_KEY`. Both builds went green, both
     previews loaded, every stylesheet arrived — and sign-in returned `auth/api-key-not-valid`.
     Checking a truncated prefix of the value was what hid it; printing the length would not have.
   - A docs branch built on the wrong parent was missing `tools/build.mjs` altogether. The diff
     showed nothing wrong. `node tools/build.mjs garden` failed instantly.

   Corollaries worth remembering: a green Netlify check means *the build succeeded*, not that the
   app works; a preview URL keeps serving the last **successful** build, so a failed deploy still
   loads happily; and for anything visual, serve over HTTP — `file://` blocks cross-directory CSS
   and reports a false "everything is broken".

---

## Known issues

**The backlog lives outside the repo**, in the private data folder alongside the other private
material (`LOCAL.md` says where, on this machine). It is the record of agreed future changes, deferred
deliberately rather than forgotten — read it before assuming something is a new bug.

It was moved out on 2026-08-20, when this repo stopped being for one person. A backlog is a list of
the things you already know are wrong with a running system, which is exactly the document you do
not hand to strangers along with the code. Two of its four entries are ordinary future work and
would be harmless to publish; one is a real if low-urgency security weakness, and separating them
per-entry would be a standing tax on every future edit. Keeping the whole file outside the repo
costs nothing and needs no judgement call each time something is added.

**This does not make those items less real.** Anything still open in that file is inherited by every
copy of this repo, so a security entry should be *fixed* before copies go out — moving the
description out of sight does not move the hole. See
[`docs/distribution-plan.md`](docs/distribution-plan.md).

## Build skipping

Each app's `netlify.toml` carries an `ignore` command so a push only rebuilds the site whose folder
changed. **A base directory does not scope builds on its own** — Netlify rebuilds every connected
site on any push unless you add this. If you ever change one, verify both directions: touch a Garden
file and confirm Nursery skips, then the reverse.

---

## History

Where an installation serves from a custom domain, Netlify's own `*.netlify.app` site names are easy
to lose track of — identify each site in the Netlify dashboard by its domain.

Repo history before 2026-08 was archived outside git during the monorepo restructure, on the grounds
that git history supersedes it. From 2026-08 onward, per-change detail lives in commit messages and
in [`CHANGELOG.md`](CHANGELOG.md).

The restructure plan and the original Claude Code handoff moved out to that same archive on
2026-08-21: they are finished project records, thick with one machine's folder paths, rather than
live documentation.
