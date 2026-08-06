# Firestore data model

One Firebase project — `bbg-garden-inventory` — shared by both apps. **18 collections.** Garden owns
the first twelve; Nursery owns the six `nursery_*` ones and also reads and writes Garden's `plants`,
`instances` and `areas` when planting out.

Every collection listed here has a matching `match` block in
[`firebase/firestore.rules`](../firebase/firestore.rules). Verified 2026-08-06 — no gaps.

| Collection | Owner | Document shape (key fields) |
|---|---|---|
| `users` | shared | `role` (`viewer`\|`editor`\|`admin`), `blocked` — keyed by Firebase UID |
| `plants` | Garden | `commonName`, `genus`, `species`, `subspecies`, `variety`, `cultivar`, `authority`, `hybrid` (bool), `hybridType`, `family`, `height`, `width`, `notes`, `careReminders`, `dateAcquired`, `photoOrder[]`, `createdAt` |
| `areas` | Garden | `name`, `description`, `photoOrder[]`, `createdAt` |
| `instances` | Garden | `plantId`, `areaId`, `quantity`, `datePlanted`, `notes`, `createdAt` — a plant *in* an area |
| `photos` | Garden | photo metadata + ordering; Storage holds the files |
| `tasks` | Garden | `title`, `description`, `recurring` (bool), `recurrenceUnit`, `recurrenceInterval` |
| `taskAssignments` | Garden | `taskId`, `areaId` (or `GENERAL`), `status`, `dueDate`, `completedAt`, `notes` |
| `suggestions` | Garden | `text`, `done` (bool), `createdAt` |
| `irrigationZones` | Garden | irrigation zone definitions |
| `irrigationLogs` | Garden | watering events per zone, queryable by zone and by date range |
| `blogPosts` | Garden | `title`, `postDate` (YYYY-MM-DD), `contentDelta` (Quill JSON string), `contentHtml`, `tags[]`, `plantRefs[]` (`{plantId, name}`), `published` (bool), `createdAt`, `updatedAt` |
| `deceasedPlants` | Garden | `plantId`, `plantName`, `commonName`, `areaId`, `areaName`, `quantity`, `cause`, `notes`, `diedDate`, `createdAt` — one row per death event, per area |
| `nursery_batches` | Nursery | `plantName`/`plantId`, botanical fields, `method`, `stage`, `purpose`, `startDate`, `startQty`, `currentQty`, `qtyAdjustment`, `outcome`, `completedAt`, `locationId`, `sourceParentBatchId`, `createdAt`, `updatedAt` |
| `nursery_logs` | Nursery | `batchId`, `date`, `note`, `lossCount`, `lossReason`, `createdAt` |
| `nursery_outcomes` | Nursery | `batchId`, `date`, `type` (`planted-out`\|`given-away`\|`lost`\|`retired`), `quantity`, `areaId`/`areaName` or `recipientName`, `notes` |
| `nursery_locations` | Nursery | `name`, `type`, `createdAt` — propagation locations (bench, cold frame, …) |
| `nursery_wishlist` | Nursery | `priority` (`high`\|`medium`\|`low`), plus notes; sorted priority then newest |
| `nursery_plans` | Nursery | `method`, `timing` (season slug), `status` (`idea`\|`planned`\|`done`), `createdAt` |

## Enumerated values

Nursery's label constants live in `apps/nursery/js/db.js` and are the authoritative list:

```
stage:   propagating → rooted → potted-up → hardening-off → ready → completed   (STAGE_ORDER)
method:  seed · stem-cutting · hardwood-cutting · root-cutting · leaf-cutting ·
         division · layering-offset · grafting · acquired-potted                (METHOD_LABELS)
outcome: planted-out · given-away · lost · retired   (retired = kept as a stock plant)
loss:    damping-off · rot · dried-out · pest · cold · discarded · unknown · other
                                                                    (LOSS_REASON_LABELS)
plan:    method (PLAN_METHOD_LABELS) · timing (PLAN_TIMING_OPTIONS, 10 season slugs) ·
         status idea|planned|done (PLAN_STATUS_LABELS)
```

Garden's death causes are `DEATH_CAUSES` in `apps/garden/js/compost-view.js`.

## Firebase Storage layout

```
plant-photos/{plantId}/{filename}
area-photos/{areaId}/{filename}
blog-photos/{postId}/{filename}
```

Plus Nursery batch photos, written by `uploadNurseryPhoto()`.

Blog photo URLs are embedded directly in `blogPosts.contentHtml`, so deleting a Storage object
without editing the post leaves a broken image.

## Cross-app writes

Two functions cross the app boundary. Both are real surface area — changing either one affects the
other app's data:

| Function | Location | What it does |
|---|---|---|
| `plantOutToGarden()` | `apps/nursery/js/db.js` | Writes a `nursery_outcomes` row, creates a Garden `plants` doc if the batch has no `plantId`, then writes an `instances` row linking plant to area. Returns the resolved `plantId`. |
| `transferToNursery()` | `apps/garden/js/db.js` | Sends a Garden plant to Nursery as a new batch. `getNurseryLocations()` in the same file reads Nursery's locations so the form can offer a destination. |

## The rule that has bitten before

Any new collection added to either `db.js` needs a matching `match` block in
`firebase/firestore.rules` **in the same commit**. Firestore denies access to anything not
explicitly matched, and it fails *silently* in the app — no console error, just empty data.

In May 2026 `irrigationZones` and `irrigationLogs` were in `db.js` but missing from the rules, and
the Admin panel broke.
