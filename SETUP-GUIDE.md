# Setup Guide — Garden Management & Nursery Management 🌿

Welcome! This guide gets your own copy of the apps running. It's written for
people who are **not** programmers — if you can copy and paste, you can do this.

You'll do four things:

1. **Part 1** — Create a free Firebase project (your database, photo storage, sign-in)
2. **Part 2** — Add your Firebase keys to the apps
3. **Part 3** — Publish the apps online for free with Netlify
4. **Part 4** — Make yourself the admin and add family/friends

It takes about **30–45 minutes the first time**, and you only do it once.

> **One Firebase project runs both apps.** Even though there are two apps, they
> share a single database, so you set Firebase up **once** and both apps use it.
> You can set up just one app if you prefer — simply skip the other app's steps.

---

## Before you start

- A **Google account** (for Firebase and Netlify sign-in)
- This folder of files on your computer (the one containing `garden-management`
  and `nursery-management`)
- A free **Netlify** account — we'll create it in Part 3

---

## Part 1 — Set up Firebase (free)

Firebase is Google's free app platform. It stores your plant data and photos
and handles sign-in.

### Step 1 — Create a Firebase project
1. Go to **https://console.firebase.google.com** and sign in with Google.
2. Click **Add project**.
3. Give it a name like `My Garden` and click **Continue**.
4. Google Analytics: switch it **off** (not needed), then **Create project**.
5. Wait for it to finish, then click **Continue**.

### Step 2 — Turn on the database (Firestore)
1. Left menu: **Build → Firestore Database**.
2. Click **Create database**.
3. Choose a location close to you (UK: `europe-west2`), click **Next**.
4. Choose **Start in production mode** (we'll paste proper security rules in
   Step 5), then **Create**.

### Step 3 — Turn on photo storage
1. Left menu: **Build → Storage**.
2. Click **Get started**, accept the default location, and finish.
   (If it asks about rules, just continue — we replace them in Step 5.)

### Step 4 — Turn on sign-in (Authentication)
1. Left menu: **Build → Authentication**, then **Get started**.
2. On the **Sign-in method** tab, enable these three providers (click each,
   toggle **Enable**, **Save**):
   - **Google**
   - **Email/Password**
   - **Anonymous**  *(this powers the read-only "guest" view)*

### Step 5 — Paste in the security rules
These rules control who can read and change your data. The apps come with the
correct rules ready to paste.

**Firestore rules:**
1. Go to **Firestore Database → Rules** tab.
2. Open the file `garden-management/firestore.rules` from this folder in a text
   editor (Notepad / TextEdit), select all, and copy it.
3. Delete what's in the Firebase rules box, paste yours in, click **Publish**.

> The rules file is identical in both app folders and covers **both** apps, so
> you only paste it once.

**Storage rules:**
1. Go to **Storage → Rules** tab.
2. Open `garden-management/storage.rules`, copy all, paste over what's there,
   click **Publish**.

### Step 6 — Get your Firebase keys
1. Click the gear ⚙️ next to **Project Overview → Project settings**.
2. Scroll to **Your apps**. Click the web icon **`</>`**.
3. Nickname it anything (e.g. `Garden Web`), do **NOT** tick Firebase Hosting,
   click **Register app**.
4. You'll see a block like this — keep this screen open, you need these values:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy…",
     authDomain: "my-garden-xxxx.firebaseapp.com",
     projectId: "my-garden-xxxx",
     storageBucket: "my-garden-xxxx.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:1234…:web:abcd…"
   };
   ```

---

## Part 2 — Add your keys to the apps

1. In this folder, open **`garden-management/firebase-config.js`** in a text editor.
2. Replace each `REPLACE_WITH_YOUR_...` with the matching value from the Firebase
   screen above. Keep the quote marks. Save.
3. Do **exactly the same** with **`nursery-management/firebase-config.js`** —
   paste the **same** values (both apps share one Firebase project).

> Only setting up one app? Just edit that app's `firebase-config.js`.

---

## Part 3 — Publish online with Netlify (free)

Netlify hosts websites for free — no credit card needed. Each app becomes its
own website.

### Step 1 — Create a Netlify account
1. Go to **https://app.netlify.com/signup** and **Sign up with Google**.

### Step 2 — Deploy the Garden Management app
1. On the Netlify dashboard, find the **"Deploy manually"** drag-and-drop area
   (look for "Want to deploy a new site without connecting to Git? Drag and drop
   your site folder here").
2. Drag the **`garden-management`** folder onto it.
3. Netlify uploads it and gives you an address like
   `https://cheerful-plant-1234.netlify.app`. **Write it down.**
4. You can rename the site under **Site configuration → Change site name**.

### Step 3 — Deploy the Nursery Management app
1. Back on the dashboard, click **Add new site → Deploy manually**.
2. Drag the **`nursery-management`** folder onto it.
3. You'll get a second address — **write this one down too.**

### Step 4 — Tell Firebase to trust your new web addresses
Google sign-in only works on web addresses Firebase recognises.
1. Firebase Console → **Authentication → Settings → Authorized domains**.
2. Click **Add domain** and add the Netlify address for the Garden app
   (just the `xxxx.netlify.app` part, no `https://`).
3. **Add domain** again for the Nursery app's address.

---

## Part 4 — Make yourself the admin, then add others

The apps have three access levels: **viewer** (read-only), **editor** (can add
and edit), and **admin** (full control). The very first person has to be made
admin by hand — after that you can manage everyone from inside the app.

### Step 1 — Sign in once
1. Open your Garden Management web address.
2. Click **Sign in with Google** and sign in.
3. You'll land on a **limited / "access pending"** screen. **This is normal** —
   nobody is an admin yet. We fix that next.

### Step 2 — Promote yourself to admin
1. Firebase Console → **Firestore Database → Data** tab.
2. Open the **`users`** collection. You'll see one document — that's you
   (check the `email` field matches).
3. Click that document, then **+ Add field**:
   - Field name: `role`
   - Type: `string`
   - Value: `admin`
   - Save.
4. (Optional) change the `status` field from `pending` to `active`.
5. Go back to the app and **refresh**. You now have full admin access. 🎉

### Step 3 — Add your family and friends
1. Ask them to open the site and **sign in once** (Google or email/password).
   They'll see the same "pending" screen.
2. In the app, go to **Admin → Users**. New people show up as **pending**.
3. Set each person's role to **viewer**, **editor**, or **admin**, and they're
   in. (You can also block someone here.)

> Anyone who just wants to browse without an account can use the **Guest**
> option — that's the read-only viewer mode.

---

## Done! 🌱

Both apps are live, secured, and shared with whoever you choose. To use them on
your phone, open the web address and choose **Add to Home Screen** — they behave
like proper apps, including offline.

### If something goes wrong
- **"Access pending" never clears** → you didn't set `role: admin` on your user
  document (Part 4, Step 2), or you set it on the wrong document.
- **Google sign-in popup fails** → the site's address isn't in Firebase
  Authorized domains (Part 3, Step 4).
- **Nothing loads / console errors about permissions** → re-check the Firestore
  and Storage rules were pasted and published (Part 1, Step 5).
- **Photos won't upload** → Storage wasn't enabled or its rules weren't pasted.

Note which step you're on and what you see on screen — that's almost always
enough to pinpoint the fix.
