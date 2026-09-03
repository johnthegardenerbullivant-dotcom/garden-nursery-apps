# Plant tags — QR codes on physical labels

A printed plant tag carries a QR code. Scanning it opens that plant's detail page in Garden
Management. This file is the authority on the URL contract and the print geometry; the code is in
[`apps/garden/js/qr.js`](../apps/garden/js/qr.js).

Two ways to make one:

| | Where | Output |
|---|---|---|
| **Paper tags** | Plant detail 🏷️, or an area's **Print → Plant tags** | 63 × 64 mm tags, 12 to a sheet, cut guides |
| **Label tape** | Plant detail 🏷️ → **Print tape** | One continuous label per plant, for a Brother P-touch |

---

## The URL contract

A tag encodes exactly this, in **upper case**:

```
HTTPS://<SITE>/P/<TAGCODE>
```

`<TAGCODE>` is a six-character code stored on the `plants` document as `tagCode` — **not** the
20-character Firestore document ID. Four pieces make it work:

| Piece | Where | What it does |
|---|---|---|
| `/p/* → /index.html 200`<br>`/P/* → /index.html 200` | `apps/garden/_redirects` | **Rewrite, not redirect.** Netlify serves the app while leaving the path in the address bar and in `location.pathname`. Both cases are listed because Netlify matches paths case-sensitively. |
| `absorbTagPath()` | `apps/garden/js/main.js` | Reads that path on load and rewrites the URL to a normal hash route, so the router never learns that tags exist. |
| `getPlantByTagCode()` | `apps/garden/js/db.js` | Resolves a code to its plant. |
| `plantTagQrText()` | `apps/garden/js/qr.js` | Builds the string that goes into the code. |

**Why the indirection?** A tag is printed, laminated and pushed into the ground, and it stays there
for years. The app's routing will not. `/P/<code>` is a promise to the physical world, and the two
lines in `_redirects` are the only thing that has to keep it. `#plant-detail/<id>` still works
directly and is what Nursery's `batch-detail.js` links to — nothing about that changed.

`absorbTagPath()` also accepts a raw Firestore ID at `/p/<id>` and routes straight to the plant.
That form predates tag codes and costs one branch to keep.

### Why upper case, and why a short code

These two choices are what make a tag fit a label printer's tape. They are not cosmetic.

QR has a compact **alphanumeric mode** covering `0-9`, `A-Z`, space and `$%*+-./:` — but **not**
lower case, which forces the encoder into byte mode. Measured with `uqr` at ECC Q, on a 26-character
host:

| What the tag encodes | Chars | Modules | + quiet zone |
|---|---|---|---|
| `https://host/p/<20-char Firestore ID>` | 49 | 37 | 45 |
| `HTTPS://HOST/P/<20-CHAR FIRESTORE ID>` | 49 | 33 | 41 |
| `https://host/p/<6-char code>` | 35 | 33 | 41 |
| **`HTTPS://HOST/P/<6-CHAR CODE>`** | **35** | **29** | **37** |

Only the last one fits an 18 mm tape at three printer dots per module. See the tape table below for
why that number is the whole game.

Upper case is safe: RFC 3986 makes the scheme and host case-insensitive and browsers normalise them,
and the path is served by explicit `/p/*` **and** `/P/*` rules.

**Budget for a fork.** A version-3 alphanumeric symbol at ECC Q holds **47 characters**. The code is
6 and `/P/` is 3, so the host — scheme included — must be **38 characters or fewer** to stay at 29
modules. `https://something.netlify.app` is comfortably inside that; a long custom domain may not
be, and the tag will quietly grow to 33 modules and drop to two dots per module on tape. The plant
tag modal prints the actual dots-per-module for the code in front of you.

### Tag codes

`tagCode` is six characters from **Crockford's Base32** alphabet — `0123456789ABCDEFGHJKMNPQRSTVWXYZ`,
which omits I, L, O and U. Two reasons: nothing on a printed tag can be misread as something else,
and every character is legal in QR alphanumeric mode.

Codes are **minted lazily** — the first time someone prints a tag for a plant, by `ensureTagCode()`
in `db.js`. So this feature needed no migration over the collection, and a plant that never gets a
tag never gets a code. Allocation checks the collection for a collision before writing; 32⁶ is a
billion codes, so a retry should never happen, but a duplicate would silently point two tags at one
plant and that is not worth leaving to probability.

Minting is a write, so it needs **editor**. Every path that prints a tag is already editor-only.

### Two things that will silently break every printed tag

1. **Relative asset paths in `index.html`.** Under the `/p/` rewrite, `href="styles.css"` resolves
   to `/p/styles.css` and 404s — an unstyled, script-less page. The stylesheet and module `src`
   attributes are root-absolute (`/styles.css`, `/js/main.js`) for exactly this reason. Keep them
   that way.
2. **Clearing or reassigning `tagCode`.** The code is the tag's whole identity. Deleting a plant and
   adding it again mints a new one, and the tag in the ground now leads to "Tag not recognised".
   Edit plants, don't replace them — or reprint the tag.

## Who can scan a tag

Anyone. A visitor arriving on a `/p/` URL while signed out is signed in anonymously and taken
straight to the plant — `arrivedFromTag` in `main.js`. Anonymous users are **viewers**: read-only,
enforced by the Firestore rules, not by that branch. A login screen behind a QR code on a plant
label is a wall in front of someone standing in the garden holding a phone, so there isn't one.

This is a deliberate trade: the plant collection was already readable by any guest who pressed
*Continue as Guest*, and tags remove the last speed bump in front of it. The site remains `noindex`
and is not linked from anywhere public.

Resolving a code is an ordinary `plants` query, which viewers may already run, so **no Firestore
rules change was needed** for any of this.

## Where the base URL comes from

`tagBaseUrl()` prefers `GARDEN_URL` and falls back to `window.location.origin`.

`GARDEN_URL` is documented as Nursery-only, and Garden works without it. **Set it on the Garden
Netlify site anyway if you print tags**: without it, a sheet generated while looking at a deploy
preview is stamped with that preview's throwaway address, and every one of those tags dies when the
pull request is merged. The sheet prints the base it used along its top edge, so this is visible
before you cut anything out.

---

## Paper print geometry

| | |
|---|---|
| Tag | 63 × 64 mm, dashed cut guide |
| Grid | 3 across, 4 down = **12 per sheet** |
| Paper | Fits US Letter **and** A4 at an 8 mm margin, so paper size never has to be chosen |
| QR | 37 mm, error correction **Q**, four-module quiet zone |
| Text | Botanical name (authority dropped), common name, the area with a quantity if more than one, and the tag code |

One tag per **plant**, not per instance: two rows for the same plant in one area are two clumps of
the same thing and would carry an identical code, so they fold into one tag with the quantities
added.

### Why those QR numbers

- The tag URL at ECC Q is a **29 × 29 module** code (QR version 3), 37 across once the quiet zone is
  added. At 37 mm on paper that is **1.0 mm per module** — enormous, and deliberately so: paper
  tags have the room, and every spare millimetre of module is tolerance against mud and wear.
- **ECC Q survived about twice the contiguous damage that ECC M did** (10% of the code area smeared
  over, against 5%) before it stopped decoding. That difference is mud, moss and a scuff from a hoe.
- The four-module quiet zone is the QR spec's, and a thin one is the most common reason a
  home-printed code refuses to scan. `uqr` defaults to **one** module and ECC **L**; both are
  overridden explicitly in `qrSvg()`, and both should stay overridden.

---

## Label tape — Brother P-touch

The **Print tape** button lays out one label per plant for continuous tape, and sends it through the
**ordinary print dialog to the printer's own driver**. Connect the PT-P710BT over **USB**, choose it
as the print destination, set the paper to the tape width, margins to **None**, and scale to
**100%** — *not* "Fit to page", which resizes the code and destroys the whole-dot module sizing
below. The print window repeats these instructions on screen.

### Why not Bluetooth

Asking a browser to drive the printer directly does not work, and it is worth writing down why so
nobody spends a weekend on it:

- The **PT-P710BT speaks Bluetooth Classic RFCOMM/SPP.** Every working open-source driver for it
  pairs over RFCOMM.
- **The Web Bluetooth API only speaks BLE/GATT.** There is no SPP equivalent in BLE, so the printer
  never even appears in `requestDevice()`'s chooser. This is categorical, not a bug to route around.
- **Web Serial** *can* reach Bluetooth SPP, but only on **desktop Chrome 117+**, only after the
  device is paired at OS level, and not on Android or iOS at all — which removes the phone-in-the-
  garden case this feature exists for. It would also mean implementing Brother's raster command set
  byte-exactly in the browser, untestable without the hardware in hand.

The driver already does all of that, and it is the same driver P-touch Editor uses.

### Tape geometry

A P-touch has a **128-pin head at 180 dpi**, so one dot is 0.1411 mm. Narrower tape does not use the
whole head — the unused pins are a margin at each end:

| Tape | Margin pins (each) | Printable dots | Printable height |
|---|---|---|---|
| 3.5 mm | 52 | 24 | 3.4 mm |
| 6 mm | 48 | 32 | 4.5 mm |
| 9 mm | 39 | 50 | 7.1 mm |
| 12 mm | 29 | 70 | 9.9 mm |
| **18 mm** | **8** | **112** | **15.8 mm** |
| **24 mm** | **0** | **128** | **18.1 mm** |

**A QR module must be a whole number of printer dots.** Ask for 2.49 and the modules come out
unevenly sized, and uneven modules — not overall size — are what actually stops a small thermal code
scanning. So `tapeQrPlan()` floors it, and the code may leave a sliver of tape unused.

For the 37-module tag code:

| Tape | Dots per module | Code size | Module size | |
|---|---|---|---|---|
| 12 mm | 1 | 5.2 mm | 0.14 mm | **not offered** |
| 18 mm | **3** | 15.7 mm | 0.42 mm | good |
| 24 mm | **3** | 15.7 mm | 0.42 mm | good |

18 mm is the sweet spot: it reaches three dots per module, and 24 mm buys no more code because
three dots is already all that 37 modules can take before overrunning either tape. Anything under
18 mm is refused rather than printed badly. Verified by rendering the code at exactly 111 px
(37 modules × 3 dots) and decoding it — it reads back correctly at the true print raster.

The layout runs **along** the tape rather than across it, because length is unlimited and width is
not: the QR is sized by the width, and the name sits beside it.

The label box is the **full tape width** with its contents centred, not just the printable strip —
the driver centres its own printable window on the tape, so the two agree.

### Length, and the tag underneath

Tape is continuous; the aluminium tag it is stuck to is not, so the **tag** is what caps a label's
length and decides how the name is set. Two are stocked:

| Tag | Usable length | Name | Why |
|---|---|---|---|
| **7 × ¾ in strip** | 171.8 mm | one line, 7.1 mm | shallow enough that two lines crowd it, long enough that one fits |
| **4 × 1½ in plate** | 95.6 mm | two lines, 5.4 mm | deep enough for two lines, and the shorter label is the cheaper one |

Three millimetres of bare metal is left at each end, which is where the usable lengths come from.

The name is **measured, not estimated**. It used to be sized from character count times an assumed
average advance, which over-reserved badly whenever a name wrapped: measured on
*Weinmannia trichosperma* the old estimate asked for 47.7 mm of name width against 26.0 mm of
actual ink. That over-reservation does not cost tape — the driver's Length decides how much tape a
label costs, see below — it costs **type size**, because the width the name is allowed is exactly
what caps how large it can be set. `tapeLabelPlan()` now measures the real font on a canvas and,
for a two-line name, tries every break at a space and keeps the split whose longest line is
shortest — a balanced wrap is both tidier and narrower than the greedy one a browser produces from
a narrow box.

**The page itself is the tag's usable length, not the name's.** `tapeLabelPlan()` returns
`labelLengthMm = round(usableMm)` — a constant **172 mm** for the strip and **96 mm** for the
plate. Sizing the page down to the text would save nothing, because the P-touch feeds and cuts to
its own **Length** setting whatever the page says, and it would mean retyping that setting for
every batch. A constant page means one Length per stock, and a page that always matches the driver.

The **six-character tag code is not printed on tape.** It is on the paper tags, where there is room
for it; on tape it cost a line of height for something only ever needed when the QR will not scan,
and the height is worth more to the name.

## Printing them so they last

Nothing here is enforced by the code, but the tags are only as good as what they are printed on:

- **Don't go below 30 mm** for a code printed on paper.
- **Matte, not glossy.** Glare beats contrast every time.
- **Laser, not inkjet** — inkjet fades in one Pacific Northwest winter. White polyester or vinyl
  label stock on an aluminium or thick plastic tag, over-laminated, is the cheap durable route.
- **Laminated TZe tape is the tidy route**, and it is already weatherproof — that is what it is for.
  Use **18 mm or 24 mm**; 12 mm cannot carry this code.
- **The plant's name is printed beside the code on purpose.** A label only a smartphone can read is
  not a plant label. On paper tags the six-character tag code is printed too, so a worn tag can
  still be typed in by hand; on tape the name gets that height instead.
- **The driver's Length is the whole game, and it decides the physical strip.** The PT-P710BT's
  Windows driver publishes exactly one form, `0.70"`, and that form carries its own **Length**
  box — defaulting to **3.00"**. It is not automatic. **The strip that comes out is exactly that
  Length, every time, whatever the label measures.** Set it to the length the print window reports:
  **6.8" for the strip, 3.8" for the plate**. Those are constants per stock — set it when you
  switch stock, not per run.

  A label *longer* than the Length is **clipped**, mid-word and silently. Measured 2026-09-03: a
  172 mm label against a 3.00" Length printed `Weinmannia trici` and stopped. This is not the older
  failure, where an over-long label was scaled down to fit — that one is more dangerous, because it
  shrinks the QR along with the type and the whole-dot module sizing above quietly stops holding.
  Either way the Length is the fix.

- **"Trim tape after data" does nothing when printing from a browser. Do not rely on it.** It reads
  like the answer — cut where the printing stops, so one generous Length would serve every label —
  and it does not work. Measured 2026-09-03 with Trim **on** and Length 7.00": a 172 mm label and a
  96 mm label printed strips of **identical length**. Chrome rasterizes the full page, white space
  included, so the "image edge" the driver looks for is the end of the page, and there is no bare
  tape left to trim.

  Two consequences. A shorter label **saves no tape at all**, which is why `tapeLabelPlan()` sizes
  the page to the tag rather than to the text — the strip costs the same either way, and a page
  that matches the driver is one that cannot clip. And the Trim checkbox **does not reliably
  persist**: on 2026-09-03 it was ticked, applied and OK'd in both Printing Preferences and
  Printing Defaults, and read back as `FeedToMediaSize` (off) from both print tickets afterwards.
  If you ever do need it, verify it rather than trusting the dialog.

- **The driver does not cap the Length — that theory is dead.** Its `PageMediaSizeMediaSizeHeight`
  parameter declares `MinValue` 4000 microns and `MaxValue` **1000000 microns (1000 mm / 39.37")**,
  so nothing about 172 mm troubles it. If a long label misbehaves the Length is set wrong; it is
  not a limit being hit.
- **The Brother driver's Feed margin is already at its floor — leave it.** That margin is the blank
  tape fed before the first printed dot. Its `MinValue` and its `DefaultValue` are both **2000
  microns (0.08")**, so there is nothing to win here. Do still check the print preview says
  **1 sheet of paper** per label — more than that means the driver's paper size is wrong, and it
  will feed a blank strip for every extra page.

## Dependency

`uqr` (MIT, ~27 KB, no dependencies), imported as an ES module from jsDelivr in `qr.js`, matching
how `browser-image-compression` is loaded elsewhere. It is the only new third-party dependency.
