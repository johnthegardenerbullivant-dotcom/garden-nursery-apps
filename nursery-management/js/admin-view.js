// =============================================================
//  admin-view.js — Admin panel (Locations CRUD + backup)
// =============================================================

import {
    getNurseryLocations, addNurseryLocation, updateNurseryLocation, deleteNurseryLocation,
    exportNurseryData, escHtml,
    getNurseryWishlist, addNurseryWishlistItem, updateNurseryWishlistItem, deleteNurseryWishlistItem,
    getUsers, updateUserRole, setUserBlocked
} from './db.js';
import { showModal, hideModal, showToast } from './ui-utils.js';
import { isAtLeast, getCurrentUser } from './auth.js';

const LOCATION_TYPES = [
    { value: 'heated-greenhouse',   label: '🌡️ Heated Greenhouse' },
    { value: 'unheated-greenhouse', label: '🏡 Unheated Greenhouse' },
    { value: 'coldframe',           label: '🪟 Coldframe' },
    { value: 'outdoor',             label: '🌤️ Outdoor' },
    { value: 'lath-house',          label: '🪵 Lath House' },
    { value: 'polytunnel',          label: '🏕️ Polytunnel' },
];

export async function renderAdminView(container, headerActionEl, backBtn) {
    backBtn.classList.remove('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading…</p></div>`;

    if (!isAtLeast('admin')) {
        container.innerHTML = `<div class="empty-state"><p>Admin access required.</p></div>`;
        return;
    }

    await renderAdmin(container);
    renderUsersSection(container); // async — fills #um-content when ready
}

// =============================================
//  USER MANAGEMENT
// =============================================

async function renderUsersSection(container) {
    const umContent = container.querySelector('#um-content');
    if (!umContent) return;

    let users;
    try {
        users = await getUsers();
    } catch (e) {
        umContent.innerHTML = `<p class="section-hint" style="color:var(--danger,#e63946);">
            Could not load users — check Firestore rules are deployed.</p>`;
        return;
    }

    const me = getCurrentUser();

    users.sort((a, b) => {
        const aPending = !a.role && !a.blocked;
        const bPending = !b.role && !b.blocked;
        if (aPending !== bPending) return aPending ? -1 : 1;
        return (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '');
    });

    const pending = users.filter(u => !u.role && !u.blocked).length;
    const admins  = users.filter(u => u.role === 'admin').length;
    const editors = users.filter(u => u.role === 'editor').length;
    const viewers = users.filter(u => u.role === 'viewer').length;
    const blocked = users.filter(u => u.blocked).length;

    function providerLabel(p) {
        if (p === 'google.com') return '<span class="um-provider google">Google</span>';
        if (p === 'password')   return '<span class="um-provider email">Email</span>';
        return '<span class="um-provider guest">Unknown</span>';
    }

    function fmtDate(ts) {
        if (!ts) return '—';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        const diff = Date.now() - d.getTime();
        const mins  = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days  = Math.floor(diff / 86400000);
        if (mins < 2)   return 'just now';
        if (hours < 1)  return `${mins}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7)   return `${days}d ago`;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
    }

    function userRow(u) {
        const isMe      = me && u.uid === me.uid;
        const isPending = !u.role && !u.blocked;
        const isBlocked = !!u.blocked;
        const initials  = (u.displayName || u.email || '?')
            .trim().split(/\s+/)
            .map(w => w[0]).join('').slice(0, 2).toUpperCase();

        const roleOptions = ['viewer', 'editor', 'admin'].map(r =>
            `<option value="${r}"${u.role === r ? ' selected' : ''}>${r}</option>`
        ).join('');

        let statusBadge = '';
        if (isPending) statusBadge = '<span class="um-status-badge pending">Pending</span>';
        if (isBlocked) statusBadge = '<span class="um-status-badge blocked">Blocked</span>';

        const rowClass = isPending ? 'um-row pending' : isBlocked ? 'um-row blocked' : 'um-row';

        return `
        <div class="${rowClass}" data-uid="${escHtml(u.uid)}">
            <div class="um-avatar" aria-hidden="true">${escHtml(initials)}</div>
            <div class="um-user-info">
                <div class="um-user-name">
                    ${escHtml(u.displayName || '(no name)')}
                    ${isMe ? '<span class="um-you-tag">you</span>' : ''}
                    ${statusBadge}
                </div>
                <div class="um-user-email">${escHtml(u.email || '—')}</div>
            </div>
            <div class="um-meta">
                ${providerLabel(u.provider || '')}
                <span class="um-lastseen">${fmtDate(u.lastLoginAt)}</span>
            </div>
            <div class="um-actions">
                ${isPending ? `
                    <label class="um-grant-label" style="font-size:0.78rem;color:var(--grey-600,#6c757d);">Grant:</label>
                    <select class="um-role-select um-grant-select" data-uid="${escHtml(u.uid)}" ${isMe ? 'disabled' : ''}>
                        <option value="">— choose —</option>
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                    </select>
                ` : `
                    <select class="um-role-select" data-uid="${escHtml(u.uid)}" ${isMe || isBlocked ? 'disabled' : ''}>
                        ${roleOptions}
                    </select>
                `}
                ${isBlocked
                    ? `<button class="btn btn-sm btn-secondary um-unblock-btn" data-uid="${escHtml(u.uid)}">Unblock</button>`
                    : isMe
                        ? `<span style="font-size:0.78rem;color:var(--grey-400,#adb5bd);">—</span>`
                        : `<button class="btn btn-sm um-block-btn" data-uid="${escHtml(u.uid)}">Block</button>`
                }
            </div>
        </div>`;
    }

    umContent.innerHTML = `
        <div class="um-stats-row">
            <div class="um-stat-chip${pending > 0 ? ' highlight' : ''}">
                <span class="um-stat-num">${pending}</span> pending
            </div>
            <div class="um-stat-chip">
                <span class="um-stat-num">${admins}</span> admin${admins !== 1 ? 's' : ''}
            </div>
            <div class="um-stat-chip">
                <span class="um-stat-num">${editors}</span> editor${editors !== 1 ? 's' : ''}
            </div>
            <div class="um-stat-chip">
                <span class="um-stat-num">${viewers}</span> viewer${viewers !== 1 ? 's' : ''}
            </div>
            ${blocked > 0 ? `<div class="um-stat-chip blocked">
                <span class="um-stat-num">${blocked}</span> blocked
            </div>` : ''}
        </div>
        ${users.length === 0
            ? `<p class="section-hint">No users have signed in yet.</p>`
            : `<div class="um-list">${users.map(userRow).join('')}</div>`
        }`;

    document.dispatchEvent(new CustomEvent('pending-users-changed'));

    umContent.querySelectorAll('.um-grant-select').forEach(sel => {
        sel.addEventListener('change', async () => {
            const role = sel.value;
            const uid  = sel.dataset.uid;
            if (!role) return;
            try {
                await updateUserRole(uid, role);
                showToast(`Access granted (${role})`, 'success');
                await renderUsersSection(container);
            } catch (e) {
                showToast('Could not update role', 'error');
                console.error(e);
            }
        });
    });

    umContent.querySelectorAll('.um-role-select:not(.um-grant-select)').forEach(sel => {
        sel.addEventListener('change', async () => {
            const role = sel.value;
            const uid  = sel.dataset.uid;
            if (!role) return;
            if (!confirm(`Change this user's role to "${role}"?`)) {
                await renderUsersSection(container);
                return;
            }
            try {
                await updateUserRole(uid, role);
                showToast(`Role updated to ${role}`, 'success');
                await renderUsersSection(container);
            } catch (e) {
                showToast('Could not update role', 'error');
                console.error(e);
            }
        });
    });

    umContent.querySelectorAll('.um-block-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Block this user? They will see an access-denied screen on their next sign-in.')) return;
            try {
                await setUserBlocked(btn.dataset.uid, true);
                showToast('User blocked', 'success');
                await renderUsersSection(container);
            } catch (e) {
                showToast('Could not block user', 'error');
                console.error(e);
            }
        });
    });

    umContent.querySelectorAll('.um-unblock-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            try {
                await setUserBlocked(btn.dataset.uid, false);
                showToast('User unblocked', 'success');
                await renderUsersSection(container);
            } catch (e) {
                showToast('Could not unblock user', 'error');
                console.error(e);
            }
        });
    });
}

async function renderAdmin(container) {
    let locations = [], wishlist = [];
    try {
        [locations, wishlist] = await Promise.all([
            getNurseryLocations(),
            getNurseryWishlist()
        ]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading admin data.</p></div>`;
        return;
    }

    container.innerHTML = `
        <div class="view-content">

            <!-- User Management -->
            <section class="admin-section">
                <div class="section-header-row">
                    <h2 class="section-heading" style="margin:0;">👥 User Management</h2>
                </div>
                <p class="section-hint" style="margin-bottom:10px;">
                    Roles apply to both <strong>Garden Management</strong> and
                    <strong>Nursery Management</strong> — they share the same Firebase project.
                </p>
                <div id="um-content"><p class="section-hint">Loading users…</p></div>
            </section>

            <!-- Propagation Locations -->
            <section class="admin-section">
                <div class="section-header-row">
                    <h2 class="section-heading" style="margin:0;">📍 Propagation Locations</h2>
                    <button class="btn btn-sm btn-primary" id="add-location-btn">+ Add</button>
                </div>
                <p class="section-hint">Where do you propagate? E.g. Heated Propagator, Cold Frame, South Windowsill.</p>

                <div id="locations-list">
                    ${locations.length === 0
                        ? `<div class="empty-state" style="margin-top:12px;">
                               <p style="color:var(--grey-600);font-size:0.9rem;">No locations yet. Add one to get started.</p>
                           </div>`
                        : `<div class="card-list">
                               ${locations.map(loc => locationCard(loc)).join('')}
                           </div>`
                    }
                </div>
            </section>

            <!-- Wishlist / Ideas -->
            <section class="admin-section">
                <div class="section-header-row">
                    <h2 class="section-heading" style="margin:0;">💡 App Wishlist & Ideas</h2>
                    <button class="btn btn-sm btn-primary" id="add-wish-btn">+ Add</button>
                </div>
                <p class="section-hint">Record feature ideas, improvements, or things you'd like to change about this app.</p>
                <div id="wishlist-list">
                    ${wishlist.length === 0
                        ? `<div class="empty-state" style="margin-top:12px;">
                               <p style="color:var(--grey-600);font-size:0.9rem;">No ideas yet — add your first one!</p>
                           </div>`
                        : `<div class="card-list">
                               ${wishlist.map(item => wishCard(item)).join('')}
                           </div>`
                    }
                </div>
            </section>

            <!-- Backup -->
            <section class="admin-section">
                <h2 class="section-heading">💾 Backup</h2>
                <p class="section-hint">Download a full JSON export of all nursery data (batches, logs, outcomes, locations).</p>
                <button class="btn btn-secondary" id="backup-btn">Download backup</button>
            </section>

            <!-- Link to Garden Management -->
            <section class="admin-section">
                <h2 class="section-heading">🔗 Garden Management</h2>
                <p class="section-hint">This app shares the same Firebase project as your Garden Management app.</p>
                <a class="btn btn-secondary" href="https://johnandkath.garden" target="_blank" rel="noopener">
                    Open Garden Management ↗
                </a>
            </section>

        </div>
    `;

    container.querySelector('#add-location-btn')?.addEventListener('click', () => {
        showLocationForm(null, () => renderAdmin(container));
    });

    container.querySelectorAll('.location-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.closest('[data-id]')?.dataset.id;
            const loc = locations.find(l => l.id === id);
            if (loc) showLocationForm(loc, () => renderAdmin(container));
        });
    });

    container.querySelectorAll('.location-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id = btn.closest('[data-id]')?.dataset.id;
            const loc = locations.find(l => l.id === id);
            if (!loc) return;
            if (!confirm(`Delete location "${loc.name}"? Any batches using it will keep the name but lose the link.`)) return;
            try {
                await deleteNurseryLocation(id);
                showToast('Location deleted', 'success');
                await renderAdmin(container);
            } catch (err) {
                console.error(err);
                showToast('Could not delete location', 'error');
            }
        });
    });

    container.querySelector('#add-wish-btn')?.addEventListener('click', () => {
        showWishForm(null, () => renderAdmin(container));
    });

    container.querySelectorAll('.wish-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.closest('[data-id]')?.dataset.id;
            const item = wishlist.find(w => w.id === id);
            if (item) showWishForm(item, () => renderAdmin(container));
        });
    });

    container.querySelectorAll('.wish-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id = btn.closest('[data-id]')?.dataset.id;
            const item = wishlist.find(w => w.id === id);
            if (!item) return;
            if (!confirm(`Delete "${item.title}"?`)) return;
            try {
                await deleteNurseryWishlistItem(id);
                showToast('Idea deleted', 'success');
                await renderAdmin(container);
            } catch (err) {
                console.error(err);
                showToast('Could not delete', 'error');
            }
        });
    });

    container.querySelectorAll('.wish-status-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id = btn.closest('[data-id]')?.dataset.id;
            const item = wishlist.find(w => w.id === id);
            if (!item) return;
            const cycle = { idea: 'planned', planned: 'done', done: 'idea' };
            const newStatus = cycle[item.status] || 'idea';
            try {
                await updateNurseryWishlistItem(id, { status: newStatus });
                await renderAdmin(container);
            } catch (err) {
                console.error(err);
                showToast('Could not update status', 'error');
            }
        });
    });

    container.querySelector('#backup-btn')?.addEventListener('click', async () => {
        try {
            const data = await exportNurseryData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `nursery-backup-${ts}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Backup downloaded', 'success');
        } catch (err) {
            console.error(err);
            showToast('Backup failed', 'error');
        }
    });
}

// =============================================
//  Location card
// =============================================

function locationCard(loc) {
    const typeLabel = LOCATION_TYPES.find(t => t.value === loc.type)?.label || loc.type || '—';
    return `
        <div class="admin-card" data-id="${escHtml(loc.id)}">
            <div class="admin-card-main">
                <div>
                    <div class="admin-card-title">${escHtml(loc.name)}</div>
                    <div class="admin-card-subtitle">${typeLabel}</div>
                    ${loc.description ? `<div class="admin-card-desc">${escHtml(loc.description)}</div>` : ''}
                </div>
                <div class="admin-card-actions">
                    <button class="icon-btn location-edit-btn" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="icon-btn danger location-delete-btn" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// =============================================
//  Location form (add / edit)
// =============================================

function showLocationForm(existing, onSaved) {
    const isEdit = !!existing;
    showModal(isEdit ? 'Edit Location' : 'Add Location', `
        <form id="location-form" novalidate>
            <div class="form-group">
                <label class="form-label" for="loc-name">Name <span class="required">*</span></label>
                <input class="form-input" type="text" id="loc-name" name="name"
                       value="${escHtml(existing?.name || '')}"
                       placeholder="e.g. Heated Propagator, Cold Frame, South Windowsill"
                       required maxlength="80" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label" for="loc-type">Type <span class="required">*</span></label>
                <select class="form-input" id="loc-type" name="type">
                    ${LOCATION_TYPES.map(t => `
                        <option value="${t.value}" ${(existing?.type || 'indoor') === t.value ? 'selected' : ''}>
                            ${t.label}
                        </option>`).join('')}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="loc-desc">Description (optional)</label>
                <textarea class="form-input" id="loc-desc" name="description" rows="2"
                          placeholder="Any extra notes about this location…">${escHtml(existing?.description || '')}</textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="loc-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="loc-save-btn">
                    ${isEdit ? 'Save changes' : 'Add location'}
                </button>
            </div>
        </form>
    `);

    document.getElementById('loc-cancel-btn')?.addEventListener('click', hideModal);

    document.getElementById('location-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('loc-name')?.value.trim();
        if (!name) {
            showToast('Please enter a location name', 'error');
            return;
        }

        const data = {
            name,
            type:        document.getElementById('loc-type')?.value || 'indoor',
            description: document.getElementById('loc-desc')?.value.trim() || ''
        };

        const saveBtn = document.getElementById('loc-save-btn');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        try {
            if (isEdit) {
                await updateNurseryLocation(existing.id, data);
                showToast('Location updated', 'success');
            } else {
                await addNurseryLocation(data);
                showToast('Location added', 'success');
            }
            hideModal();
            await onSaved();
        } catch (err) {
            console.error(err);
            showToast('Could not save location', 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = isEdit ? 'Save changes' : 'Add location';
        }
    });
}

// =============================================
//  Wishlist card
// =============================================

const WISH_STATUS_CONFIG = {
    idea:    { label: 'Idea',    colour: 'var(--grey-400)',   bg: 'var(--grey-100)' },
    planned: { label: 'Planned', colour: 'var(--amber)',      bg: '#fff4ec' },
    done:    { label: 'Done',    colour: 'var(--green-700)',  bg: 'var(--green-100)' }
};

const WISH_PRIORITY_CONFIG = {
    high:   { label: '🔴 High',   colour: '#e63946' },
    medium: { label: '🟡 Medium', colour: '#f4a261' },
    low:    { label: '🟢 Low',    colour: 'var(--green-500)' }
};

function wishCard(item) {
    const sc = WISH_STATUS_CONFIG[item.status] || WISH_STATUS_CONFIG.idea;
    const pc = WISH_PRIORITY_CONFIG[item.priority] || WISH_PRIORITY_CONFIG.medium;
    return `
        <div class="admin-card" data-id="${escHtml(item.id)}">
            <div class="admin-card-main">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;">
                        <div class="admin-card-title" style="margin:0;">${escHtml(item.title)}</div>
                        <button class="wish-status-btn pill-tag" title="Click to cycle status"
                            style="background:${sc.bg};color:${sc.colour};border:none;cursor:pointer;padding:2px 8px;border-radius:99px;font-size:0.72rem;font-weight:600;">
                            ${sc.label}
                        </button>
                    </div>
                    <div style="font-size:0.78rem;color:${pc.colour};margin-bottom:${item.description ? '4px' : '0'};">${pc.label}</div>
                    ${item.description ? `<div class="admin-card-desc" style="color:var(--grey-600);font-size:0.85rem;">${escHtml(item.description)}</div>` : ''}
                </div>
                <div class="admin-card-actions">
                    <button class="icon-btn wish-edit-btn" title="Edit">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button class="icon-btn danger wish-delete-btn" title="Delete">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                    </button>
                </div>
            </div>
        </div>
    `;
}

// =============================================
//  Wishlist form (add / edit)
// =============================================

function showWishForm(existing, onSaved) {
    const isEdit = !!existing;
    showModal(isEdit ? 'Edit Idea' : 'Add Idea', `
        <form id="wish-form" novalidate>
            <div class="form-group">
                <label class="form-label" for="wish-title">Title <span class="required">*</span></label>
                <input class="form-input" type="text" id="wish-title" name="title"
                       value="${escHtml(existing?.title || '')}"
                       placeholder="e.g. Add photo thumbnails to batch list"
                       required maxlength="120" autocomplete="off">
            </div>
            <div class="form-group">
                <label class="form-label" for="wish-desc">Description (optional)</label>
                <textarea class="form-input" id="wish-desc" name="description" rows="3"
                          placeholder="More detail about why this would be useful…">${escHtml(existing?.description || '')}</textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                    <label class="form-label" for="wish-priority">Priority</label>
                    <select class="form-input" id="wish-priority" name="priority">
                        <option value="low"    ${(existing?.priority || 'medium') === 'low'    ? 'selected' : ''}>🟢 Low</option>
                        <option value="medium" ${(existing?.priority || 'medium') === 'medium' ? 'selected' : ''}>🟡 Medium</option>
                        <option value="high"   ${(existing?.priority || 'medium') === 'high'   ? 'selected' : ''}>🔴 High</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="wish-status">Status</label>
                    <select class="form-input" id="wish-status" name="status">
                        <option value="idea"    ${(existing?.status || 'idea') === 'idea'    ? 'selected' : ''}>💡 Idea</option>
                        <option value="planned" ${(existing?.status || 'idea') === 'planned' ? 'selected' : ''}>📅 Planned</option>
                        <option value="done"    ${(existing?.status || 'idea') === 'done'    ? 'selected' : ''}>✅ Done</option>
                    </select>
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="wish-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="wish-save-btn">
                    ${isEdit ? 'Save changes' : 'Add idea'}
                </button>
            </div>
        </form>
    `);

    document.getElementById('wish-cancel-btn')?.addEventListener('click', hideModal);

    document.getElementById('wish-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const title = document.getElementById('wish-title')?.value.trim();
        if (!title) { showToast('Please enter a title', 'error'); return; }

        const data = {
            title,
            description: document.getElementById('wish-desc')?.value.trim() || '',
            priority:    document.getElementById('wish-priority')?.value || 'medium',
            status:      document.getElementById('wish-status')?.value || 'idea'
        };

        const saveBtn = document.getElementById('wish-save-btn');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        try {
            if (isEdit) {
                await updateNurseryWishlistItem(existing.id, data);
                showToast('Idea updated', 'success');
            } else {
                await addNurseryWishlistItem(data);
                showToast('Idea added', 'success');
            }
            hideModal();
            await onSaved();
        } catch (err) {
            console.error(err);
            showToast('Could not save idea', 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = isEdit ? 'Save changes' : 'Add idea';
        }
    });
}
