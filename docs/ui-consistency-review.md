# UI Consistency Review — Garden Management & Nursery Management

*Prepared 9 August 2026. Based on a full read of `apps/garden` and `apps/nursery` at the current
state of `main`. **No code has been changed.** This document is for review only.*

---

## How the two apps got here

Nursery's `styles.css` is a fork of Garden's. The first 1,930 lines are still byte-identical —
same `:root`, same header, same nav, same modal, same buttons. Everything after that diverged
independently, and neither side has been reconciled since.

The evidence:

| | Garden | Nursery |
|---|---|---|
| CSS lines | 3,781 | 4,396 |
| CSS classes declared | 394 | 509 |
| Classes never referenced in JS/HTML | 27 (7%) | **~260 (51%)** |
| Inline `style="…"` attributes in JS | 236 | 178 |
| Undefined CSS variables referenced | 92 | 102 |

Nursery is the *smaller* app but carries the *larger* stylesheet, because it inherited all of
Garden's irrigation, blog, tasks and overview CSS and never deleted it. Meanwhile it invented
parallel names for components Garden already had.

So the inconsistencies you're feeling aren't random sloppiness — they're the predictable result of
one stylesheet being copied and then edited twice. That matters for the fix: patching individual
screens will not stop it recurring.

---

# Part 1 — The three things you named

## 1. Photo adding: sometimes inline, sometimes only via Edit

**You're right, and it's inconsistent *within* Garden, not just between the two apps.**

The good pattern already exists as a shared component — `.photo-upload-strip` containing two
`.photo-upload-mini` labels (🖼 Gallery / 📸 Camera). It's defined identically in both
stylesheets. It's just applied unevenly:

| Where | Photos shown? | Add from that screen? |
|---|---|---|
| Garden → **Plant detail** | Carousel, **and only if the plant already has ≥1 photo** | ❌ No — [`plants-view.js:447`](../apps/garden/js/plants-view.js:447) says *"read-only; tap to enlarge — manage via Edit"* |
| Garden → Area detail | Carousel, always | ✅ Inline strip — but **admin only** ([`areas-view.js:286`](../apps/garden/js/areas-view.js:286)) |
| Garden → Plant form (modal) | Thumbnail grid | ✅ Inline strip |
| Garden → Area form (modal) | Thumbnail grid | ✅ Inline strip |
| Nursery → **Batch detail** | Thumbnail grid, always | ✅ Inline strip — **editor+** ([`batch-photos.js:36`](../apps/nursery/js/batch-photos.js:36)) |
| Nursery → Log entry | Thumbs appear in the batch grid, read-only | ❌ No — must edit the log entry |

Two things compound the Plant-detail case. The Photos section is wrapped in
`${photos.length > 0 ? …}`, so a plant with **no** photos has no Photos section at all — there is
nothing on screen to suggest you can add one. And the plant you most want to photograph is usually
the one that has none yet.

Nursery's Batch detail gets this right: the section always renders, showing *"No photos yet."* plus
the upload strip.

**The rule I'd adopt:** every entity that can hold photos shows a Photos section on its detail
view, always — even at zero photos — with the inline Gallery/Camera strip visible to anyone with
`editor` or above. Editing stays available for reordering and deleting, but is never the *only*
way in.

Affected: Garden Plant detail (add the section + strip), Garden Area detail (relax `admin` → `editor`),
Nursery Log entries (add a strip to the log row, or accept edit-only for logs and say so).

There are also two different upload progress bars for the same job — Garden's
`.upload-progress` / `.upload-progress-bar` and Nursery's `.photo-upload-bar` / `.photo-upload-fill`
/ `.photo-upload-label`. Same feature, two implementations.

---

## 2. Cultivar capitalization

**Confirmed, and it's a one-attribute difference.** Neither app normalizes text on save — this is
purely the mobile keyboard's `autocapitalize` hint.

Garden's plant form sets it deliberately per field ([`plants-view.js:1006–1050`](../apps/garden/js/plants-view.js:1006)):

| Field | Garden | Nursery ([`batch-form.js:219–270`](../apps/nursery/js/batch-form.js:219)) |
|---|---|---|
| Genus | `words` | *(unset → browser default `sentences`)* |
| Species | `none` | `none` ✅ |
| Subspecies | `none` | `none` ✅ |
| Variety | `none` | `none` ✅ |
| **Cultivar** | **`words`** | *(unset)* ❌ |
| Common name | `words` | *(unset)* ❌ |
| Authority | *(n/a)* | *(unset)* |
| Plant name (picker) | *(n/a)* | *(unset)* |

So typing *new dawn* gives you **New Dawn** in Garden and **New dawn** in Nursery. On a desktop
keyboard there's no difference at all, which is why it only shows up on the phone.

Nursery's placeholders have drifted to match its own behavior too — `e.g. Dog rose` where Garden
says `e.g. Dog Rose`, and `e.g. New Dawn` for a field that won't produce that.

**The rule I'd adopt** — one table, applied identically in both apps:

```
genus, cultivar, commonName, authority, plantName, areaName, zoneName, locationName  → autocapitalize="words"
species, subspecies, variety, epithets, tags, email                                  → autocapitalize="none" spellcheck="false"
task titles, notes, descriptions, observations, blog titles, wishlist items          → autocapitalize="sentences"
```

A second option was to *also* normalize on save (`toTitleCase` on cultivar and common name), which
would fix records already stored in lower case. **Decided against** — see Decisions #2. The
`autocapitalize` hint is overridable by the typist; normalizing on save is not, and would silently
rewrite deliberate lower-case entries.

---

## 3. Buttons placed haphazardly

**Confirmed, with three distinct causes.**

### 3a. The header slot, not the create button

*Corrected 9 Aug 2026 — an earlier draft of this section claimed Garden puts "add" in the header.
It does not. All nine create actions across both apps use a FAB.*

**Create is already consistent.** Every list view in both apps builds a `.fab` bottom-right:
Garden Plants, Areas, Tasks and Blog; Nursery Batches, Dashboard and Plans. Nothing to decide here.

What *is* inconsistent is the **header action slot** — the area to the left of your initials chip —
and the FAB's own details:

| Screen | Header slot holds | FAB |
|---|---|---|
| Garden Plants list | *(empty)* | ➕ |
| Garden Areas list | *(empty)* | ➕ |
| Garden Blog list | *(empty)* | ➕ |
| Garden **Tasks list** | **view-toggle (By Area / By Status) + "Expand all" + 🖨️** — three controls of three different kinds crammed into one row | ➕ |
| Garden Plant detail | ✏️ only *(delete lives inside the edit form)* | — |
| Garden Area detail | 🖨️ + ✏️ | — |
| Garden Blog post | ✏️ | — |
| Nursery **Batches list** | *(empty)* | **two stacked** — 📷 scan above, ➕ below |
| Nursery **Dashboard** | *(empty)* | two stacked |
| Nursery Plans | *(empty)* | ➕ |
| Nursery **Batch detail** | ✏️ **+ 🗑️** — delete is a header icon here, unlike Garden | — |

Four specific problems:

1. **Garden's Tasks header is overloaded.** A view switcher, a bulk action and an icon button share
   one row in a 60px-tall bar. The view-toggle is a *filter*, not a page action — it belongs in the
   content area with the other filter chips, where Nursery puts its equivalent `.filter-tabs`.
2. **Nursery stacks two FABs** on Batches and Dashboard. Two floating circles cover the
   bottom-right corner of the list at every scroll position, and the second one (📷 scan) is a
   shortcut to a *mode* of the first, not a peer action.
3. **Delete is in a different place in each app** — a header icon on Nursery's Batch detail, inside
   the edit form on Garden's Plant detail.
4. **The FAB glyph varies**: Garden and Nursery Batches use a text `+` at 1.6rem; Nursery Plans
   uses a 24px SVG plus. Slightly different weight and optical centring.

Header icon buttons also use different classes per app — `.btn-icon` in Garden, `.icon-btn` in
Nursery (see §2.2).

### 3b. Layout decided ad hoc, 414 times

There are **414 inline `style="…"` attributes** across the two apps' JS. The heaviest offenders:

```
garden/areas-view.js        49      nursery/plans-view.js      40
garden/tasks-view.js        43      nursery/batch-detail.js    30
garden/admin-view.js        39      nursery/batch-form.js      21
garden/irrigation-view.js   39      nursery/admin-view.js      18
garden/plants-view.js       36      nursery/batch-list.js      10
```

Most are spacing — `style="margin-top:24px"` repeated on four consecutive section headers in
`batch-detail.js`, `style="margin:0"` to cancel a heading margin that shouldn't be there, and so
on. When spacing is decided per call site rather than by the component, small differences
accumulate into exactly the "slightly off" feeling you described.

### 3c. Tap targets below 44px

Every interactive element is under Apple's and Google's 44/48px minimum except the FAB (56px) and
the user chip (44px):

| Component | Height | |
|---|---|---|
| `.fab` | 56px | ✅ |
| `.user-chip` | 44px | ✅ |
| `.btn` | ~36px | ⚠️ |
| `.filter-tab` (Nursery) | ~35px | ⚠️ |
| `.sort-toggle-btn` (Nursery) | ~35px | ⚠️ |
| `.icon-btn` (Nursery) | ~32px | ⚠️ |
| `.view-toggle-btn` (Garden) | ~31px | ⚠️ |
| `.filter-chip` (Garden) | ~28px | ⚠️ |
| `.photo-upload-mini` | ~28px | ⚠️ |
| `.filter-pill` (Nursery) | ~26px | ⚠️ |
| `.btn-sm` | ~26px | ⚠️ |

Buttons that are hard to hit read as badly placed even when they're aligned correctly.

---

# Part 2 — Other inconsistencies found

## 2.1 Undefined design tokens — 194 references *(this one is a genuine bug)*

Both stylesheets use CSS variables that are **never defined anywhere**:

| Variable | Garden refs | Nursery refs |
|---|---|---|
| `--grey-500` | 41 | 38 |
| `--grey-300` | 13 | 17 |
| `--green-600` | 12 | 14 |
| `--green-200` | 9 | 8 |
| `--green-400` | 7 | 10 |
| `--grey-700` | 5 | 9 |
| `--radius` | 5 | 5 |
| `--primary` | 0 | 1 |
| **Total** | **92** | **102** |

`:root` defines grey 50/100/200/400/600/800 and green 50/100/300/500/700/800/900. The intermediate
steps were used but never added.

An undefined variable makes the declaration *invalid at computed-value time*. For `color` that
means the element **inherits** its parent's color instead; for `border-color` it falls back to
`currentColor`. So every `color: var(--grey-500)` — the muted-text colour, used 79 times across
both apps — is silently rendering as whatever the parent's text color happens to be. That's why
secondary text looks subtly different from card to card: it *is* different, and it's an accident.

This is the single highest-value fix in this document. It's eight lines of CSS per app and it will
visibly change the look of both — for the better, but worth seeing on a deploy preview first.

`--amber` is defined in both and used in neither.

## 2.2 Parallel names for the same component

| Component | Garden | Nursery | Note |
|---|---|---|---|
| Icon-only button | `.btn-icon` (14 uses) | `.icon-btn` (12 uses) | Nursery still carries `.btn-icon` in CSS, unused |
| Textarea | `.form-textarea` (9 uses) | `.form-input` on `<textarea>` (9 uses) | Nursery still carries `.form-textarea`, unused |
| List container | `.card-grid` | `.card-list` / `.batch-list` | |
| List item | `.card` | `.card-item` | |
| Section container | `.detail-section` (white card, 19 uses) | `.view-content` + bare `<h2>` (0 uses of `.detail-section`) | Fundamentally different visual model |
| Section heading | `.detail-section-title` — green-700, uppercase, inside a card | `.section-heading` — grey-600, uppercase, on the page | |
| Filter control | `.filter-chip` | `.filter-tab` **and** `.filter-pill` **and** `.stage-pill` | Four vocabularies for one idea |
| View switcher | `.view-toggle` / `.view-toggle-btn` | `.filter-tabs` / `.filter-tab` | |
| Upload progress | `.upload-progress` / `-bar` | `.photo-upload-bar` / `-fill` / `-label` | |
| Empty state | `.empty-state` + `.empty-state-icon` (emoji) | `.empty-state` only, no icon, plus one-off `.empty-hint` | |

`.plant-card` means different things in each app: in Garden it's a full-width tile with a colored
banner; in Nursery it's a dense row. Same name, different component.

## 2.3 Page width and padding differ between the apps

Both define `.app-main { padding: 16px }` with `max-width: 1100px` on desktop. Nursery then wraps
every view in a second container:

```css
.view-content { padding: 16px 16px 100px; max-width: 680px; margin: 0 auto; }
```

So Nursery content sits inside **32px** gutters and is capped at **680px**, while Garden uses
**16px** and **1100px**. On a phone that's a visibly narrower column; on a laptop it's a completely
different page shape. Nursery's Batches list opts back out via `.view-content--list { max-width: none }`,
so within Nursery the list is 1100px wide and the detail below it is 680px.

The 100px bottom padding in `.view-content` is what keeps Nursery's FAB from covering the last row.
Garden has no equivalent — its `.app-main` only reserves the 68px nav height, and the FAB sits at
`nav-h + 16` and is 56px tall, so on Garden's Plants list the FAB overlaps the final card.

## 2.4 Dates are formatted five different ways in Garden

Nursery exports one `fmtDate()` from `db.js` and uses it everywhere. Garden has **six local
copies**, and they don't agree:

| Module | Renders 14 May 2026 as |
|---|---|
| `tasks-view.js`, `garden-view.js` | `14 May 26` |
| `admin-view.js` | `14 May 26` |
| `compost-view.js` | `14 May 2026` |
| `irrigation-view.js` | `14 May 2026` |
| `blog-view.js` | `14 May 2026` *(via `toLocaleDateString`)* |

`todayStr()` and `isOverdue()` are likewise re-declared in several Garden modules.

## 2.5 Role gating is uneven

| Action | Garden | Nursery |
|---|---|---|
| Add a plant / batch | `editor` | `editor` |
| **Add an area** | **`admin`** | *(n/a)* |
| **Add a photo to an area** | **`admin`** | *(n/a)* |
| Add a photo to a batch | *(n/a)* | `editor` |
| Delete a record | `admin` | `admin` ✅ |
| Reach the Admin tab | `editor` (for Wishlist) | `admin` only |

An editor in Garden can add plants and tasks but not areas or area photos. The
[`ux-review.md`](ux-review.md) §6 note about the Admin tab being visible to editors is still open,
and Nursery has since resolved the same question the other way.

## 2.6 Behavioral differences

- **Filter persistence.** Nursery's Batches list persists status, stage, search, sort and origin to
  `sessionStorage` and restores them after you visit a detail page. Garden keeps only the Plants
  search query, in a module-level variable that resets on reload. Everything else — task view mode,
  status chips, blog tag filter — resets every time.
- **Sorting.** Nursery's Batches list has an A→Z / Date toggle. No Garden list has a sort control.
- **Search.** Present on Garden Plants, Garden Blog, Nursery Batches, Nursery Plants. Absent from
  Garden Areas, Garden Tasks, Nursery Plans.
- **Confirmation dialogs.** 29 native `confirm()` calls across both apps (19 Garden, 10 Nursery)
  sitting alongside a custom modal and toast system that's used for everything else. Native
  `confirm()` is unstyled, can't be themed, and on installed PWAs shows the origin URL.

## 2.7 Copy and labels

- Primary buttons in modal footers read *Save*, *Save area*, *Save changes*, *Save entry*,
  *Add plant*, *Assign task*, *🍂 Move to Compost Bin*, *🪴 Send to nursery*. The footer *layout* is
  consistent everywhere (Cancel left, primary right) — it's only the wording that wanders.
- **Heading capitalization is mixed in both apps, differently.** Garden uses Title Case —
  *Database Summary*, *Data Quality*, *Import from Spreadsheet*, *Botanical Identity*,
  *Common Information*, *Garden Locations* — but *Plants in this area* in sentence case, in the same
  view as *Danger Zone*. Nursery uses sentence case in content views (*Active batches*,
  *Log entries*, *Loss reasons*) but Title Case in Admin (*User Management*,
  *Propagation Locations*).
- *Emoji in headings — corrected 9 Aug 2026.* An earlier draft claimed Nursery used emoji in
  headings and Garden didn't. Both do, and both confine them to Admin: Garden has *💡 Wishlist &
  Ideas*, *💧 Irrigation*, *👥 User Management*; Nursery has those plus *📍 Propagation Locations*,
  *💾 Backup*, *🔗 Garden Management*. The only outlier is *⚠️ Needs a check-in* on Nursery's
  Dashboard — the one emoji heading outside an Admin panel in either app.
- Garden's nav reads *Overview*; the code, the CSS classes and `ux-review.md` all call it
  *Dashboard*; Nursery's equivalent tab is *Dashboard*.

---

# Part 3 — Overhaul options

## Option A — Targeted fixes, no restructuring

Fix the three things you named plus the undefined variables. Roughly:

1. Define the eight missing CSS variables in both `:root` blocks.
2. Add the Photos section + inline strip to Garden's Plant detail; relax Area photos to `editor`.
3. Add `autocapitalize` to Nursery's plant fields.
4. Raise `.btn`, `.btn-sm`, chips and pills to a 44px minimum tap target.
5. Pick one home for the primary action and apply it to all eight list views.

**Effort:** about a day. **Risk:** low — all additive, nothing renamed.
**Downside:** the two stylesheets still drift apart from tomorrow onward, and the next feature
re-introduces the same class of problem.

## Option B — Shared design layer *(recommended)*

Everything in Option A, plus fixing the *cause*. The root `CLAUDE.md` already anticipates this:

> *"With no build step, a folder outside the publish directory isn't served to the browser… If drift
> becomes a nuisance, a one-line `cp` build command is the easy upgrade."*

Drift has become a nuisance. The shape:

```
garden-apps/
├── shared/
│   ├── tokens.css        ← the complete color ramp, spacing, radii, shadows, type scale
│   ├── base.css          ← reset, header, nav, modal, toast, forms, page container
│   ├── components.css    ← one canonical name per component
│   ├── ui-utils.js       ← today's duplicated copy, now single-source
│   └── auth.js           ← already byte-identical
└── apps/
    ├── garden/
    │   ├── app.css       ← Garden-only: irrigation, blog, tasks, compost
    │   └── …
    └── nursery/
        ├── app.css       ← Nursery-only: stages, batches, outcomes, stats
        └── …
```

Each app's `netlify.toml` gains a build command that copies `shared/` into the publish directory
(`cp -r ../../shared .`). One line, no npm, no bundler, and the "an edited file is the deployed
file" property survives for everything except the shared folder. `tools/check-drift.mjs` gets
simpler because there's nothing left to diff.

The design decisions I'd bake into `shared/`:

**Tokens.** Complete both ramps (grey 50→900, green 50→900), add the missing `--radius`, add a
spacing scale (`--sp-1: 4px` … `--sp-6: 32px`) so section spacing stops being inline. Define
`--tap-min: 44px`.

**One canonical name per component.** Winner in brackets:
`btn-icon` [Garden] · `form-textarea` [Garden] · `card` / `card-grid` [Garden] · `filter-chip`
[Garden, absorbing Nursery's pill and tab] · `view-toggle` [Garden] · `upload-progress` [Garden] ·
`section` / `section-title` [new, replacing both `.detail-section` and `.section-heading`] ·
`empty-state` with a required icon [Garden] · `stage-badge` [Nursery] · `sort-toggle` [Nursery] ·
`view-content` page container [Nursery, but reconciled to one padding value].

**A placement law**, applied everywhere:

| Action type | Placement |
|---|---|
| Create the main thing on a list page | FAB, bottom-right, one only *(already the rule — just enforce "one")* |
| Secondary create (label scan) | Not a second FAB — put it in the header slot, or a small button beside the search bar |
| Edit / delete the record you're looking at | Header icon buttons, top-right |
| Filters and view switchers | Content area, below the search bar — **never** the header slot |
| Add to a section within a detail page | `btn btn-sm` in that section's header row, right-aligned |
| Add a photo | Inline Gallery/Camera strip directly under the photos, always visible to editors |
| Confirm / cancel a form | Modal footer, Cancel then primary, right-aligned *(already consistent — keep it)* |
| Destructive action in a form | `btn-danger`, footer, far left, separated |

**A copy law.** Primary button = the verb of the action, sentence case, no emoji
(*Save*, *Save changes*, *Add plant*, *Assign task*). Emoji only in headings, and then in both apps
or neither.

**Effort:** roughly a week of evenings, done in phases behind branches and deploy previews.
**Risk:** medium, but each phase is independently checkable on a preview URL.
**Payoff:** the next feature you add lands consistent by default.

## Option C — Rebuild on a framework

React/Svelte + a component library. **I'd advise against it.** These are working apps with real
data and a genuinely nice no-build-step property that makes them easy for you to maintain
single-handed. The problems above are all *organizational*, not architectural — a framework would
solve them incidentally while costing a full rewrite, a build toolchain, an npm dependency tree,
and every one of your Firestore integration points re-tested. The cost isn't proportionate to the
benefit.

---

## Suggested sequence

If you go with Option B, I'd order it by visible-benefit-per-risk:

| Phase | What | Why first |
|---|---|---|
| **1** | Define the 8 missing CSS variables in both apps | Fixes a real bug, one commit, immediately visible |
| **2** | The three issues you named: photo strips, `autocapitalize`, 44px tap targets | Your actual daily friction |
| **3** | Consolidate Garden's six `fmtDate` copies into `db.js` | Small, self-contained, removes a visible inconsistency |
| **4** | Extract `shared/tokens.css` + `base.css`; add the `cp` build command; verify both deploy previews | The structural change, isolated so it can be rolled back cleanly |
| **5** | Reconcile component names into `shared/components.css`; delete Nursery's ~260 dead classes | Biggest diff, lowest functional risk |
| **6** | Apply the placement law; replace inline spacing with the spacing scale | The "haphazard" fix proper |
| **7** | Optional: replace 29 `confirm()` calls with the existing modal; add filter persistence and sort to Garden's lists | Polish, genuinely optional |

Phases 1–3 are worth doing whichever option you pick. Phase 4 is the decision point.

---

## Decisions — agreed with John, 9 August 2026

**Approach: Option B — shared design layer.** Agreed.

| # | Question | Decision |
|---|---|---|
| 1a | Nursery's second (📷 scan) FAB | **Remove it.** It opens the same batch form as ➕, which already offers the scan card. The FAB is redundant, not a shortcut worth a second floating circle. |
| 1b | Garden's Tasks view-toggle (By Area / By Status) | **Move it out of the header** into the content area, alongside the filter chips — matching Nursery's Batches layout. |
| 1c | Where delete lives on a detail page | **Nursery's way** — a header icon button beside edit. Cleaner than burying it in the edit form. Garden's Plant, Area and Blog detail views change to match. |
| 2 | Title-casing cultivar and common name | **Keyboard hint only** — `autocapitalize="words"`, which the user can always override by backspacing. **Do not** normalize on save: that would silently rewrite deliberate lower-case entries such as `× heucherella`. Note this only affects touch keyboards; desktop typing is unchanged. |
| 3 | Can an editor add areas and area photos in Garden? | **Yes.** Change `isAtLeast('admin')` → `isAtLeast('editor')` on the Areas FAB, the area-photo upload strip and the area edit button. Deletion stays `admin`. |
| 4 | Nursery's 680px column | **Not deliberate** — an accident of the fork. Reconcile to Garden's single container: one 16px gutter, 1100px desktop cap. Keep a bottom-padding reserve so the FAB stops covering the last row (which fixes Garden too). |
| 5 | Emoji and heading case | **Sentence case everywhere.** Keep emoji for Admin-panel section headings in both apps; remove the stray *⚠️* from Nursery's Dashboard heading. |

## State of the April 2026 `ux-review.md`

Checked against the code on 9 Aug 2026. **Seven of its nine suggestions are already shipped** — no
work needed:

| ux-review § | Suggestion | State |
|---|---|---|
| 1 | Default landing page → Tasks | ✅ `main.js:48` — `currentView = 'tasks'` |
| 1 | Reorder nav, most-used first | ✅ Tasks · Areas · Plants · Overview · Blog · Admin |
| 2a | Tasks defaults to By Status | ✅ `tasks-view.js:36` — `activeView = 'by-status'` |
| 2b | Overdue filter chip | ✅ `.filter-chip--overdue`, session-persistent |
| 3 | Rebuild My Garden as a real dashboard | ✅ Stats, recent plants, tasks, compost, area chips |
| 4 | Active-task count on area cards | ✅ `.area-task-badge`, with an overdue variant |
| 5 | Plant location on plant cards | ✅ `.plant-card-location`, incl. "Not placed" |
| 6 | Admin tab visibility for editors | ⚠️ **Already resolved as Option A** — see below |
| 7 | Bigger tap target for the user chip | ⛔ **Declined 9 Aug 2026** — not a problem in practice |

The only leftover from §1 is naming: the nav still reads *Overview* while the code, the CSS classes
and both docs call it *Dashboard*. Pick one during Phase 6.

### §6 was already answered — as Option A, not B

The April doc offered two options. **Option A has since been implemented in full:**

- `main.js:308–312` hides the Admin tab for viewers *and* editors — *"Show admin tab for admin only"*.
- The Wishlist was surfaced elsewhere instead: `garden-view.js:243` puts a **Wishlist & Ideas**
  section on the Overview page, commented *"(all roles)"*, with an add box and list.

So editors already have the Wishlist somewhere contextual and no confusing Admin tab — exactly what
Option A proposed.

Adopting Option B now would **reverse** that: re-show a nav tab to editors that is currently hidden,
and put the Wishlist in two places at once. Flagged for John to confirm before anything changes.

Two loose ends left by the Option A work, worth tidying whichever way this goes:

- `main.js:302–304`'s comment still claims *"Editors: Admin tab shown (they see Wishlist section
  only)"* — it contradicts the code three lines below it.
- `admin-view.js:39–45` still carries the editor-only Wishlist branch (`buildWishlistOnlyHTML()`),
  now unreachable from the nav.

## Still open

- **Whether Garden's lists gain sort and filter persistence** to match Nursery's Batches list.
  Phase 7, genuinely optional.
- **Deploy previews.** John hasn't used Netlify's deploy-preview feature before. Phase 1 is the
  first branch that needs one — walk through it step by step at that point.

---

## Appendix — findings index

| # | Finding | Severity | Effort |
|---|---|---|---|
| 1 | 194 references to undefined CSS variables; muted text silently inherits | **Bug** | Trivial |
| 2 | Garden Plant detail has no photo-add affordance, and no Photos section at all when empty | High | Small |
| 3 | Garden area photos gated on `admin`, Nursery batch photos on `editor` | High | Trivial |
| 4 | Nursery plant-name fields missing `autocapitalize="words"` | High | Trivial |
| 5 | Header slot overloaded on Garden Tasks; Nursery stacks two FABs; delete placed differently per app | Medium | Small |
| 6 | Every control except the FAB and user chip is under a 44px tap target | High | Small |
| 7 | Garden's FAB overlaps the last list row (no bottom padding reserve) | Medium | Trivial |
| 8 | 414 inline `style` attributes doing layout | Medium | Large |
| 9 | ~260 of Nursery's 509 CSS classes are dead (inherited from the fork) | Medium | Medium |
| 10 | Parallel names for 10 shared components (`btn-icon`/`icon-btn`, etc.) | Medium | Medium |
| 11 | Nursery content is 680px/32px, Garden is 1100px/16px | Medium | Trivial |
| 12 | Garden formats dates 3 different ways across 6 duplicated `fmtDate` copies | Medium | Small |
| 13 | 29 native `confirm()` calls alongside a custom modal system | Medium | Medium |
| 14 | Filter/sort state persists in Nursery Batches only | Low | Medium |
| 15 | Section-heading visual language differs (green card label vs grey page heading) | Low | Medium |
| 16 | Primary button labels wander across 8 variants | Low | Trivial |
| 17 | Heading capitalization mixes Title Case and sentence case in both apps, differently | Low | Trivial |
| 18 | Nav says "Overview"; code, CSS and docs say "Dashboard" | Low | Trivial |
| 19 | Empty states have icons in Garden, not in Nursery | Low | Trivial |
| 20 | `--amber` defined in both, used in neither | Cosmetic | Trivial |

---

*Related: [`ux-review.md`](ux-review.md) (April 2026) — content and navigation suggestions, several
still open. This document deliberately covers only consistency and visual system, not information
architecture.*
