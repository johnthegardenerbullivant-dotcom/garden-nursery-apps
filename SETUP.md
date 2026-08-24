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

Do the steps in order. **B5 is the easiest one to skip, and B8 the one everyone gets stuck on** —
read both twice.

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
     install them in B7.
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
     about security rules; take the locked-down/production option, because B7 replaces them anyway.
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
2. Signed in as yourself, put this in your browser's **address bar** — not into anything on the
   GitHub page — and press Enter:

   **https://github.com/johnthegardenerbullivant-dotcom/garden-nursery-apps**

   > **Ignore the buttons a new account is offered.** A fresh GitHub account opens on a dashboard
   > whose two prominent buttons are **Create repository** and **Import repository**, and *neither is
   > what you want*. Create repository makes an empty one with no code in it. Import repository does
   > copy the files, but it severs the link to the original — no "forked from" line, no **Sync fork**
   > button, and every future update becomes a hand-merge. Forking is a different operation, and it
   > starts from the page above rather than from the dashboard.

3. On that page, look along the **top right** for the row of three buttons — **Watch**, **Fork**,
   **Star**. Click **Fork**, then **Create fork** on the screen that follows. Leave every field as
   it comes: owner is your account, the name stays `garden-nursery-apps`, and "Copy the `main`
   branch only" stays ticked.
4. A few seconds later you're looking at your own copy. Check the small grey line under the title:
   it should read **"forked from johnthegardenerbullivant-dotcom/garden-nursery-apps"**. That line is
   the whole point — when a new release lands upstream, GitHub shows "this branch is N commits
   behind" with a **Sync fork** button, one click, and your sites rebuild. Without it you'd be
   merging files by hand forever. `garden-nursery-apps` is also the name to look for in B4.

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

1. Sign up at **https://app.netlify.com**. **Sign up with GitHub** saves a step later; Google or
   email work just as well, they only mean you authorize GitHub separately in step 3.
2. Netlify asks a page of getting-to-know-you questions — name, how you'll use it, experience level,
   project type, role, how you heard about it. Answer however you like; none of it changes anything.
   The last one, **"What is the name of your team?"**, does stick: it becomes the heading your sites
   live under. Something like `My Garden` is fine. Then **Continue to deploy**.
3. The **"Deploy your first project"** screen leads with an AI agent box offering to build you a
   site, and bonus credits for using it. **Ignore all of that** — you already have the code. Scroll
   past it to *"Bringing your own code?"* and under **Import a Git repository** click **GitHub**.
   Two GitHub windows follow, and they are not the same thing:
   - **Authorize Netlify** — the OAuth consent. Click **Authorize**.
   - **Install Netlify** — this is GitHub asking which of *your* repositories Netlify may touch.
     Choose **Only select repositories**, click **Select repositories**, pick
     **`garden-nursery-apps`**, then **Install**. (*All repositories* also works. Only-select is
     tidier and costs nothing, since this one repository is the source of both sites — you will not
     have to come back here for the Nursery site.)
4. Pick **garden-nursery-apps** from the list. You'll get a card saying *"Deploy as … from `main`
   branch"* with a big deploy button. **Do not press it yet** — the settings you need are collapsed.
   Click **Edit build settings ↓** underneath *"Need to be more specific?"* to unfold them.

   **You type one thing:**

   | Field | What to put |
   |---|---|
   | Branch to deploy | `main` — already correct |
   | **Base directory** | **`apps/garden`** |

   > **The cursor will jump backwards while you type this.** Netlify re-reads the repository after
   > every keystroke, and each time it does, the caret is thrown back to the start of the box — so
   > `apps/garden` comes out as `nedrag/sppa` or worse. It is disconcerting and it is not your
   > typing. Type it, then **look at what's actually in the box** and retype until it reads
   > `apps/garden` exactly. Pasting it in one go, or typing it somewhere else and pasting, avoids
   > the fight entirely.

   Once the box is right, Netlify reads the repo's `netlify.toml` and **fills in the other three by
   itself**:

   | Field | Fills in as |
   |---|---|
   | Build command | `node ../../tools/build.mjs garden` |
   | Publish directory | `apps/garden/` |
   | Functions directory | `apps/garden/functions` |

   **Leave whatever it puts there.** Those values come from the repo, they are correct, and this is
   the guide's one-file-to-edit promise working: you supply the base directory, the repository
   supplies the build. (For Nursery, the same three appear with `nursery` in place of `garden`.)

5. Still on that screen, open **Add environment variables**. This is where your Firebase details
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
     six values* again on the Nursery site in step 7. That is correct — both apps deliberately use
     one Firebase project.
   - **Leave the scope at "All scopes"** so preview builds get them too.

   You do *not* need any secret-scanning settings; those live in the repo already.
6. Click **Deploy**. Wait a minute, and watch the deploy log: Initializing, Building, Deploying,
   Cleanup, Post-processing.
   - **Post-processing often sits on "In progress" after the log has already said `Site is live ✨`.**
     That's a stale panel, not a stuck build. Reload the page and it says Published.
   - You'll get an auto-generated address like `https://precious-zuccutto-800b80.netlify.app`.
     Netlify does **not** offer to name it during setup, so a name like that is expected, not a
     mistake. Rename it whenever you like under **Project configuration → Change project name** —
     Netlify now calls sites "projects", so anywhere you're looking for *Site settings*, read
     *Project configuration*.
   - **Open the address.** You should get the app's green sign-in screen — *Continue as Guest*,
     *Sign in with Google*, and an email/password form. That means the build read your six
     variables and the app is configured. A green **"Setup required"** screen instead means the
     variables didn't take; check them and redeploy. Don't sign in yet — until B7 deploys the
     security rules, everything is blocked and lists come back empty with no error.
7. **Now the Nursery site.** That signup wizard only ever makes one site, so this time start from
   the Netlify dashboard: **Add new project → Import an existing project → GitHub**. It will offer
   `garden-nursery-apps` straight away — you already granted access in step 3, and there is no
   second authorization. This route walks you through three numbered steps and, unlike the signup
   wizard, gives you a **Project name** box at the top. Filling it in gets you that address instead
   of another random one — but the name has to be **unique across the whole of Netlify**, not just
   your account, so anything obvious like `nursery` or `garden` is long gone and the box will reject
   it. Use something nobody else would have picked: `nursery-<yoursurname>`. Leaving it blank is
   fine too; you can rename later under **Project configuration → Project details**. Then as before,
   except:
   - **Base directory:** `apps/nursery`
   - the **same six `FIREBASE_*` values** — yes, again; see the note above
   - and one extra variable, which is **much easier to add now than later**:

   | Key | Value |
   |---|---|
   | `GARDEN_URL` | your Garden site's address, e.g. `https://garden-yourname.netlify.app` |

   Nursery uses it for two links back to Garden — a button in the Admin panel and "View in garden"
   on a batch you've planted out. Leave it unset and those links simply don't appear, which is what
   you want if you're only running Nursery.

   **If you forget it here** — easily done, it's the seventh box on a screen where the first six are
   the point — adding it afterwards is fine, but **the site will not pick it up until it rebuilds**.
   Netlify does not redeploy when you change a variable. **Project configuration → Environment
   variables → Add a variable**, then **Deploys → Trigger deploy → Deploy site**. Until you do that
   second half, the links stay missing and nothing tells you why.
Both sites are now live. **Write down the two addresses** — the next section needs them, and so
does B8.

## B5. Tell Firebase about your two addresses ← two minutes, and everything depends on it

This is one small entry in one list, it takes about two minutes, and **B8 cannot be done at all
until it is.** It gets its own section because it used to be the last bullet of the Netlify
section, where it was skipped — the guide's author skipped it himself while testing this guide.

1. Firebase Console → **Security → Authentication** → the **Settings** tab → **Authorized domains**.
2. **Add domain**, and enter your Garden address. **Hostname only** — no `https://`, no trailing
   slash, no path:

   ```
   precious-zuccutto-800b80.netlify.app
   ```

3. **Add domain** again for the Nursery address. Both, separately. One is not enough.

**Why it matters, and why the failure is so unhelpful:** Firebase only permits Google sign-in
popups from hosts on that list. Until an address is on it, clicking **Sign in with Google** opens a
popup that closes itself instantly and shows you nothing at all — no error, no message, on either
site. It looks exactly like a broken app. The real error, `auth/unauthorized-domain`, appears only
in the browser's developer console, which nobody has open.

You will need to come back here if you ever add a custom domain.

## B6. Turn on the AI features (optional, 5 minutes)

**Skipping this is genuinely safe, and tested.** Everything else works; only **Scan label** and
**Look up plant** stop, and they stop politely — a "Failed" flag and a panel that says in plain
words that the key is missing. You can come back and do this months later.

1. Go to **https://aistudio.google.com/apikey**, sign in, click **Create API key**. A **Create a new
   key** dialog opens, wanting two things:
   - **Name your key** — anything; `Gemini API Key` is the default and is fine.
   - **Choose an imported project** — a drop-down offering *Import project*, *Create project*, and
     any Cloud projects you already have. **Pick the Firebase project you made in B1** (it appears
     under the name you gave it, e.g. *A Garden Database*). It's already set up and already has
     billing attached, so key, quota and usage all stay in one place instead of being scattered
     across a stray "Default Gemini Project".

   Then **Copy key** from the details panel that appears.

   > **The key does not look like the Firebase one, and that's correct.** A Gemini key starts
   > **`AQ.`** and runs to about 50 characters — it is not the `AIza…`-and-39-characters shape of
   > `FIREBASE_API_KEY`. Nothing validates it at build time, so nothing will tell you if it's wrong;
   > the first sign of a bad key is a scan or lookup failing. The key list also shows a **Billing
   > Tier** of *Free trial* with an *Activate billing* link — ignore it, the free tier is what this
   > uses.
   >
   > To find the key again later, note that AI Studio's list only shows keys for projects that have
   > been *imported into AI Studio* — if yours seems to have vanished, that's why, and there's an
   > **Import projects** button at the foot of the page.

2. In Netlify, for **each of your two sites**: **Project configuration → Environment variables →
   Add**:

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

## B7. Deploy the security rules

Right now your database is in production mode, which means **everything is blocked**, including you.
The repo contains the rules that open it up correctly. Two ways to install them — pick one.

**The easy way (copy and paste):**

1. In your GitHub repo, open `firebase/firestore.rules`. Click the **Raw** button, select all the
   text, copy it. (GitHub's **copy raw file** icon — the little clipboard at the top right of the
   file view — is more reliable than select-all on the raw page, and doesn't need the Raw button
   at all.)
2. In Firebase Console: **Firestore → Rules** tab (left menu → *Databases & Storage → Firestore*,
   or the **Firestore** shortcut that now sits under *Project shortcuts*). Delete what's there,
   paste, click **Publish**.
3. Do the same with `firebase/storage.rules` into **Storage → Rules**.

   > **If the Storage editor won't take a paste, click directly onto a line of the code first.**
   > That page opens with the **Rules Playground** panel beside the editor, and the rules text can
   > look selected while the editor has no keyboard focus at all — so `Ctrl+A` and `Ctrl+V` go
   > nowhere and nothing tells you why. One click on a line of code gives you a blinking caret, and
   > from there select-all, paste and **Publish** behave normally.

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

## B8. Make yourself the administrator ← the step everyone gets stuck on

There is deliberately no way to sign yourself up as an admin from inside the app — otherwise anyone
who found the URL could. So the first admin is created by hand, once.

> **Before you start, confirm you have done B5.** Both `.netlify.app` addresses have to be in
> Firebase's **Authorized domains** list. If they aren't, *Sign in with Google* opens a popup that
> shuts itself instantly, showing you nothing, and this whole step is impossible — there is no way
> to make an admin out of a sign-in that never happened. It looks like a broken app and it is one
> missing list entry. Go and do it now if you skipped past it.

1. Open your Garden site and click **Sign in with Google**.

   > **If the app lets you straight in, look at who you are before celebrating.** Firebase keeps you
   > signed in between visits, so an earlier press of *Continue as Guest* is still live and the app
   > opens as that guest. Guests are read-only, and — the part that matters here — they get no
   > `users` record at all, so there will be nothing in step 3 for you to edit. **Sign out first**,
   > then sign in with Google properly.

2. You will land on an **access denied / pending** screen. **This is correct.** Signing in created
   your account record; it has no permissions yet.
3. Go to Firebase Console → **Firestore** → the **Data** tab. You'll see a `users` collection
   containing one document, its name a long string of letters and numbers (that's your user ID).
4. Click that document, then **+ Add field**:
   - Field name: `role`
   - Type: **string**
   - Value: `admin`
   - Click **Add**. Spelling and lower case both matter.

   The document will already hold `createdAt`, `displayName`, `email`, `lastLoginAt`, `photoURL`,
   `provider` and `status` — the app wrote those when you signed in. Leave them alone. In
   particular **don't touch `status: "pending"`**: it is only there so the Admin panel can list new
   arrivals, nothing reads it for access, and `role` is what grants you entry.
5. Go back to the app, **sign out, and sign in again**. You now have full access.

   A plain reload is *supposed* to be enough — the app re-reads your role from Firestore every time
   it starts. In testing it wasn't, and the access-denied screen stayed put until a full sign-out
   and sign-in. If reloading works for you, fine; if you still see "access denied" after setting the
   role, this is the fix, and it is not a sign you got the field wrong.
6. You do **not** need to repeat this on the Nursery site — both apps read the same `users`
   collection, so one admin record covers both. Nursery may still be showing you the old session,
   though; sign out and in there too if it looks stuck.

## B9. Add the rest of the household

1. They open the site and sign in with Google once. They'll get the same pending screen.
2. You go to the app's **Admin** panel → **User Management**, find them in the pending list, and
   grant **viewer** (look only), **editor** (add and change plants) or **admin** (everything,
   including delete and backups). A role granted in one app applies to both.

   **Tell them to sign out and sign in again** once you've done it. Same caveat as B8 step 5: a
   reload ought to be enough and may not be, and "I still can't get in" is otherwise the next thing
   you'll hear.
3. For someone without a Google account, create an email/password login in Firebase Console →
   **Security → Authentication → Users → Add user**. There is no sign-up form in the app, on
   purpose. They then
   sign in with the **Email** form and you grant them a role as above.

## B10. The last bits

- **Nothing in the code needs editing** — if you set `GARDEN_URL` in B4 step 7, Nursery's two links
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
| Everything loads but every list is empty | Security rules not deployed (B7). Rules failures are silent — they look like no data, not like an error. |
| Google sign-in popup flashes and closes | That address isn't in Firebase Authorized domains (B5). It must be **both** addresses, hostname only. |
| "Access denied" after signing in | Normal until B8 is done. If it persists *after* you set the role, sign out and sign back in. |
| Green "Setup required" screen | The six `FIREBASE_*` variables aren't set on that site, or were added but the site hasn't rebuilt since (B4 step 5). |
| Build fails: "contains a non-ASCII character" | A value was pasted from a masked display and is full of `•` characters. Re-copy it from the Firebase console config block. The build is stopping this from reaching your live site. |
| Build fails: "does not look like a Google API key" | `FIREBASE_API_KEY` is truncated or is some other value. It should be 39 characters starting `AIza`. |
| `firebase deploy` says "No currently active project" | `firebase use --add` hasn't been run in that folder (B7). |
| Nursery has no links to Garden | `GARDEN_URL` isn't set on the Nursery site, or it hasn't rebuilt since (B4 step 7). Working as designed if you only run Nursery. |
| Page loads with no styling at all | The build didn't run. Check the site's base directory is `apps/garden` or `apps/nursery`, not the repo root. |
| Scan label / Look up plant error out | `GEMINI_API_KEY` missing on that site, or added but not redeployed since (B6). |
| Photos won't upload | The Storage bucket was never created — the Blaze upgrade in B1 step 5 didn't complete. |
