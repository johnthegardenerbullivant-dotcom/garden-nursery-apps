# Making a copy for someone else

Written 2026-08-19, after a couple of friends asked for their own Garden/Nursery apps.
**Substantially revised 2026-08-20**, once the Firebase config moved out of git into environment
variables. That change removed most of the fiddly parts of this guide: there is no longer a single
file in the repo that a copy owner has to edit, which is what makes one-click updates possible.
Anything below describing hand-edited credentials or a template repo is gone for that reason.

This is two documents in one. **Part A** is John's decisions and one-off work. **Part B** is the
step-by-step a friend follows. Part B is the bit you send them.

The short version: it is genuinely doable — an afternoon for them, an evening for you the first
time — but it is **not** "here's a zip, drag it into Netlify" any more. That was the retired Friend
Setup Package, and it worked because the app had no accounts, no roles, no serverless functions and
no AI. All four of those now exist, and each one adds a setup step.

---

## What they actually get

A completely separate copy: their own database, their own photos, their own users, their own web
address. **Nothing is shared with your garden** — not data, not logins, not billing. They cannot see
your plants and you cannot see theirs.

- Garden Management, Nursery Management, or both. Either runs standalone.
- **If they take both, both must point at one Firebase project.** The two apps write into each
  other's collections in **both** directions, and neither goes over the network to do it — they are
  plain Firestore writes inside the shared project:
  - Planting out a Nursery batch writes into Garden's `plants` and `instances`
    (`plantOutToGarden()` in `apps/nursery/js/db.js`).
  - Transferring a garden plant to the nursery writes a `nursery_batches` document
    (`transferToNursery()` in `apps/garden/js/db.js`).

  Split the two apps across two Firebase projects and both paths fail **silently** — no error, the
  record simply lands in a database the other app never reads. This is the single most important
  thing to get right at setup, and the hardest to notice later.
- Installable on a phone, works offline, three roles (viewer / editor / admin), label scanning and
  AI plant lookup — all of it, as long as they set up the Gemini key.
- An **empty** database. No plants, no areas, no nursery locations. There is a bulk import in the
  Admin panel that reads a prepared `plant-import.json`, so a spreadsheet of plants can be loaded in
  one go if they have one.

### What it costs them

| Thing | Cost | Notes |
|---|---|---|
| Firebase, Blaze plan | **Card required**, ~£0/month in practice | Since 3 Feb 2026 a new project must be on Blaze to provision a Storage bucket at all. Free allowances still apply on Blaze — 5 GB storage, 100 GB/month transfer. A household garden will not approach that. |
| Netlify | Free | Two sites, 100 GB bandwidth, 125k function calls/month. |
| Gemini API key | Free tier, or pennies | Only needed for label scan and plant lookup. The apps work without it — those two features just fail. |
| Domain name | £0 or ~£12/year | A free `something.netlify.app` address is fine. A custom domain is optional. |

Worth saying out loud to them: **a card is required before photos will work at all.** That is the
one thing most likely to make someone back out, so lead with it rather than letting them discover it
at step five.

---

# Part A — What John does

## A1. Decide how they get the code (do this first)

**Decided 2026-08-20.** An earlier draft of this document recommended a *template* repo. That was
superseded once the config moved out of git — see [`distribution-plan.md`](distribution-plan.md).

| Option | Verdict |
|---|---|
| Add them as a collaborator on `garden-apps` | **No.** They'd get push access to your repo, and your commits would deploy to their sites. Wrong shape entirely. |
| Send a zip | **No.** They can never receive a fix, and you can never tell what version they're on. |
| A public **template** repo | **No.** A template produces a copy with no upstream link, so updates mean `git fetch upstream` from a terminal — exactly what a non-technical friend cannot do. |
| **A public release repo they fork** | **Yes.** GitHub's one-click **Sync fork** button, forever. |

The mechanism: keep `garden-apps` private for day-to-day work, and add a **second remote** — a
public `garden-apps` repo — that you push to deliberately when you want to cut a release:

```bash
git remote add public https://github.com/YOURNAME/garden-apps.git
```

```bash
git push public main
```

Nothing is visible to anyone until you run that push, so you can make several changes, live with
them on your own sites for a week, and publish when you're satisfied. What you control is **when**
it becomes visible, not the granularity — the push publishes your individual commits with their real
dates, not one squashed blob. That is usually what you want anyway: the commit messages are the
release notes.

Friends then press **Fork** on the public repo. Their fork tracks yours, so GitHub shows them "this
branch is 3 commits behind" with a **Sync fork** button next to it.

### Why the fork can be public, and why that's fine

Forks of a public repo are themselves public — you cannot make one private. That would have been a
problem under the old design, where a copy owner had to paste their Firebase credentials into a
tracked file. It isn't one now: **their repo contains no configuration at all.** Everything
installation-specific lives in Netlify environment variables. A fork is a plain copy of the code,
identical to yours, with nothing personal in it.

That property is also what makes Sync fork work. A fork that never edits a tracked file never
diverges, so every sync is a fast-forward and no conflict is possible.

## A2. Prepare the repo for publication (one evening)

This is now done **in `garden-apps` itself**, not in a copy — the public repo is the same repo,
pushed to a second remote. There is no separate template to keep in sync.

**Steps 2–4 of an earlier draft are gone.** They said to blank the credentials in both
`firebase-config.js` files, blank the project ID in `.firebaserc`, and deal with two hard-coded
links to your garden. None of that exists any more: those three files are generated at build time
from environment variables and are gitignored, so **there is nothing to sanitise in the code**. That
is the whole point of the config work — see [`distribution-plan.md`](distribution-plan.md).

What's left is documentation hygiene:

1. **Strip the internal docs.** `docs/restructure-plan.md`, `docs/ui-consistency-review.md`,
   `docs/ux-review.md`, `docs/claude-code-handoff.md` and this file are your working notes and mean
   nothing to anyone else. Keep `data-model.md`, `plant-lookup.md`, `nursery-design.md` and
   `label-scan-spec.md` — those are genuinely useful to a copy owner and to their Claude.
   (`docs/backlog.md` is already gone — it moved to `Garden Data\` on 2026-08-20, precisely so this
   step has one less judgement call in it.)
2. **Edit `CLAUDE.md` and `README.md`.** Remove `C:\Users\johnb\...` paths, your live URLs, the
   `bbg-garden-inventory` project ID and the "Owner: John Bullivant" line. Keep the architecture,
   the role system, the standing rules and the deploy instructions — that content is exactly what
   makes their copy maintainable, and it is what their Claude will read.
3. **Add a `LICENSE` and a short "no warranty, no support promise" line in the README.** MIT is the
   usual choice. This matters more than it sounds: it is the difference between a gift and an
   open-ended obligation.
4. **Add Part B of this file** as `SETUP.md` at the repo root, so the instructions travel with the
   code instead of living in an email.
5. **Fix anything still open in the backlog that a copy would inherit** — `Garden Data\backlog.md`.
   A weakness in your rules becomes a weakness in every copy, belonging to someone who has no idea
   it is there. (Item 1, guests writing to Storage, was fixed on 2026-08-20 for exactly this
   reason.)
6. Create the **public repo** on GitHub, add it as a second remote, and `git push public main`.
   Do **not** tick *Template repository* — friends should fork, so they get the Sync fork button.

Before pushing, run the repo's own checks:

```bash
node --check apps/garden/js/*.js apps/nursery/js/*.js apps/*/functions/*.js tools/*.mjs
```

```bash
node tools/check-drift.mjs
```

## A3. Decide your support boundary now, not later

Say it in the README and say it to them: you'll help get it running, you're not on call. The two
places they will realistically get stuck are the **first-admin bootstrap** (B7) and **Google
sign-in failing on a domain that isn't authorised** (B4 step 7). Both are one-liners once you know
them. Point people at those sections rather than remote-controlling their console.

## A4. How an update reaches them

Once you `git push public main`:

1. GitHub shows their fork as "N commits behind".
2. They click **Sync fork → Update branch**.
3. Netlify rebuilds both their sites automatically.

No command line, no conflicts — because they have never edited a tracked file, every sync is a
fast-forward. That is the property the whole config-from-env change exists to protect. **If you ever
commit something a copy owner must edit, you break it**, and every future update for every copy
becomes a merge conflict.

**Two things a sync cannot carry**, and both fail quietly:

- **Security rules.** `firestore.rules` and `storage.rules` deploy by CLI, never by Netlify. A rules
  change reaches their *files* and not their *database*, and a mismatch shows up as empty lists
  rather than errors.
- **New environment variables.** A feature that adds one is broken on their site until they add it
  and redeploy.

So every release that touches either needs an **Action required** line in `CHANGELOG.md` — `none`,
`redeploy rules`, `add env var X`, or `data migration`. Without it, "just click Sync fork" is advice
that quietly breaks people's apps.

## A5. Things not to do

- **Do not give them your Firebase project details.** Sharing `bbg-garden-inventory` would put their
  plants in your database and hand them your data. Every copy needs its own project.
- **Do not let them connect a Netlify site to your repo.** Their site would then rebuild from your
  commits, which is the tail wagging the dog.
- **Do not paste your `firestore.rules` into their Console for them.** It is the same file, so it
  would work — but you become the person who deploys their security. Walk them through B6 instead.

---

# Part B — What the friend does

*(This is the part to send them. It assumes no prior experience with any of these tools.)*

Setting up takes about **an hour and a half**, most of it waiting for things to finish. You need a
Google account and a debit or credit card. You will not be charged in normal use, but Google
requires a card on file before it will store photos.

Do the steps in order. **Step 7 is the one everyone gets stuck on** — read it twice.

## B1. Create your Firebase project (the database)

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project**. Name it something like `my-garden`. Turn Google Analytics **off**.
3. When it finishes, click **Continue**.
4. In the left menu click **Build → Firestore Database → Create database**.
   - Choose **Production mode** (not test mode — the app brings its own security rules).
   - Pick a location near you (`europe-west2` for the UK, `us-west1` for the US west coast). **You
     cannot change this later.**
5. In the left menu click **Build → Storage → Get started**.
   - This is where Firebase asks you to upgrade to the **Blaze** plan and add a card. You have to.
     Storage is where plant photos live, and since February 2026 a new project cannot create a photo
     bucket without it. The free allowance on Blaze (5 GB) still applies, and a home garden will not
     get close to it.
   - Set a budget alert at £1 while you're there — Firebase offers this during the upgrade.
6. In the left menu click **Build → Authentication → Get started**, then enable these three
   sign-in methods:
   - **Google**
   - **Email/Password**
   - **Anonymous**

## B2. Copy your Firebase keys

1. Click the ⚙️ gear next to **Project Overview** → **Project settings**.
2. Scroll to **Your apps**. Click the web icon **`</>`**.
3. Nickname it anything. **Do not** tick Firebase Hosting. Click **Register app**.
4. You'll see a block of code containing `apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId` and `appId`. **Leave this browser tab open** — you need these values in B3.

## B3. Get your own copy of the code

1. Create a free account at **https://github.com** if you don't have one.
2. Open the repo link John sends you and click **Fork** (top right) → **Create fork**.
3. You now have your own copy, and it stays linked to John's. When he releases an update, GitHub
   shows "this branch is N commits behind" with a **Sync fork** button — one click, and your sites
   rebuild. That link is why you fork rather than download.

**There is nothing to edit in the code.** Not one file. Your Firebase details go into Netlify as
settings in the next step, and the app reads them from there when it builds. Keep the Firebase tab
from B2 open — you'll paste those six values in B4.

> **When you do paste them, never copy a value off a screen that shows it as dots.** Some sites and
> apps mask keys when displaying them, and copying the mask gives you 30-odd `•` characters that
> look plausible and are not the key. Copy from the Firebase console's own config block, where the
> value is shown in full. (This is not hypothetical — it cost John an afternoon. The build now
> refuses a masked value rather than shipping it, so if you see a build fail complaining about a
> "non-ASCII character", this is what happened.)

## B4. Put it on the internet (Netlify)

You'll create **two** websites from the one repository — one for Garden, one for Nursery. (Taking
only Garden is fine; skip the Nursery half of every step below.)

1. Sign up at **https://app.netlify.com** — choose **Sign up with GitHub**.
2. Click **Add new site → Import an existing project → GitHub**, authorise Netlify when asked, and
   pick your `garden-apps` repository.
3. On the configuration screen, set:
   - **Base directory:** `apps/garden`
   - **Publish directory:** `apps/garden`
   - Leave the build command alone — it comes from the repo.
4. Before clicking Deploy, open **Add environment variables**. This is where your Firebase details
   go — the app is built from them, so **without these the site loads a green "Setup required"
   screen**. From the Firebase tab you left open in B2:

   | Key | Value (from the Firebase config block) |
   |---|---|
   | `FIREBASE_API_KEY` | `apiKey` |
   | `FIREBASE_AUTH_DOMAIN` | `authDomain` |
   | `FIREBASE_PROJECT_ID` | `projectId` |
   | `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
   | `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
   | `FIREBASE_APP_ID` | `appId` |

   Netlify's **Import from a .env file** option lets you paste all six at once as `KEY=value` lines,
   which is much faster than six separate boxes.

   Two things worth knowing:
   - **These are per site.** Netlify does not share them between sites, so you will add the *same
     six values* again on the Nursery site in step 6. That is correct — both apps deliberately use
     one Firebase project.
   - **Leave the scope at "All scopes"** so preview builds get them too.

   You do *not* need any secret-scanning settings; those live in the repo already.
5. Click **Deploy**. Wait a minute. You'll get an address like
   `https://cheerful-marzipan-1a2b3c.netlify.app`. Rename it to something memorable under **Site
   configuration → Change site name** if you like.
6. **Repeat steps 2–5 for Nursery**, with base and publish directory `apps/nursery`, the **same six
   `FIREBASE_*` values**, and one extra:

   | Key | Value |
   |---|---|
   | `GARDEN_URL` | your Garden site's address, e.g. `https://garden-yourname.netlify.app` |

   Nursery uses it for two links back to Garden — a button in the Admin panel and "View in garden"
   on a batch you've planted out. Leave it unset and those links simply don't appear, which is what
   you want if you're only running Nursery. You can add it later once you know the Garden address;
   remember to redeploy afterwards.
7. Go back to Firebase: **Authentication → Settings → Authorized domains → Add domain**, and add
   **both** Netlify addresses (just the `something.netlify.app` part, no `https://`). **Google
   sign-in fails with a popup that opens and instantly closes until you do this.**

## B5. Turn on the AI features (optional, 5 minutes)

Skip this and everything still works except **Scan label** and **Look up plant**, which will error.

1. Go to **https://aistudio.google.com/apikey**, sign in, click **Create API key**.
2. In Netlify, for **each of your two sites**: **Site configuration → Environment variables → Add**:

   | Key | Value |
   |---|---|
   | `GEMINI_API_KEY` | the key you just created |

   Environment variables are **per site** — you have to add it twice, once to each.
3. Trigger a redeploy of each site (**Deploys → Trigger deploy → Deploy site**). Environment
   variables only take effect on the next build.

One caveat about plant lookup: Netlify allows these background requests **10 seconds** by default,
and a thorough plant lookup can want longer. Leave the settings alone at first — the code defaults
are tuned to fit inside 10 seconds. If lookups time out often, either ask Netlify support to raise
your function timeout (they are usually quick about it — John was granted 30 seconds the same day he
asked) or add `GEMINI_MODEL_RESEARCH` = `gemini-3.5-flash-lite`, which is faster and slightly less
thorough.

## B6. Deploy the security rules

Right now your database is in production mode, which means **everything is blocked**, including you.
The repo contains the rules that open it up correctly. Two ways to install them — pick one.

**The easy way (copy and paste):**

1. In your GitHub repo, open `firebase/firestore.rules`. Click the **Raw** button, select all the
   text, copy it.
2. In Firebase Console: **Firestore Database → Rules** tab. Delete what's there, paste, click
   **Publish**.
3. Do the same with `firebase/storage.rules` into **Storage → Rules**.

**The proper way (command line)** — better if you'll ever change the rules, because it keeps the
repo as the single source of truth. Needs Node.js installed:

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

then, from inside the `firebase` folder of your copy, tell the CLI which project it is working on:

```bash
firebase use --add
```

That lists your Firebase projects, lets you pick one, and writes the `.firebaserc` file it needs.
**Don't skip it** — without it the next command stops with *"No currently active project"*. (The
file is deliberately not in the repo, because it names one specific Firebase project and yours is
not John's.)

Then deploy:

```bash
firebase deploy --only firestore:rules,storage
```

Add `--dry-run` first if you want to check the files compile without publishing anything.

## B7. Make yourself the administrator ← the step everyone gets stuck on

There is deliberately no way to sign yourself up as an admin from inside the app — otherwise anyone
who found the URL could. So the first admin is created by hand, once.

1. Open your Garden site and click **Sign in with Google**.
2. You will land on an **access denied / pending** screen. **This is correct.** Signing in created
   your account record; it has no permissions yet.
3. Go to Firebase Console → **Firestore Database → Data**. You'll see a `users` collection
   containing one document, its name a long string of letters and numbers (that's your user ID).
4. Click that document, then **+ Add field**:
   - Field name: `role`
   - Type: **string**
   - Value: `admin`
   - Click **Save**. Spelling and lower case both matter.
5. Go back to the app and **reload the page**. You now have full access.
6. You do **not** need to repeat this on the Nursery site — both apps read the same `users`
   collection, so one admin record covers both.

## B8. Add the rest of the household

1. They open the site and sign in with Google once. They'll get the same pending screen.
2. You go to the app's **Admin** panel → **User Management**, find them in the pending list, and
   grant **viewer** (look only), **editor** (add and change plants) or **admin** (everything,
   including delete and backups). A role granted in one app applies to both.
3. For someone without a Google account, create an email/password login in Firebase Console →
   **Authentication → Users → Add user**. There is no sign-up form in the app, on purpose. They then
   sign in with the **Email** form and you grant them a role as above.

## B9. The last bits

- **Nothing in the code needs editing** — if you set `GARDEN_URL` in B4 step 6, Nursery's two links
  to Garden already point at your own site. If you skipped it, they aren't shown at all. Add the
  variable and redeploy whenever you want them.
- **Set up your garden first.** Create your **Areas** in Garden and your **Locations** in Nursery
  before adding plants — most forms ask you to pick one. If you have a spreadsheet of plants, the
  Admin panel's **Import from Spreadsheet** section loads them in bulk from a prepared `.json` file;
  ask Claude to convert your spreadsheet into that format.
- **Install it on your phone.** Open the site in Safari (iPhone) or Chrome (Android) and choose
  **Add to Home Screen**. It then behaves like a real app and works without signal.
- **Take a backup occasionally.** Admin panel → **Download backup** gives you a single `.json` file.
  Keep it somewhere that isn't your phone.

## If something doesn't work

| Symptom | Almost certainly |
|---|---|
| Everything loads but every list is empty | Security rules not deployed (B6). Rules failures are silent — they look like no data, not like an error. |
| Google sign-in popup flashes and closes | Your Netlify address isn't in Firebase Authorized domains (B4 step 7). |
| "Access denied" after signing in | Normal until B7 is done. |
| Green "Setup required" screen | The six `FIREBASE_*` variables aren't set on that site, or were added but the site hasn't rebuilt since (B4 step 4). |
| Build fails: "contains a non-ASCII character" | A value was pasted from a masked display and is full of `•` characters. Re-copy it from the Firebase console config block. The build is stopping this from reaching your live site. |
| Build fails: "does not look like a Google API key" | `FIREBASE_API_KEY` is truncated or is some other value. It should be 39 characters starting `AIza`. |
| `firebase deploy` says "No currently active project" | `firebase use --add` hasn't been run in that folder (B6). |
| Nursery has no links to Garden | `GARDEN_URL` isn't set on the Nursery site, or it hasn't rebuilt since (B4 step 6). Working as designed if you only run Nursery. |
| Page loads with no styling at all | The build didn't run. Check the site's base directory is `apps/garden` or `apps/nursery`, not the repo root. |
| Scan label / Look up plant error out | `GEMINI_API_KEY` missing on that site, or added but not redeployed since (B5). |
| Photos won't upload | The Storage bucket was never created — the Blaze upgrade in B1 step 5 didn't complete. |
