# AI plant lookup

Researches a plant from its botanical name and offers the result for the Notes field.
Companion to the label scan — that reads what is *printed on a tag*, this searches the *web*.
The two sit together at the top of the same forms.

- Function: `apps/*/functions/lookup-plant.js` (byte-identical, in `check-drift.mjs`)
- Client: `apps/*/js/plant-lookup.js` (byte-identical; field IDs are passed in by the caller)
- Callers: `apps/garden/js/plants-view.js`, `apps/nursery/js/batch-form.js`
- Styles: `.plant-lookup*` in `shared/components.css`

---

## Two tracks

| Track | Covers | Also fills |
|---|---|---|
| `details` | description, cultivation | height, width, family, commonNames, careNotes |
| `origins` | etymology, history | nothing |

Separate on purpose: most plants only need the first, and the etymology and history are worth a
deliberate second request on a rarer specimen. Asking for both fires two concurrent calls.

Each track's prompt names **only its own categories**. Mentioning the others invites the model to
fill them from memory, which is exactly what the design exists to prevent.

## Two phases

`research` searches the web and returns short facts, each tagged with its category, its level
(cultivar / species / genus) and the source it came from. `write` is handed that list and turns it
into prose **with no search tool**.

Splitting them was forced by the Netlify timeout (below), but it earns its keep regardless: the
writer has no web access and sees nothing but the researcher's facts, so it has nothing to invent
from. "Add nothing" stops being an instruction we hope the model follows and becomes a property of
the arrangement. The writer is also forbidden from promoting a fact's level — that is what stops a
species range being retold as a fact about the cultivar.

If the researcher verifies nothing, **the write call is skipped entirely**. Asking for prose with an
empty fact list is precisely how a plausible essay gets invented.

## The anti-fabrication rules

Eight numbered rules in `PROMPT_RESEARCH_HEAD`. Read them before editing. The load-bearing ones:

- **Rule 3** lists the fabrication-prone specifics individually — person, nursery, place, year,
  patent, award — because an invented one reads exactly like a real one.
- **Rule 4** forbids guessing etymology from the shape of a word. A genus ending in *-ia* is not
  necessarily named after somebody.
- **Rule 5** keeps cultivar, species and genus claims apart. A named cultivar is often chosen for
  being more compact than the species, so an unsourced species height is actively misleading.
- **Rule 6** stops it silently answering about a different plant when the name is misspelt.
- **Rule 7** requires recording the range *and* noting the disagreement. An earlier version offered
  caveats as an alternative, and the model took the exit — leaving height blank while caveats read
  "given variously as 5-7 m, up to 8 m". A reader told only that sources disagree has nothing.

Worked examples land better than rules with this model. The size guidance carries one showing the
right answer, the right caveat, and the two wrong answers (blank, and an average).

## Server-side guards

The prompt is not trusted on its own. Three things are enforced in code:

- `shortField()` discards anything long, multi-sentence, or carrying deliberation markers from the
  single-line fields, and **reports what it discarded and why**. Flash-Lite once returned a `width`
  containing several sentences of the model arguing with itself. Limits are per field —
  `commonNames` legitimately runs longer than a size.
- Facts outside the track's categories are dropped and counted.
- Grounding citations arrive as `vertexaisearch` redirect URLs that expire. They are reduced to
  their title in the note. Matched loosely — Google shards those hosts with a number, and one came
  through on `cloud5.google.com` after the first version pinned `cloud.google.com`.

**Match loosely, generally.** Three separate bugs in this feature came from exact string matching:
fact categories (`"Description"` vs `"description"`, which lost every fact and produced an empty
note), the `scope` value, and that redirect host.

## The timeout, and the model choice

Netlify kills a synchronous function at **10 seconds** by default, and the kill arrives as an empty
504 that looks identical to a crash. A single grounded call writing several paragraphs never came
close. Splitting into phases was not enough — searching alone overran. The stopgap was
`GEMINI_MODEL_RESEARCH=gemini-3.5-flash-lite`, which brought research to about 4 seconds.

`LOOKUP_BUDGET_MS` is our own deadline, set just inside the platform's, so a timeout returns a
diagnostic naming the elapsed time instead of a blank 504. **The code default stays at 8500** — that
is the value that is safe on a site whose timeout has not been raised, and a too-generous default
fails as a blank 504 with no clue in it. Sites with more headroom set the variable explicitly.

### Timeout increase — granted 2026-08-12

Netlify raised the account's function timeout to **30 seconds** on request via their support forum.
Their reply notes that **existing sites must be redeployed** before the new limit applies, which an
environment-variable change forces anyway.

Settings on both sites from that date:

1. `LOOKUP_BUDGET_MS=27000` — just inside the platform's 30s, leaving room for cold start and our
   own overhead. This removed the intermittent failures that previously needed a re-run.
2. `GEMINI_MODEL_RESEARCH` **deleted**, putting research back on full Flash. Flash-Lite was a
   latency compromise, not a preference: it is the model that rambled into a form field and
   mislabelled fact categories, both of which needed defending against in code. Those defences stay
   — they are cheap, and they guard against any model having a bad day.

Each phase is a separate function invocation, so the 30 seconds applies to research and to write
independently, not to the pair.

Worth revisiting now there is headroom, in this order and only once full Flash is confirmed working:

- `GEMINI_THINKING_BUDGET` currently defaults to 0. Thinking was disabled to save latency, and its
  absence is what made Flash-Lite deliberate inside a form field. With room to spare, letting the
  model think properly should improve fact quality. The request ladder drops `thinkingConfig`
  automatically if a model rejects the value, so a bad setting degrades rather than breaks.
- The per-track fact cap (`t.categories.length * 6`) and the terse-prose instructions were both
  tuned for a budget that no longer applies.

## Env vars (per site — Netlify env is not shared between them)

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Required. Shared with the label scan. |
| `LOOKUP_BUDGET_MS` | `27000` on both sites since the 30s timeout increase. Code default is 8500, which is what is safe without the increase. |
| `GEMINI_MODEL_RESEARCH` | **Deleted** since the increase — research runs on full Flash. Set it to `gemini-3.5-flash-lite` only if the timeout is ever lost. |
| `GEMINI_MODEL_WRITE`, `GEMINI_THINKING_BUDGET` | Optional overrides; both default sensibly. |

## Design decisions worth not re-opening

- **Notes stays plain text.** Rich text would mean migrating every record and adding an editor to
  both apps. See `backlog.md` item 4 for the cheap alternative (linkify at render time).
- **Nothing touches the form until the button is pressed.** Unlike the label scan's `applyFields()`,
  which fills silently — fine for a genus, wrong for four paragraphs of researched prose.
- **Notes are appended, never replaced.** Enriching a plant that already has notes is the common
  case. Height, width and care notes fill only when empty.
- **Offered on edit as well as add**, unlike the scan card.
- **Nursery hides the card when a batch is linked to an existing plant** — the botanical inputs are
  empty then, so the buttons could only say "fill in the genus first".

## Known limitations

- Grounded search is nondeterministic: the same plant can return different sources run to run, and a
  slow tail still occasionally overruns the budget. Re-running usually works.
- Fact quality now depends on full Flash, restored once the 30s timeout landed. If lookups are ever
  moved back to Flash-Lite, expect weaker categorisation and watch the discard warnings.
- `scope` is derived from the request rather than the model, which kept returning nothing for it.
