# CLAUDE.md — Garden Management (`apps/garden`)

Garden-specific module map and conventions. Shared architecture, the Firestore data model, the role
system and the deploy workflow are in the [root `CLAUDE.md`](../../CLAUDE.md) — read that first.

---

## Snapshot

- **What it is:** a PWA for managing a personal garden — plant collection, areas, tasks, irrigation,
  a public blog/journal, and a "compost bin" log of plants that didn't make it
- **Version:** v2.0 (blog/journal), plus the July–August 2026 label-scan, hybrid-nomenclature and
  date/quantity work
- **Live URL:** https://johnandkath.garden/
- **This folder is both the Netlify base directory and the publish directory.**

### Netlify settings

| Setting | Value |
|---|---|
| Base directory | `apps/garden` |
| Build command | *(empty)* |
| Publish directory | `apps/garden` (or `.` relative to base) |
| Functions directory | `apps/garden/functions` (also set in `netlify.toml`) |

Environment variables on the Garden site:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio key for the label-scan function. Set and verified working. |
| `GEMINI_MODEL` | Optional; defaults to `gemini-flash-latest` |
| `GEMINI_MODEL_RESEARCH` | Not set — research runs on full Flash since the 30s timeout increase. Only needed if that is ever lost. |
| `LOOKUP_BUDGET_MS` | `27000`, just inside Netlify's 30s function timeout. Code default is 8500. |
| `SECRETS_SCAN_OMIT_PATHS` | `firebase-config.js` — stops the secret scanner failing the build |

---

## Files

```
apps/garden/
├── index.html               ← single-page app shell; loads Quill 1.3.7 from CDN
├── styles.css               ← all CSS (~93 KB)
├── firebase-config.js       ← real credentials
├── manifest.json  sw.js     ← PWA manifest + service worker (offline caching)
├── robots.txt  _headers     ← Netlify config
├── netlify.toml             ← functions directory + esbuild bundler
├── compress-photos.html     ← standalone utility, not part of the SPA (see below)
├── icons/                   ← favicon-32, icon-192, icon-512
├── functions/               ← 2 Netlify serverless functions, both calling Gemini
│   ├── scan-label.js        ← reads a printed plant label from photos
│   └── lookup-plant.js      ← researches a plant from its name, with web search
└── js/                      ← 15 ES modules
```

`compress-photos.html` is a self-contained one-off page that re-compresses existing photos in
Firebase Storage. It carries its own inline Firebase imports and is not reachable from the app's
navigation. It ships with the site but nothing in `js/` depends on it.

---

## JS module map (15 modules)

| File | Responsibility | Key exports |
|---|---|---|
| `main.js` | Entry point: router, auth state listener, nav wiring | *(no exports — entry point)* |
| `db.js` | Every Firestore + Storage read/write. ~1030 lines, the biggest module. | `initFirebase`, `getPlants`/`addPlant`/`updatePlant`/`deletePlant`, `getAreas`/`addArea`/…, `getInstances*`/`addInstance`/…, `getDeceasedPlants`, `recordPlantDeath`, `transferToNursery`, `getNurseryLocations`, `getTasks`/`addTask`/…, `getTaskAssignments*`/…, photo helpers (`uploadPhoto`, `getPhotosForPlant`, `updatePhotoOrders`, `uploadAreaPhoto`, …), `getIrrigationZones`/`addIrrigationZone`/…, `getIrrigationLogs*`/…, `getSuggestions`/…, `nextOccurrenceDate`, `firstOccurrenceFromToday`, `createNextRecurringOccurrence`, `getBlogPosts`/`saveBlogPost`/`uploadBlogPhoto`/…, `exportAllData`, `importAllData`, `clearAllData`, `getDataCounts`, `formatBotanicalName`, `hybridTypeOf`, `getUsers`, `updateUserRole`, `setUserBlocked`, `getPendingUserCount`, `escHtml` |
| `auth.js` | Auth state, role cache, sign-in helpers. **Byte-identical to Nursery's — see `tools/check-drift.mjs`.** | `initAuth`, `getAuthInstance`, `getCurrentUser`, `getCurrentRole`, `isAtLeast`, `loadRole`, `setCurrentUser`, `setRole`, `signInWithGoogle`, `signInWithEmail`, `signInAsGuest`, `signOutUser` |
| `ui-utils.js` | Modal, toast, carousel, drag-sort, date picker | `navigate`, `goBack`, `showModal`, `hideModal`, `showToast`, `initPhotoCarousel`, `initPhotoDragSort`, `datePicker`, `initDatePickers` |
| `auth-view.js` | Login / access-denied overlay | `showLoginOverlay`, `hideLoginOverlay`, `showAccessDenied` |
| `garden-view.js` | Overview dashboard | `renderGardenView` |
| `plants-view.js` | Plants list, plant detail, plant form | `renderPlantsList`, `renderPlantDetail`, `clearPlantSearch`, `showPlantForm`, `showAddPlantToAreaModal` |
| `areas-view.js` | Areas list, area detail (plants / tasks / gallery tabs) | `renderAreasList`, `renderAreaDetail`, `showAreaForm` |
| `tasks-view.js` | Tasks: recurring, by-area, by-status | `renderTasksView`, `renderAreaTasksSection`, `buildTaskRow`, `attachTaskHandlers`, `showTaskForm`, `showAssignExistingTaskModal`, `updateNavBadge`, `GENERAL_AREA_ID` |
| `irrigation-view.js` | Irrigation zones and watering logs (~74 KB, the largest view) | `renderIrrigationView`, `getIrrigationBannerInfo` |
| `blog-view.js` | Blog/Journal list, post reader, admin editor (Quill) | `renderBlogList`, `renderBlogPost`, `renderBlogEditor` |
| `compost-view.js` | Compost Bin: deceased-plant log, grouped by month | `renderCompostView`, `DEATH_CAUSES`, `causeMeta` |
| `label-scan.js` | Client half of the Gemini label scan; compresses images and POSTs to the function. **Near-identical to Nursery's.** | `scanPanelHTML`, `focusScanCard`, `initLabelScan` |
| `plant-lookup.js` | Client half of the AI plant lookup. Offers the two tracks, previews the result, appends to Notes on request. **Byte-identical to Nursery's** — field IDs are passed in. | `lookupPanelHTML`, `initPlantLookup` |
| `admin-view.js` | Admin panel: backup/restore, import, stats, user roles, irrigation shortcut | `renderAdminView` |

**Navigation (bottom bar, 6 tabs):** Tasks · Areas · Plants · Overview · Blog · Admin.
Irrigation is reached via the Admin panel shortcut, not its own tab.

---

## Garden-specific notes

**Label scanning.** `js/label-scan.js` compresses two photos client-side
(`browser-image-compression`) and POSTs them as base64 to `/.netlify/functions/scan-label`, which
calls Gemini with `GEMINI_API_KEY` and returns parsed plant details. The function is
byte-identical to Nursery's copy — change one, run `check-drift.mjs`. **Nursery's is the original:**
the scan was trialled there first and then ported here. Spec:
[`docs/label-scan-spec.md`](../../docs/label-scan-spec.md).

**Plant lookup.** `js/plant-lookup.js` researches a plant from the botanical name in the form and
offers the result for Notes; nothing reaches the form until the button is pressed. Two tracks, two
phases, and a set of anti-fabrication rules that are the point of the feature. Read
[`docs/plant-lookup.md`](../../docs/plant-lookup.md) before changing the prompts, and note the
settings recorded there for the 30-second function timeout granted 2026-08-18.

**Transfer to Nursery.** `transferToNursery()` in `db.js` sends a Garden plant to Nursery as a new
batch, and `getNurseryLocations()` reads Nursery's `nursery_locations` so the form can offer a
destination. This is the Garden→Nursery direction; Nursery's `plantOutToGarden()` is the return leg.

**Botanical naming.** `formatBotanicalName()` and `hybridTypeOf()` implement the hybrid nomenclature
rules. The `plants` doc carries the full set — `genus`, `species`, `subspecies`, `variety`,
`cultivar`, `authority`, `hybrid`, `hybridType` — not just genus/species/cultivar.

**Blog is the only Quill consumer.** Posts store both `contentDelta` (Quill's JSON) and
`contentHtml` (rendered, with Storage photo URLs inlined). Keep both in sync when editing
programmatically.

**UX notes and improvement ideas:** [`docs/ux-review.md`](../../docs/ux-review.md).
