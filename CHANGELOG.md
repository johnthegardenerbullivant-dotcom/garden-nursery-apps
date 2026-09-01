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
