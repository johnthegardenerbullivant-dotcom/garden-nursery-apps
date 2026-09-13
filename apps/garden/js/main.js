// =============================================================
//  main.js — App entry point, initialisation & router
// =============================================================

import { initFirebase, getPendingUserCount, getPlantByTagCode, isTagCode } from './db.js';
import { initAuth, getAuthInstance, loadRole, setCurrentUser, setRole,
         getCurrentUser, getCurrentRole, signInAsGuest, signOutUser } from './auth.js';
import { showLoginOverlay, hideLoginOverlay, showAccessDenied } from './auth-view.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import { setNavigateFn, setGoBackFn, setNavigateReplaceFn, hideModal } from './ui-utils.js';
import { renderPlantsList, renderPlantDetail, clearPlantSearch } from './plants-view.js';
import { renderAreasList, renderAreaDetail }   from './areas-view.js';
import { renderWalkRound }                     from './walkround-view.js';
import { renderGardenView }                    from './garden-view.js';
import { renderAdminView }                     from './admin-view.js';
import { renderTasksView }                     from './tasks-view.js';
import { renderIrrigationView }                from './irrigation-view.js';
import { renderCompostView }                    from './compost-view.js';
import { renderBlogList, renderBlogPost, renderBlogEditor } from './blog-view.js';

// =============================================
//  DOM references
// =============================================
const mainEl        = document.getElementById('app-main');
const pageTitleEl   = document.getElementById('page-title');
const headerAction  = document.getElementById('header-action');
const backBtn       = document.getElementById('back-btn');
const bottomNav     = document.getElementById('bottom-nav');
const navBtns       = bottomNav.querySelectorAll('.nav-btn');
const modalOverlay  = document.getElementById('modal-overlay');
const modalCloseBtn = document.getElementById('modal-close-btn');
const configOverlay = document.getElementById('config-overlay');

// User chip + dropdown DOM refs
const userChipEl      = document.getElementById('user-chip');
const userChipInitials= document.getElementById('user-chip-initials');
const userDropdown    = document.getElementById('user-dropdown');
const userDropName    = document.getElementById('user-dropdown-name');
const userDropRole    = document.getElementById('user-dropdown-role');
const signoutBtn      = document.getElementById('signout-btn');

// Admin nav button (may be hidden for viewers)
const adminNavBtn = bottomNav.querySelector('[data-view="admin"]');

// =============================================
//  Router state
// =============================================
let currentView = 'tasks';
let currentId   = null;
let navHistory  = [];

// =============================================
//  Plant tag arrival  (/p/<code>)
// =============================================
// A printed QR plant tag encodes  https://<site>/P/<tagCode>.  `_redirects`
// rewrites that path to this app with a 200, so the path is still there when
// this file loads; absorbTagPath() turns it into an ordinary hash route
// before the router reads the hash, which keeps the whole of the rest of the
// router ignorant that tags exist.
//
// Two shapes are accepted. A six-character tag code becomes #plant-tag/<code>,
// which the router resolves to a plant. Anything else is taken for a raw
// Firestore document ID and becomes #plant-detail/<id> directly — that form
// predates tag codes, costs one line to keep, and means a tag printed before
// this change still works.
//
// The flag it sets is what tells the auth listener that this visitor arrived
// off a tag and should be let in as a read-only guest rather than shown a
// login screen — a sign-in wall behind a QR code on a plant label is a wall
// in front of a garden visitor holding a phone.
let arrivedFromTag = false;

function absorbTagPath() {
    // Split rather than match: location.pathname already excludes the query and
    // the hash, so the two segments are all there is to check, and it keeps a
    // fiddly escaped regex out of a path that silently disables every tag if it
    // is ever got wrong.
    const parts = window.location.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return;
    if (parts[0] !== 'p' && parts[0] !== 'P') return;

    arrivedFromTag = true;
    const raw = decodeURIComponent(parts[1]);
    const to  = isTagCode(raw) ? `plant-tag/${raw.toUpperCase()}` : `plant-detail/${raw}`;
    history.replaceState(null, '', `/#${to}`);
}

// =============================================
//  Navigation
// =============================================

function captureCurrentState() {
    const state = { scrollTop: window.scrollY };
    const activeTabBtn = document.querySelector('.view-toggle-btn.active');
    if (activeTabBtn && activeTabBtn.id) state.activeTab = activeTabBtn.id;
    state.expandedSections = [...document.querySelectorAll('.area-section.expanded')]
        .map(s => s.dataset.areaId)
        .filter(Boolean);
    return state;
}

async function navigate(view, id) {
    navHistory.push({ view: currentView, id: currentId, state: captureCurrentState() });
    currentView = view;
    currentId   = id || null;
    const hash  = id ? `#${view}/${id}` : `#${view}`;
    history.replaceState(null, '', hash);
    await route(view, id);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// Like navigate() but does NOT push the current view onto the history stack.
// Use when a view should replace its predecessor (e.g. editor → post after save),
// so the back button skips the replaced view entirely.
async function navigateReplace(view, id) {
    currentView = view;
    currentId   = id || null;
    const hash  = id ? `#${view}/${id}` : `#${view}`;
    history.replaceState(null, '', hash);
    await route(view, id);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

async function goBack() {
    if (navHistory.length > 0) {
        const prev  = navHistory.pop();
        currentView = prev.view;
        currentId   = prev.id;
        const hash  = prev.id ? `#${prev.view}/${prev.id}` : `#${prev.view}`;
        history.replaceState(null, '', hash);
        await route(prev.view, prev.id, prev.state || {});
        if (prev.state && prev.state.scrollTop > 0) {
            window.scrollTo({ top: prev.state.scrollTop, behavior: 'instant' });
        }
    } else {
        const base  = currentView.startsWith('plant') ? 'plants'
                    : currentView.startsWith('area')  ? 'areas'
                    : 'garden';
        navHistory  = [];
        currentView = base;
        currentId   = null;
        history.replaceState(null, '', `#${base}`);
        await route(base, null, {});
    }
}

setNavigateFn(navigate);
setGoBackFn(goBack);
setNavigateReplaceFn(navigateReplace);

async function route(view, id, state = {}) {
    document.querySelector('.fab')?.remove();

    navBtns.forEach(btn => {
        const base = view.startsWith('plant')    ? 'plants'
                   : view.startsWith('area')     ? 'areas'
                   : view.startsWith('blog')     ? 'blog'
                   : view === 'admin'            ? 'admin'
                   : view === 'irrigation'       ? 'admin'
                   : view === 'compost'          ? 'garden'
                   : view === 'tasks'            ? 'tasks'
                   : 'garden';
        btn.classList.toggle('active', btn.dataset.view === base);
    });

    switch (view) {
        case 'plants':
            pageTitleEl.textContent = '\u{1F33F} Garden Management';
            await renderPlantsList(mainEl, headerAction, backBtn);
            break;

        case 'plant-detail':
            pageTitleEl.textContent = 'Plant Detail';
            await renderPlantDetail(mainEl, headerAction, backBtn, id);
            break;

        // Reached only from a scanned tag. Resolving a tag code needs
        // Firestore, so it cannot happen in absorbTagPath() before the app has
        // booted; it happens here instead and then hands over to the ordinary
        // plant-detail route, replacing the history entry so Back does not
        // bounce the visitor through the lookup again.
        case 'plant-tag': {
            pageTitleEl.textContent = 'Plant Detail';
            mainEl.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
            const tagged = await getPlantByTagCode(id);
            if (tagged) {
                await navigateReplace('plant-detail', tagged.id);
            } else {
                mainEl.innerHTML = `<div class="empty-state">
                    <div class="empty-state-icon">🏷️</div>
                    <h3>Tag not recognised</h3>
                    <p>No plant carries the code <strong>${String(id || '').toUpperCase()}</strong>.
                       It may have been reprinted, or the plant removed.</p>
                </div>`;
            }
            break;
        }

        case 'areas':
            pageTitleEl.textContent = '\u{1F5FA}\uFE0F Garden Areas';
            await renderAreasList(mainEl, headerAction, backBtn);
            break;

        case 'area-detail':
            pageTitleEl.textContent = 'Area Detail';
            await renderAreaDetail(mainEl, headerAction, backBtn, id, state.activeTab || null);
            break;

        // Named area-… so the Areas tab stays highlighted and Back falls back to Areas.
        case 'area-walk':
            pageTitleEl.textContent = '\u{1F6B6} Walk-round';
            await renderWalkRound(mainEl, headerAction, backBtn, id);
            break;

        case 'garden':
            pageTitleEl.textContent = '\u{1F3E1} Garden Overview';
            await renderGardenView(mainEl, headerAction, backBtn);
            break;

        case 'tasks':
            pageTitleEl.textContent = '\u{1F4CB} Garden Tasks';
            await renderTasksView(mainEl, headerAction, backBtn,
                Array.isArray(state.expandedSections) ? state.expandedSections : null);
            break;

        case 'irrigation':
            pageTitleEl.textContent = '\uD83D\uDCA7 Irrigation';
            await renderIrrigationView(mainEl, headerAction, backBtn);
            break;

        case 'compost':
            pageTitleEl.textContent = '\uD83E\uDEB5 Compost Bin';
            await renderCompostView(mainEl, headerAction, backBtn);
            break;

        case 'blog':
            pageTitleEl.textContent = '\uD83D\uDCDD Garden Journal';
            await renderBlogList(mainEl, headerAction, backBtn);
            break;

        case 'blog-post':
            pageTitleEl.textContent = 'Journal Entry';
            await renderBlogPost(mainEl, headerAction, backBtn, id);
            break;

        case 'blog-compose':
            pageTitleEl.textContent = '\u270F\uFE0F New Entry';
            await renderBlogEditor(mainEl, headerAction, backBtn, null);
            break;

        case 'blog-edit':
            pageTitleEl.textContent = '\u270F\uFE0F Edit Entry';
            await renderBlogEditor(mainEl, headerAction, backBtn, id);
            break;

        case 'admin':
            pageTitleEl.textContent = '\u2699\uFE0F Admin';
            await renderAdminView(mainEl, headerAction, backBtn);
            break;

        default:
            navigate('garden');
    }
}

// =============================================
//  Initial load — read URL hash
// =============================================
function routeFromHash() {
    const hash  = window.location.hash.replace('#', '') || 'garden';
    const parts = hash.split('/');
    const view  = parts[0] || 'garden';
    const id    = parts[1] || null;
    navHistory  = [];
    currentView = view;
    currentId   = id;
    route(view, id);
}

// =============================================
//  Event listeners
// =============================================

navBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        if (btn.dataset.view === 'plants') clearPlantSearch();
        navHistory  = [];
        currentView = btn.dataset.view;
        currentId   = null;
        history.replaceState(null, '', `#${btn.dataset.view}`);
        await route(btn.dataset.view, null);
        window.scrollTo({ top: 0, behavior: 'instant' });
    });
});

backBtn.addEventListener('click', goBack);

let overlayMousedownTarget = null;
modalCloseBtn.addEventListener('click', hideModal);
modalOverlay.addEventListener('mousedown', (e) => { overlayMousedownTarget = e.target; });
modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay && overlayMousedownTarget === modalOverlay) hideModal();
    overlayMousedownTarget = null;
});

// =============================================
//  User chip + dropdown
// =============================================

function showUserChip(user, role) {
    let initials, displayName;

    if (user.isAnonymous) {
        initials    = '👤';
        displayName = 'Guest';
    } else {
        const name  = user.displayName || user.email || '?';
        const parts = name.trim().split(/\s+/);
        initials    = parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : name.slice(0, 2).toUpperCase();
        displayName = user.displayName || user.email || 'Signed in';
    }

    userChipInitials.textContent = initials;
    userChipEl.style.display     = 'flex';

    // Populate dropdown info
    userDropName.textContent = displayName;
    userDropRole.textContent = role || 'viewer';
    userDropRole.className   = `user-dropdown-role role-${role || 'viewer'}`;
}

// Toggle dropdown on chip click
userChipEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = userDropdown.style.display !== 'none';
    userDropdown.style.display = isOpen ? 'none' : 'block';
});

// Close dropdown when clicking elsewhere
document.addEventListener('click', (e) => {
    if (!userDropdown.contains(e.target) && e.target !== userChipEl) {
        userDropdown.style.display = 'none';
    }
});

// Sign out
signoutBtn?.addEventListener('click', async () => {
    userDropdown.style.display = 'none';
    try {
        await signOutUser();
        // Auth state listener will fire and show login screen
        userChipEl.style.display = 'none';
    } catch (e) {
        console.error('Sign-out error:', e);
    }
});

// =============================================
//  Role-aware nav setup
// =============================================

/**
 * Show/hide nav tabs and adjust labels based on role.
 * - Viewers:  no Admin tab
 * - Editors:  Admin tab shown (they see Wishlist section only)
 * - Admins:   full access
 */
function applyRoleToNav(role) {
    if (!adminNavBtn) return;
    // Show admin tab for admin only; hide for viewer and editor
    if (role === 'admin') {
        adminNavBtn.style.display = '';
    } else {
        adminNavBtn.style.display = 'none';
    }
}

// =============================================
//  Bootstrap
// =============================================

function boot() {
    // Before anything reads the URL: /p/<code> becomes a normal hash route.
    absorbTagPath();

    const firebase = initFirebase();

    if (!firebase) {
        configOverlay.style.display = 'flex';
        mainEl.innerHTML = '';
        return;
    }

    configOverlay.style.display = 'none';

    // Initialise Auth with the Firebase app + Firestore instances
    initAuth(firebase.app, firebase.db);

    // Listen for auth state changes
    onAuthStateChanged(getAuthInstance(), async (user) => {
        if (!user) {
            setCurrentUser(null);
            userChipEl.style.display = 'none';

            // Scanned a plant tag: sign in anonymously and go straight to the
            // plant. Guests are viewers — read-only — and the Firestore rules
            // are what enforce that, not this branch. Cleared first so a
            // failed sign-in falls back to the login screen instead of looping.
            if (arrivedFromTag) {
                arrivedFromTag = false;
                signInAsGuest().catch(() => showLoginOverlay());
                return;
            }

            // Not signed in — show login screen
            showLoginOverlay();
            return;
        }

        // Anonymous guest — auto-assign viewer without needing a Firestore role document
        if (user.isAnonymous) {
            setCurrentUser(user);
            setRole('viewer');
            hideLoginOverlay();
            showUserChip(user, 'viewer');
            applyRoleToNav('viewer');
            routeFromHash();
            return;
        }

        // Named user (Google / email) — fetch their role from Firestore.
        // Passing `user` also writes / refreshes their profile data so the
        // User Management panel in Admin can display them immediately.
        setCurrentUser(user);
        const role = await loadRole(user.uid, user);

        if (!role || role === 'blocked') {
            // Authenticated but no role assigned yet, or explicitly blocked
            showAccessDenied(user.email || user.displayName || 'you');
            return;
        }

        // Fully authenticated and authorised — launch the app
        hideLoginOverlay();
        showUserChip(user, role);
        applyRoleToNav(role);
        routeFromHash();

        // Show pending-users badge on Admin tab for admins
        if (role === 'admin') updateAdminPendingBadge();
    });
}

// =============================================
//  Pending-users badge on Admin nav tab
// =============================================

/**
 * Fetches the count of users awaiting role assignment and shows/hides
 * a red badge on the Admin nav button.  Called on login (for admins)
 * and whenever the User Management panel dispatches 'pending-users-changed'.
 */
async function updateAdminPendingBadge() {
    if (!adminNavBtn) return;
    try {
        const count = await getPendingUserCount();
        let badge = adminNavBtn.querySelector('.nav-badge.um-badge');
        if (count > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'nav-badge um-badge';
                adminNavBtn.appendChild(badge);
            }
            badge.textContent = count;
        } else {
            badge?.remove();
        }
    } catch (_) {
        // Silently ignore — badge is cosmetic
    }
}

// Re-run badge update whenever the User Management panel changes data
document.addEventListener('pending-users-changed', updateAdminPendingBadge);

boot();
