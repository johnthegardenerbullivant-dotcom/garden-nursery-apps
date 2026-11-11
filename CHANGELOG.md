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

## 2026-11-10 — quicker to start

**Action required: none**

- **Both apps start with less to download.** Screens opened less often are fetched the first time
  they are needed. Garden's launch went from 19 of its own files (568 KB) to 15 (375 KB), and no
  longer loads the blog editor; Nursery's from 27 files (410 KB) to 24 (338 KB). A few seconds after
  launch the rest are fetched in the background, so every screen still opens with no signal later.
- **Fixed: a task repeating monthly on the 31st skipped February** (31 January was followed by
  31 March). Months shorter than the chosen day now use their last day.
- **Fixed: repeat dates could land on the wrong day east of UTC+12**, such as New Zealand in summer.
- **`CLAUDE.md` is no longer served by either site.** It is a note for whoever works on the code.
- **For maintainers:** a `tests/` folder, run with `node --test "tests/*.test.mjs"`, and no npm.
  Garden's pure helpers moved from `db.js` to a new `garden-logic.js` so Node can load them;
  `db.js` re-exports them, so nothing that imports them changed.

## 2026-11-10 — Tasks screen

**Action required: none**

- **Tasks opens with the tasks showing.** The Overdue section is open, and when there are 15 tasks or
  fewer every section is. It used to open with every section shut. Once you open or close a section
  yourself, the screen remembers that for the rest of the visit, separately for By Area and By
  Status.
- **A section you leave open stays open** after you change a task's status in By Status. Before, the
  whole list closed up again.
- **A round tick at the start of each task marks it done in one tap**, without opening the row, on
  Tasks, on Overview and on each area's task list. Tap
  it again to put the task back to To-Do. It does exactly what the Completed and To-Do buttons do,
  so a task in several areas still asks which areas, and a recurring task still schedules its next
  date.
- **The "10 active tasks across all areas" banner is gone**; the same number is on the Tasks tab.
  The four filter chips now sit on one row.
- **Add Task: a find box over the area list**, which is also taller. Type part of a name to narrow
  the 35 areas; areas already ticked stay in view. Long plant lists in the same form get one too.

## 2026-11-10 — easier to tap

**Action required: none**

- **The controls used most are now big enough for a finger.** In Garden: the To-Do / In Progress /
  Completed pills on a task (they were 26 px high, with Delete just beneath), Edit and Delete on a
  task, the irrigation Log, Done and Skip buttons, the filter chips, By Area / By Status, and the
  area chips on Overview. In Nursery: the stage pills, the All / Active / Completed tabs, the sort
  button and the Planted out / Given away / Lost choice. In both: Back, the role picker in Admin,
  and every small button. Each is at least 44 px high.
- **Small ✕ buttons and status pills look the same but respond over a wider area**: the search
  clear, photo delete, wishlist delete, and the Idea / Planned / Done pill on a plan.
- **Text you type into is 16 px everywhere.** It is easier to read, and on an iPhone it stops the
  page zooming in each time a field is tapped.
- **On a phone or tablet, date fields open the system's own date picker.** A laptop keeps the typed
  field with its calendar button.
- **Garden shows dates one way.** Plant cards, plant details and the plant rows in an area now read
  *4 May 22*, as task rows already did, instead of *2022-05-04*.
- **The labels under the bottom tabs are slightly larger.**

## 2026-11-10 — Plants list

**Action required: none**

- **The Plants list in Garden opens with the first 60 plants and adds more as you scroll**, instead
  of drawing every plant at once. Searching is quicker for the same reason.
- **An A–Z strip down the right-hand edge jumps to a letter.** Tap a letter, or slide a finger down
  the strip. It appears when the list is long enough to need it.
- **Three filters under the search box:** *Not placed*, *No photo*, and a picker that shows one
  area. They combine with each other and with the search, and the count reads *25 of 1068 plants*
  while any of them is narrowing the list.
- **Coming back from a plant returns to the same place**, with the same search and filters. Tapping
  the Plants tab starts afresh.
- **The genus badge on a plant card is easier to hit.** It looks the same; the area that responds to
  a finger is larger.

## 2026-11-10

**Action required: none**

- **Saves that change several records now happen completely or not at all.** Recording a plant
  death, transferring a plant to the nursery and planting a batch out each used to make two or
  three separate changes, and a connection dropped between them left half behind: a death recorded
  with the plant still shown in its area, or a planting-out the garden never received. Each is now
  a single step.
- **Deleting a plant, area, task, irrigation zone or batch removes it and everything under it
  together**, and is quicker. Before, a delete that stopped partway left the parent with some of
  its records gone.
- **Screens stop downloading the same lists over and over.** Each list (plants, areas, tasks,
  batches and so on) is kept in memory after its first download, so tapping a filter or the
  By Area / By Status switch on Tasks redraws at once instead of fetching five lists again.
- **A change made somewhere else can take up to two minutes to appear**, where before it appeared on
  the next tap. "Somewhere else" means the other app or another person's device. Changes made in
  the app you are using still show at once, and returning to the app from another tab or app
  fetches fresh data.
- **The Admin panel's record counts and the "has nursery batches" check** ask the server for the
  number alone instead of downloading every record.
- **Deleting a plant no longer waits for its photo files to be removed.** The records go first; the
  files follow in the background. If the device is offline at that moment the files stay behind in
  Storage, unused.

## 2026-11-09 — works offline

**Action required: none.** Each device builds its offline copy the first time it opens the app
with a connection after this update.

- **Both apps now work with poor or no signal.** What a device has already loaded is kept on it, so
  lists and records open without a connection. Changes made without signal are saved on the device
  and sent when it is back in range, even if the app was closed in between. A pill under the
  header says when you are offline and how many changes are waiting.
- **What offline does not cover:** anything that device has never loaded shows as empty rather than
  as an error; photos cannot be uploaded; label scanning and plant lookup need a connection; and a
  device that has never opened the app online cannot open it offline.
- **Fixed: "Access Pending" shown when there was simply no signal.** The app now says it can't
  connect and offers *Try again*.
- **Fixed: a task note that failed to save said nothing.** It now reports the failure, as does any
  other error that nothing else caught.

## 2026-11-09

**Action required: none**

- **The phone's Back button now goes back one screen** in both apps, instead of leaving the app.
  The same goes for the browser's Back and Forward buttons on a laptop. With a form open, Back
  closes the form. On a top-level screen, Back leaves as before.
- **A half-filled form asks before it is thrown away.** Tapping the dimmed area above a form, the ✕,
  or Back used to discard whatever had been typed. Each now asks first if anything was entered.
  *Cancel* and *Save* behave as before.
- **Save and Cancel stay at the bottom of the screen** on every form, so a long form no longer has
  to be scrolled to its end to save.
- **A tap visibly registers.** The screen dims and a bar runs under the header while the next
  screen loads. A screen that fails to load now says so and offers *Retry*.
- **Garden opens on Tasks**, as intended since April; it had been opening on Overview. The count on
  the Tasks tab is right from launch.
- **Fixed:** two quick taps on different tabs could leave the wrong screen showing; AI lookup notes
  written in the evening were stamped with the next day's date; and two places showed text without
  escaping it.

## 2026-09-14

**Action required: none**

- **Fixed: Area print view shows plant and area text safely.** *Print → Summary* and *Detailed* on an
  area put names, notes, heights and the area description into the printed page as raw HTML, so a
  `<` in a note could break the layout or add markup. Every value is now escaped, as the rest of the
  app already does. Printouts look the same.

- **Web addresses are now clickable in both apps.** A link starting `http://` or `https://` opens in
  a new tab, and long addresses wrap instead of running off the screen.
  - **Garden:** task descriptions and completion notes, a plant's notes and care reminders, the notes
    on a planting, an area's description on its detail page, and Compost Bin notes. The Areas list,
    Walk-round rows and printed views still show plain text.
  - **Nursery:** a batch's initial notes, *About this plant* and care notes, log entry observations,
    outcome notes, pre-sowing treatment step notes, plan notes, and the descriptions of nursery
    locations and wishlist items in Admin.

## 2026-09-13

**Action required: none** — but if a change you merged never reached your live site, trigger a
deploy of `main` for that site in Netlify once.

- **Seed counts and germination.** A seed batch no longer needs a starting quantity. *Seeds sown*
  is optional — fill it in if you counted them, leave it blank for fine seed that's scattered — and
  the batch shows *Sown · not counted* until **Record germination** counts the seedlings. That moves
  it on to a stage that reads **Germinated** for seed, and shows a germination rate when seeds were
  counted, e.g. *12 of 40 seeds (30%)*. Record it again as more come up; losses and thinning still
  go in log entries. Entering 0 closes a sowing where nothing came up.

- **Sow now asks how many seeds were sown** on a pre-sowing batch. A pre-sowing batch created before
  this release, with its seed count typed into *Starting quantity*, carries that number over.

- Seed batches that already have a count are unchanged.

- **Fixed: production builds canceled after a deploy preview.** Each site's `ignore` command
  compared the commit being built with the last commit that site built in any context, deploy
  previews included. A pull request's preview already contains its changes, so the merge commit
  looked unchanged and Netlify canceled the production build ("Canceled build due to no content
  change"). The command now also compares the commit with its first parent, and a build is skipped
  only when both comparisons are empty.

- **Fixed: a nursery batch linked to a Garden plant now keeps that plant's details.** Picking a
  Garden plant in the batch form copied its name but not its description, care notes, height or
  spread, because it read them under the wrong field names. Linking now copies all of them, and the
  name fields stay visible so you can see what the batch holds.

- **Fixed: Unlink no longer wipes the plant name.** It removes only the link; the batch keeps its
  name and details.

- **Fixed: links to deleted Garden plants.** A batch whose Garden plant has been deleted shows
  "Garden record removed" instead of a broken *View in garden* link, and editing it offers to drop
  the link. Planting such a batch out used to create a Garden planting that pointed at the deleted
  plant and never appeared in Garden; it now creates a new Garden plant from the batch's own details
  and links the batch to it.

- **Planting out finds the plant already in Garden.** When a batch isn't linked to a Garden plant,
  or its plant has been deleted, the plant-out form looks for Garden plants with the same botanical
  name and offers to add to one of them rather than create a second record of it. *Create a new
  Garden plant* is still there. A linked batch says which Garden plant it will add to.

- **Deleting a Garden plant says how many nursery batches link to it.** They keep the name and
  details stored on the batch; only the link stops working.

## 2026-09-12

**Action required: none.** No new collection, no rules change, no environment variable.

- **Pre-sowing treatment for seed batches.** A seed batch can now record the steps its seed needs
  before it is sown — cleaning, scarifying, soaking, smoke water, GA3, warm or cold moist
  stratification, dry after-ripening — in order, each with a minimum and an optional maximum number
  of days. Such a batch starts at a new first stage, **Pre-sowing**, and its page shows where the
  treatment stands: day N of the current step, when the next check is due, and the sow-from and
  sow-by dates.

- **Plan first, mark steps as you do them.** Saving the batch saves the plan; nothing starts by
  itself. On the batch page each step has its own button — *Mark done* for a one-off like cleaning,
  *Start* for a timed step like the day the packet goes in the fridge — with a date that defaults to
  today, so steps done on different days keep their real dates. A marked step's date can be
  corrected, and the latest one undone.

- **Checks and sowing.** While a timed step is running, *Checked — all fine* logs a check and
  restarts the check clock (every 14 days by default; any log entry counts as a check too). A plan
  not yet started never asks for attention. *Sow now* records the sowing date and moves the batch to
  Propagating — early if the seed has started germinating in the bag. *Don't sow before* holds a
  finished treatment until a chosen date, so 90 days in the fridge from September waits for January.

- **Reminders are worked out, not stored.** The dashboard's *Needs a check-in* list now uses a
  pre-sowing batch's own dates — a check falling due, a step or sowing falling due, a maximum passed
  — instead of the ten-days-without-an-update rule other batches use. Because nothing is written
  down in advance, extending a step or sowing early cannot leave a stale reminder behind.

- **Stats count a treated batch in the month it was sown**, not the month its treatment began.

- Existing batches are untouched, and the Pre-sowing stage only appears in pipelines and filters
  when a batch is actually in it.

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
