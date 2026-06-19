// =============================================================
//  db.js — All Firestore & Storage database operations
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
        db      = getFirestore(app);
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
export async function getPlants() {
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

/** Delete a plant and all its instances and photos */
export async function deletePlant(id) {
    // Delete instances
    const instancesSnap = await getDocs(
        query(collection(db, 'instances'), where('plantId', '==', id))
    );
    for (const d of instancesSnap.docs) {
        await deleteDoc(d.ref);
    }
    // Delete photos — Storage file first, then Firestore metadata document
    const photosSnap = await getDocs(
        query(collection(db, 'photos'), where('plantId', '==', id))
    );
    for (const d of photosSnap.docs) {
        // Try to delete from storage
        try {
            const storageRef = ref(storage, d.data().storagePath);
            await deleteObject(storageRef);
        } catch (_) { /* ignore if already gone */ }
        await deleteDoc(d.ref);
    }
    // Delete the plant itself
    await deleteDoc(doc(db, 'plants', id));
}

// =============================================
//  AREAS
// =============================================

/** Fetch all areas */
export async function getAreas() {
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
    for (const d of instancesSnap.docs) {
        await deleteDoc(d.ref);
    }
    // Also remove any task assignments scoped to this area
    const assignmentsSnap = await getDocs(
        query(collection(db, 'taskAssignments'), where('areaId', '==', id))
    );
    for (const d of assignmentsSnap.docs) {
        await deleteDoc(d.ref);
    }
    await deleteDoc(doc(db, 'areas', id));
}

// =============================================
//  INSTANCES  (plant ↔ area associations)
// =============================================

/** Get all instances */
export async function getInstances() {
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
export async function getDeceasedPlants() {
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
 * Record a plant death. Creates a deceasedPlants document, then adjusts the
 * source instance: if the whole quantity died the instance is removed,
 * otherwise its quantity is reduced by the number that died.
 *
 * @param {object} record   { plantId, plantName, commonName, areaId, areaName,
 *                            quantity, cause, notes, diedDate }
 * @param {object} instance { id, quantity } — the location the death came from
 */
export async function recordPlantDeath(record, instance) {
    await addDoc(collection(db, 'deceasedPlants'), {
        ...record,
        createdAt: serverTimestamp()
    });

    if (instance && instance.id) {
        const had  = instance.quantity || 1;
        const died = record.quantity   || 1;
        if (died >= had) {
            await deleteDoc(doc(db, 'instances', instance.id));
        } else {
            await updateDoc(doc(db, 'instances', instance.id), { quantity: had - died });
        }
    }
}

/** Delete a deceased record (removes the Compost Bin entry — does not replant) */
export async function deleteDeceasedRecord(id) {
    await deleteDoc(doc(db, 'deceasedPlants', id));
}

// =============================================
//  TASKS
// =============================================

/** Fetch all tasks, ordered by title */
export async function getTasks() {
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
    for (const d of assignmentsSnap.docs) {
        await deleteDoc(d.ref);
    }
    await deleteDoc(doc(db, 'tasks', id));
}

// =============================================
//  TASK ASSIGNMENTS  (task ↔ area pairings)
// =============================================

/** Get all task assignments */
export async function getTaskAssignments() {
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
    for (const d of snap.docs) {
        await deleteDoc(d.ref);
    }
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
export async function uploadPhoto(plantId, file, onProgress) {
    const fileToUpload = await compressImage(file);
    return new Promise((resolve, reject) => {
        const ext        = file.name.split('.').pop();
        const filename   = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const path       = `plant-photos/${plantId}/${filename}`;
        const storageRef = ref(storage, path);
        const task       = uploadBytesResumable(storageRef, fileToUpload);

        task.on('state_changed',
            snap => {
                const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
                if (onProgress) onProgress(pct);
            },
            err => reject(err),
            async () => {
                const url = await getDownloadURL(task.snapshot.ref);
                const docRef = await addDoc(collection(db, 'photos'), {
                    plantId,
                    url,
                    storagePath: path,
                    filename: file.name,
                    createdAt: serverTimestamp()
                });
                resolve(docRef.id);
            }
        );
    });
}

/**
 * Return the first (lowest-order / oldest) photo for each of the given plantIds.
 * Result is a map { plantId → photoData }. Uses 'in' queries chunked to 30 ids each.
 */
export async function getFirstPhotoForPlants(plantIds) {
    if (!plantIds.length) return {};
    const CHUNK = 30;
    const map   = {};
    for (let i = 0; i < plantIds.length; i += CHUNK) {
        const chunk = plantIds.slice(i, i + CHUNK);
        const q     = query(collection(db, 'photos'), where('plantId', 'in', chunk));
        const snap  = await getDocs(q);
        snap.docs.forEach(d => {
            const data   = { id: d.id, ...d.data() };
            const pid    = data.plantId;
            const curr   = map[pid];
            const dOrder = data.order ?? Infinity;
            const cOrder = curr?.order ?? Infinity;
            if (!curr || dOrder < cOrder ||
                (dOrder === cOrder &&
                 (data.createdAt?.toMillis?.() ?? 0) < (curr.createdAt?.toMillis?.() ?? 0))) {
                map[pid] = data;
            }
        });
    }
    return map;
}

/** Return a Set of plantIds that have at least one photo */
export async function getPlantIdsWithPhotos() {
    const snap = await getDocs(collection(db, 'photos'));
    const ids  = new Set();
    snap.docs.forEach(d => { const pid = d.data().plantId; if (pid) ids.add(pid); });
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
    await Promise.all(
        orderedIds.map((id, idx) => updateDoc(doc(db, 'photos', id), { order: idx }))
    );
}

/**
 * Upload a photo for an area (stored under area-photos/{areaId}/).
 * Compresses the image to ≤500 KB / 1920 px before uploading if needed.
 */
export async function uploadAreaPhoto(areaId, file, onProgress) {
    const fileToUpload = await compressImage(file);
    return new Promise((resolve, reject) => {
        const ext        = file.name.split('.').pop();
        const filename   = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const path       = `area-photos/${areaId}/${filename}`;
        const storageRef = ref(storage, path);
        const task       = uploadBytesResumable(storageRef, fileToUpload);
        task.on('state_changed',
            snap => {
                const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
                if (onProgress) onProgress(pct);
            },
            err => reject(err),
            async () => {
                const url = await getDownloadURL(task.snapshot.ref);
                const docRef = await addDoc(collection(db, 'photos'), {
                    areaId,
                    url,
                    storagePath: path,
                    filename: file.name,
                    createdAt: serverTimestamp()
                });
                resolve(docRef.id);
            }
        );
    });
}

// =============================================
//  IRRIGATION ZONES
//  One document per zone; schedule is embedded on the zone document.
// =============================================

/** Fetch all irrigation zones (sorted in JS to avoid index requirements) */
export async function getIrrigationZones() {
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
    for (const d of logsSnap.docs) await deleteDoc(d.ref);
    await deleteDoc(doc(db, 'irrigationZones', id));
}

// =============================================
//  IRRIGATION LOGS
// =============================================

/** Fetch all irrigation logs */
export async function getIrrigationLogs() {
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

export async function getSuggestions() {
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
 * Given a recurrence pattern and a YYYY-MM-DD start date, return the next
 * occurrence date as a YYYY-MM-DD string (always at least one unit ahead).
 */
export function nextOccurrenceDate(recurrence, fromDateStr) {
    const d = new Date(fromDateStr + 'T12:00:00');
    if (recurrence.type === 'daily') {
        d.setDate(d.getDate() + 1);
    } else if (recurrence.type === 'weekly') {
        const target = recurrence.dayOfWeek;
        let ahead = target - d.getDay();
        if (ahead <= 0) ahead += 7;
        d.setDate(d.getDate() + ahead);
    } else if (recurrence.type === 'monthly') {
        const dom = recurrence.dayOfMonth || 1;
        d.setMonth(d.getMonth() + 1);
        d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    }
    return d.toISOString().slice(0, 10);
}

/**
 * Return the first (upcoming) occurrence date from today for a new recurring task.
 * For weekly tasks, returns today if today matches the target day.
 */
export function firstOccurrenceFromToday(recurrence) {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    if (recurrence.type === 'daily') {
        return today.toISOString().slice(0, 10);
    } else if (recurrence.type === 'weekly') {
        const target = recurrence.dayOfWeek;
        let ahead = target - today.getDay();
        if (ahead < 0) ahead += 7;
        today.setDate(today.getDate() + ahead);
        return today.toISOString().slice(0, 10);
    } else if (recurrence.type === 'monthly') {
        const dom = recurrence.dayOfMonth || 1;
        const thisMonth = new Date(today.getFullYear(), today.getMonth(), dom, 12);
        if (thisMonth >= today) return thisMonth.toISOString().slice(0, 10);
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, dom, 12);
        return nextMonth.toISOString().slice(0, 10);
    }
    return today.toISOString().slice(0, 10);
}

/**
 * After a recurring assignment is completed or skipped, create the next occurrence.
 */
export async function createNextRecurringOccurrence(assignment, task) {
    if (!task?.recurrence || task.recurrence.type === 'none') return;
    const fromDate = assignment.occurrenceDate || assignment.dueDate
                     || new Date().toISOString().slice(0, 10);
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
    const fileToUpload = await compressImage(file);
    return new Promise((resolve, reject) => {
        const ext        = file.name.split('.').pop();
        const filename   = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const path       = `blog-photos/${postId}/${filename}`;
        const storageRef = ref(storage, path);
        const task       = uploadBytesResumable(storageRef, fileToUpload);
        task.on('state_changed',
            snap => {
                const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
                if (onProgress) onProgress(pct);
            },
            err => reject(err),
            async () => {
                const url = await getDownloadURL(task.snapshot.ref);
                resolve({ url, storagePath: path });
            }
        );
    });
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
    const [p, a, i, ph, t, ta, iz, il, bp, dp] = await Promise.all([
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
    const specimens = i.docs.reduce((sum, d) => sum + (d.data().quantity || 1), 0);
    const composted = dp.docs.reduce((sum, d) => sum + (d.data().quantity || 1), 0);
    return {
        plants: p.size, areas: a.size, instances: i.size, specimens,
        photos: ph.size, tasks: t.size, taskAssignments: ta.size,
        irrigationZones: iz.size, irrigationLogs: il.size,
        blogPosts: bp.size,
        deceasedPlants: dp.size, composted,
    };
}

// ===========================================