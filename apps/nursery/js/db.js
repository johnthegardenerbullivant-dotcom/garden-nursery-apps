// =============================================================
//  db.js — All Firestore & Storage database operations
//  Nursery Management — shares ONE Firebase project with Garden Management
// =============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    getFirestore, initializeFirestore,
    persistentLocalCache, persistentMultipleTabManager,
    collection, doc,
    setDoc as fsSetDoc, updateDoc as fsUpdateDoc, deleteDoc as fsDeleteDoc,
    writeBatch,
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
import { isUncounted, uncountedQtyText } from './germination.js';

// ---------- Initialise Firebase ----------
let app, db, storage;

// =============================================
//  Offline: a cache on the device, and writes that queue
// =============================================
// Added 2026-11. Two things make the app usable with poor or no signal.
//
// 1. Firestore keeps its data in IndexedDB on the device (see initFirebase).
//    A read with no connection is answered from that copy, and a write made
//    with no connection is stored there and sent when the connection returns,
//    even if the app has been closed in between.
//
// 2. Every write in this file goes through queued(). Firestore's own write
//    promise does not settle until the SERVER has the write, so out of signal
//    an awaited save would leave its form on "Saving…" for as long as you stay
//    out of range. queued() waits a few seconds for the server and then lets
//    the caller carry on: the write is already safe in the local cache and is
//    in every read from that moment.
//
// The cost of (2): a write the server later REFUSES (the security rules) can no
// longer fail the form that made it once queued() has let go. That is announced
// with a 'write-failed' event instead, which ui-utils turns into a toast. When
// the server is reachable a refusal arrives well inside the wait, so the form
// still sees it as before.
//
// addDoc, setDoc, updateDoc and deleteDoc below shadow Firestore's own, which
// are imported under fs* names, so the rest of this file reads as it always
// did and cannot bypass the queue by accident.

const ACK_WAIT_MS         = 5000;  // online: how long to wait for the server
const ACK_WAIT_OFFLINE_MS = 300;   // browser already says we are offline

let unsynced = 0;                  // writes the server has not confirmed yet

function announceSync() {
    window.dispatchEvent(new CustomEvent('sync-state', { detail: { unsynced } }));
}

function queued(serverPromise) {
    unsynced++;
    announceSync();
    let acked = false, released = false;
    const settled = serverPromise.then(
        value => { acked = true; unsynced--; announceSync(); return value; },
        err   => {
            acked = true; unsynced--; announceSync();
            if (released) {
                console.error('A queued write was refused:', err);
                window.dispatchEvent(new CustomEvent('write-failed', { detail: err }));
            }
            throw err;
        }
    );
    return new Promise((resolve, reject) => {
        settled.then(resolve, err => { if (!released) reject(err); });
        setTimeout(() => {
            if (!acked) { released = true; resolve(undefined); }
        }, navigator.onLine ? ACK_WAIT_MS : ACK_WAIT_OFFLINE_MS);
    });
}

// addDoc must hand back the new document's reference straight away, so the id
// is made on the device (which is all Firestore's addDoc does) and written
// with setDoc.
function addDoc(collectionRef, data) {
    const ref = doc(collectionRef);
    forget(collectionRef.id);
    return queued(fsSetDoc(ref, data)).then(() => ref);
}
// Each also drops the remembered copy of the collection it writes to (see
// "Remembered collections" below). ref.parent.id is the collection's name.
const touched   = ref => { forget(ref.parent.id); return ref; };
const setDoc    = (ref, ...rest) => queued(fsSetDoc(touched(ref), ...rest));
const updateDoc = (ref, ...rest) => queued(fsUpdateDoc(touched(ref), ...rest));
const deleteDoc = (ref, ...rest) => queued(fsDeleteDoc(touched(ref), ...rest));

// Writes that belong together go to the server as one step: all of them
// happen, or none do. Without this, a connection dropped between two awaits
// left half a change behind, such as a death recorded with the plant still
// shown in its area. A batch queues offline exactly as a single write does,
// and counts as one change on the sync pill.
//
//     await commitTogether(b => { b.set(refA, dataA); b.delete(refB); });
function commitTogether(build) {
    const batch = writeBatch(db);
    build({
        set:    (ref, ...rest) => batch.set(touched(ref), ...rest),
        update: (ref, ...rest) => batch.update(touched(ref), ...rest),
        delete: ref            => batch.delete(touched(ref)),
    });
    return queued(batch.commit());
}

// Delete a list of documents together. Put a parent LAST: a list too long for
// one batch goes in several, and if it stops partway the parent is still
// there, so the delete can simply be run again.
const BATCH_MAX = 450;
async function deleteTogether(refs) {
    for (let i = 0; i < refs.length; i += BATCH_MAX) {
        const chunk = refs.slice(i, i + BATCH_MAX);
        await commitTogether(b => chunk.forEach(r => b.delete(r)));
    }
}

// =============================================
//  Remembered collections
// =============================================
// Added 2026-11. Every screen used to download whole collections again each
// time it drew, so tapping a filter chip on Tasks fetched five collections to
// re-filter what was already on the phone. A whole-collection read is now
// kept in memory and handed back until one of these happens:
//
//   - this app writes to that collection (the write functions above do it,
//     so a new write function needs nothing special);
//   - the app comes back to the foreground, or the connection returns;
//   - two minutes pass.
//
// The last two are for changes made somewhere else: the other app, or another
// person's phone. Until one of them happens such a change is not seen, which
// is the price of not asking the server on every tap.
//
// Only whole-collection reads are kept. A read of one document, or of one
// plant's or one batch's records, still asks Firestore each time: those are
// small, and several of them feed a calculation that is then written back.
//
// Callers get copies, so a view can sort or change what it is given.
const REMEMBER_MS = 2 * 60 * 1000;
const remembered  = new Map();     // collection name -> { at, list, promise }

function forget(...names) {
    if (names.length) names.forEach(n => remembered.delete(n));
    else remembered.clear();
}
const copies = list => list.map(item => ({ ...item }));
function current(name) {
    const entry = remembered.get(name);
    return entry && Date.now() - entry.at < REMEMBER_MS ? entry : null;
}
/** The whole collection, from memory if it is there, else from fetch(). */
async function whole(name, fetch) {
    let entry = current(name);
    if (!entry) {
        entry = { at: Date.now(), list: null };
        // A write that lands while this is in flight removes the entry, so the
        // answer goes to whoever is already waiting and is not kept.
        entry.promise = fetch().then(
            list => { entry.list = list; return list; },
            err  => { if (remembered.get(name) === entry) remembered.delete(name); throw err; }
        );
        remembered.set(name, entry);
    }
    return copies(await entry.promise);
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') forget();
});
window.addEventListener('online', () => forget());


export function initFirebase() {
    if (firebaseConfig.apiKey.startsWith('REPLACE_WITH')) return null;
    try {
        app     = initializeApp(firebaseConfig);
        // Keep the data on the device so the app works without signal. The
        // tab manager lets two tabs of the app share that one copy. A browser
        // that refuses IndexedDB (some private windows) falls back to the
        // in-memory cache the app used before: it works, online only.
        try {
            db = initializeFirestore(app, {
                localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
            });
        } catch (e) {
            console.warn('Offline cache unavailable, continuing online-only:', e);
            db = getFirestore(app);
        }
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

/**
 * escHtml, plus http(s) URLs turned into links that open in a new tab.
 * Added 2026-09-14 for notes and descriptions; Garden's db.js has the same
 * function. The text between URLs and each URL are escaped separately, so
 * the <a> is the only markup that can reach the page, and the pattern only
 * matches http and https — never javascript: or data:.
 */
export function linkify(str) {
    if (!str) return '';
    str = String(str);
    const re = /\bhttps?:\/\/[^\s<>"']+/gi;
    let out = '', last = 0, m;
    while ((m = re.exec(str))) {
        let url = m[0];
        // Trailing punctuation belongs to the sentence, not the URL — except
        // a ')' that closes a '(' inside it, as Wikipedia URLs have.
        while (/[.,;:!?)\]]$/.test(url)) {
            const opens  = (url.match(/\(/g) || []).length;
            const closes = (url.match(/\)/g) || []).length;
            if (url.endsWith(')') && opens >= closes) break;
            url = url.slice(0, -1);
        }
        out += escHtml(str.slice(last, m.index))
             + `<a class="text-link" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${escHtml(url)}</a>`;
        last = m.index + url.length;
        re.lastIndex = last;
    }
    return out + escHtml(str.slice(last));
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
export function getUsers() { return whole('users', fetchUsers); }
async function fetchUsers() {
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
    // The users list is a handful of documents and the Admin panel wants it
    // anyway, so this shares the one remembered read with getUsers().
    return (await getUsers()).filter(u => !u.role && !u.blocked).length;
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

export function getNurseryLocations() { return whole('nursery_locations', fetchNurseryLocations); }
async function fetchNurseryLocations() {
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

export function getNurseryBatches() { return whole('nursery_batches', fetchNurseryBatches); }
async function fetchNurseryBatches() {
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
    const outcomeSnap = await getDocs(
        query(collection(db, 'nursery_outcomes'), where('batchId', '==', id))
    );
    return await deleteTogether([
        ...logSnap.docs.map(d => d.ref),
        ...outcomeSnap.docs.map(d => d.ref),
        doc(db, 'nursery_batches', id),
    ]);
}

// =============================================
//  PROPAGATION LOGS  (nursery_logs)
// =============================================

export function getAllNurseryLogs() { return whole('nursery_logs', fetchAllNurseryLogs); }
async function fetchAllNurseryLogs() {
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
    if (isUncounted(batch)) return uncountedQtyText(batch);
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
    // A seed batch with no plant count yet has nothing to count down from, and
    // must not close itself as lost because startQty is empty (germination.js).
    if (isUncounted(batch)) return batch;

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

// When planting out, write a Garden Management plant record (if needed) and instance.
// The outcome, the plant and the instance go to the server as one step, so the
// Nursery cannot record a planting-out that Garden never received.
// `gardenPlantId` overrides the batch's link: a plant ID adds to that plant, null
// creates a new one. Left out, the batch's own link decides.
export async function plantOutToGarden(batchData, areaId, areaName, quantity, date, notes, { gardenPlantId } = {}) {
    // A link to a Garden plant that has since been deleted counts as no link.
    // Otherwise the instance below would point at nothing and never show in
    // Garden. Checked before anything is written, so a failed read writes nothing.
    let plantId = gardenPlantId !== undefined ? gardenPlantId : (batchData.plantId || null);
    if (plantId && !(await gardenPlantExists(plantId))) plantId = null;

    // No linked Garden plant (a gift or purchase, or the link was dead) — one
    // is created below. Its id is made here, on the device.
    const newPlantRef = plantId ? null : doc(collection(db, 'plants'));
    if (newPlantRef) plantId = newPlantRef.id;

    await commitTogether(b => {
        // The nursery outcome
        b.set(doc(collection(db, 'nursery_outcomes')), {
            batchId:   batchData.id,
            date,
            type:      'planted-out',
            quantity,
            areaId,
            areaName,
            notes,
            createdAt: serverTimestamp()
        });

        // The Garden Management plant record, if there was none
        if (newPlantRef) b.set(newPlantRef, {
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

        // The instance linking the plant to the area
        b.set(doc(collection(db, 'instances')), {
            plantId,
            areaId,
            quantity,
            datePlanted: date,
            notes:       `From nursery batch${notes ? ': ' + notes : ''}`,
            createdAt:   serverTimestamp()
        });
    });

    // Return the resolved plantId so the caller can store it back on the batch if it was newly created
    return plantId;
}

// =============================================
//  GARDEN MANAGEMENT cross-reference reads
// =============================================

/** Does this Garden plant still exist? A batch's plantId can outlive the plant,
 *  because Garden deletes plants without looking at nursery batches. Throws if
 *  the read fails, so callers can tell "gone" from "couldn't check". */
export async function gardenPlantExists(plantId) {
    if (!plantId) return false;
    const snap = await getDoc(doc(db, 'plants', plantId));
    return snap.exists();
}

/** Read the Garden Management plants list for the plant picker */
export function getGardenPlants() { return whole('plants', fetchGardenPlants); }
async function fetchGardenPlants() {
    const q = query(collection(db, 'plants'), orderBy('genus'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Read the Garden Management areas list for the "planted out" picker */
export function getGardenAreas() { return whole('areas', fetchGardenAreas); }
async function fetchGardenAreas() {
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

// 'pre-sowing' applies only to seed batches with a pre-sowing treatment
// (stratification, scarifying…) — see pretreatment.js. Views show it only
// where a batch is actually in it, so other batches keep a five-step pipeline.
export const STAGE_LABELS = {
    'pre-sowing':    'Pre-sowing',
    'propagating':   'Propagating',
    'rooted':        'Rooted',
    'potted-up':     'Potted up',
    'hardening-off': 'Hardening off',
    'ready':         'Ready',
    'completed':     'Completed'
};

export const STAGE_ORDER = [
    'pre-sowing', 'propagating', 'rooted', 'potted-up', 'hardening-off', 'ready', 'completed'
];

/**
 * A stage's label for one batch. Seed germinates rather than roots, so a seed
 * batch at 'rooted' reads "Germinated". Views that total batches of every
 * method (dashboard pills, stats pipeline) keep STAGE_LABELS.
 */
export function stageLabel(stage, method) {
    if (stage === 'rooted' && method === 'seed') return 'Germinated';
    return STAGE_LABELS[stage] || stage || '—';
}

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

export function getNurseryWishlist() { return whole('nursery_wishlist', fetchNurseryWishlist); }
async function fetchNurseryWishlist() {
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

export function getNurseryPlans() { return whole('nursery_plans', fetchNurseryPlans); }
async function fetchNurseryPlans() {
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
