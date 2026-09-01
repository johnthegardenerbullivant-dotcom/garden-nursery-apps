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

## 2026-09-01

**Action required: none — but set `GARDEN_URL` on the Garden site if you intend to print tags.**

- **QR codes on plant tags.** A printed label can now carry a QR code that opens that plant's page.
  Plant detail has a tag button (editor and above) for a single tag; an area's **Print** dialog has
  a third option, **Plant tags**, which lays out a sheet of them — 12 per page, cut guides included,
  sized to fit US Letter and A4 alike.

- **Label printers are supported directly.** The tag dialog also prints a layout for continuous
  label tape on a Brother P-touch, through the printer's own driver over USB — pick the tape width
  and it sizes the code to a whole number of printer dots. 18 mm and 24 mm tape both give a 15.7 mm
  code at three dots per module; 12 mm and narrower cannot carry the code and are not offered.
  Not over Bluetooth: the PT-P710BT speaks Bluetooth Classic, the Web Bluetooth API speaks only
  BLE, and a browser cannot reach it. [`docs/plant-tags.md`](docs/plant-tags.md) has the details.

- **Tags encode `HTTPS://<SITE>/P/<TAGCODE>`.** `apps/garden/_redirects` rewrites `/p/*` and `/P/*`
  to the app (a 200 rewrite, so the path survives) and the router turns it into the existing
  `#plant-detail/<id>` view. The indirection is the point: a tag in the ground outlives any change
  to the app's routing, and only those lines have to keep the promise. Existing
  `#plant-detail/<id>` links, including Nursery's, are untouched.

- **`tagCode` is a new field on `plants`** — six characters, minted the first time a tag is printed
  for that plant, so **there is nothing to migrate**. Plants you never tag never get one. It exists
  because the 20-character Firestore ID makes a code too dense to print on label tape; the short
  code, upper-cased, is what fits 18 mm tape at three printer dots per module. No new collection and
  **no Firestore rules change** — resolving a code is an ordinary `plants` read.

- **Scanning a tag no longer meets a login screen.** Someone arriving on a `/p/` URL while signed
  out is signed in anonymously and taken to the plant. Anonymous users are viewers — read-only, as
  enforced by the Firestore rules. Nothing became readable that a guest could not already read by
  pressing *Continue as Guest*; the speed bump in front of it is gone.

- **`index.html`'s asset paths are now root-absolute** (`/styles.css`, `/js/main.js`, `/shared/…`).
  Under the `/p/` rewrite the old relative paths would resolve to `/p/styles.css` and 404. If you
  maintain a fork and have edited `index.html`, keep those paths absolute.

- **`GARDEN_URL` now matters on Garden too.** It was documented as Nursery-only. Tags fall back to
  whatever host generated them, so a sheet printed from a deploy preview would be stamped with that
  preview's temporary address and would die with the pull request. Setting `GARDEN_URL` on the
  Garden site pins tags to the real one. The sheet prints the address it used along its top edge.
  It also sets the length budget for the code: the whole upper-cased URL must stay within 47
  characters to keep the tag printable on tape, which leaves 38 for the host.

- **New dependency:** `uqr` (MIT, ~27 KB, no dependencies), loaded from jsDelivr like
  `browser-image-compression`. Full notes, including why the QR error correction is level Q, why the
  quiet zone is four modules and why the encoded URL is upper case, are in
  [`docs/plant-tags.md`](docs/plant-tags.md).

## 2026-08-24

**Action required: none**, unless you use AI plant lookup — see the Gemini entry below.

- **[`QUICKSTART.md`](QUICKSTART.md) added.** The same setup as a two-page checklist, reasoning
  stripped out, every step deep-linked to its section in `SETUP.md`. The full guide roughly doubled
  in length over a day of testing it against the real consoles — all of it earned, none of it what
  a newcomer wants to read before they've started. Begin with whichever suits you.
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
- **If the Storage rules editor won't accept a paste, click onto a line of the code first** —
  confirmed fix. The page opens with the Rules Playground beside the editor and the editor holding
  no keyboard focus, so select-all and paste silently do nothing. Also points at GitHub's *copy raw
  file* button, which beats select-all on the Raw page.
- **Authorized domains is now its own section, B5** — the sections after it shift up by one, so the
  admin step is **B8** and the last bits are **B10**. It was the closing bullet of the Netlify
  section, and there it got skipped, which makes B8 not merely harder but impossible: Google sign-in
  opens a popup that shuts itself with no message on either site, so no account is ever created to
  promote. The underlying `auth/unauthorized-domain` shows only in the browser console.
- **Setting `role: admin` may not take effect on a reload — sign out and sign in.** The app re-reads
  the role at every start, so a reload ought to be enough; in testing it wasn't, and the
  access-denied screen persisted until a full sign-out. B8 and B9 both say so now, because the same
  thing will happen to anyone you grant a role to.
- **B8 now says what the other fields in the user document are for**, so nobody edits
  `status: "pending"` trying to help. Nothing reads it for access; `role` is the whole mechanism.
- **B6 covers the Google AI Studio key dialog**, which now asks you to name the key and choose a
  Cloud project. Pick the Firebase project from B1, so key, quota and billing stay together instead
  of landing in a stray "Default Gemini Project". Also: a Gemini key starts **`AQ.`** and is about
  50 characters — *not* the `AIza…`-and-39 shape of `FIREBASE_API_KEY`, so it looks wrong and isn't.
  Nothing validates it at build time; a bad one shows up as a failed scan.
- **Skipping the AI features is now stated as tested rather than promised.** With no key, Scan label
  and Look up plant fail with a "Failed" flag and a panel saying the key is missing. Nothing else is
  affected.
- **Plant lookup now requires billing enabled on the Gemini API. Scan label does not.** Google sells
  the web-search tool separately from the model and does not include it in the free tier of *any*
  Gemini 3.x model; the two older models that did allow it, `gemini-2.5-flash` and
  `gemini-2.5-flash-lite`, now answer `HTTP 404 … no longer available to new users`. Tested
  directly against the API on 24 Aug 2026, not inferred: grounded calls fail on every reachable
  model, an ungrounded call to the same key succeeds. **There is no model or environment variable
  that works around it** — leave `GEMINI_MODEL` and `GEMINI_MODEL_RESEARCH` alone. Enable billing
  in AI Studio and it works; the first **5,000 grounded searches a month are free**. Measured on the
  author's own installation, the Gemini API bill for 24 days was **$3.34**, in a month that included
  building and testing the feature — a household should expect pennies. Two things B6 now warns
  about: the API bills as **prepaid credits** with **auto-reload likely switched on**, which is the
  part that can quietly recur; and it is a **separate billing account from the Firebase card in B1**,
  so a Firebase budget alert will not warn you about it.
  The research phase never falls back to an unsearched answer, by design — an ungrounded plant
  description is a confident invention — so it fails outright instead.
- **The error you get says none of that.** It arrives as `HTTP 429 RESOURCE_EXHAUSTED`, *"You
  exceeded your current quota"*, in under half a second on a key with no usage at all. B6 now names
  it and points at Netlify → *Logs & metrics → Functions → `lookup-plant`*, which logs Google's full
  message — the apps show only "Lookup service error", and the guide had never mentioned the log.
- **B6 also names the dead ends, so nobody re-walks them.** *Rate limits by model* shows healthy,
  unused quota, because the model allowance genuinely is fine and nothing there hints that the tool
  on the request is priced separately. And a project can carry a ⚠ **"Prepay required"** badge — the
  Firebase project from B1 does, which is a second reason not to put the key there — but that was
  not the cause either.
- **Don't attach the Gemini key to your Firebase project.** Use `Default Gemini Project`. The key is
  used server-side by the Netlify functions and has no relationship to Firebase, so there was never
  anything to gain by keeping them together, and the B1 project carries the prepay flag.
- **The Gemini API's paid tier is not the Firebase Blaze upgrade.** B1 already asks for a card, so
  assuming it covers Gemini is natural and wrong. The cost table is corrected accordingly.
- **New troubleshooting row for "Lookup service error" / "Vision service error"** with a key that is
  correctly set, pointing at the function log. The apps deliberately don't surface Google's message,
  so without that pointer there's nothing to go on.
- **"It signed me in" is not the same as "it signed me in as me."** Firebase keeps a session between
  visits, so an earlier *Continue as Guest* is still live and the app opens as that guest — who is
  read-only and has no `users` record to grant a role to. B7 now says to check who you are, and sign
  out first.
- **Netlify project names are unique across all of Netlify**, not just your account, so the obvious
  ones are taken and the box rejects them.

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
