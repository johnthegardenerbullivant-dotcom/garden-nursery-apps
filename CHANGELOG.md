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
