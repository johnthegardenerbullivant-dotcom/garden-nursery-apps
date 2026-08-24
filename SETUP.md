# Setting up your own copy 🌿

Garden Management and Nursery Management are two Progressive Web Apps for keeping track of a garden
and a propagation nursery. This guide takes you from nothing to a working, installable copy of your
own — your database, your photos, your users, your web address. Nothing is shared with anyone
else's.

Take **both** apps or just one. They're companions: plant out a nursery batch and it appears in the
garden automatically, and you can send a garden plant back to the nursery to propagate. If you take
both, **they must use one Firebase project** — that's what makes those two paths work, and splitting
them fails silently.

Setting up takes about **an hour and a half**, most of it waiting for things to finish. You need a
Google account and a debit or credit card. You will not be charged in normal use, but Google
requires a card on file before it will store photos.

## Before you start — what it costs

| Thing | Cost | Notes |
|---|---|---|
| Firebase, Blaze plan | **Card required**, ~$0/month in practice | Since 3 Feb 2026 a new project must be on Blaze to create a photo bucket at all. Free allowances still apply — 5 GB storage, 100 GB/month transfer. A household garden won't approach that. |
| Netlify | Free | Two sites, 100 GB bandwidth, 125k function calls/month. |
| Gemini API key | Free tier, or pennies | Only for label scanning and AI plant lookup. Everything else works without it. |
| Domain name | $0 or ~$15/year | A free `something.netlify.app` address is fine. |

**The card is the thing worth knowing up front**: photos will not work at all without it.

You'll start with an empty database — no plants, no areas, no nursery locations. There's a bulk
import in the Admin panel if you have a spreadsheet of plants to load.

Do the steps in order. **Step 7 is the one everyone gets stuck on** — read it twice.

## B1. Create your Firebase project (the database)

> **The left menu has no "Build" section.** Firebase reorganized the console in 2026. Below
> **Project Overview** and **Settings** you'll find **Project shortcuts** (which fills up as you add
> products) and then **Product categories**: *Databases & Storage*, *Security*, *AI services*,
> *Hosting & Serverless*, *DevOps & Engagement*, *Analytics*. Everything this guide needs lives under
> the first two. Each is a fly-out — click the category, then the product in the little menu that
> appears. Where an older guide says "Build → *something*", look under those categories instead.

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project**. Name it something like `my-garden`. Turn Google Analytics **off**.
3. When it finishes, click **Continue**.
4. Left menu → **Databases & Storage → Firestore**. The **Create database** button is in the middle
   of the page, not in the menu. Click it and answer three questions, in this order:
   - **Edition:** **Standard**. (Enterprise is a paid tier for large workloads. You don't need it.)
   - **Location:** somewhere near you — `europe-west2` for the UK, `us-west1` for the US west coast.
     **You cannot change this later.**
   - **Rules:** **Production mode**, not test mode. The app brings its own security rules and you
     install them in B6.
5. Left menu → **Databases & Storage → Storage**. The page says *"To use Storage, upgrade your
   project's pricing plan"* — click **Upgrade project**.
   - This is the card step, and you have to do it. Storage is where plant photos live, and since
     February 2026 a new project cannot create a photo bucket at all without the **Blaze** plan. The
     free allowance on Blaze (5 GB) still applies, and a home garden will not get close to it.
   - You'll enter name, address and card details, set a budget, and confirm linking the billing
     account to the project. Set the budget alert to **$1** while you're there.
   - Google will probably also start a **Google Cloud Free Trial** — $300 of credit, 90 days —
     and show it as a countdown card on Project Overview. Ignore it. When it expires you stay on
     Blaze with the free allowances, which is what you actually want.
   - Then a **Set up default bucket** dialog appears. Step 1 offers **No cost location** or **All
     locations**: take **No cost location** and change the drop-down (it defaults to `US-EAST1`) to
     whichever offered region is nearest you — ideally the same one you gave Firestore. Step 2 asks
     about security rules; take the locked-down/production option, because B6 replaces them anyway.
6. Left menu → **Security → Authentication**, then **Get started**. Open the **Sign-in method** tab
   and use **Add new provider** to enable these three:
   - **Google** — before it will let you save, the console makes you fill in a **public-facing name
     for project** (it pre-fills something like `project-982217052574`; any name will do) and a
     **support email**. Both are project-wide settings that happen to be asked for here.
   - **Email/Password**
   - **Anonymous** — tick **Enable Auto clean-up** as well. It deletes guest accounts older than 30
     days, and it's safe here: guests are read-only viewers and the app stores nothing against them,
     so there is nothing to lose and it keeps your user list honest.

## B2. Copy your Firebase keys

1. In the left menu click **Settings** (the ⚙️ directly under **Project Overview**) → **General**.
2. **Your apps** is a panel partway down the *page* — not an entry in the Settings menu. Scroll to
   it. On a new project it reads *"There are no apps in your project"*. Click the web icon
   **`</>`**.
3. Nickname it anything. **Do not** tick Firebase Hosting. Click **Register app**.
4. You'll see a block of code containing `apiKey`, `authDomain`, `projectId`, `storageBucket`,
   `messagingSenderId` and `appId`. **Leave this browser tab open** — you need these values in B3.

## B3. Get your own copy of the code

1. Create a free account at **https://github.com** if you don't have one.
2. Signed in as yourself, open

   **https://github.com/johnthegardenerbullivant-dotcom/garden-nursery-apps**

   and click **Fork** (top right) → **Create fork**. Accept the defaults on that screen; the copy
   lands in your own account, still called **`garden-nursery-apps`**. That's the name to look for in
   B4.
3. You now have your own copy, and it stays linked to the original. When a new release lands
   upstream, GitHub shows "this branch is N commits behind" with a **Sync fork** button — one click,
   and your sites rebuild. That link is why you fork rather than download the files.

**There is nothing to edit in the code.** Not one file. Your Firebase details go into Netlify as
settings in the next step, and the app reads them from there when it builds. Keep the Firebase tab
from B2 open — you'll paste those six values in B4.

> **When you do paste them, never copy a value off a screen that shows it as dots.** Some sites and
> apps mask keys when displaying them, and copying the mask gives you 30-odd `•` characters that
> look plausible and are not the key. Copy from the Firebase console's own config block, where the
> value is shown in full. (This is not hypothetical — it cost the author an afternoon. The build now
> refuses a masked value rather than shipping it, so if you see a build fail complaining about a
> "non-ASCII character", this is what happened.)

## B4. Put it on the internet (Netlify)

You'll create **two** websites from the one repository — one for Garden, one for Nursery. (Taking
only Garden is fine; skip the Nursery half of every step below.)

1. Sign up at **https://app.netlify.com** — choose **Sign up with GitHub**.
2. Click **Add new site → Import an existing project → GitHub**, authorize Netlify when asked, and
   pick your `garden-nursery-apps` repository.
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
your function timeout (they are usually quick about it — one such request was granted 30 seconds on
the same day it was asked) or add `GEMINI_MODEL_RESEARCH` = `gemini-3.5-flash-lite`, which is faster
and slightly less thorough.

## B6. Deploy the security rules

Right now your database is in production mode, which means **everything is blocked**, including you.
The repo contains the rules that open it up correctly. Two ways to install them — pick one.

**The easy way (copy and paste):**

1. In your GitHub repo, open `firebase/firestore.rules`. Click the **Raw** button, select all the
   text, copy it.
2. In Firebase Console: **Firestore → Rules** tab (left menu → *Databases & Storage → Firestore*,
   or the **Firestore** shortcut that now sits under *Project shortcuts*). Delete what's there,
   paste, click
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
file is deliberately not in the repo, because it names one specific Firebase project, and yours is
not the one this repository was developed against.)

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
3. Go to Firebase Console → **Firestore** → the **Data** tab. You'll see a `users` collection
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
   **Security → Authentication → Users → Add user**. There is no sign-up form in the app, on
   purpose. They then
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
