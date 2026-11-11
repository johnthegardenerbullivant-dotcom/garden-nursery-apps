// =============================================================
//  db.js — All Firestore & Storage database operations
// =============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
    getFirestore, initializeFirestore,
    persistentLocalCache, persistentMultipleTabManager,
    collection, doc,
    setDoc as fsSetDoc, updateDoc as fsUpdateDoc, deleteDoc as fsDeleteDoc,
    writeBatch,
    getDocs, getDoc, getCountFromServer,
    query, orderBy, where, limit,
    serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
    getStorage,
    ref, uploadBytesResumable, getDownloadURL, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import imageCompression from 'https://cdn.jsdelivr.net/npm/browser-image-compression@2/dist/browser-image-compression.mjs';

import { firebaseConfig } from '../firebase-config.js';
import {
    TAG_CODE_ALPHABET, TAG_CODE_LENGTH, isTagCode, nextOccurrenceDate, firstOccurrenceFromToday,
    formatBotanicalName, hybridTypeOf, plainPlantName, escHtml, linkify,
    fmtDate, fmtDateLong, todayStr, isOverdue
} from './garden-logic.js';
// The pure helpers live in garden-logic.js so Node can test them; they are
// re-exported here so every view still imports from './db.js'.
export {
    isTagCode, nextOccurrenceDate, firstOccurrenceFromToday,
    formatBotanicalName, hybridTypeOf, plainPlantName, escHtml, linkify,
    fmtDate, fmtDateLong, todayStr, isOverdue
};

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
/** The collection if it is already in memory, else null. Never fetches. */
function held(name) {
    const entry = current(name);
    return entry && entry.list ? copies(entry.list) : null;
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') forget();
});
window.addEventListener('online', () => forget());

/** How many documents a query matches, without downloading them. The server
 *  has to answer this, so offline it falls back to counting the device's copy. */
async function countOf(q) {
    try {
        return (await getCountFromServer(q)).data().count;
    } catch (_) {
        return (await getDocs(q)).size;
    }
}

/**
 * Initialise Firebase.
 * Returns { app, db, storage } on success, or null if config is not filled in.
 * main.js passes app + db to auth.js via initAuth().
 */
export function initFirebase() {
    // Check if the config has been filled in
    if (firebaseConfig.apiKey.startsWith('REPLACE_WITH')) {
        return null; // Not configured yet
    }
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
//  PLANTS
// =============================================

/** Fetch all plants, ordered by genus (secondary sort done in JS to avoid index requirements) */
export function getPlants() { return whole('plants', fetchPlants); }
async function fetchPlants() {
    const q = query(collection(db, 'plants'), orderBy('genus'));
    const snap = await getDocs(q);
    const plants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort by genus → species → cultivar → commonName in JS — no composite index needed
    return plants.sort((a, b) => {
        const g = (a.genus    || '').localeCompare(b.genus    || ''); if (g !== 0) return g;
        const s = (a.species  || '').localeCompare(b.species  || ''); if (s !== 0) return s;
        const c = (a.cultivar || '').localeCompare(b.cultivar || ''); if (c !== 0) return c;
        return   (a.commonName|| '').localeCompare(b.commonName|| '');
    });
}

/** Fetch a single plant by ID */
export async function getPlant(id) {
    const snap = await getDoc(doc(db, 'plants', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

/** Add a new plant */
export async function addPlant(data) {
    return await addDoc(collection(db, 'plants'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

/** Update an existing plant */
export async function updatePlant(id, data) {
    return await updateDoc(doc(db, 'plants', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

// =============================================
//  Plant tag codes
// =============================================
// A printed tag carries a QR code, and what it encodes is a SHORT code rather
// than the plant's 20-character Firestore ID. That is not cosmetic: it is what
// lets the code fit a label printer's tape.
//
// The encoder picks QR's alphanumeric mode when every character is upper case,
// which is denser than byte mode. Host + '/P/' + a six-character code stays
// inside a 29-module version-3 symbol, and 29 modules plus the four-module
// quiet zone each side is 37 across — exactly three printer dots per module on
// an 18 mm tape's 112 usable pins. Two dots per module is the difference
// between a tag that scans covered in mud and one that does not.
//
// Crockford's Base32 alphabet: no I, L, O or U, so nothing on a printed tag
// can be misread as something else, and every character is legal in QR
// alphanumeric mode. See docs/plant-tags.md.


function randomTagCode() {
    const bytes = new Uint8Array(TAG_CODE_LENGTH);
    crypto.getRandomValues(bytes);
    // Modulo bias is irrelevant here: the alphabet is 32 long and divides 256
    // exactly, so every character is uniformly distributed.
    return [...bytes].map(b => TAG_CODE_ALPHABET[b % TAG_CODE_ALPHABET.length]).join('');
}

/** The plant a printed tag's code belongs to, or null if nothing matches. */
export async function getPlantByTagCode(code) {
    const snap = await getDocs(query(
        collection(db, 'plants'),
        where('tagCode', '==', String(code).toUpperCase()),
        limit(1)
    ));
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() };
}

/**
 * The plant's tag code, minting and saving one the first time it is needed.
 *
 * Lazy on purpose: existing plants get a code when someone first prints a tag
 * for them, so adding this feature needs no migration over the collection.
 * Writing requires editor, which every path that prints a tag already does.
 *
 * Collisions are checked rather than assumed. 32^6 is a billion codes, so a
 * retry is close to unheard of, but a duplicate would silently point two tags
 * at one plant and that is not a failure worth leaving to probability.
 */
export async function ensureTagCode(plant) {
    if (plant.tagCode) return plant.tagCode;

    let code = null;
    for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = randomTagCode();
        if (!(await getPlantByTagCode(candidate))) { code = candidate; break; }
    }
    if (!code) throw new Error('Could not allocate a unique plant tag code');

    await updatePlant(plant.id, { tagCode: code });
    plant.tagCode = code;               // keep the caller's copy in step
    return code;
}

/** Delete a plant and all its instances and photos */
export async function deletePlant(id) {
    // Find the instances and photos first
    const instancesSnap = await getDocs(
        query(collection(db, 'instances'), where('plantId', '==', id))
    );
    const photosSnap = await getDocs(
        query(collection(db, 'photos'), where('plantId', '==', id))
    );
    // The records go together, the plant last.
    await deleteTogether([
        ...instancesSnap.docs.map(d => d.ref),
        ...photosSnap.docs.map(d => d.ref),
        doc(db, 'plants', id),
    ]);
    // Then the photo files. Storage has no offline queue and cannot join a
    // batch, so these are not waited for: a file that cannot be removed now is
    // left behind in Storage, where nothing points at it any more.
    for (const d of photosSnap.docs) {
        const path = d.data().storagePath;
        if (path) deleteObject(ref(storage, path)).catch(() => { /* already gone, or offline */ });
    }
}

/** How many Nursery batches link to a plant, for the delete warning. Deleting
 *  the plant leaves them alone: each keeps the name and details stored on it,
 *  and Nursery treats the dead link as no link. */
export async function countNurseryBatchesForPlant(plantId) {
    return countOf(query(collection(db, 'nursery_batches'), where('plantId', '==', plantId)));
}

// =============================================
//  AREAS
// =============================================

/** Fetch all areas */
export function getAreas() { return whole('areas', fetchAreas); }
async function fetchAreas() {
    const q = query(collection(db, 'areas'), orderBy('name'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Fetch a single area */
export async function getArea(id) {
    const snap = await getDoc(doc(db, 'areas', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

/** Add a new area */
export async function addArea(data) {
    return await addDoc(collection(db, 'areas'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

/** Update an area */
export async function updateArea(id, data) {
    return await updateDoc(doc(db, 'areas', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

/** Delete an area, its instances, and its task assignments */
export async function deleteArea(id) {
    const instancesSnap = await getDocs(
        query(collection(db, 'instances'), where('areaId', '==', id))
    );
    // Also remove any task assignments scoped to this area
    const assignmentsSnap = await getDocs(
        query(collection(db, 'taskAssignments'), where('areaId', '==', id))
    );
    await deleteTogether([
        ...instancesSnap.docs.map(d => d.ref),
        ...assignmentsSnap.docs.map(d => d.ref),
        doc(db, 'areas', id),
    ]);
}

// =============================================
//  INSTANCES  (plant ↔ area associations)
// =============================================

/** Get all instances */
export function getInstances() { return whole('instances', fetchInstances); }
async function fetchInstances() {
    const snap = await getDocs(collection(db, 'instances'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get instances for a specific plant */
export async function getInstancesForPlant(plantId) {
    const q = query(collection(db, 'instances'), where('plantId', '==', plantId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get instances in a specific area */
export async function getInstancesInArea(areaId) {
    const q = query(collection(db, 'instances'), where('areaId', '==', areaId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Add a plant instance to an area */
export async function addInstance(data) {
    return await addDoc(collection(db, 'instances'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

/** Update an instance */
export async function updateInstance(id, data) {
    return await updateDoc(doc(db, 'instances', id), data);
}

/** Remove an instance */
export async function deleteInstance(id) {
    await deleteDoc(doc(db, 'instances', id));
}

// =============================================
//  DECEASED PLANTS  (Compost Bin)
// =============================================
//  Each document logs a single death event — a quantity of one plant that
//  died in one area. Records keep name snapshots (plantName, commonName,
//  areaName) so they remain readable even if the plant or area is later
//  edited or deleted. Death is per-area: a plant can be composted in one
//  area while still alive in another.

/** Get all deceased records, newest death first (sorted in JS — no index needed) */
export function getDeceasedPlants() { return whole('deceasedPlants', fetchDeceasedPlants); }
async function fetchDeceasedPlants() {
    const snap = await getDocs(collection(db, 'deceasedPlants'));
    const recs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return recs.sort((a, b) => (b.diedDate || '').localeCompare(a.diedDate || ''));
}

/** Get deceased records for a specific plant */
export async function getDeceasedForPlant(plantId) {
    const q = query(collection(db, 'deceasedPlants'), where('plantId', '==', plantId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Record a plant death. Creates a deceasedPlants document and adjusts the
 * source instance in one step: if the whole quantity died the instance is
 * removed, otherwise its quantity is reduced by the number that died.
 *
 * @param {object} record   { plantId, plantName, commonName, areaId, areaName,
 *                            quantity, cause, notes, diedDate }
 * @param {object} instance { id, quantity } — the location the death came from
 */
export async function recordPlantDeath(record, instance) {
    await commitTogether(b => {
        b.set(doc(collection(db, 'deceasedPlants')), {
            ...record,
            createdAt: serverTimestamp()
        });
        if (instance && instance.id) {
            const had  = instance.quantity || 1;
            const died = record.quantity   || 1;
            const instanceRef = doc(db, 'instances', instance.id);
            if (died >= had) b.delete(instanceRef);
            else             b.update(instanceRef, { quantity: had - died });
        }
    });
}

/** Delete a deceased record (removes the Compost Bin entry — does not replant) */
export async function deleteDeceasedRecord(id) {
    await deleteDoc(doc(db, 'deceasedPlants', id));
}

// =============================================
//  TRANSFER TO NURSERY  (writes a nursery_batches doc)
//  Same Firebase project as Nursery Management — the shared firestore.rules
//  already cover nursery_batches / nursery_locations, so no rules change.
// =============================================

/** Read the Nursery Management locations list (for the transfer location picker).
 *  No orderBy — sort client-side to avoid a composite index requirement. */
export function getNurseryLocations() { return whole('nursery_locations', fetchNurseryLocations); }
async function fetchNurseryLocations() {
    const snap = await getDocs(collection(db, 'nursery_locations'));
    return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/**
 * Transfer plants from the garden into the Nursery Management app.
 * Writes a new nursery_batches document (shape compatible with the Nursery
 * schema) and reduces / removes the source garden instance by the quantity
 * moved, in one step (mirrors recordPlantDeath). `instance` is { id, quantity }.
 * Returns the new batch DocumentReference.
 */
export async function transferToNursery(batchData, instance) {
    const batchRef = doc(collection(db, 'nursery_batches'));
    await commitTogether(b => {
        b.set(batchRef, {
            ...batchData,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        if (instance && instance.id) {
            const had   = instance.quantity || 1;
            const moved = batchData.startQty || 1;
            const instanceRef = doc(db, 'instances', instance.id);
            if (moved >= had) b.delete(instanceRef);
            else              b.update(instanceRef, { quantity: had - moved });
        }
    });
    return batchRef;
}

// =============================================
//  TASKS
// =============================================

/** Fetch all tasks, ordered by title */
export function getTasks() { return whole('tasks', fetchTasks); }
async function fetchTasks() {
    const q = query(collection(db, 'tasks'), orderBy('title'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Fetch a single task by ID */
export async function getTask(id) {
    const snap = await getDoc(doc(db, 'tasks', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

/** Add a new task */
export async function addTask(data) {
    return await addDoc(collection(db, 'tasks'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

/** Update an existing task */
export async function updateTask(id, data) {
    return await updateDoc(doc(db, 'tasks', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

/** Delete a task and all its area assignments */
export async function deleteTask(id) {
    const assignmentsSnap = await getDocs(
        query(collection(db, 'taskAssignments'), where('taskId', '==', id))
    );
    await deleteTogether([...assignmentsSnap.docs.map(d => d.ref), doc(db, 'tasks', id)]);
}

// =============================================
//  TASK ASSIGNMENTS  (task ↔ area pairings)
// =============================================

/** Get all task assignments */
export function getTaskAssignments() { return whole('taskAssignments', fetchTaskAssignments); }
async function fetchTaskAssignments() {
    const snap = await getDocs(collection(db, 'taskAssignments'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get assignments for a specific task */
export async function getTaskAssignmentsForTask(taskId) {
    const q = query(collection(db, 'taskAssignments'), where('taskId', '==', taskId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Get assignments for a specific area (including '__general__') */
export async function getTaskAssignmentsForArea(areaId) {
    const q = query(collection(db, 'taskAssignments'), where('areaId', '==', areaId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Add a task assignment */
export async function addTaskAssignment(data) {
    return await addDoc(collection(db, 'taskAssignments'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

/** Update a task assignment */
export async function updateTaskAssignment(id, data) {
    return await updateDoc(doc(db, 'taskAssignments', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

/** Remove a single task assignment */
export async function deleteTaskAssignment(id) {
    await deleteDoc(doc(db, 'taskAssignments', id));
}

/** Remove all task assignments for a given area (used when deleting an area) */
export async function deleteTaskAssignmentsForArea(areaId) {
    const snap = await getDocs(
        query(collection(db, 'taskAssignments'), where('areaId', '==', areaId))
    );
    await deleteTogether(snap.docs.map(d => d.ref));
}

// =============================================
//  PHOTOS
// =============================================

/**
 * Compress an image file if it exceeds 500 KB.
 * Returns the original file unchanged if it is already small enough.
 */
async function compressImage(file) {
    const MAX_SIZE_BYTES = 500 * 1024; // 500 KB
    if (file.size <= MAX_SIZE_BYTES) return file;
    return imageCompression(file, {
        maxSizeMB:        0.5,
        maxWidthOrHeight: 1920,
        useWebWorker:     true,
    });
}

/** Get all photos for a plant (sorted by explicit order field, then createdAt) */
export async function getPhotosForPlant(plantId) {
    const q = query(
        collection(db, 'photos'),
        where('plantId', '==', plantId)
    );
    const snap = await getDocs(q);
    const photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return photos.sort((a, b) => {
        const oa = a.order ?? Infinity, ob = b.order ?? Infinity;
        if (oa !== ob) return oa - ob;
        return (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0);
    });
}

/**
 * Upload a photo file and save its metadata.
 * Compresses the image to ≤500 KB / 1920 px before uploading if needed.
 * Returns a promise that resolves with the photo document ID.
 * Calls onProgress(pct) with upload % (0–100).
 */
/**
 * Compress a picture and put it in Storage under <folder>/<ownerId>/.
 * Resolves with { url, path }. The three upload functions below differ only
 * in the folder and in what record, if any, they write afterwards.
 */
async function uploadToStorage(folder, ownerId, file, onProgress) {
    const fileToUpload = await compressImage(file);
    const ext      = file.name.split('.').pop();
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const path     = `${folder}/${ownerId}/${filename}`;
    const task     = uploadBytesResumable(ref(storage, path), fileToUpload);
    await new Promise((resolve, reject) => task.on('state_changed',
        snap => { if (onProgress) onProgress((snap.bytesTransferred / snap.totalBytes) * 100); },
        reject,
        resolve
    ));
    return { url: await getDownloadURL(task.snapshot.ref), path };
}

/** Upload a plant photo and record it. Resolves with the photo record's id. */
export async function uploadPhoto(plantId, file, onProgress) {
    const { url, path } = await uploadToStorage('plant-photos', plantId, file, onProgress);
    const docRef = await addDoc(collection(db, 'photos'), {
        plantId,
        url,
        storagePath: path,
        filename: file.name,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

/**
 * Return the first (lowest-order / oldest) photo for each of the given plantIds.
 * Result is a map { plantId → photoData }. Uses 'in' queries chunked to 30 ids each.
 */
export async function getFirstPhotoForPlants(plantIds) {
    if (!plantIds.length) return {};
    const CHUNK = 30;
    const map   = {};
    const consider = data => {
        const pid    = data.plantId;
        const curr   = map[pid];
        const dOrder = data.order ?? Infinity;
        const cOrder = curr?.order ?? Infinity;
        if (!curr || dOrder < cOrder ||
            (dOrder === cOrder &&
             (data.createdAt?.toMillis?.() ?? 0) < (curr.createdAt?.toMillis?.() ?? 0))) {
            map[pid] = data;
        }
    };
    // If the Plants list has already brought every photo record down, pick
    // from those rather than asking again in chunks of 30.
    const all = held('photos');
    if (all) {
        const wanted = new Set(plantIds);
        all.forEach(p => { if (wanted.has(p.plantId)) consider(p); });
        return map;
    }
    for (let i = 0; i < plantIds.length; i += CHUNK) {
        const chunk = plantIds.slice(i, i + CHUNK);
        const q     = query(collection(db, 'photos'), where('plantId', 'in', chunk));
        const snap  = await getDocs(q);
        snap.docs.forEach(d => consider({ id: d.id, ...d.data() }));
    }
    return map;
}

/** Return a Set of plantIds that have at least one photo */
export async function getPlantIdsWithPhotos() {
    const photos = await whole('photos', async () => {
        const snap = await getDocs(collection(db, 'photos'));
        return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    });
    const ids = new Set();
    photos.forEach(p => { if (p.plantId) ids.add(p.plantId); });
    return ids;
}

/** Delete a photo from Storage and Firestore */
export async function deletePhoto(photoId, storagePath) {
    try {
        const storageRef = ref(storage, storagePath);
        await deleteObject(storageRef);
    } catch (_) { /* already gone */ }
    await deleteDoc(doc(db, 'photos', photoId));
}

/** Get all photos for an area (sorted by explicit order field, then createdAt) */
export async function getPhotosForArea(areaId) {
    const q = query(
        collection(db, 'photos'),
        where('areaId', '==', areaId)
    );
    const snap = await getDocs(q);
    const photos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return photos.sort((a, b) => {
        const oa = a.order ?? Infinity, ob = b.order ?? Infinity;
        if (oa !== ob) return oa - ob;
        return (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0);
    });
}

/** Persist a new display order for a set of photos */
export async function updatePhotoOrders(orderedIds) {
    if (!orderedIds.length) return;
    await commitTogether(b => {
        orderedIds.forEach((id, idx) => b.update(doc(db, 'photos', id), { order: idx }));
    });
}

/**
 * Upload a photo for an area (stored under area-photos/{areaId}/).
 * Compresses the image to ≤500 KB / 1920 px before uploading if needed.
 */
export async function uploadAreaPhoto(areaId, file, onProgress) {
    const { url, path } = await uploadToStorage('area-photos', areaId, file, onProgress);
    const docRef = await addDoc(collection(db, 'photos'), {
        areaId,
        url,
        storagePath: path,
        filename: file.name,
        createdAt: serverTimestamp()
    });
    return docRef.id;
}

// =============================================
//  IRRIGATION ZONES
//  One document per zone; schedule is embedded on the zone document.
// =============================================

/** Fetch all irrigation zones (sorted in JS to avoid index requirements) */
export function getIrrigationZones() { return whole('irrigationZones', fetchIrrigationZones); }
async function fetchIrrigationZones() {
    const snap = await getDocs(collection(db, 'irrigationZones'));
    const zones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return zones.sort((a, b) => {
        const ao = a.displayOrder ?? 999, bo = b.displayOrder ?? 999;
        if (ao !== bo) return ao - bo;
        return (a.name || '').localeCompare(b.name || '');
    });
}

/** Add a new irrigation zone */
export async function addIrrigationZone(data) {
    return addDoc(collection(db, 'irrigationZones'), {
        ...data,
        createdAt: serverTimestamp()
    });
}

/** Update an irrigation zone */
export async function updateIrrigationZone(id, data) {
    return updateDoc(doc(db, 'irrigationZones', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

/** Delete a zone and all its logs */
export async function deleteIrrigationZone(id) {
    const logsSnap = await getDocs(
        query(collection(db, 'irrigationLogs'), where('zoneId', '==', id))
    );
    await deleteTogether([...logsSnap.docs.map(d => d.ref), doc(db, 'irrigationZones', id)]);
}

// =============================================
//  IRRIGATION LOGS
// =============================================

/** Fetch all irrigation logs */
export function getIrrigationLogs() { return whole('irrigationLogs', fetchIrrigationLogs); }
async function fetchIrrigationLogs() {
    const snap = await getDocs(collection(db, 'irrigationLogs'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Fetch logs for a specific zone, sorted newest-first in JS (avoids composite index) */
export async function getIrrigationLogsForZone(zoneId) {
    const q    = query(collection(db, 'irrigationLogs'), where('zoneId', '==', zoneId));
    const snap = await getDocs(q);
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return logs.sort((a, b) => (b.scheduledDate || '').localeCompare(a.scheduledDate || ''));
}

/** Fetch logs whose scheduledDate falls within [startDate, endDate] inclusive (YYYY-MM-DD) */
export async function getIrrigationLogsForDateRange(startDate, endDate) {
    const q = query(
        collection(db, 'irrigationLogs'),
        where('scheduledDate', '>=', startDate),
        where('scheduledDate', '<=', endDate)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Add a new irrigation log entry */
export async function addIrrigationLog(data) {
    return addDoc(collection(db, 'irrigationLogs'), {
        ...data,
        loggedAt: serverTimestamp()
    });
}

/** Update an existing irrigation log */
export async function updateIrrigationLog(id, data) {
    return updateDoc(doc(db, 'irrigationLogs', id), {
        ...data,
        updatedAt: serverTimestamp()
    });
}

/** Delete a single irrigation log */
export async function deleteIrrigationLog(id) {
    return deleteDoc(doc(db, 'irrigationLogs', id));
}

// =============================================
//  SUGGESTIONS  (improvement / wishlist list)
// =============================================

export function getSuggestions() { return whole('suggestions', fetchSuggestions); }
async function fetchSuggestions() {
    const q    = query(collection(db, 'suggestions'), orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function addSuggestion(text) {
    return addDoc(collection(db, 'suggestions'), { text, done: false, createdAt: serverTimestamp() });
}
export async function updateSuggestion(id, data) {
    return updateDoc(doc(db, 'suggestions', id), { ...data, updatedAt: serverTimestamp() });
}
export async function deleteSuggestion(id) {
    return deleteDoc(doc(db, 'suggestions', id));
}

// =============================================
//  RECURRING TASK HELPERS
// =============================================

/**
 * After a recurring assignment is completed or skipped, create the next occurrence.
 */
export async function createNextRecurringOccurrence(assignment, task) {
    if (!task?.recurrence || task.recurrence.type === 'none') return;
    const fromDate = assignment.occurrenceDate || assignment.dueDate || todayStr();
    const nextDate = nextOccurrenceDate(task.recurrence, fromDate);
    return addTaskAssignment({
        taskId:         assignment.taskId,
        areaId:         assignment.areaId,
        status:         'todo',
        dueDate:        nextDate,
        completedDate:  null,
        completionNote: null,
        plantIds:       assignment.plantIds || [],
        isRecurring:    true,
        occurrenceDate: nextDate,
        isSkipped:      false,
    });
}

// =============================================
//  BLOG POSTS
// =============================================

/**
 * Fetch blog posts.
 * @param {boolean} publishedOnly  If true, only return published posts. Admins pass false to see drafts.
 */
export async function getBlogPosts(publishedOnly = true) {
    const snap = await getDocs(collection(db, 'blogPosts'));
    let posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (publishedOnly) posts = posts.filter(p => p.published);
    // Sort newest postDate first; within the same day, newest createdAt first
    // (fall back to updatedAt for older posts that pre-date the createdAt field)
    function postTime(p) {
        const ts = p.createdAt ?? p.updatedAt;
        return ts?.toMillis?.() ?? (ts?.seconds ?? 0) * 1000;
    }
    return posts.sort((a, b) => {
        const dateCmp = (b.postDate || '').localeCompare(a.postDate || '');
        if (dateCmp !== 0) return dateCmp;
        return postTime(b) - postTime(a);
    });
}

/** Fetch a single blog post by ID */
export async function getBlogPost(id) {
    const snap = await getDoc(doc(db, 'blogPosts', id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
}

/**
 * Save a blog post. Pass a postId to create with a specific ID (for new posts with
 * already-uploaded photos), or omit to auto-generate an ID.
 */
export async function saveBlogPost(postId, data) {
    if (postId) {
        // Strip the internal flag before saving; set createdAt only on first save
        const { createdAt_flag, ...cleanData } = data;
        const toSave = { ...cleanData, updatedAt: serverTimestamp() };
        if (createdAt_flag) toSave.createdAt = serverTimestamp();
        await setDoc(doc(db, 'blogPosts', postId), toSave, { merge: true });
        return postId;
    } else {
        const ref = await addDoc(collection(db, 'blogPosts'), {
            ...data,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
        });
        return ref.id;
    }
}

/** Delete a blog post */
export async function deleteBlogPost(id) {
    await deleteDoc(doc(db, 'blogPosts', id));
}

/**
 * Upload a photo for a blog post (stored under blog-photos/{postId}/).
 * Compresses the image to ≤500 KB / 1920 px before uploading.
 * Returns { url, storagePath }.
 */
export async function uploadBlogPhoto(postId, file, onProgress) {
    const { url, path } = await uploadToStorage('blog-photos', postId, file, onProgress);
    return { url, storagePath: path };
}

// =============================================
//  ADMIN — BACKUP & RESTORE
// =============================================

/** Export all Firestore data as a plain JS object ready for JSON.stringify */
export async function exportAllData() {
    const strip = data => {
        const { createdAt, updatedAt, restoredAt, loggedAt, ...rest } = data;
        return rest;
    };

    const [plantsSnap, areasSnap, instancesSnap, photosSnap, tasksSnap, assignmentsSnap,
           irrZonesSnap, irrLogsSnap, blogSnap, deceasedSnap] = await Promise.all([
        getDocs(collection(db, 'plants')),
        getDocs(collection(db, 'areas')),
        getDocs(collection(db, 'instances')),
        getDocs(collection(db, 'photos')),
        getDocs(collection(db, 'tasks')),
        getDocs(collection(db, 'taskAssignments')),
        getDocs(collection(db, 'irrigationZones')),
        getDocs(collection(db, 'irrigationLogs')),
        getDocs(collection(db, 'blogPosts')),
        getDocs(collection(db, 'deceasedPlants')),
    ]);

    return {
        exportedAt: new Date().toISOString(),
        version: 5,
        plants:           plantsSnap.docs.map(d      => ({ id: d.id, ...strip(d.data()) })),
        areas:            areasSnap.docs.map(d        => ({ id: d.id, ...strip(d.data()) })),
        instances:        instancesSnap.docs.map(d   => ({ id: d.id, ...strip(d.data()) })),
        photos:           photosSnap.docs.map(d       => ({ id: d.id, ...strip(d.data()) })),
        tasks:            tasksSnap.docs.map(d        => ({ id: d.id, ...strip(d.data()) })),
        taskAssignments:  assignmentsSnap.docs.map(d => ({ id: d.id, ...strip(d.data()) })),
        irrigationZones:  irrZonesSnap.docs.map(d    => ({ id: d.id, ...strip(d.data()) })),
        irrigationLogs:   irrLogsSnap.docs.map(d     => ({ id: d.id, ...strip(d.data()) })),
        blogPosts:        blogSnap.docs.map(d         => ({ id: d.id, ...strip(d.data()) })),
        deceasedPlants:   deceasedSnap.docs.map(d     => ({ id: d.id, ...strip(d.data()) })),
    };
}

/** Restore data from a backup object. Preserves original document IDs so all
 *  plantId / areaId cross-references remain valid. */
export async function importAllData(backup) {
    const write = async (collName, items) => {
        for (const item of (items || [])) {
            const { id, ...data } = item;
            await setDoc(doc(db, collName, id), { ...data, restoredAt: serverTimestamp() });
        }
    };
    await write('plants',           backup.plants);
    await write('areas',            backup.areas);
    await write('instances',        backup.instances);
    await write('photos',           backup.photos);
    await write('tasks',            backup.tasks);
    await write('taskAssignments',  backup.taskAssignments);
    await write('irrigationZones',  backup.irrigationZones);
    await write('irrigationLogs',   backup.irrigationLogs);
    await write('blogPosts',        backup.blogPosts);
    await write('deceasedPlants',   backup.deceasedPlants);
}

/** Delete every document in all collections. Use before a full restore. */
export async function clearAllData() {
    const wipe = async (collName) => {
        const snap = await getDocs(collection(db, collName));
        for (const d of snap.docs) await deleteDoc(d.ref);
    };
    await wipe('plants');
    await wipe('areas');
    await wipe('instances');
    await wipe('photos');
    await wipe('tasks');
    await wipe('taskAssignments');
    await wipe('irrigationZones');
    await wipe('irrigationLogs');
    await wipe('blogPosts');
    await wipe('deceasedPlants');
    // Note: Firebase Storage photo files are NOT deleted — only the Firestore metadata
}

/** Return record counts for all collections */
export async function getDataCounts() {
    // Eight of these are plain counts, which the server can give without
    // sending the documents. Instances and deceased plants are read in full
    // because their quantities are added up.
    const n = name => countOf(collection(db, name));
    const [p, a, i, ph, t, ta, iz, il, bp, dp] = await Promise.all([
        n('plants'), n('areas'), getInstances(), n('photos'), n('tasks'),
        n('taskAssignments'), n('irrigationZones'), n('irrigationLogs'),
        n('blogPosts'), getDeceasedPlants(),
    ]);
    const specimens = i.reduce((sum, d)  => sum + (d.quantity || 1), 0);
    const composted = dp.reduce((sum, d) => sum + (d.quantity || 1), 0);
    return {
        plants: p, areas: a, instances: i.length, specimens,
        photos: ph, tasks: t, taskAssignments: ta,
        irrigationZones: iz, irrigationLogs: il,
        blogPosts: bp,
        deceasedPlants: dp.length, composted,
    };
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




