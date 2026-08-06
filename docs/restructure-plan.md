# Restructure Plan — Garden & Nursery Management

**Drafted:** 2026-08-05 · **Status:** proposal, awaiting John's approval
**Goal:** retire drag-and-drop deploys and the Friend Setup Package; make one private GitHub monorepo the single source of truth, with both Netlify sites deploying automatically from it.

---

## Part 1 — Where we are now

I audited all three folders. The findings that shape the plan:

### The repo is real but badly out of date

`garden-apps-shared` is already a git repo — remote `origin` points at
`https://github.com/johnthegardenerbullivant-dotcom/garden-apps-shared.git`, branch `main`,
working tree clean, but it has **exactly one commit** ("Initial commit", June 2026) and has never
been updated since.

Against the live deploy folders it is missing or stale in a big way:

| | Garden | Nursery |
|---|---|---|
| JS files that differ | 10 | 12 |
| Files missing from repo entirely | `js/label-scan.js`, `netlify.toml`, `functions/scan-label.js` | `js/label-scan.js`, `netlify.toml`, `functions/scan-label.js` |
| Also differ | `styles.css`, `firestore.rules`, `firebase-config.js` | `styles.css`, `firestore.rules`, `firebase-config.js` |

So the repo predates label-scan, the garden→nursery transfer, hybrid nomenclature, and the
August date/quantity work. **The live `Netlify Deploy` folders are the truth; the repo is not.**
The migration direction is one-way: local folders overwrite the repo, not the reverse.

### Four files are byte-identical across both apps

Verified with `diff`:

- `firestore.rules` — identical (this is the file CLAUDE.md warns you to keep in sync manually)
- `storage.rules` — identical
- `functions/scan-label.js` — identical
- `js/auth.js` — identical

And `js/ui-utils.js` differs by **only 12 lines** — Nursery has `isValidDateStr()`, Garden does not.
That is drift, not intent. It will keep happening as long as there are two copies.

### Content is scattered across five places

The same app code currently lives in up to four locations:

1. `Garden Management/Netlify Deploy/` — the live truth
2. `Garden Management/Friend Setup Package/` — a stale parallel copy
3. `Garden Management/Releases/v1.0, v1.1, v1.2/` — 1.3 MB of frozen snapshots
4. `garden-apps-shared/garden-management/` — the stale repo copy
5. …plus a Google Drive copy of the Friend Package

Nursery is better off (only two copies) but has its design docs stranded outside the repo.

### Junk in the deploy folders

These are currently being served to the public internet:

- `Garden Management/Netlify Deploy/err.txt` — empty file
- `Garden Management/Netlify Deploy/zi9km4XN` — an unnamed **zip archive** containing `HOW_TO_APPLY.txt`
- `Garden Management/Netlify Deploy/SETUP GUIDE.txt` — friend-package doc, shouldn't be public
- `Nursery Management/Netlify Deploy/js/batches-view.js.bak`

### ✅ RESOLVED — the folders match production

Three CLAUDE.md entries were marked *"drafted by AI, pending John's review before deploy"*
(2026-07-24 label scan + transfer-to-nursery, 2026-07-25 hybrid nomenclature, 2026-08-05 typeable
dates + editable quantity). **John has confirmed all three are reviewed, deployed and tested**, and
`GEMINI_API_KEY` is set on the Garden Netlify site with label scanning verified working.

This was the biggest risk in the cutover and it is now gone. Both `Netlify Deploy` folders are an
exact match for what is live, so committing them as-is produces a repo that genuinely represents
production — and the first Git-triggered deploy should be a no-op in content terms. The changelog
caveats have been corrected accordingly.

### Cowork cannot push to GitHub

I tested this directly, because it decides the last question you asked:

```
$ git ls-remote https://github.com/.../garden-apps-shared.git
fatal: could not read Username for 'https://github.com'
$ gh --version        → command not found
$ netlify --version   → command not found
```

Cowork's shell is an isolated Linux sandbox with no access to your GitHub credentials, no GitHub
CLI and no Netlify CLI. I can edit files in your folders, but I cannot commit, push, open a PR,
watch a deploy, or run `firebase deploy`. More on what that means in Part 5.

---

## Part 2 — The target structure

One private repo. One working folder. Nothing duplicated that doesn't have to be.

```
C:\Users\johnb\Documents\Claude\Projects\garden-apps\      ← the git repo; the ONLY code folder
│
├── CLAUDE.md                  ← shared conventions, Firebase model, deploy workflow
├── README.md                  ← what this is, live URLs, how to deploy
├── CHANGELOG.md               ← the update log, moved out of CLAUDE.md
├── .gitignore
├── .gitattributes
│
├── apps/
│   ├── garden/                ← Netlify site #1: base + publish directory
│   │   ├── CLAUDE.md          ← Garden-specific module map
│   │   ├── netlify.toml
│   │   ├── firebase-config.js ← REAL credentials (repo is private)
│   │   ├── index.html  styles.css  manifest.json  sw.js  robots.txt  _headers
│   │   ├── icons/
│   │   ├── functions/
│   │   │   └── scan-label.js
│   │   └── js/                ← 14 modules
│   │
│   └── nursery/               ← Netlify site #2: base + publish directory
│       ├── CLAUDE.md          ← Nursery-specific module map
│       └── (same shape, 19 js modules)
│
├── firebase/                  ← SINGLE source of truth; deployed via Firebase CLI
│   ├── firebase.json          ← new — makes `firebase deploy` a one-liner
│   ├── firestore.rules        ← was duplicated in both apps
│   ├── storage.rules          ← was duplicated in both apps
│   └── cors.json              ← from Garden Management/cors.json
│
├── docs/
│   ├── nursery-design.md      ← from Nursery Management/DESIGN.md (+ DESIGN.pdf)
│   ├── label-scan-spec.md     ← from Nursery Management/LABEL-SCAN-SPEC.md
│   └── ux-review.md           ← from Garden Management/UX Review & Suggestions.md
│
└── tools/
    └── check-drift.mjs        ← fails loudly if files meant to be identical have diverged
```

**Outside the repo — private data, never in git:**

```
C:\Users\johnb\Documents\Claude\Garden Data\
├── Backups/                   ← 4.9 MB of JSON exports (already gitignored today)
├── plant-import.json          ← 527 KB
└── Archive/                   ← the old Releases/ and Friend Setup Package, kept read-only
                                  for a few months, then deleted
```

### Why this shape

**One repo, two Netlify sites.** Netlify natively supports a monorepo: each site gets a *base
directory* (`apps/garden` / `apps/nursery`), and the publish directory is resolved relative to it.
When you connect a repo, Netlify scans it and offers you the list of detected sites to pick from.
Two sites, two base directories, one repo, one push.

**`firestore.rules` stops being a sync hazard.** Today it exists twice and CLAUDE.md carries a
standing warning to update both copies. In the new layout it exists once, in `firebase/`. The rules
are deployed by the Firebase CLI, not served by Netlify, so nothing needs a copy inside an app
folder. That warning gets deleted from the docs rather than restated.

**No build step, still.** Netlify's build command stays empty for both sites; it just serves
`apps/garden` and `apps/nursery` as-is. Native ES modules, Firebase from the Google CDN, no npm,
no `node_modules`. The one thing `netlify.toml` still does is point at the functions folder for
label-scan.

**Shared browser JS stays duplicated — deliberately, for now.** `auth.js` is identical and
`ui-utils.js` is 12 lines apart, so the temptation is to hoist them into `shared/js/`. But with no
build step, a folder outside the publish directory isn't served to the browser, so sharing it
requires either a build command or symlinks. Not worth it yet. Instead `tools/check-drift.mjs`
diffs the files that are supposed to match and reports any divergence — cheap, no build step, and
it catches exactly the `isValidDateStr` situation. If drift becomes a nuisance, a one-line `cp`
build command is the easy upgrade later.

**Folder renamed `garden-apps` (from `garden-apps-shared`).** "Shared" meant "shared with friends",
which we're dropping. Optional, but the name will otherwise mislead you in a year. The GitHub repo
can be renamed to match (GitHub auto-redirects the old URL).

### What disappears

| Gone | Why |
|---|---|
| `Garden Management/` and `Nursery Management/` as code folders | Replaced by `apps/garden` and `apps/nursery` |
| `Friend Setup Package/` + the Google Drive copy | Retired, per your decision |
| `SETUP-GUIDE.md`, `convert_to_json.py`, `Plant Import Template.xlsx` | Friend-package artifacts |
| `Releases/v1.0, v1.1, v1.2/` | Git tags replace frozen folder snapshots |
| `PWA-Update-for-Friend-Setup-Package.zip` | Historical |
| `err.txt`, `zi9km4XN`, `batches-view.js.bak`, `SETUP GUIDE.txt` | Junk currently being served publicly |
| The duplicate `firestore.rules` / `storage.rules` | One copy in `firebase/` |

---

## Part 3 — Migration plan

Nine phases. Phases 0–4 are safe (nothing goes live). Phase 5 is the cutover.

### Phase 0 — Get the folders matching production ✅ COMPLETE

Both sites have been deployed from the current `Netlify Deploy` folders, `GEMINI_API_KEY` is set on
Garden, and label scanning is tested and working. The folders are the truth and the truth is live.

This means the cutover is materially safer than originally scoped: the first Git-triggered deploy
should produce byte-identical output to what is already serving, so any post-cutover breakage is
unambiguously a plumbing problem, not a code problem. Keep that in mind when smoke-testing in
Phase 5 — you are testing Netlify's build settings, not the app.

**Also complete (2026-08-06):** the update log has been extracted from Garden's `CLAUDE.md` into a
new `CHANGELOG.md`, cutting the file from ~21 KB to ~9 KB. The stale "pending review before deploy"
caveats were corrected to reflect that everything is now live.

### Phase 1 — Prepare, without touching anything live

1. Create `C:\Users\johnb\Documents\Claude\Garden Data\` and move `Backups/` and
   `plant-import.json` there.
2. Move `Releases/`, `Friend Setup Package/` and the zip into `Garden Data\Archive\`.
3. Delete the junk: `err.txt`, `zi9km4XN`, `SETUP GUIDE.txt`, `batches-view.js.bak`.
4. Take one full manual copy of both `Netlify Deploy` folders into `Garden Data\Archive\pre-migration\`.
   Belt and braces before restructuring.

### Phase 2 — Build the new tree

Inside the existing `garden-apps-shared` folder (renamed to `garden-apps`), since it already has
the `.git` directory and remote wired up:

1. `git rm -r` the stale `garden-management/` and `nursery-management/` folders.
2. Copy `Garden Management/Netlify Deploy/*` → `apps/garden/`, same for Nursery.
3. Hoist `firestore.rules` and `storage.rules` into `firebase/` (delete both app copies), plus
   `cors.json` from the Garden Management root.
4. Write `firebase/firebase.json` so rules deploy with
   `firebase deploy --only firestore:rules,storage`.
5. Move the three design docs into `docs/`.
6. Drop in `apps/*/firebase-config.js` with the **real** values (repo is going private).
7. Update `.gitignore`: drop the now-irrelevant friend-package comments, keep the backup
   exclusions, add `*.bak`, `err.txt`, `.netlify/`.
8. Write `tools/check-drift.mjs`.
9. Run `node --check` on all 35 JS files (14 Garden + 19 Nursery modules, plus the two
   `scan-label.js` functions). *(Per your standing rule: always `node --check` every JS file.)*

### Phase 3 — Rewrite the documentation

Detailed in Part 4 below. Doing it before the first commit means the repo's history starts clean.

### Phase 4 — Make the repo private, then push

1. On GitHub: **Settings → General → Danger Zone → Change visibility → Private.**
   Do this *before* pushing real credentials. This is the one irreversible-ish ordering mistake
   available in this plan.
2. Optionally rename the repo to `garden-apps`.
3. Commit and push. Suggested first commits:
   - `chore: restructure into apps/ monorepo layout`
   - `feat: bring repo up to date with live Garden and Nursery code`
   - `docs: rewrite CLAUDE.md for git-based workflow`
4. Tag the baseline: `git tag v2.1 && git push --tags`.

### Phase 5 — Cut Garden over to Git deploys 🔴 THE CUTOVER

Do **one site at a time**, Garden first. If it goes wrong, Nursery is untouched and still working.

1. Netlify → Garden site → **Site configuration → Build & deploy → Continuous deployment → Link
   repository.** Linking a repo to an *existing* site preserves the site ID, custom domain and
   environment variables — you are not creating a new site.
2. Build settings:
   - Base directory: `apps/garden`
   - Build command: *(leave empty)*
   - Publish directory: `apps/garden` (or `.` relative to base)
   - Functions directory: `apps/garden/functions`
3. Add environment variables (Netlify will flag the committed Firebase config otherwise):
   - `SECRETS_SCAN_OMIT_PATHS = firebase-config.js`
   - `GEMINI_API_KEY = <your AI Studio key>` (if not already done in Phase 0)
   - `GEMINI_MODEL = gemini-flash-latest` (optional)
4. Trigger a deploy. Compare the deploy log's file list against the old drag-and-drop deploy.
5. Smoke-test the live site: sign in, load plants, load areas, open a blog post, run a label scan,
   check the Admin panel.
6. **Rollback if needed:** Deploys → find the last drag-and-drop deploy → *Publish deploy*. Instant.

Netlify's secret scanner will fail the build if it spots something that looks like a credential in
the published output, and Firebase's `AIza…` API key format trips its smart detection. Hence
`SECRETS_SCAN_OMIT_PATHS`. Worth saying plainly: that Firebase key is already readable by anyone
who views source on your live site — Firestore security rules are what actually protect the data,
not the key's obscurity. Making the repo private is about tidiness and habit, not about that key.

### Phase 6 — Cut Nursery over

Same steps, base directory `apps/nursery`. Only after Garden has been stable for a day or two.

### Phase 7 — Firebase rules from one place

1. Install `firebase-tools` locally, `firebase login`, `firebase use bbg-garden-inventory`.
2. From `firebase/`: `firebase deploy --only firestore:rules,storage`.
3. Confirm in the Firebase Console that the published rules match.

This kills the "update both copies then paste into two separate Console pages" ritual that has
already bitten you once (May 2026, the `irrigationZones` outage).

### Phase 8 — Retire the old folders

1. In Cowork, disconnect the `Garden Management` and `Nursery Management` folders; connect
   `garden-apps` and `Garden Data`.
2. Rename the old folders `_OLD Garden Management` / `_OLD Nursery Management` and leave them for
   a month. Delete once you're confident.
3. Delete the Google Drive Friend Package copy.

### Phase 9 — Verify

- Push a trivial change (a comment) and confirm both sites rebuild only when their own folder changes.
- `node tools/check-drift.mjs` reports clean.
- Both PWAs install and work offline.
- Rules deploy cleanly from the CLI.
- Add a `deceasedPlants` sanity check — the 2026-06-18 log entry flagged a TODO to add that rule
  block to the Nursery copy of `firestore.rules`; with one shared file this resolves itself, but
  confirm the deployed rules actually contain it.

---

## Part 4 — Documentation rewrite

The current Garden `CLAUDE.md` is 21 KB, and roughly two-thirds of it is the update log. That log
is loaded into context at the start of every single session, which is expensive and increasingly
useless — git history does this job better. Nursery has no CLAUDE.md at all.

### New structure

**`/CLAUDE.md` (root)** — shared, ~4 KB:

- What the two apps are, both live URLs, Firebase project `bbg-garden-inventory`
- The monorepo layout and where each thing lives
- Shared architecture: no build step, ES modules, Firebase SDK 10.12.0 from CDN, Quill 1.3.7
- The role system (`viewer` / `editor` / `admin`, `isAtLeast()`)
- Full Firestore data model, both apps' collections in one table
- **New: the git + Netlify deploy workflow** (branch → commit → push → auto-deploy → verify → tag)
- **New: rules are deployed from `firebase/` via the CLI, and exist in exactly one place**
- Standing rules: `node --check` every generated JS file; no AI-authored production deploys without
  John's review
- Pointer to `CHANGELOG.md`

**`/apps/garden/CLAUDE.md`** — the Garden module map (14 files), Garden-only conventions,
Netlify site name, its env vars.

**`/apps/nursery/CLAUDE.md`** — the same for Nursery (19 files). This finally gives Nursery the
documentation Garden has had since April.

**`/CHANGELOG.md`** — every existing update-log entry moved here verbatim, newest first, with a note
that entries from 2026-08 onward live in git commit messages instead.

**`/README.md`** — short: what this is, both live URLs, "clone, edit, push, it deploys", link to
CLAUDE.md.

### Practices to delete from the docs

| Delete | Replace with |
|---|---|
| "Netlify Deploy/ is what the live site serves… drag/drop to Netlify" | Push to `main` → Netlify builds |
| "Keeping Friend Package in sync" | *(nothing — retired)* |
| "Cutting a new release: copy folder to Releases/vX" | `git tag vX.Y && git push --tags` |
| "⚠️ firestore.rules is SHARED — update both copies" | One file at `firebase/firestore.rules` |
| "paste the rules into the Firebase Console" | `firebase deploy --only firestore:rules,storage` |
| "Save backups to Backups/" | Save to `Garden Data\Backups\`, outside the repo |

### Practices to add

- Branch naming: `feature/…`, `fix/…`; `main` is always deployable
- Commit style: conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`)
- Never commit a real backup JSON or `plant-import.json`
- Any new Firestore collection added to a `db.js` needs a matching block in
  `firebase/firestore.rules` **in the same commit** — the rule that has caught you out before
- Run `node tools/check-drift.mjs` before pushing changes to `auth.js`, `ui-utils.js` or
  `scan-label.js`

I'd also update my saved memory notes, which currently describe the drag-and-drop workflow and the
`Netlify Deploy` folder as the source of truth.

---

## Part 5 — Claude Code or Cowork?

**Recommendation: move the code and deploy work to Claude Code. Keep Cowork for everything else.**

This isn't a close call, and it's not about capability in the abstract — it's about the specific
thing you asked for. Your goal is *"so that you can perform the updates vs me dragging and
dropping."* In Cowork I can't do that. I tested it above: the shell is an isolated Linux sandbox
with no GitHub credentials, no `gh`, no `netlify` CLI. I can edit the files in your folders, but
every `git add / commit / push` would still be you, by hand. You'd have swapped drag-and-drop for
git-by-hand — a real improvement in *versioning*, but not in *effort*.

Claude Code runs on your Windows machine as you, with your credentials. That means it can:

- commit, push, branch, open pull requests, and read the resulting Netlify deploy log
- run `node --check` and `check-drift.mjs` against the real files, not a sandbox copy
- run `firebase deploy --only firestore:rules,storage` directly
- `git revert` or roll back a bad deploy without you touching a browser

There's also a second, quieter benefit: git gives you a proper review gate. Your standing rule is
"no AI-assisted live changes without John's review." Right now that's enforced by you remembering.
With branches and PRs, it's enforced by the tooling — I push to a branch, Netlify builds a **deploy
preview** at its own URL, you click the preview and look at the actual working site before merging
to `main`. That is a strictly better version of the policy you already have, and it's what would
have caught the three batches of pending work now sitting undeployed in your folders.

### What stays in Cowork

Claude Code is a terminal tool. It's excellent at the repo and poor at everything around it. Keep
using Cowork for:

- Propagation planning, plant research, NPA work, and general gardening questions
- Anything producing a Word doc, spreadsheet or deck (the docx/xlsx/pptx skills)
- Gmail, Calendar and Drive work
- Reading and reasoning over the backup JSON files
- Thinking-out-loud design conversations *before* the code gets written

A reasonable rhythm: design it here, build it there.

### The honest costs — smaller than I first thought

You've said you already use Claude Code through the **desktop app** rather than the command line.
That removes the main objection I had drafted (the terminal feel), and it means the switch is
essentially just pointing it at a different folder. What's left:

- The context is per-directory. You'd open it on `garden-apps`, and it picks up the root
  `CLAUDE.md` plus the relevant `apps/*/CLAUDE.md` automatically — which is exactly why the
  three-file split in Part 4 is worth doing.
- Git and Netlify work happens with your real credentials, so the review discipline matters more,
  not less. Push to a branch, look at the deploy preview, then merge. Never straight to `main`.
- Same Claude subscription; no additional cost.

Given the desktop app, there's a reasonable argument for switching *sooner* than Phase 5 — as early
as Phase 1 — since everything from there on is file surgery inside what will become the repo, and
doing it where the git history is being written is tidier. Your call; the plan works either way.

### Nothing is wasted either way

The CLAUDE.md files specified in Part 4 use the identical format in both tools. If you do Phases
0–4 here in Cowork (I can do all the file restructuring and doc writing — just not the push) and
then switch to Claude Code for Phase 5 onward, everything carries over. That's probably the
smoothest path: **finish the restructure here, cut over to Claude Code at the first push.**

---

## Summary of decisions needed

| # | Decision | My recommendation |
|---|---|---|
| ~~1~~ | ~~How to handle the pending undeployed work~~ | ✅ Resolved — all deployed and tested |
| 2 | Rename folder/repo `garden-apps-shared` → `garden-apps` | Yes — "shared" no longer means anything |
| 3 | Do the restructure here in Cowork, or switch to Claude Code now | Now leaning **switch now** — see Part 5 |
| 4 | Archive or delete `Releases/` and `Friend Setup Package/` | Archive for a month, then delete |
| 5 | Hoist shared JS (`auth.js`, `ui-utils.js`) now, or just detect drift | Detect drift now; hoist only if it becomes annoying |

## Progress

- ✅ **Phase 0** — folders match production; `GEMINI_API_KEY` set; label scan tested
- ✅ **Partial Phase 3** — update log extracted to `CHANGELOG.md`; Garden `CLAUDE.md` cut ~21 KB → ~9 KB
- ⬜ **Phase 1** — prepare folders (next)

---

**Sources for the Netlify specifics:**
[Monorepos — Netlify Docs](https://docs.netlify.com/build/configure-builds/monorepos/) ·
[Build configuration overview — Netlify Docs](https://docs.netlify.com/build/configure-builds/overview/) ·
[Secret scanning — Netlify Docs](https://docs.netlify.com/manage/security/secret-scanning/)
