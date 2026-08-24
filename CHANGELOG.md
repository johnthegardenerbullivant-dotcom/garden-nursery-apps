# Changelog

Notable changes, newest first. Per-commit detail is in the git history; this file exists for one
job the history cannot do: telling someone running **their own copy** what a release asks of them.

## Read this if you maintain a fork

Syncing your fork updates your *files*. Netlify rebuilds your sites automatically. **Two things it
cannot do for you**, and both fail quietly:

- **Security rules.** `firestore.rules` and `storage.rules` deploy by the Firebase CLI, never by
  Netlify. A rules change reaches your files and not your database, and a mismatch shows up as
  **empty lists rather than errors**. When an entry says *redeploy rules*, run this from `firebase/`:

  ```bash
  firebase deploy --only firestore:rules,storage
  ```

- **New environment variables.** A feature that needs one is broken on your site until you add it in
  Netlify **and redeploy** — environment variables only take effect on the next build.

Every entry below therefore carries an **Action required** line. `none` means sync and you're done.

---

## 2026-08-24

**Action required: none.** Documentation only — sync and you're done.

- **`SETUP.md` now names the repository to fork.** B3 said "open the repository on GitHub and click
  Fork" without ever giving the address, which is fine if you arrived from a link and useless if you
  didn't. It's `johnthegardenerbullivant-dotcom/garden-nursery-apps`, and B4 now looks for that name
  rather than `garden-apps`.
- **B3 also says which GitHub buttons to ignore.** A brand-new account opens on a dashboard offering
  **Create repository** and **Import repository**. Both are wrong, and Import is the actively harmful
  one: it copies the files but drops the upstream link, so there's no **Sync fork** button and every
  future update becomes a hand-merge.
- **B1 and B2 rewritten for the 2026 Firebase console.** The left menu no longer has a **Build**
  section; products sit under **Product categories** — Firestore and Storage under *Databases &
  Storage*, Authentication under *Security*. Also covered, because each stops you dead the first
  time: **Create database** is a button on the page rather than a menu entry, the database wizard
  asks **edition → location → rules** in that order, Storage now walks you through **Upgrade
  project** and a **Set up default bucket** dialog, Google sign-in refuses to save until you give
  the project a public-facing name and support email, and **Your apps** is a panel inside
  *Settings → General*, not an item in the Settings menu.
- **Anonymous sign-in: turn on Auto clean-up.** It deletes guest accounts older than 30 days.
  Guests are read-only viewers with no Firestore document, so there is nothing to lose.
- **B4 rewritten for Netlify's first-run flow**, which is not the one it described. Creating your
  first site doesn't go through *Add new site* at all — signup runs a questionnaire (the team name
  at the end is the one answer that sticks), then offers an AI site-builder you should ignore, then
  two *separate* GitHub windows people conflate: **Authorize Netlify** (consent) and **Install
  Netlify** (which repositories it may touch — pick *Only select repositories*). The build settings
  are collapsed behind **Edit build settings ↓**.
- **You type the base directory and nothing else.** Netlify reads the repo's `netlify.toml` and
  auto-fills the build command, publish directory and functions directory for you. The guide used to
  ask for the publish directory as well, which was redundant. Leave whatever Netlify puts there.
- **Netlify calls sites "projects" now.** *Site configuration* is **Project configuration**
  throughout, including where you rename a site — and it never offers to name it during setup, so
  an address like `precious-zuccutto-800b80.netlify.app` is expected rather than a mistake.
- **Post-processing can sit on "In progress" after the log says `Site is live`.** Stale panel, not a
  stuck build. Reload.
- **Warned about the cursor jumping while you type the base directory.** Netlify re-reads the repo
  on every keystroke and throws the caret back to the start of the box each time, so `apps/garden`
  comes out scrambled. Paste it, or check the box afterwards.
- **The second site can be named at creation.** The dashboard route has a **Project name** field the
  signup wizard doesn't, so only the first site has to get a random address.
- **`GARDEN_URL` needs a redeploy if you add it after the fact**, and Netlify won't do that for you.
  It's the easiest of the seven variables to miss, and the symptom — two links quietly absent — is
  indistinguishable from a Nursery-only installation.
- **If the Storage rules editor won't accept a paste,** the Rules Playground panel has the keyboard.
  Close it, or use the CLI. Also points at GitHub's *copy raw file* button, which beats select-all.

## 2026-08-21

**Action required: none.** Documentation only — sync and you're done.

- **`SUPPORT.md` added**, along with issue templates. It leads with the fix rather than the contact
  details, because one problem dominates: the app loads, every list is empty, and there is no error
  message. That's security rules that haven't been deployed.
- **Questions and ideas now belong in Discussions**, bugs in Issues. The bug form asks which app,
  what role your account has, and whether you've done the **Action required** steps for your
  version — that last one resolves most reports on its own.
- **Installation-specific details moved out of the tracked files.** Nothing in this repository now
  names any particular Firebase project, web address or folder path, so a fork doesn't inherit
  another installation's details as though they were its own.
- **Prices are in US dollars**, and the documentation no longer describes itself as a private repo.

## 2026-08-20

**Action required: redeploy rules.**

- **Anonymous guests can no longer write to Storage.** `storage.rules` gated every path on
  `request.auth != null`, which is true for guest sign-ins — so anyone who pressed *Continue as
  Guest* could upload to and delete from every photo path by calling the Storage SDK directly.
  Reads are unchanged, so guests still see photos. (#20)

  A signed-in **viewer** can still write to Storage: that distinction lives in Firestore, which
  Storage rules cannot read. Closing it needs the role in a custom auth claim. Not done.

- **Nursery's wishlist is open to editors**, matching Garden, where an editor who can add plants can
  also record an idea about the app. Editors get a wishlist-only view; locations, user management
  and backup stay admin-only. (#22)

- **Firebase configuration moved out of the repo into environment variables.** `firebase-config.js`
  and `app-config.js` are now generated at build time by `tools/build.mjs` and are gitignored, along
  with `firebase/.firebaserc`. **This is what makes forks updatable**: there is no longer a tracked
  file a copy owner must edit, so every sync is a clean fast-forward instead of a merge conflict.
  (#15)

  A corrupt variable now fails the build rather than shipping — whitespace, any non-ASCII character,
  or an `apiKey` not shaped like `AIza` + 35 characters. That guard exists because a masked paste of
  an API key once passed every check and only surfaced at sign-in.

- **`SETUP.md`, `LICENSE` and this file added.** Setup instructions now travel with the code.

- **Documentation corrected** to describe the build that actually exists, and a new standing rule:
  verify by running it, not by reading it. (#18, #21)

## 2026-08-18

**Action required: none.**

- **AI plant lookup** researches a plant from its botanical name and offers sourced prose for the
  Notes field. Nothing reaches the form until you press a button, and notes are appended, never
  replaced. Needs `GEMINI_API_KEY`. See `docs/plant-lookup.md`. (#13)

## 2026-08-10

**Action required: none.**

- **One shared design layer** at `/shared`, copied into each app at build time, ending the drift
  between the two stylesheets.

## 2026-08-06

**Action required: redeploy rules.**

- **Monorepo restructure.** Both apps in one repository, deploying automatically, with
  `firestore.rules` and `storage.rules` in exactly one place (`firebase/`) instead of a copy inside
  each app. Editors can now create and rename areas — an editor who can add a plant needs to be able
  to add the bed it goes in.

---

Earlier history predates this file and is in the git log.
