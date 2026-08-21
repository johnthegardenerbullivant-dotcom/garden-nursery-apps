# Making a copy for someone else

Written 2026-08-19, after a couple of friends asked for their own Garden/Nursery apps.
**Substantially revised 2026-08-20**, once the Firebase config moved out of git into environment
variables. That change removed most of the fiddly parts of this guide: there is no longer a single
file in the repo that a copy owner has to edit, which is what makes one-click updates possible.
Anything below describing hand-edited credentials or a template repo is gone for that reason.

This is two documents in one. **Part A** is John's decisions and one-off work. **Part B** is the
step-by-step a friend follows. Part B is the bit you send them.

The short version: it is genuinely doable — an afternoon for them, an evening for you the first
time — but it is **not** "here's a zip, drag it into Netlify" any more. That was the retired Friend
Setup Package, and it worked because the app had no accounts, no roles, no serverless functions and
no AI. All four of those now exist, and each one adds a setup step.

---

## What they actually get

A completely separate copy: their own database, their own photos, their own users, their own web
address. **Nothing is shared with your garden** — not data, not logins, not billing. They cannot see
your plants and you cannot see theirs.

- Garden Management, Nursery Management, or both. Either runs standalone.
- **If they take both, both must point at one Firebase project.** The two apps write into each
  other's collections in **both** directions, and neither goes over the network to do it — they are
  plain Firestore writes inside the shared project:
  - Planting out a Nursery batch writes into Garden's `plants` and `instances`
    (`plantOutToGarden()` in `apps/nursery/js/db.js`).
  - Transferring a garden plant to the nursery writes a `nursery_batches` document
    (`transferToNursery()` in `apps/garden/js/db.js`).

  Split the two apps across two Firebase projects and both paths fail **silently** — no error, the
  record simply lands in a database the other app never reads. This is the single most important
  thing to get right at setup, and the hardest to notice later.
- Installable on a phone, works offline, three roles (viewer / editor / admin), label scanning and
  AI plant lookup — all of it, as long as they set up the Gemini key.
- An **empty** database. No plants, no areas, no nursery locations. There is a bulk import in the
  Admin panel that reads a prepared `plant-import.json`, so a spreadsheet of plants can be loaded in
  one go if they have one.

### What it costs them

| Thing | Cost | Notes |
|---|---|---|
| Firebase, Blaze plan | **Card required**, ~£0/month in practice | Since 3 Feb 2026 a new project must be on Blaze to provision a Storage bucket at all. Free allowances still apply on Blaze — 5 GB storage, 100 GB/month transfer. A household garden will not approach that. |
| Netlify | Free | Two sites, 100 GB bandwidth, 125k function calls/month. |
| Gemini API key | Free tier, or pennies | Only needed for label scan and plant lookup. The apps work without it — those two features just fail. |
| Domain name | £0 or ~£12/year | A free `something.netlify.app` address is fine. A custom domain is optional. |

Worth saying out loud to them: **a card is required before photos will work at all.** That is the
one thing most likely to make someone back out, so lead with it rather than letting them discover it
at step five.

---

# Part A — What John does

## A1. Decide how they get the code (do this first)

**Decided 2026-08-20.** An earlier draft of this document recommended a *template* repo. That was
superseded once the config moved out of git — see [`distribution-plan.md`](distribution-plan.md).

| Option | Verdict |
|---|---|
| Add them as a collaborator on `garden-apps` | **No.** They'd get push access to your repo, and your commits would deploy to their sites. Wrong shape entirely. |
| Send a zip | **No.** They can never receive a fix, and you can never tell what version they're on. |
| A public **template** repo | **No.** A template produces a copy with no upstream link, so updates mean `git fetch upstream` from a terminal — exactly what a non-technical friend cannot do. |
| **A public release repo they fork** | **Yes.** GitHub's one-click **Sync fork** button, forever. |

The mechanism: keep `garden-apps` private for day-to-day work, and add a **second remote** — a
public `garden-apps` repo — that you push to deliberately when you want to cut a release:

```bash
git remote add public https://github.com/YOURNAME/garden-apps.git
```

```bash
git push public main
```

Nothing is visible to anyone until you run that push, so you can make several changes, live with
them on your own sites for a week, and publish when you're satisfied. What you control is **when**
it becomes visible, not the granularity — the push publishes your individual commits with their real
dates, not one squashed blob. That is usually what you want anyway: the commit messages are the
release notes.

Friends then press **Fork** on the public repo. Their fork tracks yours, so GitHub shows them "this
branch is 3 commits behind" with a **Sync fork** button next to it.

### Why the fork can be public, and why that's fine

Forks of a public repo are themselves public — you cannot make one private. That would have been a
problem under the old design, where a copy owner had to paste their Firebase credentials into a
tracked file. It isn't one now: **their repo contains no configuration at all.** Everything
installation-specific lives in Netlify environment variables. A fork is a plain copy of the code,
identical to yours, with nothing personal in it.

That property is also what makes Sync fork work. A fork that never edits a tracked file never
diverges, so every sync is a fast-forward and no conflict is possible.

## A2. Prepare the repo for publication (one evening)

This is now done **in `garden-apps` itself**, not in a copy — the public repo is the same repo,
pushed to a second remote. There is no separate template to keep in sync.

**Steps 2–4 of an earlier draft are gone.** They said to blank the credentials in both
`firebase-config.js` files, blank the project ID in `.firebaserc`, and deal with two hard-coded
links to your garden. None of that exists any more: those three files are generated at build time
from environment variables and are gitignored, so **there is nothing to sanitise in the code**. That
is the whole point of the config work — see [`distribution-plan.md`](distribution-plan.md).

What's left is documentation hygiene:

1. ~~**Strip the internal docs.**~~ **Done 2026-08-21, partly.** `restructure-plan.md` and
   `claude-code-handoff.md` moved to the archive — finished project records, thick with one
   machine's folder paths. `backlog.md` went to the private data folder on 2026-08-20.
   `ui-consistency-review.md` and `ux-review.md` **stay**: they carry the reasoning behind decisions
   that shouldn't be re-opened, and nothing personal. So do `data-model.md`, `plant-lookup.md`,
   `nursery-design.md` and `label-scan-spec.md` — genuinely useful to a copy owner and to their
   Claude.
2. ~~**Edit `CLAUDE.md` and `README.md`.**~~ **Done 2026-08-21.** The scrub was not really about
   secrecy — the project ID and the live URLs are readable by anyone who views source on the live
   site. It was about **correctness in a fork**: a copy whose docs name someone else's Firebase
   project and web addresses is simply wrong for its owner.

   The details moved to **`LOCAL.md`** at the repo root, which is gitignored, and the tracked docs
   point at it conditionally — "if this checkout has one". A fresh clone has no `LOCAL.md` and
   nothing breaks.

   **Note the constraint that forces this.** Both remotes push the same content, so
   "private-but-not-public" does not exist: anything left in a tracked file *is* published. The
   choice is to scrub it or to publish it, and there is no third option short of maintaining a
   separate publish branch, which is a permanent tax.
3. ~~**Add a `LICENSE`** and a "no warranty, no support promise" line in the README.~~
   **Done 2026-08-20** — MIT, plus a *Copies and support* section in the README. It matters more
   than it sounds: it is the difference between a gift and an open-ended obligation.
4. ~~**Add Part B of this file as `SETUP.md`.**~~ **Done 2026-08-20** — Part B *moved* to
   [`SETUP.md`](../SETUP.md) rather than being copied there, so there is only ever one guide to keep
   correct. A `CHANGELOG.md` was added at the same time, with the **Action required** line per
   release that a fork owner depends on.
5. **Fix anything still open in the backlog that a copy would inherit** — it lives in the private
   data folder, outside the repo.
   A weakness in your rules becomes a weakness in every copy, belonging to someone who has no idea
   it is there. (Item 1, guests writing to Storage, was fixed on 2026-08-20 for exactly this
   reason.)
6. Create the **public repo** on GitHub, add it as a second remote, and `git push public main`.
   Do **not** tick *Template repository* — friends should fork, so they get the Sync fork button.

Before pushing, run the repo's own checks:

```bash
node --check apps/garden/js/*.js apps/nursery/js/*.js apps/*/functions/*.js tools/*.mjs
```

```bash
node tools/check-drift.mjs
```

## A3. Decide your support boundary now, not later

Say it in the README and say it to them: you'll help get it running, you're not on call. The two
places they will realistically get stuck are the **first-admin bootstrap** (B7) and **Google
sign-in failing on a domain that isn't authorised** (B4 step 7). Both are one-liners once you know
them. Point people at those sections rather than remote-controlling their console.

## A4. How an update reaches them

Once you `git push public main`:

1. GitHub shows their fork as "N commits behind".
2. They click **Sync fork → Update branch**.
3. Netlify rebuilds both their sites automatically.

No command line, no conflicts — because they have never edited a tracked file, every sync is a
fast-forward. That is the property the whole config-from-env change exists to protect. **If you ever
commit something a copy owner must edit, you break it**, and every future update for every copy
becomes a merge conflict.

**Two things a sync cannot carry**, and both fail quietly:

- **Security rules.** `firestore.rules` and `storage.rules` deploy by CLI, never by Netlify. A rules
  change reaches their *files* and not their *database*, and a mismatch shows up as empty lists
  rather than errors.
- **New environment variables.** A feature that adds one is broken on their site until they add it
  and redeploy.

So every release that touches either needs an **Action required** line in `CHANGELOG.md` — `none`,
`redeploy rules`, `add env var X`, or `data migration`. Without it, "just click Sync fork" is advice
that quietly breaks people's apps.

## A5. Things not to do

- **Do not give them your Firebase project details.** Sharing your Firebase project would put their
  plants in your database and hand them your data. Every copy needs its own project.
- **Do not let them connect a Netlify site to your repo.** Their site would then rebuild from your
  commits, which is the tail wagging the dog.
- **Do not paste your `firestore.rules` into their Console for them.** It is the same file, so it
  would work — but you become the person who deploys their security. Walk them through B6 instead.

---

# Part B — What the friend does

**Part B now lives at [`SETUP.md`](../SETUP.md), in the repo root.** It moved there on 2026-08-20 so
the instructions travel with the code a friend forks, instead of living in a document full of your
private decisions. It is the same guide, with a standalone introduction added.

Send them that file, or just the repo — they'll find it.

Everything a friend needs is there: Firebase project, keys, forking, Netlify, the AI features,
security rules, making themselves the administrator, adding the household, and a troubleshooting
table. Part A above is yours alone and is not published.
