# Backlog

Known issues and agreed future changes, deferred deliberately rather than forgotten. Each entry says
what's wrong, why it was deferred, and what "done" looks like.

---

## 1. Storage rules don't exclude anonymous guests

**Status:** open · raised 2026-08-06 during Phase 7 · John: "deal with it later"
**Severity:** real but low urgency — pre-existing, unchanged by the restructure

`firebase/storage.rules` gates every path on `request.auth != null`. That condition is **true for
anonymous guest sign-ins**, which is precisely why `firestore.rules` bothers to define
`isAnonymous()` and exclude it from `isEditor()` and `isAdmin()`.

As written, anyone who signs in as a guest can upload to and delete from `plant-photos/`,
`area-photos/`, `nursery-photos/` and `blog-photos/` by calling the Firebase Storage SDK directly.
The inline comments say enforcement happens "at app level by `isAtLeast()`" — but that is UI-only
and does not constrain a direct SDK call.

**Why it was deferred:** Phase 7 deployed byte-identical rules on purpose, so the cutover changed no
behaviour. Fixing this is a considered security change needing its own test pass, not something to
fold into a no-op deploy.

**Done looks like:** Storage rules carry their own role model. Storage rules cannot read Firestore
documents, so `userRole()` is not available — the options are:

- gate on `request.auth.token.firebase.sign_in_provider != 'anonymous'` (cheap, blocks guests, does
  not distinguish editor from viewer), or
- put the role in a **custom auth claim** at sign-in so Storage rules can read
  `request.auth.token.role` (proper fix, needs a Cloud Function or admin-SDK step to set claims)

Recommend starting with the first as a quick win, then deciding whether custom claims are worth it.
Test with a guest session before and after. Ship on a branch with a Netlify deploy preview.

---

## 2. `nursery_wishlist` should match Garden's wishlist behaviour

**Status:** open · raised 2026-08-06 · **John's decision: change Nursery to match Garden — he
prefers Garden's behaviour**

`nursery_wishlist` is the only collection in `firebase/firestore.rules` where *reading* requires
admin:

```
match /nursery_wishlist/{itemId} {
  allow read:                    if isAdmin();
  allow create, update, delete:  if isAdmin();
}
```

Garden's equivalent collection, `suggestions` (its "Wishlist & Ideas"), is:

```
match /suggestions/{suggestionId} {
  allow read:                    if isViewer();
  allow create, update, delete:  if isEditor();
}
```

Consequence today: a viewer or editor opening Nursery's **Plans** tab sees the wishlist silently
empty — no error, just nothing. Firestore denials fail quietly. John, as admin, never sees this.

**Done looks like:** `nursery_wishlist` read becomes `isViewer()` and writes become `isEditor()`,
matching `suggestions`.

**Open question to scope first:** John said the Nursery wishlist should "match the wishlist in the
Garden app". That may mean more than the rules — check whether Nursery's wishlist UI in
`apps/nursery/js/plans-view.js` also differs in behaviour from Garden's suggestions UI in
`apps/garden/js/admin-view.js` (fields, sorting, done/undone handling) before deciding the scope.
The rules change alone is a one-liner; a UI alignment is a larger piece.

Remember standing rule 3: a rules change and any `db.js` change ship in the **same commit**.

---

## 3. `apps/garden/CLAUDE.md` is served publicly

**Status:** open, cosmetic · noted 2026-08-06

Because the publish directory is `apps/garden`, `apps/garden/CLAUDE.md` is reachable at
`https://johnandkath.garden/CLAUDE.md` (and the same for Nursery). It's architecture notes, not
credentials, and both sites send `X-Robots-Tag: noindex` plus `Disallow: /`, so it isn't crawled.

Repo-root files (`CLAUDE.md`, `docs/`, `firebase/`, `tools/`) are **not** published — they're
outside the publish directory.

**Done looks like:** a redirect in each app's `netlify.toml` returning 404 for `/CLAUDE.md`, or
accept it and close this. Not worth a deploy on its own; fold it into the next change that touches
those files.

---

## 4. Linkify URLs in notes at render time

**Status:** open, enhancement · noted 2026-08-13

The AI plant lookup writes a `SOURCES` block into a plant's `notes`, and some entries carry a real
URL. `notes` renders through `escHtml()` into `.field-value`, which is plain text with
`white-space: pre-wrap`, so those URLs are readable but not clickable.

Considered and **rejected**: making `notes` a rich-text field. That would mean migrating every
existing record, rewriting the detail view, and adding an editor to the plant form in both apps —
Nursery has no rich-text editor at all, and Garden's Quill is confined to the blog. It would also
cost the things plain text is good at: searchable, exportable, unchanged in a JSON backup.

**Done looks like:** after `escHtml()`, replace bare `https?://…` runs in the rendered string with
an anchor (`target="_blank" rel="noopener noreferrer"`). Order matters — escape first, then linkify
the escaped text, or the anchor itself gets escaped. No data change, no migration, and it applies
retroactively to every note already written.

Deliberately deferred: the lookup already strips Google's `vertexaisearch` grounding redirects and
keeps the source title alone, so most notes have few bare URLs to click. Worth doing only if the
missing links turn out to be a nuisance in real use.
