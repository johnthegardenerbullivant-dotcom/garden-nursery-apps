// =============================================================
//  auth.js — Firebase Authentication & Role Management
//  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//  Three roles: viewer < editor < admin
//
//  Usage in any view:
//    import { isAtLeast, getCurrentRole } from './auth.js';
//    if (isAtLeast('editor')) { /* show add/edit buttons */ }
//    if (isAtLeast('admin'))  { /* show delete / admin controls */ }
// =============================================================

import {
    getAuth,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    signInAnonymously,
    GoogleAuthProvider,
    signOut as fbSignOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
    doc, getDoc, setDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// Role hierarchy — higher number = more permission
const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };

let _auth = null;
let _db   = null;
let _user = null;
let _role = null;  // 'viewer' | 'editor' | 'admin' | null

// =============================================
//  Initialisation
// =============================================

/**
 * Call once after Firebase has been initialised (from main.js).
 * @param {import('firebase/app').FirebaseApp} app   - the Firebase app instance
 * @param {import('firebase/firestore').Firestore} db - the Firestore instance
 */
export function initAuth(app, db) {
    _auth = getAuth(app);
    _db   = db;
}

/** Returns the raw Firebase Auth instance (used for onAuthStateChanged in main.js). */
export function getAuthInstance() { return _auth; }

// =============================================
//  Current state getters
// =============================================

export function getCurrentUser() { return _user; }
export function getCurrentRole() { return _role; }

/**
 * Returns true if the currently signed-in user's role is at least `role`.
 * e.g. isAtLeast('editor') → true for editor and admin, false for viewer / unauthenticated
 */
export function isAtLeast(role) {
    if (!_role) return false;
    return (ROLE_RANK[_role] || 0) >= (ROLE_RANK[role] || 0);
}

// =============================================
//  Role fetching
// =============================================

/**
 * Fetches the role document for `uid` from Firestore `users/{uid}`.
 * Caches it internally and returns the role string, or null if none.
 *
 * If `userRecord` (a Firebase Auth user object) is supplied, also writes
 * enriched profile data (name, email, provider, lastLoginAt) to the document
 * so the admin User Management panel can display it. On first sign-in it also
 * sets `status: 'pending'` so admins can see the new arrival.
 *
 * Returns 'blocked' if the user has been blocked by an admin — the caller
 * should treat this the same as no role (show access-denied screen).
 */
export async function loadRole(uid, userRecord = null) {
    try {
        const userRef = doc(_db, 'users', uid);
        const snap    = await getDoc(userRef);
        const existed = snap.exists();

        // Write / refresh profile data on every sign-in
        if (userRecord) {
            const profileUpdate = {
                displayName: userRecord.displayName || '',
                email:       userRecord.email       || '',
                photoURL:    userRecord.photoURL    || '',
                provider:    userRecord.providerData?.[0]?.providerId || 'unknown',
                lastLoginAt: serverTimestamp(),
            };
            if (!existed) {
                // First ever sign-in — record creation time and mark as pending
                profileUpdate.createdAt = serverTimestamp();
                profileUpdate.status    = 'pending';
            }
            // merge: true keeps any existing role / blocked fields untouched
            await setDoc(userRef, profileUpdate, { merge: true });
        }

        if (!existed) {
            _role = null;
            return null;
        }

        const data = snap.data();

        // Blocked users get no access regardless of role
        if (data.blocked) {
            _role = null;
            return 'blocked';
        }

        _role = data.role || null;
    } catch (e) {
        console.error('Could not fetch user role:', e);
        _role = null;
    }
    return _role;
}

/** Called by the auth state listener to update the cached user. */
export function setCurrentUser(user) {
    _user = user;
    if (!user) _role = null;
}

/**
 * Directly set the cached role — used for anonymous (guest) users who
 * are auto-assigned 'viewer' without needing a Firestore role document.
 */
export function setRole(role) {
    _role = role;
}

// =============================================
//  Sign-in helpers
// =============================================

/** Open a Google sign-in popup. */
export function signInWithGoogle() {
    return signInWithPopup(_auth, new GoogleAuthProvider());
}

/** Sign in with email + password. */
export function signInWithEmail(email, password) {
    return signInWithEmailAndPassword(_auth, email, password);
}

/**
 * Sign in anonymously — gives read-only (viewer) access with no account needed.
 * Firebase assigns a temporary UID for the session; no role document is required.
 */
export function signInAsGuest() {
    return signInAnonymously(_auth);
}

/** Sign out the current user. */
export async function signOutUser() {
    _user = null;
    _role = null;
    return fbSignOut(_auth);
}
