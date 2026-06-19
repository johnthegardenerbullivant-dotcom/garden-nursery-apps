# Garden Management &amp; Nursery Management 🌿

Two free, self-hostable web apps for keen home gardeners:

- **Garden Management** — catalogue your plant collection, organise it by area, track tasks and irrigation, keep a garden journal/blog, and log plants that don't make it (the "compost bin").
- **Nursery Management** — track propagation batches (seeds, cuttings, division and more) from first sowing through to planted-out, given-away, or lost, and learn what works best over time.

They're companion apps: when you "plant out" a batch in Nursery Management, it appears as a new specimen in Garden Management automatically. You can run either one on its own, or both together.

## What they're built with

Plain HTML, CSS and JavaScript — **no build step, no install, nothing to compile**. Each app is just a folder of files you upload to a free web host. Data and photos live in your own free Google Firebase project, so everything stays under your control.

## How to set it up

Full step-by-step instructions — written for non-developers — are in **[SETUP-GUIDE.md](SETUP-GUIDE.md)**. It walks you through:

1. Creating a free Firebase project (your database, photo storage, and sign-in)
2. Pasting in the security rules and turning on sign-in
3. Adding your Firebase keys to the apps
4. Publishing each app for free on Netlify
5. Making yourself the admin and adding your family/friends

It takes about 30–45 minutes the first time, and you only do it once.

## What's in this repository

```
garden-apps-shared/
├── README.md                 ← you are here
├── SETUP-GUIDE.md            ← the full setup walkthrough — start here
├── garden-management/        ← the Garden Management app (upload this folder to Netlify)
│   ├── firebase-config.js    ← blank — you paste YOUR Firebase keys here
│   └── …
└── nursery-management/       ← the Nursery Management app (upload this folder to Netlify)
    ├── firebase-config.js    ← blank — paste the SAME keys here
    └── …
```

The `firebase-config.js` files ship **blank on purpose** — you fill in your own keys during setup. Use the **same** Firebase project for both apps so they share one database.

## Need a hand?

If you get stuck, note which step you're on and what you're seeing on screen — that's usually enough to sort it out quickly.

Happy gardening! 🌱
