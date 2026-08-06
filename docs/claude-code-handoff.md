# Claude Code handoff

How to pick up the restructure in Claude Code. Written 2026-08-06 at the end of the Cowork planning
session.

---

## Before you start the session

**Open Claude Code on the parent folder, not the three project folders:**

```
C:\Users\johnb\Documents\Claude\Projects\
```

Phases 1 and 2 move files *between* `Garden Management`, `Nursery Management` and
`garden-apps-shared`. If Claude Code is opened on one of them it can't see the others, and
adding three separate directories is fussier than just opening the parent. Opening the parent puts
all three in scope in one go.

*(If `Projects\` contains other unrelated work you'd rather keep out of scope, open on
`garden-apps-shared` instead and use `/add-dir` to add the other two — it works, it's just more
steps.)*

**Two things to have ready**, because Claude Code will need them and can't get them itself:

1. Your **real Firebase config values** — they're already in
   `Garden Management\Netlify Deploy\firebase-config.js`, so Claude Code can just read them. Nothing
   for you to do, but know that they're about to be committed to git.
2. Your **GitHub login**, for making the repo private in Phase 4. That's a browser step you do
   yourself; Claude Code shouldn't and can't do it.

---

## The opening prompt

Copy everything between the lines.

---

I'm restructuring two PWAs (Garden Management and Nursery Management) so that a single private
GitHub monorepo becomes the source of truth and both Netlify sites deploy from it automatically,
replacing the current drag-and-drop workflow.

The full plan already exists. Before doing anything else, read these three files:

1. `garden-apps-shared\RESTRUCTURE-PLAN.md` — the agreed plan: current-state audit, target
   structure, and nine migration phases. This is your primary brief.
2. `Garden Management\CLAUDE.md` — architecture, module map and Firestore data model. Note that its
   "Working conventions" section still describes the OLD drag-and-drop process; rewriting it is
   Phase 3.
3. `garden-apps-shared\README.md` and `.gitignore` — current repo state.

Context on where things stand:

- **Phase 0 is complete.** Both Netlify sites have been deployed from the current `Netlify Deploy`
  folders and tested, `GEMINI_API_KEY` is set on Garden, and label scanning works. The
  `Netlify Deploy` folders are an exact match for production. The `garden-apps-shared` repo,
  by contrast, has one commit from June 2026 and is badly stale — around 10 Garden and 12 Nursery
  JS files differ, and `netlify.toml` plus the whole `functions/` folder are missing. Migration is
  strictly one-way: the live folders overwrite the repo.
- **Part of Phase 3 is done.** The update log has been extracted from Garden's `CLAUDE.md` into
  `Garden Management\CHANGELOG.md`.

Please start on **Phase 1 (prepare) and Phase 2 (build the new tree)**.

Before you change anything, give me a short written summary of what you're about to do — the exact
file moves and deletions, in order — and wait for my confirmation. I want to check the plan against
what you're actually seeing on disk before any files move.

Guardrails for this work:

- **Do not `git push` until I explicitly say so.** The repo must be switched to private on GitHub
  before real Firebase credentials are committed, and that's a manual step I'll do myself. Local
  commits are fine.
- **Run `node --check` on every JS file** after any generation or move — 14 Garden modules, 19
  Nursery modules, plus two `scan-label.js` functions. This is a standing rule of mine. If it
  reports an error, treat it as real; don't dismiss it as a false alarm.
- **Take the backup copy in Phase 1 step 4 before anything else moves.** Everything after that is
  recoverable from it.
- Don't touch the Netlify or Firebase consoles. Phases 5–7 are mine to drive; you prepare the files
  and tell me what to click.
- Flag anything in the plan that doesn't match what you find on disk rather than working around it.

---

## What to expect

Claude Code should come back with a file-by-file breakdown before touching anything. Worth actually
reading it — this is the moment to catch a wrong assumption, when nothing has moved yet.

After Phases 1–2 land, the natural next prompts are:

- *"Now do Phase 3 — rewrite the documentation per Part 4 of the plan."*
- *"Make the first commits per Phase 4, but don't push yet."* — then you flip the repo to private
  on GitHub, and only then authorise the push.

---

## The one ordering mistake worth avoiding

Make the GitHub repo private **before** the first push, not after. Pushing real credentials to a
public repo and then flipping it private leaves them in the public history and in GitHub's caches.

To be clear about the actual stakes: that Firebase web config is already readable by anyone who
views source on your live site — Firestore security rules are what protect the data, not the key's
obscurity. So this isn't an emergency if it happens. But it's a free mistake to avoid, and getting
the habit right matters more than this one key does.
