# Label Scan → Auto-fill Batch Form

**Feature:** Photograph the front and back of a nursery label; a vision model reads it and pre-fills the New Batch form. Built for acquired (purchased / gifted) plants.

**Provider:** Google Gemini 3.5 Flash (free tier via Google AI Studio). *(Google retires models fast — 2.0 Flash shut down 1 Jun 2026, 2.5 Flash later closed to new users. The function uses `gemini-3.5-flash`; set `GEMINI_MODEL=gemini-flash-latest` in Netlify to auto-track the newest Flash and avoid future 404s.)*
**Deploy:** Drag-and-drop of the `Netlify Deploy` folder. The serverless function ships inside that folder.

---

## How it works

1. On the **New Propagation Batch** form a "📷 Scan a nursery label" card appears at the top (new batches only).
2. John captures the **front** and **back** of the label (camera or gallery). Images are compressed client-side (~1600px, JPEG) so the upload is small and fast.
3. The browser POSTs the two images (base64) to a Netlify function: `/.netlify/functions/scan-label`.
4. The function forwards them to Gemini with a strict prompt + JSON schema, so the model returns **only structured fields** and never invents data. The Gemini API key lives **only** on the server — never in the shipped JavaScript.
5. The returned fields pre-fill the form. Only empty fields are filled; anything John already typed is preserved. Filled fields flash green so he can review before saving.

Nothing auto-saves. The scan is a head-start; John always reviews and hits *Create batch* himself.

## What gets extracted, and where it lands

| Label information            | Form field                                  |
|------------------------------|---------------------------------------------|
| Botanical name (parsed)      | Genus, Species, Subspecies, Variety, Cultivar, Authority, Hybrid ✕ |
| Common name                  | Common name                                 |
| Full display name            | Plant name (the required field at the top)  |
| Plant description            | Description                                 |
| Sun, water, soil, hardiness, pruning | Care notes (combined)               |
| Ultimate height / spread     | Ultimate height / Ultimate spread           |
| Nursery / brand name         | Source → Supplier (source set to *Purchased*) |

Because these are bought/gifted plants, the scan also pre-selects **Method = Acquired (potted plant)**. John can change any of it.

The model is instructed to leave a field **blank** rather than guess. It uses only what is printed on the label, not outside plant knowledge.

## Files added / changed

```
Netlify Deploy/
  netlify.toml                 ← NEW: tells Netlify where the function lives
  functions/
    scan-label.js              ← NEW: serverless proxy to Gemini (key stays here)
  js/
    label-scan.js              ← NEW: capture UI, compression, fill logic
    batch-form.js              ← EDITED: injects the scan card + init call
  styles.css                   ← EDITED: styles for the scan card + fill highlight
```

No build step, no npm dependencies — the function uses Node's built-in `fetch`, so drag-and-drop deploy works unchanged.

---

## One-time Netlify setup (beyond your normal deploy)

You only do these **once**. After that, your normal drag-and-drop deploy carries the function automatically.

### 1. Get a free Gemini API key
- Go to **https://aistudio.google.com/apikey** (sign in with your Google account).
- Click **Create API key**. Copy it (starts with `AIza…`).
- Free tier: no credit card, generous daily limits — fine for label scanning.

### 2. Add the key to Netlify (as an environment variable, **not** in the code)
- Netlify dashboard → your Nursery site → **Site configuration → Environment variables**.
- **Add a variable**: key = `GEMINI_API_KEY`, value = the key you copied.
- Save.

### 3. Deploy as usual
- Drag the `Netlify Deploy` folder onto Netlify as you always do.
- The new `netlify.toml` + `functions/` folder inside it make Netlify publish the function automatically. You'll see it listed under **Functions** in the dashboard after deploy.

That's it. If you ever rotate the key, just update the environment variable — no redeploy of code needed for that.

### Checking it works
- Open the app → New batch → the scan card is at the top.
- Scan a label. If the key is missing you'll get a clear toast ("Server missing API key") rather than a silent failure.

## Cost & privacy notes
- Gemini free tier covers typical home-nursery use at no cost.
- Images are sent to Google only at the moment of a scan, solely to read the label; they are not stored by the app (the function holds nothing).
- The label photos used for scanning are **not** attached to the batch. If John wants the label kept as a batch photo, he adds it via the existing photo feature.
