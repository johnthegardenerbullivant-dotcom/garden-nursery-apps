# Distribution plan — making copies able to track updates

Written 2026-08-19. Companion to [`making-a-copy.md`](making-a-copy.md), which describes the setup
as it stands today. This one describes what to change **first** if more than one or two people are
going to run copies.

---

## The goal, in one sentence

**Make the repo contain zero files a copy owner has to edit.**

Everything else follows from that. If a copy is a byte-identical mirror of yours, then their repo
never diverges, every update is a fast-forward, and GitHub's **Sync fork** button — one click, no
command line, no git knowledge — works forever. If even one tracked file has to be edited locally,
every single update becomes a merge conflict, and you are back to talking non-technical friends
through conflict resolution over the phone.

That is the whole design. The rest of this document is how to get there.

---

## What currently forces a copy to diverge

Three things, four files:

| # | File | Why they must edit it | Fix |
|---|---|---|---|
| 1 | `apps/garden/firebase-config.js`<br>`apps/nursery/firebase-config.js` | Their Firebase credentials | Generate at build time from environment variables; gitignore the file |
| 2 | `firebase/.firebaserc` | Their Firebase project ID | Gitignore it; `firebase use --add` creates it locally |
| 3 | `apps/nursery/js/admin-view.js:316`<br>`apps/nursery/js/batch-detail.js:119` | Hard-coded `https://johnandkath.garden` | Read from a generated `app-config.js`; hide the links when it isn't set |

Nothing else in either app is installation-specific. The manifests, icons, titles, colours, rules
and role model are all generic already — that was checked, not assumed.

---

## Change 1 — one build script instead of the `cp` line

Each `netlify.toml` currently runs:

```
rm -rf shared && cp -r ../../shared shared
```

Replace with:

```
node ../../tools/build.mjs garden      # and `nursery` in the other one
```

`tools/build.mjs` does three things:

1. `rm -rf shared` + copy `/shared` in — exactly what the `cp` does now.
2. Write `firebase-config.js` from six environment variables.
3. Write `app-config.js` from `GARDEN_URL` (Nursery only; harmless in Garden).

Sketch:

```js
// tools/build.mjs — run as: node tools/build.mjs <garden|nursery>
const KEYS = {
  apiKey:            'FIREBASE_API_KEY',
  authDomain:        'FIREBASE_AUTH_DOMAIN',
  projectId:         'FIREBASE_PROJECT_ID',
  storageBucket:     'FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'FIREBASE_MESSAGING_SENDER_ID',
  appId:             'FIREBASE_APP_ID',
};

// A missing variable writes the REPLACE_WITH placeholder rather than failing the
// build, so an unconfigured copy shows the existing "Setup required" overlay
// instead of a white screen. db.js already tests for exactly this string.
const cfg = Object.fromEntries(
  Object.entries(KEYS).map(([k, env]) => [k, process.env[env] || `REPLACE_WITH_YOUR_${env}`])
);
```

**Three things this gets for free:**

- **The existing "Setup required" overlay keeps working.** `db.js` returns `null` from
  `initFirebase()` when `apiKey.startsWith('REPLACE_WITH')`, and `main.js` shows `#config-overlay`.
  A copy owner who forgets the environment variables gets a green screen saying so, not a blank
  page. (Update the overlay's wording — it still points at `SETUP GUIDE.txt`, which no longer
  exists.)
- **The fresh-checkout papercut goes away.** Right now a new clone renders unstyled until you
  remember the `cp`. One documented command now does everything: `node tools/build.mjs garden`.
- **Your credentials leave git entirely.** A side benefit, not the point, but a real one.

For local work the script should also read a gitignored `.env` at the repo root, so you run one
command and get a working local copy.

### Six variables, not one JSON blob

It is tempting to accept a single `FIREBASE_CONFIG` JSON blob — one paste instead of six. Don't:
the Firebase console hands you a **JavaScript object literal** with unquoted keys, which is not
valid JSON, so every copy owner would hit a parse error on their first try and have no idea why.
Six named variables are six clean copy-pastes with no editing.

---

## Change 2 — the two Nursery links

Generate `apps/nursery/app-config.js` alongside the Firebase config:

```js
export const GARDEN_URL = '';   // set from the GARDEN_URL env var
```

Then in both call sites, render the link only when `GARDEN_URL` is non-empty. Graceful absence beats
a placeholder URL: a copy owner who only runs Nursery simply never sees a link to a Garden site they
don't have, and one who runs both sets one environment variable.

---

## Change 3 — Netlify secret scanning will bite here

This is the non-obvious one. Netlify's scanner looks for **the values of your environment variables
appearing in build output** — which, after Change 1, is precisely what `firebase-config.js` is. The
existing `SECRETS_SCAN_OMIT_PATHS = firebase-config.js` should still cover it (that setting matches
substrings of paths relative to the repo root), but add belt and braces:

| Key | Value |
|---|---|
| `SECRETS_SCAN_OMIT_PATHS` | `firebase-config.js` *(already set on both your sites)* |
| `SECRETS_SCAN_OMIT_KEYS` | `FIREBASE_API_KEY,FIREBASE_APP_ID,FIREBASE_MESSAGING_SENDER_ID` |

Test this on a deploy preview before merging. A failed build here is a hard stop, and it would hit
every copy on their very first deploy — the worst possible first impression.

---

## Change 4 — the repo has to be public (the real decision)

**GitHub's Sync fork button only exists for forks, and you can only fork a public repo.** A
*template* repo produces an independent repository with no upstream link at all — updates then mean
adding a remote and merging from the command line, which is exactly the thing your friends can't do.
Fork versus template is the difference between "click Sync fork" and "let me talk you through
`git fetch upstream`".

So: to get one-click updates, `garden-apps` — or a public twin of it — must be public.

Last week's advice was to keep it private. That advice was correct **under the current design**,
where the repo contains live credentials and your local folder paths. Changes 1–3 remove the
credentials. What's left to clean is small and bounded:

- **`docs/backlog.md` must move or be fixed first.** It is a written list of known weaknesses in a
  running system ("Storage rules don't exclude anonymous guests"). Publishing that is the one
  genuinely bad idea in going public. Either fix those items or move that file to `Garden Data\`.
- **Scrub `C:\Users\johnb\...` paths, "Owner: John Bullivant", and the `Garden Data\` references**
  from `CLAUDE.md` and `README.md`. Keep everything architectural — that content is what makes a
  copy maintainable, and it is what a copy owner's Claude will read.
- **`docs/restructure-plan.md`, `ui-consistency-review.md`, `ux-review.md`, `claude-code-handoff.md`
  and `making-a-copy.md` Part A** are your working notes. Move them out or accept that they're
  public; nothing in them is dangerous, they're just noise for a stranger.
- **Your live URLs and Firebase project ID are already public** — anyone can read both from your
  site's source today. Removing them from the repo changes nothing either way, so don't agonise
  over it.
- **The API key stays in git history** even after the file is removed. Not a leak — it is
  public-by-design and readable from your live site — but if it ever bothers you, restrict the key
  by HTTP referrer in the Google Cloud console rather than trying to rewrite history.

### If you'd rather not put your working repo in public

**One local repo, two remotes.** Keep `origin` private for day-to-day work, add a second remote you
push to deliberately when you want to cut a release:

```bash
git remote add public https://github.com/YOURNAME/garden-apps.git
```

```bash
git push public main
```

Friends fork the public one and still get the Sync fork button. Cost is one extra command per
release and remembering the public remote exists. The cleanup list above still applies, because
pushing `main` publishes its history — this variant buys you control over *when*, not over *what*.

**Verdict:** once Changes 1–3 are done, one public repo is the low-maintenance answer and the two-
remote split is the cautious one. Both work. What does not work is a template repo, if the goal is
updates that friends can actually apply.

---

## Change 5 — say what an update requires

Netlify redeploys a fork automatically once it's synced. **Two things it cannot do for them:**

1. **Security rules.** `firebase/firestore.rules` and `storage.rules` are deployed by the Firebase
   CLI, never by Netlify. A rules change in your repo reaches their *files* and not their
   *database*, and a rules mismatch fails **silently** — lists come back empty, nothing errors.
   Every commit that touches those files needs a loud note.
2. **New environment variables.** A feature that adds one is broken on their site until they add it
   and redeploy.

So: a `CHANGELOG.md` at the repo root, one entry per tagged release, each with an explicit
**Action required** line — `none`, `redeploy rules`, `add env var X`, or `data migration`. You
already tag releases; this is the missing half. Without it, "just click Sync fork" is advice that
quietly breaks people's apps.

---

## Change 6 — schema migrations (do the cheap half now, not the expensive half)

The sleeper problem. You currently evolve the schema against one database and fix things by hand.
With several copies you cannot do that, and a change like renaming a field would strand everyone.

**Do now, because it's free:** a `SCHEMA_VERSION` constant in `/shared`, and write it to a
`meta/app` document in Firestore on startup. Costs one line and one document, and means that when a
migration is eventually needed, you can tell which copies need it.

**Don't build yet:** an Admin-panel migration runner. Write migrations as manual steps in the
CHANGELOG until one is actually painful. Building the machinery before you have a real migration to
run means guessing at what it needs to do.

---

## What does not need to change

Worth stating so it doesn't get relitigated: the monorepo build skipping, the `/shared` design layer
and its copy step, the security rules themselves, the three-role model, the Netlify two-site layout,
and the first-admin bootstrap. All of it is already copy-agnostic. The bootstrap is manual by
design — anyone who found the URL could otherwise make themselves an admin — and that stays.

---

## Order of work

Changes 1–3 touch your own live sites, so sequence matters. **Environment variables go in before the
code that needs them**, or both sites show "Setup required" at once.

1. On **both** Netlify sites, add the six `FIREBASE_*` variables (values copied from the current
   `firebase-config.js`), `GARDEN_URL` on Nursery, and `SECRETS_SCAN_OMIT_KEYS`. Don't deploy yet.
2. On a branch: write `tools/build.mjs`, point both `netlify.toml` at it, gitignore
   `apps/*/firebase-config.js`, `apps/*/app-config.js` and `firebase/.firebaserc`, and fix the two
   Nursery links and the overlay wording.
3. Open a PR and check the deploy preview — previews inherit site environment variables, so it is a
   real test. Sign in with the email/password account, not Google.
4. Merge. If anything is wrong: Netlify → Deploys → last good deploy → **Publish deploy**. Instant.
5. Clean the docs and paths for publication, add `LICENSE`, `SETUP.md` (Part B of
   `making-a-copy.md`) and `CHANGELOG.md`.
6. Flip the repo public, or push to the public remote.
7. **Dry run it yourself.** Fork your own repo from a second GitHub account, follow `SETUP.md`
   literally, against a throwaway Firebase project. Nothing else finds the gaps — you know too much
   about this system to spot them by reading.

Roughly an evening for steps 1–4 and another for 5–7.

---

## What a friend's update then looks like

1. GitHub emails them, or they notice "This branch is 3 commits behind".
2. They click **Sync fork** → **Update branch**.
3. Netlify rebuilds both their sites automatically. Done — no command line, ever.
4. If the release notes say "redeploy rules", they paste two files into the Firebase console.

That is the whole point of the exercise, and it is only achievable if step 2 never produces a
conflict — which is only true if they have never had to edit a tracked file.
