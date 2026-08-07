// =============================================================
//  main.js — App entry point, initialisation & router
// =============================================================

import { initFirebase, getPendingUserCount } from './db.js';
import { initAuth, getAuthInstance, loadRole, setCurrentUser, setRole,
         getCurrentUser, getCurrentRole, signOutUser } from './auth.js';
import { showLoginOverlay, hideLoginOverlay, showAccessDenied } from './auth-view.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import { setNavigateFn, setGoBackFn, setNavigateReplaceFn, hideModal } from './ui-utils.js';
import { renderDashboard }                                   from './dashboard-view.js';
import { renderBatchesList, renderBatchDetail }              from './batches-view.js';
import { renderPropagatedPlants, renderPlantPropHistory }    from './plants-view.js';
import { renderStats }                                       from './stats-view.js';
import { renderAdminView }                                   from './admin-view.js';
import { renderPlansView }                                   from './plans-view.js';

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

export async function navigate(view, id) {
    navHistory.push({ view: currentView, id: currentId, state: captureCurrentState() });
    currentView = view;
    currentId   = id || null;
    const hash  = id ? `#${view}/${id}` : `#${view}`;
    history.replaceState(null, '', hash);
    await route(view, id);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

export async function navigateReplace(view, id) {
    currentView = view;
    currentId   = id || null;
    const hash  = id ? `#${view}/${id}` : `#${view}`;
    history.replaceState(null, '', hash);
    await route(view, id);
    window.scrollTo({ top: 0, behavior: 'instant' });
}

export async function goBack() {
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
        navHistory  = [];
        currentView = 'dashboard';
        currentId   = null;
        history.replaceState(null, '', '#dashboard');
        await route('dashboard', null, {});
    }
}

setNavigateFn(navigate);
setGoBackFn(goBack);
setNavigateReplaceFn(navigateReplace);

// =============================================
//  Router
// =============================================

async function route(view, id, state = {}) {
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
            await renderStats(mainEl, headerAction, backBtn);
            break;

        case 'plans':
            pageTitleEl.textContent = '🌿 Propagation Plans';
            await renderPlansView(mainEl, headerAction, backBtn);
            break;

        case 'admin':
            pageTitleEl.textContent = '⚙️ Admin';
            await renderAdminView(mainEl, headerAction, backBtn);
            break;

        default:
            navigate('dashboard');
    }
}

// =============================================
//  Initial load from URL hash
// =============================================
function routeFromHash() {
    const hash  = window.location.hash.replace('#', '') || 'dashboard';
    const parts = hash.split('/');
    const view  = parts[0] || 'dashboard';
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
modalOverlay.addEventListener('mousedown', e => { overlayMousedownTarget = e.target; });
modalOverlay.addEventListener('click', e => {
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
