// =============================================================
//  main.js — App entry point, initialisation & router
// =============================================================

import { initFirebase, getPendingUserCount, getPlantByTagCode, isTagCode, escHtml } from './db.js';
import { initAuth, getAuthInstance, loadRole, setCurrentUser, setRole,
         getCurrentUser, getCurrentRole, signInAsGuest, signOutUser } from './auth.js';
import { showLoginOverlay, hideLoginOverlay, showAccessDenied, showCantConnect } from './auth-view.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import { setNavigateFn, setGoBackFn, setNavigateReplaceFn,
         isModalOpen, requestCloseModal, showToast, initSyncIndicator } from './ui-utils.js';
import { renderPlantsList, renderPlantDetail, clearPlantSearch } from './plants-view.js';
import { renderAreasList, renderAreaDetail }   from './areas-view.js';
import { renderTasksView }                     from './tasks-view.js';
import { renderCompostView }                    from './compost-view.js';

// Screens opened less often are fetched the first time they are needed, not
// at launch: Overview, Irrigation, the blog, Admin and the walk-round. That is plain import(), a browser feature; there is no
// build step. A few seconds after the first screen has drawn, they are fetched
// in the background anyway, so the service worker has a copy and they still
// open with no signal later.
const lazy = {
    garden:     () => import('./garden-view.js'),
    walkround:  () => import('./walkround-view.js'),
    irrigation: () => import('./irrigation-view.js'),
    blog:       () => import('./blog-view.js'),
    admin:      () => import('./admin-view.js'),
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
    const hash  = window.location.hash.replace('#', '') || 'tasks';
    const parts = hash.split('/');
    return { view: parts[0] || 'tasks', id: parts[1] || null };
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

async function navigate(view, id) {
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
async function navigateReplace(view, id) {
    currentView = view;
    currentId   = id || null;
    history.replaceState({ idx: navHistory.length }, '', hashFor(view, id));
    await route(view, id);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

async function goBack() {
    // Somewhere to go back to: let the browser do it, and the popstate handler
    // below draws the screen. One code path for the on-screen Back button and
    // the phone's.
    if (navHistory.length > 0) {
        history.back();
        return;
    }
    // Arrived straight on a detail screen (a link, a reload): no history, so
    // fall back to the list it belongs to.
    const base  = currentView.startsWith('plant') ? 'plants'
                : currentView.startsWith('area')  ? 'areas'
                : currentView.startsWith('blog')  ? 'blog'
                : 'tasks';
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
                return 'handed-on';
            } else {
                mainEl.innerHTML = `<div class="empty-state">
                    <div class="empty-state-icon">🏷️</div>
                    <h3>Tag not recognised</h3>
                    <p>No plant carries the code <strong>${escHtml(String(id || '').toUpperCase())}</strong>.
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
            await (await lazy.walkround()).renderWalkRound(mainEl, headerAction, backBtn, id);
            break;

        case 'garden':
            pageTitleEl.textContent = '\u{1F3E1} Garden Overview';
            await (await lazy.garden()).renderGardenView(mainEl, headerAction, backBtn);
            break;

        case 'tasks':
            pageTitleEl.textContent = '\u{1F4CB} Garden Tasks';
            await renderTasksView(mainEl, headerAction, backBtn,
                Array.isArray(state.expandedSections) ? state.expandedSections : null);
            break;

        case 'irrigation':
            pageTitleEl.textContent = '\uD83D\uDCA7 Irrigation';
            await (await lazy.irrigation()).renderIrrigationView(mainEl, headerAction, backBtn);
            break;

        case 'compost':
            pageTitleEl.textContent = '\uD83E\uDEB5 Compost Bin';
            await renderCompostView(mainEl, headerAction, backBtn);
            break;

        case 'blog':
            pageTitleEl.textContent = '\uD83D\uDCDD Garden Journal';
            await (await lazy.blog()).renderBlogList(mainEl, headerAction, backBtn);
            break;

        case 'blog-post':
            pageTitleEl.textContent = 'Journal Entry';
            await (await lazy.blog()).renderBlogPost(mainEl, headerAction, backBtn, id);
            break;

        case 'blog-compose':
            pageTitleEl.textContent = '\u270F\uFE0F New Entry';
            await (await lazy.blog()).renderBlogEditor(mainEl, headerAction, backBtn, null);
            break;

        case 'blog-edit':
            pageTitleEl.textContent = '\u270F\uFE0F Edit Entry';
            await (await lazy.blog()).renderBlogEditor(mainEl, headerAction, backBtn, id);
            break;

        case 'admin':
            pageTitleEl.textContent = '\u2699\uFE0F Admin';
            await (await lazy.admin()).renderAdminView(mainEl, headerAction, backBtn);
            break;

        default:
            // An address that names no screen: go home without adding history.
            navigateReplace('tasks');
            return 'handed-on';
    }
}

// =============================================
//  Initial load — read URL hash
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
        if (btn.dataset.view === 'plants') clearPlantSearch();
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
modalOverlay.addEventListener('mousedown', (e) => { overlayMousedownTarget = e.target; });
modalOverlay.addEventListener('click', (e) => {
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
    initSyncIndicator();

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

        if (role === 'unavailable') {
            showCantConnect();
            return;
        }

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
