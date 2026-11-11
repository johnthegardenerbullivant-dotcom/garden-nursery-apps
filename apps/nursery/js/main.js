// =============================================================
//  main.js — App entry point, initialisation & router
// =============================================================

import { initFirebase, getPendingUserCount } from './db.js';
import { initAuth, getAuthInstance, loadRole, setCurrentUser, setRole,
         getCurrentUser, getCurrentRole, signOutUser } from './auth.js';
import { showLoginOverlay, hideLoginOverlay, showAccessDenied, showCantConnect } from './auth-view.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import { setNavigateFn, setGoBackFn, setNavigateReplaceFn,
         isModalOpen, requestCloseModal, showToast, initSyncIndicator } from './ui-utils.js';
import { renderDashboard }                                   from './dashboard-view.js';
import { renderBatchesList, renderBatchDetail }              from './batches-view.js';
import { renderPropagatedPlants, renderPlantPropHistory }    from './plants-view.js';

// Screens opened less often are fetched the first time they are needed, not
// at launch: Stats, Plans and Admin. That is plain import(), a browser feature; there is no
// build step. A few seconds after the first screen has drawn, they are fetched
// in the background anyway, so the service worker has a copy and they still
// open with no signal later.
const lazy = {
    stats: () => import('./stats-view.js'),
    plans: () => import('./plans-view.js'),
    admin: () => import('./admin-view.js'),
};
let lazyWarmed = false;
function warmLazyViews() {
    if (lazyWarmed || !navigator.onLine) return;
    lazyWarmed = true;
    setTimeout(() => Object.values(lazy).forEach(load => load().catch(() => {})), 4000);
}

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

const userChipEl       = document.getElementById('user-chip');
const userChipInitials = document.getElementById('user-chip-initials');
const userDropdown     = document.getElementById('user-dropdown');
const userDropName     = document.getElementById('user-dropdown-name');
const userDropRole     = document.getElementById('user-dropdown-role');
const signoutBtn       = document.getElementById('signout-btn');
const adminNavBtn      = document.getElementById('admin-nav-btn');

// =============================================
//  Router state
// =============================================
let currentView = 'dashboard';
let currentId   = null;
let navHistory  = [];

// =============================================
//  Navigation
// =============================================

function captureCurrentState() {
    return { scrollTop: window.scrollY };
}

// ---------------------------------------------
//  Browser history
// ---------------------------------------------
// Every screen change is mirrored into the browser's own history, so the
// phone's Back button or gesture (and the laptop's Back button) steps back one
// screen instead of leaving the app. Until 2026-11 every change used
// replaceState, which left the browser with a single entry however far in you
// had gone.
//
// navHistory stays the source of saved screen state (scroll position, open
// sections). Each browser entry carries { idx }, its depth in that stack, which
// is how a popstate tells Back (idx below the stack) from Forward or a
// hand-edited address (anything else).
//
// One extra entry, { guard: true }, sits underneath the first screen. Without
// it, Back on a top-level screen leaves the page with no event at all, so an
// open form could not be closed by Back there. Landing on the guard means "the
// user backed out of the app": the handler closes a form if one is open, and
// otherwise lets them leave.

function hashFor(view, id) { return id ? `#${view}/${id}` : `#${view}`; }

function parseHash() {
    const hash  = window.location.hash.replace('#', '') || 'dashboard';
    const parts = hash.split('/');
    return { view: parts[0] || 'dashboard', id: parts[1] || null };
}

let historyReady   = false;  // guard entry laid down?
let skipPops       = 0;      // popstate events caused by our own history calls
let skipTimer      = null;
let pendingTabHash = null;   // hash to stamp on the entry a tab tap rewinds to

function expectOwnPop() {
    skipPops++;
    clearTimeout(skipTimer);
    // If the browser never delivers it (nothing to move to), stop expecting it
    // rather than swallowing the user's next real Back.
    skipTimer = setTimeout(() => { skipPops = 0; pendingTabHash = null; }, 1000);
}

export async function navigate(view, id) {
    navHistory.push({ view: currentView, id: currentId, state: captureCurrentState() });
    currentView = view;
    currentId   = id || null;
    history.pushState({ idx: navHistory.length }, '', hashFor(view, id));
    await route(view, id);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

// Like navigate() but does NOT add a history entry. Use when a view should
// replace its predecessor (e.g. editor → post after save), so Back skips the
// replaced view entirely.
export async function navigateReplace(view, id) {
    currentView = view;
    currentId   = id || null;
    history.replaceState({ idx: navHistory.length }, '', hashFor(view, id));
    await route(view, id);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

export async function goBack() {
    // Somewhere to go back to: let the browser do it, and the popstate handler
    // below draws the screen. One code path for the on-screen Back button and
    // the phone's.
    if (navHistory.length > 0) {
        history.back();
        return;
    }
    // Arrived straight on a detail screen (a link, a reload): no history, so
    // fall back to the list it belongs to.
    const base  = currentView.startsWith('batch')      ? 'batches'
                : currentView.startsWith('plant-prop') ? 'plants'
                : 'dashboard';
    navHistory  = [];
    currentView = base;
    currentId   = null;
    history.replaceState(history.state && history.state.guard ? { guard: true } : { idx: 0 }, '', `#${base}`);
    await route(base, null, {});
}

window.addEventListener('popstate', async (e) => {
    if (skipPops > 0) {
        skipPops--;
        if (pendingTabHash) {
            history.replaceState({ idx: 0 }, '', pendingTabHash);
            pendingTabHash = null;
        }
        return;
    }

    // Back with a form open closes the form (asking first if it has been
    // filled in) and stays on the screen underneath.
    if (isModalOpen()) {
        requestCloseModal();
        expectOwnPop();
        history.forward();
        return;
    }

    // Backed out past the first screen. In a browser tab this goes on to the
    // page before the app; installed as an app there is nothing before it, so
    // the next Back closes it.
    if (e.state && e.state.guard) {
        history.back();
        setTimeout(() => {
            if (history.state && history.state.guard && document.visibilityState === 'visible') {
                showToast('Press Back again to leave');
            }
        }, 350);
        return;
    }

    const { view, id } = parseHash();
    const idx = (e.state && Number.isInteger(e.state.idx)) ? e.state.idx : null;
    let saved = {};
    if (idx !== null && idx < navHistory.length) {
        // Back: unwind to that depth and reuse the state saved when we left it.
        let prev = null;
        while (navHistory.length > idx) prev = navHistory.pop();
        if (prev && prev.view === view && (prev.id || null) === id) saved = prev.state || {};
    } else {
        // Forward, or an address typed or followed by hand.
        navHistory.push({ view: currentView, id: currentId, state: captureCurrentState() });
        if (idx === null) history.replaceState({ idx: navHistory.length }, '', hashFor(view, id));
    }
    currentView = view;
    currentId   = id;
    await route(view, id, saved);
    window.scrollTo({ top: saved.scrollTop || 0, behavior: 'instant' });
});

setNavigateFn(navigate);
setGoBackFn(goBack);
setNavigateReplaceFn(navigateReplace);

// =============================================
//  Router
// =============================================

// route() is the only way a screen gets drawn. It wraps drawRoute() with three
// things the views cannot do for themselves:
//   • a loading state at once, so a tap visibly registers before the data
//     arrives (the previous screen used to sit unchanged under a new title);
//   • a sequence number, because two taps in quick succession start two
//     renders and the slower one would otherwise finish last and win;
//   • a Retry screen if a view throws, instead of silently leaving the old one.
let routeSeq  = 0;   // most recent route() call
let routeDone = 0;   // most recent route() call that has finished drawing
let lastRoute = null;

async function route(view, id, state = {}) {
    const seq = ++routeSeq;
    lastRoute = { view, id, state };
    mainEl.classList.add('is-loading');
    let handedOn = false;
    try {
        handedOn = (await drawRoute(view, id, state)) === 'handed-on';
    } catch (err) {
        console.error('Could not draw', view, err);
        if (seq === routeSeq) {
            mainEl.innerHTML = `<div class="empty-state">
                <div class="empty-state-icon">⚠️</div>
                <h3>Couldn't load this screen</h3>
                <p>Check your connection and try again.</p>
                <button class="btn btn-primary" id="route-retry-btn">Retry</button>
            </div>`;
            mainEl.querySelector('#route-retry-btn')
                ?.addEventListener('click', () => route(view, id, state));
        }
    }
    if (handedOn) return;                    // a nested route() call owns the screen
    if (seq === routeSeq) {
        routeDone = seq;
        warmLazyViews();
        mainEl.classList.remove('is-loading');
    } else if (routeDone > seq && lastRoute) {
        // A newer screen had already finished and this older one has just drawn
        // over it. Draw the newer one again.
        const l = lastRoute;
        await route(l.view, l.id, l.state);
    }
}

async function drawRoute(view, id, state = {}) {
    document.querySelectorAll('.fab').forEach(el => el.remove());
    backBtn.classList.remove('visible');

    // Determine which nav tab should be active
    const navBase = view.startsWith('batch')     ? 'batches'
                  : view.startsWith('plant-prop') ? 'plants'
                  : view === 'stats'              ? 'stats'
                  : view === 'plans'              ? 'plans'
                  : view === 'admin'              ? 'admin'
                  : 'dashboard';

    navBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.view === navBase));

    switch (view) {
        case 'dashboard':
            pageTitleEl.textContent = '🌱 Nursery Management';
            await renderDashboard(mainEl, headerAction, backBtn);
            break;

        case 'batches':
            pageTitleEl.textContent = '📋 Batches';
            await renderBatchesList(mainEl, headerAction, backBtn);
            break;

        case 'batch-detail':
            pageTitleEl.textContent = 'Batch Detail';
            await renderBatchDetail(mainEl, headerAction, backBtn, id);
            break;

        case 'plants':
            pageTitleEl.textContent = '🌸 Propagated Plants';
            await renderPropagatedPlants(mainEl, headerAction, backBtn);
            break;

        case 'plant-prop-history':
            pageTitleEl.textContent = 'Propagation History';
            await renderPlantPropHistory(mainEl, headerAction, backBtn, id);
            break;

        case 'stats':
            pageTitleEl.textContent = '📊 Stats';
            await (await lazy.stats()).renderStats(mainEl, headerAction, backBtn);
            break;

        case 'plans':
            pageTitleEl.textContent = '🌿 Propagation Plans';
            await (await lazy.plans()).renderPlansView(mainEl, headerAction, backBtn);
            break;

        case 'admin':
            pageTitleEl.textContent = '⚙️ Admin';
            await (await lazy.admin()).renderAdminView(mainEl, headerAction, backBtn);
            break;

        default:
            // An address that names no screen: go home without adding history.
            navigateReplace('dashboard');
            return 'handed-on';
    }
}

// =============================================
//  Initial load from URL hash
// =============================================
function routeFromHash() {
    const { view, id } = parseHash();
    navHistory  = [];
    currentView = view;
    currentId   = id;
    if (!historyReady) {
        // First screen of this page load: lay the guard entry underneath it.
        history.replaceState({ guard: true }, '', hashFor(view, id));
        history.pushState({ idx: 0 }, '', hashFor(view, id));
        historyReady = true;
    } else {
        history.replaceState({ idx: 0 }, '', hashFor(view, id));
    }
    route(view, id);
}

// =============================================
//  Event listeners
// =============================================

navBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        // A tab is a top-level screen, so it sits at depth 0: Back from it
        // leaves the app rather than replaying every tab visited. If we are
        // deeper than that, rewind the browser's history to match first.
        const depth = navHistory.length;
        const hash  = `#${btn.dataset.view}`;
        navHistory  = [];
        currentView = btn.dataset.view;
        currentId   = null;
        if (depth > 0) {
            pendingTabHash = hash;
            expectOwnPop();
            history.go(-depth);
        } else {
            history.replaceState(history.state && history.state.guard ? { guard: true } : { idx: 0 }, '', hash);
        }
        await route(btn.dataset.view, null);
        window.scrollTo({ top: 0, behavior: 'instant' });
    });
});

backBtn.addEventListener('click', goBack);

let overlayMousedownTarget = null;
modalCloseBtn.addEventListener('click', requestCloseModal);
modalOverlay.addEventListener('mousedown', e => { overlayMousedownTarget = e.target; });
modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay && overlayMousedownTarget === modalOverlay) requestCloseModal();
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
    userDropName.textContent     = displayName;
    userDropRole.textContent     = role || 'viewer';
    userDropRole.className       = `user-dropdown-role role-${role || 'viewer'}`;
}

userChipEl?.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = userDropdown.style.display !== 'none';
    userDropdown.style.display = isOpen ? 'none' : 'block';
});

document.addEventListener('click', e => {
    if (!userDropdown.contains(e.target) && e.target !== userChipEl) {
        userDropdown.style.display = 'none';
    }
});

signoutBtn?.addEventListener('click', async () => {
    userDropdown.style.display = 'none';
    try {
        await signOutUser();
        userChipEl.style.display = 'none';
    } catch (e) {
        console.error('Sign-out error:', e);
    }
});

// =============================================
//  Role-aware nav
// =============================================

function applyRoleToNav(role) {
    if (!adminNavBtn) return;
    adminNavBtn.style.display = (role === 'admin') ? '' : 'none';
}

// =============================================
//  Bootstrap
// =============================================

function boot() {
    const firebase = initFirebase();

    if (!firebase) {
        configOverlay.style.display = 'flex';
        mainEl.innerHTML = '';
        return;
    }

    configOverlay.style.display = 'none';
    initSyncIndicator();
    initAuth(firebase.app, firebase.db);

    onAuthStateChanged(getAuthInstance(), async (user) => {
        if (!user) {
            setCurrentUser(null);
            userChipEl.style.display = 'none';
            showLoginOverlay();
            return;
        }

        if (user.isAnonymous) {
            setCurrentUser(user);
            setRole('viewer');
            hideLoginOverlay();
            showUserChip(user, 'viewer');
            applyRoleToNav('viewer');
            routeFromHash();
            return;
        }

        // Passing `user` also writes / refreshes their profile data so the
        // User Management panel in Admin can display them immediately.
        setCurrentUser(user);
        const role = await loadRole(user.uid, user);

        if (role === 'unavailable') {
            showCantConnect();
            return;
        }

        if (!role || role === 'blocked') {
            showAccessDenied(user.email || user.displayName || 'you');
            return;
        }

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

document.addEventListener('pending-users-changed', updateAdminPendingBadge);

boot();
