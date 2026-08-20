# Making a copy for someone else

Written 2026-08-19, after a couple of friends asked for their own Garden/Nursery apps.

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
- **If they take both, both must point at one Firebase project.** Planting out a Nursery batch
  writes straight into Garden's `plants` and `instances` collections (`plantOutToGarden()` in
  `apps/nursery/js/db.js`). Two projects would break that link silently.
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

| Option | Verdict |
|---|---|
| Add them as a collaborator on `garden-apps` | **No.** They'd get push access to your repo, and your commits would deploy to their sites. Wrong shape entirely. |
| Send a zip | **No.** They can never receive a fix, and you can never tell what version they're on. |
| **A separate public template repo** | **Yes.** They click one button, get their own repo, and your private repo stays private and untouched. |

The recommendation is a second GitHub repo — call it `garden-apps-template` — created from a
sanitised copy of `garden-apps` and marked as a template. Friends press **Use this template** and
get their own independent repo. You never touch their copy again unless you want to.

### Why not just make `garden-apps` public?

The Firebase web config is public-by-design — anyone can read it from your live site's source, and
Firestore rules are what protect the data. So the keys are not the problem. The problem is
everything else: `CLAUDE.md` and the docs describe your exact deploy setup, your Firebase project
ID, your Netlify configuration and your local folder paths. None of that is dangerous on its own,
and all of it is free reconnaissance. Keep the private repo private.

## A2. Build the template repo (one evening)

Work from a copy of the repo, not the repo itself.

1. Copy the whole `garden-apps` folder somewhere outside `Projects\`, delete its `.git` folder, and
   start fresh with `git init`.
2. **Blank the credentials.** In *both* `apps/garden/firebase-config.js` and
   `apps/nursery/firebase-config.js`, replace all six values with `REPLACE_WITH_YOUR_...`
   placeholders. The comment block at the top of those files already tells the reader to do exactly
   this — it is left over from the old Friend Package and is currently a lie in your repo, because
   your real values sit directly underneath it. In the template it becomes true again.
3. **Blank the project ID** in `firebase/.firebaserc` — change `bbg-garden-inventory` to
   `REPLACE_WITH_YOUR_PROJECT_ID`.
4. **Note the two hard-coded links to your site.** Nursery links out to Garden in two places:
   - `apps/nursery/js/admin-view.js:316`
   - `apps/nursery/js/batch-detail.js:119`

   Both contain `https://johnandkath.garden`. Either replace them with a placeholder in the
   template, or leave them and flag it in the friend's guide — Part B step B9 assumes the latter.
5. **Strip the internal docs.** `docs/restructure-plan.md`, `docs/backlog.md`,
   `docs/ui-consistency-review.md`, `docs/ux-review.md`, `docs/claude-code-handoff.md` and this file
   are your working notes and mean nothing to anyone else. Keep `data-model.md`, `plant-lookup.md`,
   `nursery-design.md` and `label-scan-spec.md` — those are genuinely useful to a copy owner and to
   their Claude.
6. **Edit `CLAUDE.md` and `README.md`.** Remove `C:\Users\johnb\...` paths, your live URLs, the
   `bbg-garden-inventory` project ID and the "Owner: John Bullivant" line. Keep the architecture,
   the role system, the standing rules and the deploy instructions — that content is exactly what
   makes their copy maintainable, and it is what their Claude will read.
7. **Add a `LICENSE` and a short "no warranty, no support promise" line in the README.** MIT is the
   usual choice. This matters more than it sounds: it is the difference between a gift and an
   open-ended obligation.
8. **Add Part B of this file** as `SETUP.md` at the repo root, so the instructions travel with the
   code instead of living in an email.
9. Push to a **new public repo**, then GitHub → repo **Settings** → tick **Template repository**.

Before pushing, run the repo's own checks against the copy:

```bash
node --check apps/garden/js/*.js apps/nursery/js/*.js apps/*/functions/*.js
```

```bash
node tools/check-drift.mjs
```

## A3. Decide your support boundary now, not later

Say it in the README and say it to them: you'll help get it running, you're not on call. The two
places they will realistically get stuck are the **first-admin bootstrap** (B7) and **Google
sign-in failing on a domain that isn't authorised** (B4 step 7). Both are one-liners once you know
them. Point people at those sections rather than remote-controlling their console.

## A4. Keeping the template current — decide what "current" means

A copy made from a template does **not** track your repo. There is no automatic update path, by
design. Your realistic options:

- **Do nothing.** Refresh the template when something worth sharing lands, tell friends there's a
  new version, and let them decide. This is the right answer to start with.
- **Let them merge from you.** They add your template as a second remote and merge when they want:

  ```bash
  git remote add upstream https://github.com/YOURNAME/garden-apps-template.git
  ```

  ```bash
  git fetch upstream && git merge upstream/main
  ```

  This works, with one predictable annoyance: their `firebase-config.js` (×2), `.firebaserc` and the
  two Nursery links conflict on every merge, because those are exactly the files they had to edit.
  Always the same handful of files, always resolved by keeping their version.

- **Optional refinement, only if this becomes a habit:** there is already a build step
  (`rm -rf shared && cp -r ../../shared shared`). It could also write `firebase-config.js` from a
  Netlify environment variable at build time, which would take the config out of git entirely and
  make upstream merges conflict-free. That is a real change to your own repo and its deploy path, so
  it is only worth doing if you end up with several copies out there. Don't do it for one friend.

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
2. Open the template repo link John sends you and click the green **Use this template** button →
   **Create a new repository**.
3. Name it `garden-apps`, choose **Private**, click **Create repository**.
4. You now have your own copy. You can edit files directly on the GitHub website — nothing to
   install. To edit a file: click it, click the ✏️ pencil icon, make the change, scroll down, click
   **Commit changes**.
5. Edit **`apps/garden/firebase-config.js`**: replace each `REPLACE_WITH_YOUR_...` with the matching
   value from the Firebase tab you left open. Keep the quote marks. Commit.
6. Edit **`apps/nursery/firebase-config.js`** the same way, with the **same six values**. Both apps
   deliberately share one database. Commit.
7. Edit **`firebase/.firebaserc`** and replace the placeholder with your `projectId`. Commit.

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
4. Before clicking Deploy, open **Add environment variables** and add:

   | Key | Value |
   |---|---|
   | `SECRETS_SCAN_OMIT_PATHS` | `firebase-config.js` |

   **This one is not optional.** Netlify scans for things that look like leaked keys, your Firebase
   key looks like one, and without this the build fails with a "secrets detected" error. (The key is
   safe to publish — it identifies your project, it doesn't unlock it. The security rules you deploy
   in B6 are what protect your data.)
5. Click **Deploy**. Wait a minute. You'll get an address like
   `https://cheerful-marzipan-1a2b3c.netlify.app`. Rename it to something memorable under **Site
   configuration → Change site name** if you like.
6. **Repeat steps 2–5 for Nursery**, with base and publish directory `apps/nursery`.
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

then, from inside the `firebase` folder of your copy:

```bash
firebase deploy --only firestore:rules,storage
```

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

- **Two links point back at John's garden.** Nursery has two hard-coded links to
  `https://johnandkath.garden`: one in `apps/nursery/js/admin-view.js` (around line 316) and one in
  `apps/nursery/js/batch-detail.js` (around line 119). Edit both to your own Garden site address, or
  delete them. Everything else in both apps is generic.
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
| Netlify build fails, "secrets detected" | `SECRETS_SCAN_OMIT_PATHS` missing (B4 step 4). |
| Page loads with no styling at all | The build didn't run. Check the site's base directory is `apps/garden` or `apps/nursery`, not the repo root. |
| Scan label / Look up plant error out | `GEMINI_API_KEY` missing on that site, or added but not redeployed since (B5). |
| Photos won't upload | The Storage bucket was never created — the Blaze upgrade in B1 step 5 didn't complete. |
