# Quick start 🌿

The short version — what to do, in order, without the explanations. About **90 minutes**, most of it
waiting.

Every step links to the same step in **[`SETUP.md`](SETUP.md)**, which says *why* and covers what to
do when something looks wrong. If you get stuck, that's where to go — this page assumes everything
behaves.

**You need:** a Google account, a GitHub account, and a debit or credit card (Firebase won't store
photos without one; you should not be charged).

---

## 1. Firebase project → [B1](SETUP.md#b1-create-your-firebase-project-the-database)

The console's left menu has **no "Build" section** — products live under **Product categories**.

- [ ] **https://console.firebase.google.com** → **Create a project**. Analytics **off**.
- [ ] **Databases & Storage → Firestore** → **Create database** (a button on the page, not the menu):
      edition **Standard** → a location near you (**permanent**) → **Production mode**.
- [ ] **Databases & Storage → Storage** → **Upgrade project**. Card details, budget alert **$1**.
      Then *Set up default bucket*: **No cost location**, change the region from `US-EAST1` to one
      near you.
- [ ] **Security → Authentication** → **Get started** → **Sign-in method** tab → enable three
      providers: **Google** (it will make you set a public-facing name and support email),
      **Email/Password**, and **Anonymous** (tick **Enable Auto clean-up**).

## 2. Copy your Firebase keys → [B2](SETUP.md#b2-copy-your-firebase-keys)

- [ ] **Settings → General**, scroll to the **Your apps** panel *on the page*, click **`</>`**.
- [ ] Nickname it. **Don't** tick Firebase Hosting. **Register app**.
- [ ] **Leave this tab open.** You need those six values in step 4.

## 3. Fork the code → [B3](SETUP.md#b3-get-your-own-copy-of-the-code)

- [ ] Go to **https://github.com/johnthegardenerbullivant-dotcom/garden-nursery-apps** — in the
      address bar. Ignore *Create repository* and *Import repository* on GitHub's dashboard; neither
      is what you want.
- [ ] **Fork** (top right) → **Create fork**, all defaults.
- [ ] Check it says **"forked from …"** under the title. That's what gives you one-click updates.

**There is nothing to edit in the code. Not one file.**

## 4. Two Netlify sites → [B4](SETUP.md#b4-put-it-on-the-internet-netlify)

- [ ] Sign up at **https://app.netlify.com**. Answer the questionnaire however you like — only the
      **team name** sticks.
- [ ] **Import a Git repository → GitHub**. Two windows: **Authorize Netlify**, then **Install
      Netlify** (choose *Only select repositories* → `garden-nursery-apps`).
- [ ] Pick the repo → **Edit build settings ↓**. Type **one** field: **Base directory** =
      `apps/garden`. *The cursor jumps backwards as you type — check the box reads correctly before
      moving on.* Netlify fills in the other three itself; leave them.
- [ ] **Add environment variables** — six, from the Firebase tab. *Import from a .env file* takes
      all six at once.

      | Key | From |
      |---|---|
      | `FIREBASE_API_KEY` | `apiKey` |
      | `FIREBASE_AUTH_DOMAIN` | `authDomain` |
      | `FIREBASE_PROJECT_ID` | `projectId` |
      | `FIREBASE_STORAGE_BUCKET` | `storageBucket` |
      | `FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
      | `FIREBASE_APP_ID` | `appId` |

- [ ] **Deploy.** Open the address — you should get a green sign-in screen. (Don't sign in yet.)
- [ ] **Now Nursery**, from the dashboard this time: **Add new project → Import an existing project
      → GitHub**. Same repo, **Base directory** = `apps/nursery`, the **same six values**, plus
      `GARDEN_URL` = your Garden address. Add it *now* — later needs a manual redeploy.
- [ ] **Write down both addresses.**

## 5. Authorized domains → [B5](SETUP.md#b5-tell-firebase-about-your-two-addresses)

**Two minutes. Skip it and step 8 is impossible.**

- [ ] Firebase → **Security → Authentication → Settings** tab → **Authorized domains → Add domain**.
- [ ] Add **both** Netlify addresses, separately. Hostname only — no `https://`, no trailing slash.

## 6. AI features → [B6](SETUP.md#b6-turn-on-the-ai-features-optional-5-minutes) — *optional*

Skip this entirely and everything else still works.

- [ ] **https://aistudio.google.com/apikey** → **Create API key** → project **`Default Gemini
      Project`**. *Not* your Firebase project.
- [ ] Add `GEMINI_API_KEY` to **both** sites, then **redeploy both**.
- [ ] **Scan label** now works. **Look up plant** additionally needs billing enabled on the Gemini
      API — it searches the web, which isn't free. Pennies in practice, but read
      [B6](SETUP.md#b6-turn-on-the-ai-features-optional-5-minutes) before turning it on.

## 7. Security rules → [B7](SETUP.md#b7-deploy-the-security-rules)

**Until this is done everything is blocked, and it fails silently — empty lists, no errors.**

- [ ] Copy `firebase/firestore.rules` from your repo (the **copy raw file** icon) → Firebase
      **Firestore → Rules** → replace all → **Publish**.
- [ ] Same for `firebase/storage.rules` → **Storage → Rules**. *If it won't paste, click onto a line
      of the code first to give the editor focus.*

Or, from the `firebase` folder of a local clone: `firebase login`, `firebase use --add`, then
`firebase deploy --only firestore:rules,storage`.

## 8. Make yourself admin → [B8](SETUP.md#b8-make-yourself-the-administrator)

- [ ] Open Garden → **Sign in with Google**. If it lets you straight in as a **guest**, sign out and
      sign in properly.
- [ ] You'll get **access denied**. That's correct.
- [ ] Firebase → **Firestore → Data** → `users` → your document → **+ Add field**:
      `role` / **string** / `admin`. Leave the other fields alone.
- [ ] Back in the app: **sign out and sign in again**. A reload may not be enough.

One admin record covers both apps.

## 9. Everyone else → [B9](SETUP.md#b9-add-the-rest-of-the-household)

- [ ] They sign in with Google once and get the pending screen.
- [ ] You: **Admin → User Management** → grant **viewer**, **editor** or **admin**.
- [ ] Tell them to **sign out and back in**.

No Google account? Firebase → **Security → Authentication → Users → Add user** creates an
email/password login.

## 10. Finish up → [B10](SETUP.md#b10-the-last-bits)

- [ ] Create your **Areas** (Garden) and **Locations** (Nursery) before adding plants.
- [ ] Install on your phone: open the site → **Add to Home Screen**.
- [ ] Take a backup occasionally: **Admin → Download backup**.

---

## When something doesn't work

Almost every problem is one of these, and none of them announce themselves:

| Symptom | Cause |
|---|---|
| Every list is empty | Rules not deployed — step 7 |
| Google sign-in popup flashes and closes | Address not in Authorized domains — step 5 |
| "Access denied" after signing in | Normal until step 8. Persists after? Sign out and back in. |
| Green "Setup required" screen | The six `FIREBASE_*` variables missing, or added without a rebuild |
| Nursery has no links to Garden | `GARDEN_URL` missing, or added without a rebuild |
| Photos won't upload | Storage bucket never created — step 1 |
| Scan label / Look up plant fail | `GEMINI_API_KEY` missing, or no billing on the Gemini API |

**Environment variables only take effect on the next build.** Changing one and not redeploying is
the single most common self-inflicted problem.

The full **[`SETUP.md`](SETUP.md)** has a longer table and explains every one of these.
