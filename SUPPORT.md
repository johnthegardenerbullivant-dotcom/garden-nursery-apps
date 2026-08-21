# Support

This is a personal project, shared in the hope it's useful. There's **no warranty and no promise of
support** — see the [license](LICENSE). Questions and bug reports are welcome and may go unanswered.

That said, most problems people hit are one of about five things, and you can usually fix them
faster than anyone can answer you.

## Try this first — it resolves most reports

**If the app loads but every list is empty**, your security rules almost certainly aren't deployed.
This is by far the most common problem, and it produces **no error message** — Firestore denials
look exactly like "there's no data". Run this from the `firebase/` folder:

```bash
firebase deploy --only firestore:rules,storage
```

Rules are deployed by the Firebase CLI. Nothing else deploys them — not Netlify, not merging, and
not syncing your fork. If you've just taken an update, check [`CHANGELOG.md`](CHANGELOG.md): every
entry has an **Action required** line, and some of them say *redeploy rules*.

The rest of the usual suspects:

| Symptom | Almost certainly |
|---|---|
| Every list is empty, no error | Rules not deployed (above) |
| Green **"Setup required"** screen | The six `FIREBASE_*` variables aren't set on that Netlify site, or were set but the site hasn't rebuilt since |
| Google sign-in popup opens and instantly closes | Your Netlify address isn't in Firebase → Authentication → Settings → **Authorized domains** |
| **"Access denied"** right after signing in | Normal until someone grants you a role. The very first admin is created by hand — see step B7 of [`SETUP.md`](SETUP.md) |
| Build fails, *"contains a non-ASCII character"* | A value was pasted from a masked display and is full of `•` characters. Re-copy it from the Firebase console's config block. The build is stopping this from reaching your site |
| Photos won't upload | The Storage bucket was never created — the Blaze upgrade didn't complete |
| Nursery has no links to Garden | `GARDEN_URL` isn't set on the Nursery site. Working as designed if you only run Nursery |

**Two things that catch almost everyone:**

- **Environment variables only take effect on the next build.** Setting one changes nothing until
  you redeploy.
- **Netlify environment variables are per site.** The Garden site and the Nursery site each need
  their own copy of the same six values.

## Where to go

| | |
|---|---|
| **Something is broken** | [Open an issue](../../issues/new/choose) |
| **A question, an idea, or "how do I…"** | [Start a discussion](../../discussions) |

Please use Discussions rather than Issues for questions — it keeps the issue list meaningful, and
answers stay findable for the next person.

## What to include in a bug report

Your installation is **your own** — your Firebase project, your Netlify sites, your data. None of it
is visible from here, so a report without detail can't be acted on. The issue template asks for what
matters; the important ones are:

1. **Which app** — Garden, Nursery, or both.
2. **Your role** — admin, editor, viewer, or signed out. A great many "it doesn't work" reports are
   permissions behaving exactly as designed.
3. **Whether you've done the Action required steps** in `CHANGELOG.md` for the version you're on.
4. **Anything in the browser console.** Press F12 → Console, reproduce the problem, copy what
   appears in red.

**Never paste your Firebase API key, and never paste a backup file.** The key isn't much of a secret
— it's readable from your own site's source — but a backup contains all your data.
