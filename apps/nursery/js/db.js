// =============================================================
//  db.js — All Firestore & Storage database operations
//  Nursery Management — shares bbg-garden-inventory Firebase project
// =============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    getFirestore,
    collection, doc,
    addDoc, setDoc, updateDoc, deleteDoc,
    getDocs, getDoc,
    query, orderBy, where, limit,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    getStorage,
    ref, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import imageCompression from 'https://cdn.jsdelivr.net/npm/browser-image-compression@2/dist/browser-image-compression.mjs';

import { firebaseConfig } from '../firebase-config.js';

// ---------- Initialise Firebase ----------
let app, db, storage;

export function initFirebase() {
    if (firebaseConfig.apiKey.startsWith('REPLACE_WITH')) return null;
    try {
        app     = initializeApp(firebaseConfig);
        db      = getFirestore(app);
        storage = getStorage(app);
        return { app, db, storage };
    } catch (e) {
        console.error('Firebase init error:', e);
        return null;
    }
}

// =============================================
//  Shared helpers
// =============================================

/** Escape HTML special characters */
export function escHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// =============================================
//  USER MANAGEMENT  (admin panel)
// =============================================

/**
 * Fetch all user documents from Firestore.
 * Returns array of { uid, displayName, email, photoURL, provider,
 *                    role, status, blocked, lastLoginAt, createdAt }
 * Requires admin read access on the users collection (see firestore.rules).
 */
export async function getUsers() {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

/**
 * Grant a role to a user. Also clears the 'pending' status flag so
 * the user no longer appears in the pending list.
 * @param {string} uid  - Firebase Auth UID
 * @param {string} role - 'viewer' | 'editor' | 'admin'
 */
export async function updateUserRole(uid, role) {
    await updateDoc(doc(db, 'users', uid), {
        role,
        status:    'active',
        updatedAt: serverTimestamp(),
    });
}

/**
 * Block or unblock a user.  Blocked users see the access-denied screen on
 * their next sign-in (auth.js checks the flag in loadRole).
 * @param {string}  uid     - Firebase Auth UID
 * @param {boolean} blocked - true to block, false to unblock
 */
export async function setUserBlocked(uid, blocked) {
    await updateDoc(doc(db, 'users', uid), {
        blocked,
        updatedAt: serverTimestamp(),
    });
}

/**
 * Count users who have signed in but have not yet been granted a role.
 * Used to drive the pending-users badge on the Admin nav tab.
 */
export async function getPendingUserCount() {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.filter(d => {
        const data = d.data();
        return !data.role && !data.blocked;
    }).length;
}

/** Format a YYYY-MM-DD string as "14 May 26" */
export function fmtDate(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d} ${months[m - 1]} ${String(y).slice(2)}`;
}

/** Today as YYYY-MM-DD */
export function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/**
 * Effective hybrid type: 'interspecific' | 'intergeneric' | null.
 * Legacy records stored only a boolean `hybrid` — treat those as interspecific
 * (the common case; × before the species epithet).
 */
export function hybridTypeOf(o) {
    if (o && o.hybridType) return o.hybridType;
    return (o && o.hybrid) ? 'interspecific' : null;
}

/**
 * Plain-text botanical name built from parts, with the hybrid × placed per
 * botanical convention: intergeneric → ×Genus (no space); interspecific →
 * Genus × species. Works for a batch or a garden plant record (both store the
 * same part fields). Returns '' if there are no botanical parts.
 */
export function formatBotanicalName(o) {
    if (!o) return '';
    const ht = hybridTypeOf(o);
    const parts = [];
    if (o.genus)      parts.push(ht === 'intergeneric' ? '×' + o.genus : o.genus);
    if (ht === 'interspecific' && o.species) parts.push('×');
    if (o.species)    parts.push(o.species);
    if (o.subspecies) parts.push('subsp. ' + o.subspecies);
    if (o.variety)    parts.push('var. ' + o.variety);
    let s = parts.join(' ');
    if (o.cultivar)   s += (s ? ' ' : '') + `'${o.cultivar}'`;
    if (o.authority)  s += (s ? ' ' : '') + o.authority;
    return s.trim();
}

// =============================================
//  PROPAGATION LOCATIONS  (nursery_locations)
// =============================================

export async function getNurseryLocations() {
    const q = query(collection(db, 'nursery_locations'), orderBy('name'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getNurseryLocation(id) {
    const snap = await getDoc(doc(db, 'nursery_locations', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

export async function addNurseryLocation(data) {
    return await addDoc(collection(db, 'nursery_locations'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

export async function updateNurseryLocation(id, data) {
    return await updateDoc(doc(db, 'nursery_locations', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteNurseryLocation(id) {
    return await deleteDoc(doc(db, 'nursery_locations', id));
}

// =============================================
//  PROPAGATION BATCHES  (nursery_batches)
// =============================================

export async function getNurseryBatches() {
    const q = query(collection(db, 'nursery_batches'), orderBy('startDate', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getActiveBatches() {
    const q = query(
        collection(db, 'nursery_batches'),
        where('stage', '!=', 'completed'),
        orderBy('stage'),
        orderBy('startDate', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getNurseryBatch(id) {
    const snap = await getDoc(doc(db, 'nursery_batches', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

export async function addNurseryBatch(data) {
    return await addDoc(collection(db, 'nursery_batches'), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}

export async function updateNurseryBatch(id, data) {
    return await updateDoc(doc(db, 'nursery_batches', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteNurseryBatch(id) {
    // Also delete associated logs and outcomes
    const logSnap = await getDocs(
        query(collection(db, 'nursery_logs'), where('batchId', '==', id))
    );
    for (const d of logSnap.docs) await deleteDoc(d.ref);

    const outcomeSnap = await getDocs(
        query(collection(db, 'nursery_outcomes'), where('batchId', '==', id))
    );
    for (const d of outcomeSnap.docs) await deleteDoc(d.ref);

    return await deleteDoc(doc(db, 'nursery_batches', id));
}

// =============================================
//  PROPAGATION LOGS  (nursery_logs)
// =============================================

export async function getAllNurseryLogs() {
    const snap = await getDocs(collection(db, 'nursery_logs'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getLogsForBatch(batchId) {
    // No orderBy — avoids a composite index requirement.
    // Sort client-side: newest date first; same-day entries by createdAt desc.
    const q = query(
        collection(db, 'nursery_logs'),
        where('batchId', '==', batchId)
    );
    const snap = await getDocs(q);
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return logs.sort((a, b) => {
        if (b.date !== a.date) return b.date.localeCompare(a.date);
        // Firestore Timestamps have .seconds; fall back to string compare
        const aTs = a.createdAt?.seconds ?? 0;
        const bTs = b.createdAt?.seconds ?? 0;
        return bTs - aTs;
    });
}

export async function addNurseryLog(data) {
    return await addDoc(collection(db, 'nursery_logs'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

export async function updateNurseryLog(id, data) {
    return await updateDoc(doc(db, 'nursery_logs', id), data);
}

export async function deleteNurseryLog(id) {
    return await deleteDoc(doc(db, 'nursery_logs', id));
}

// =============================================
//  OUTCOMES  (nursery_outcomes)
// =============================================

export async function getOutcomesForBatch(batchId) {
    // No orderBy — avoids composite index requirement. Sort client-side.
    const q = query(
        collection(db, 'nursery_outcomes'),
        where('batchId', '==', batchId)
    );
    const snap = await getDocs(q);
    const outcomes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return outcomes.sort((a, b) => b.date.localeCompare(a.date));
}

export async function addNurseryOutcome(data) {
    return await addDoc(collection(db, 'nursery_outcomes'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

export async function updateNurseryOutcome(id, data) {
    await updateDoc(doc(db, 'nursery_outcomes', id), data);
}

export async function deleteNurseryOutcome(id) {
    await deleteDoc(doc(db, 'nursery_outcomes', id));
}

// =============================================
//  BATCH QUANTITY + COMPLETION (single source of truth)
// =============================================

/**
 * Human label for the batch quantity indicator.
 * All plants still alive → just the number (e.g. "25"); pass { noun:true } for
 * unlabelled card chips to get "25 plants" instead.
 * Otherwise → "X of Y left" (e.g. "2 of 25 left").
 */
export function formatBatchQty(batch, opts = {}) {
    const start = batch?.startQty ?? null;
    const cur   = batch?.currentQty ?? batch?.startQty ?? null;
    if (cur == null && start == null) return '—';
    if (start != null && cur === start) {
        return opts.noun ? `${cur} plant${cur === 1 ? '' : 's'}` : `${cur}`;
    }
    return `${cur ?? '—'} of ${start ?? '—'} left`;
}

/**
 * The remaining quantity a batch *should* have according to its records alone,
 * i.e. startQty minus every log loss and every recorded outcome — before any
 * manual correction. Not clamped, so callers can see an over-allocated batch.
 */
export function derivedBatchQty(batch, logs, outcomes) {
    const lost      = (logs     || []).reduce((sum, l) => sum + (l.lossCount || 0), 0);
    const allocated = (outcomes || []).reduce((sum, o) => sum + (o.quantity  || 0), 0);
    return (batch?.startQty || 0) - lost - allocated;
}

/**
 * Fetch a batch's logs and outcomes and return its derived remaining quantity
 * (see derivedBatchQty). Used by the batch form so it can show John what the
 * records say and convert a hand-typed figure into a qtyAdjustment.
 */
export async function getDerivedBatchQty(batch) {
    if (!batch?.id) return batch?.startQty || 0;
    const [logs, outcomes] = await Promise.all([
        getLogsForBatch(batch.id).catch(() => []),
        getOutcomesForBatch(batch.id).catch(() => []),
    ]);
    return derivedBatchQty(batch, logs, outcomes);
}

/**
 * Recompute a batch's remaining quantity from the source of truth
 * (startQty minus every log loss and every outcome quantity, plus any manual
 * `qtyAdjustment` correction) and apply the correct completion state, so a
 * batch completes when it hits 0 by ANY means — log losses, outcomes, a manual
 * correction, or a mix:
 *   • reaches 0  → stage 'completed', completedAt set, outcome derived
 *                  (the single outcome type, 'mixed', or 'lost' if the batch
 *                   emptied through losses with no recorded outcomes)
 *   • back above 0 while 'completed' → reopened to 'ready'
 * Stage is otherwise left untouched. Returns the merged batch object.
 *
 * `qtyAdjustment` is a signed correction saved when John edits the remaining
 * count by hand on the batch form. Keeping it as an offset (rather than writing
 * currentQty directly) means the correction survives every later log entry and
 * outcome, instead of being wiped by the next recompute.
 */
export async function recomputeBatchState(batchId, effectiveDate) {
    const batch = await getNurseryBatch(batchId);
    if (!batch) return null;

    const [logs, outcomes] = await Promise.all([
        getLogsForBatch(batchId),
        getOutcomesForBatch(batchId),
    ]);
    const startQty   = batch.startQty || 0;
    const adjustment = batch.qtyAdjustment || 0;
    const newQty     = Math.max(0, Math.min(
        startQty,
        derivedBatchQty(batch, logs, outcomes) + adjustment
    ));

    const updates = { currentQty: newQty };
    if (newQty === 0 && batch.stage !== 'completed') {
        const types = [...new Set(outcomes.map(o => o.type))];
        updates.stage       = 'completed';
        updates.completedAt = effectiveDate || todayStr();
        updates.outcome     = types.length === 0 ? 'lost'
                            : types.length === 1 ? types[0]
                            : 'mixed';
    } else if (newQty > 0 && batch.stage === 'completed') {
        updates.stage       = 'ready';
        updates.completedAt = null;
        updates.outcome     = null;
    }
    await updateNurseryBatch(batchId, updates);
    return { ...batch, ...updates };
}

/** Fetch all batches that were created from a given stock plant (by sourceParentBatchId). */
export async function getChildBatches(parentBatchId) {
    // Single-field where clause — no composite index needed.
    const q = query(
        collection(db, 'nursery_batches'),
        where('sourceParentBatchId', '==', parentBatchId)
    );
    const snap = await getDocs(q);
    const results = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return results.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
}

// When planting out, write a Garden Management plant record (if needed) and instance
export async function plantOutToGarden(batchData, areaId, areaName, quantity, date, notes) {
    // Write nursery outcome
    await addNurseryOutcome({
        batchId:   batchData.id,
        date,
        type:      'planted-out',
        quantity,
        areaId,
        areaName,
        notes
    });

    // Resolve or create the Garden Management plant record
    let plantId = batchData.plantId || null;
    if (!plantId) {
        // Batch has no linked Garden plant (e.g. received as gift/purchase) — create one now
        const plantRef = await addDoc(collection(db, 'plants'), {
            commonName:    batchData.commonName   || batchData.plantName || '',
            genus:         batchData.genus         || '',
            species:       batchData.species        || '',
            subspecies:    batchData.subspecies     || '',
            variety:       batchData.variety        || '',
            cultivar:      batchData.cultivar       || '',
            authority:     batchData.authority      || '',
            hybrid:        batchData.hybrid         || false,
            hybridType:    batchData.hybridType     || (batchData.hybrid ? 'interspecific' : null),
            height:        batchData.ultimateHeight || '',
            width:         batchData.ultimateWidth  || '',
            notes:         batchData.description    || '',
            careReminders: batchData.careNotes      || '',
            dateAcquired:  batchData.startDate      || '',
            photoOrder:    [],
            createdAt:     serverTimestamp(),
        });
        plantId = plantRef.id;
    }

    // Write the instance linking the plant to the area
    await addDoc(collection(db, 'instances'), {
        plantId,
        areaId,
        quantity,
        datePlanted: date,
        notes:       `From nursery batch${notes ? ': ' + notes : ''}`,
        createdAt:   serverTimestamp()
    });

    // Return the resolved plantId so the caller can store it back on the batch if it was newly created
    return plantId;
}

// =============================================
//  GARDEN MANAGEMENT cross-reference reads
// =============================================

/** Read the Garden Management plants list for the plant picker */
export async function getGardenPlants() {
    const q = query(collection(db, 'plants'), orderBy('genus'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Read the Garden Management areas list for the "planted out" picker */
export async function getGardenAreas() {
    const q = query(collection(db, 'areas'), orderBy('name'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// =============================================
//  PHOTOS  (nursery-photos/{batchId}/{filename})
// =============================================

const PHOTO_COMPRESS_OPTIONS = {
    maxSizeMB:           1,
    maxWidthOrHeight:    1600,
    useWebWorker:        true,
    fileType:            'image/jpeg',
    initialQuality:      0.82
};

export async function uploadNurseryPhoto(batchId, file, onProgress) {
    const compressed = await imageCompression(file, PHOTO_COMPRESS_OPTIONS);
    const filename   = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const storePath  = `nursery-photos/${batchId}/${filename}`;
    const storageRef = ref(storage, storePath);
    const task       = uploadBytesResumable(storageRef, compressed);

    return new Promise((resolve, reject) => {
        task.on('state_changed',
            snap => onProgress && onProgress(Math.round(snap.bytesTransferred / snap.totalBytes * 100)),
            reject,
            async () => {
                const url = await getDownloadURL(task.snapshot.ref);
                resolve({ filename, url, storePath });
            }
        );
    });
}

export async function deleteNurseryPhoto(storePath) {
    try {
        await deleteObject(ref(storage, storePath));
    } catch (e) {
        if (e.code !== 'storage/object-not-found') throw e;
    }
}

// =============================================
//  BACKUP / RESTORE
// =============================================

export async function exportNurseryData() {
    const [batches, logs, outcomes, locations, wishlist, plans] = await Promise.all([
        getDocs(collection(db, 'nursery_batches')),
        getDocs(collection(db, 'nursery_logs')),
        getDocs(collection(db, 'nursery_outcomes')),
        getDocs(collection(db, 'nursery_locations')),
        getDocs(collection(db, 'nursery_wishlist')),
        getDocs(collection(db, 'nursery_plans'))
    ]);

    return {
        exportedAt: new Date().toISOString(),
        version:    1,
        nursery_batches:   batches.docs.map(d => ({ id: d.id, ...d.data() })),
        nursery_logs:      logs.docs.map(d => ({ id: d.id, ...d.data() })),
        nursery_outcomes:  outcomes.docs.map(d => ({ id: d.id, ...d.data() })),
        nursery_locations: locations.docs.map(d => ({ id: d.id, ...d.data() })),
        nursery_wishlist:  wishlist.docs.map(d => ({ id: d.id, ...d.data() })),
        nursery_plans:     plans.docs.map(d => ({ id: d.id, ...d.data() }))
    };
}

// =============================================
//  LABEL HELPERS
// =============================================

export const METHOD_LABELS = {
    'seed':             'Seed',
    'stem-cutting':     'Stem cutting',
    'hardwood-cutting': 'Hardwood cutting',
    'root-cutting':     'Root cutting',
    'leaf-cutting':     'Leaf cutting',
    'division':         'Division',
    'layering-offset':  'Layering / offset',
    'grafting':         'Grafting',
    'acquired-potted':  'Acquired (potted plant)'
};

export const STAGE_LABELS = {
    'propagating':   'Propagating',
    'rooted':        'Rooted',
    'potted-up':     'Potted up',
    'hardening-off': 'Hardening off',
    'ready':         'Ready',
    'completed':     'Completed'
};

export const STAGE_ORDER = [
    'propagating', 'rooted', 'potted-up', 'hardening-off', 'ready', 'completed'
];

export const LOSS_REASON_LABELS = {
    'damping-off': 'Damping off',
    'rot':         'Rot',
    'dried-out':   'Dried out',
    'pest':        'Pest / disease',
    'cold':        'Cold damage',
    'discarded':   'Thinned / discarded',
    'unknown':     'Unknown',
    'other':       'Other'
};
// =============================================
//  WISHLIST / IDEAS  (nursery_wishlist)
// =============================================

export async function getNurseryWishlist() {
    const snap = await getDocs(collection(db, 'nursery_wishlist'));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort: by priority (high first), then createdAt desc
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return items.sort((a, b) => {
        const pa = priorityOrder[a.priority] ?? 1;
        const pb = priorityOrder[b.priority] ?? 1;
        if (pa !== pb) return pa - pb;
        const aTs = a.createdAt?.seconds ?? 0;
        const bTs = b.createdAt?.seconds ?? 0;
        return bTs - aTs;
    });
}

export async function addNurseryWishlistItem(data) {
    return await addDoc(collection(db, 'nursery_wishlist'), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}

export async function updateNurseryWishlistItem(id, data) {
    return await updateDoc(doc(db, 'nursery_wishlist', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteNurseryWishlistItem(id) {
    return await deleteDoc(doc(db, 'nursery_wishlist', id));
}

// =============================================
//  PROPAGATION PLANS  (nursery_plans)
// =============================================

export async function getNurseryPlans() {
    const snap = await getDocs(collection(db, 'nursery_plans'));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort: active ideas first (not done), then by createdAt desc
    return items.sort((a, b) => {
        const aTs = a.createdAt?.seconds ?? 0;
        const bTs = b.createdAt?.seconds ?? 0;
        if (a.status === 'done' && b.status !== 'done') return 1;
        if (a.status !== 'done' && b.status === 'done') return -1;
        return bTs - aTs;
    });
}

export async function addNurseryPlan(data) {
    return await addDoc(collection(db, 'nursery_plans'), {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });
}

export async function updateNurseryPlan(id, data) {
    return await updateDoc(doc(db, 'nursery_plans', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

export async function deleteNurseryPlan(id) {
    return await deleteDoc(doc(db, 'nursery_plans', id));
}

// =============================================
//  PLAN CONSTANTS
// =============================================

export const PLAN_METHOD_LABELS = {
    'softwood-cutting':   'Softwood cutting',
    'semi-ripe-cutting':  'Semi-ripe cutting',
    'ripe-cutting':       'Ripe cutting',
    'hardwood-cutting':   'Hardwood cutting',
    'leaf-cutting':       'Leaf cutting',
    'root-cutting':       'Root cutting',
    'division':           'Division',
    'layering':           'Layering / offset',
    'seed':               'Seed',
    'grafting':           'Grafting',
    'other':              'Other'
};

export const PLAN_TIMING_OPTIONS = [
    { value: 'early-spring',  label: 'Early spring',  season: 'Spring' },
    { value: 'mid-spring',    label: 'Mid spring',    season: 'Spring' },
    { value: 'late-spring',   label: 'Late spring',   season: 'Spring' },
    { value: 'early-summer',  label: 'Early summer',  season: 'Summer' },
    { value: 'mid-summer',    label: 'Mid summer',    season: 'Summer' },
    { value: 'late-summer',   label: 'Late summer',   season: 'Summer' },
    { value: 'early-autumn',  label: 'Early autumn',  season: 'Autumn' },
    { value: 'mid-autumn',    label: 'Mid autumn',    season: 'Autumn' },
    { value: 'late-autumn',   label: 'Late autumn',   season: 'Autumn' },
    { value: 'winter',        label: 'Winter',        season: 'Winter' }
];

export const PLAN_STATUS_LABELS = {
    'idea':    'Idea',
    'planned': 'Planned',
    'done':    'Done'
};
