// =============================================================
//  admin-view.js — Admin panel: Backup, Restore, and future tools
// =============================================================

import {
    getDataCounts,
    exportAllData,
    importAllData,
    clearAllData,
    getPlants,
    getInstances,
    getAreas,
    addPlant,
    addArea,
    addInstance,
    getSuggestions,
    addSuggestion,
    updateSuggestion,
    deleteSuggestion,
    getUsers,
    updateUserRole,
    setUserBlocked,
    escHtml
} from './db.js';
import { showToast, navigate } from './ui-utils.js';
import { isAtLeast, getCurrentUser } from './auth.js';

export async function renderAdminView(container, headerActionEl, backBtn) {
    backBtn.classList.remove('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();

    // Editors see Wishlist only; admins see the full admin panel
    if (!isAtLeast('editor')) {
        container.innerHTML = `<div class="empty-state"><p>Access denied.</p></div>`;
        return;
    }

    if (!isAtLeast('admin')) {
        // Editor view — wishlist only
        container.innerHTML = buildWishlistOnlyHTML();
        bindWishlistEvents(container);
        return;
    }

    // Admin view — full panel
    container.innerHTML = `<div class="empty-state"><p>Loading…</p></div>`;

    let counts;
    try {
        counts = await getDataCounts();
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading data. Check your Firebase connection.</p></div>`;
        return;
    }

    container.innerHTML = buildAdminHTML(counts);
    bindAdminEvents(container);

    // Load user management section asynchronously (separate Firestore read)
    renderUsersSection(container);
}

// =============================================
//  EDITOR-ONLY HTML (Wishlist & Ideas)
// =============================================

function buildWishlistOnlyHTML() {
    return `
        <div class="detail-section">
            <div class="detail-section-title">💡 Wishlist &amp; Ideas</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Suggest ideas for the garden or improvements for this app. Tick items off as they're done.
            </p>
            <div style="display:flex;gap:8px;margin-bottom:14px;">
                <input class="form-input" id="new-suggestion-input"
                       placeholder="Add an idea or improvement…" autocapitalize="sentences"
                       style="flex:1;">
                <button class="btn btn-primary" id="add-suggestion-btn" style="flex-shrink:0;">Add</button>
            </div>
            <div id="suggestions-list"></div>
        </div>
    `;
}

function bindWishlistEvents(container) {
    const suggListEl = container.querySelector('#suggestions-list');

    async function renderSuggestions() {
        if (!suggListEl) return;
        let items;
        try { items = await getSuggestions(); } catch (_) {
            suggListEl.innerHTML = `<p class="form-hint">Could not load ideas.</p>`; return;
        }
        if (items.length === 0) {
            suggListEl.innerHTML = `<p class="form-hint">No ideas yet — add your first one above!</p>`;
            return;
        }
        items.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
        suggListEl.innerHTML = items.map(s => `
            <div class="suggestion-item${s.done ? ' done' : ''}" data-id="${s.id}">
                <label class="suggestion-label">
                    <input type="checkbox" class="suggestion-check"${s.done ? ' checked' : ''}>
                    <span class="suggestion-text">${escHtml(s.text)}</span>
                </label>
                <button class="suggestion-delete" title="Remove">✕</button>
            </div>`).join('');

        suggListEl.querySelectorAll('.suggestion-check').forEach(cb => {
            cb.addEventListener('change', async () => {
                const item = cb.closest('.suggestion-item');
                try {
                    await updateSuggestion(item.dataset.id, { done: cb.checked });
                    await renderSuggestions();
                } catch (_) { cb.checked = !cb.checked; }
            });
        });
        suggListEl.querySelectorAll('.suggestion-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.suggestion-item');
                try {
                    await deleteSuggestion(item.dataset.id);
                    item.remove();
                    if (!suggListEl.querySelector('.suggestion-item'))
                        suggListEl.innerHTML = `<p class="form-hint">No ideas yet — add your first one above!</p>`;
                } catch (_) {}
            });
        });
    }

    renderSuggestions();

    const suggInput  = container.querySelector('#new-suggestion-input');
    const suggAddBtn = container.querySelector('#add-suggestion-btn');

    async function handleAdd() {
        const text = (suggInput?.value || '').trim();
        if (!text) return;
        try {
            await addSuggestion(text);
            suggInput.value = '';
            await renderSuggestions();
            suggInput.focus();
        } catch (_) { showToast('Could not save idea', 'error'); }
    }
    suggAddBtn?.addEventListener('click', handleAdd);
    suggInput?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } });
}

// =============================================
//  USER MANAGEMENT
// =============================================

/**
 * Fetch all users and render the User Management section inside #um-content.
 * Re-renders in place when roles or blocked status change (called after each action).
 * Dispatches 'pending-users-changed' so main.js can refresh the nav badge.
 */
async function renderUsersSection(container) {
    const umContent = container.querySelector('#um-content');
    if (!umContent) return;

    let users;
    try {
        users = await getUsers();
    } catch (e) {
        umContent.innerHTML = `<p class="form-hint" style="color:var(--red);">
            Could not load users — check Firestore rules are deployed.</p>`;
        return;
    }

    const me = getCurrentUser();

    // Sort: pending first, then by displayName
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

    // Relative "last seen" for the user list — a Firestore Timestamp in, a phrase
    // out. Deliberately NOT db.js's fmtDate, which formats a YYYY-MM-DD string.
    // Renamed from fmtDate on 2026-08-10 so the two are not confused again.
    function fmtLastSeen(ts) {
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
                <span class="um-lastseen">${fmtLastSeen(u.lastLoginAt)}</span>
            </div>
            <div class="um-actions">
                ${isPending ? `
                    <label class="um-grant-label" style="font-size:0.78rem;color:var(--grey-600);">Grant:</label>
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
                        ? `<span style="font-size:0.78rem;color:var(--grey-400);">—</span>`
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
            ? `<p class="form-hint">No users have signed in yet.</p>`
            : `<div class="um-list">${users.map(userRow).join('')}</div>`
        }`;

    // Notify main.js so the nav badge can refresh
    document.dispatchEvent(new CustomEvent('pending-users-changed'));

    // ---- Event bindings ----

    // Grant role to pending user (select with "— choose —" default)
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

    // Change role for existing active user
    umContent.querySelectorAll('.um-role-select:not(.um-grant-select)').forEach(sel => {
        sel.addEventListener('change', async () => {
            const role = sel.value;
            const uid  = sel.dataset.uid;
            if (!role) return;
            if (!confirm(`Change this user's role to "${role}"?`)) {
                await renderUsersSection(container); // reset the dropdown
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

    // Block user
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

    // Unblock user
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

// =============================================
//  HTML
// =============================================

function buildAdminHTML(counts) {
    const total = counts.plants + counts.areas + counts.instances + counts.photos
                + (counts.tasks || 0) + (counts.taskAssignments || 0);
    return `
        <!-- Irrigation shortcut -->
        <div class="detail-section">
            <div class="detail-section-title">💧 Irrigation</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Manage irrigation zones and log watering events.
            </p>
            <button class="btn btn-secondary" id="goto-irrigation-btn">💧 Open Irrigation</button>
        </div>

        <!-- User Management -->
        <div class="detail-section" id="um-section">
            <div class="detail-section-title">👥 User Management</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:6px;line-height:1.5;">
                Manage who has access to this app. Roles apply to both
                <strong>Garden Management</strong> and <strong>Nursery Management</strong>
                — they share the same Firebase project.
            </p>
            <div id="um-content"><p class="form-hint">Loading users…</p></div>
        </div>

        <!-- Wishlist & Ideas -->
        <div class="detail-section">
            <div class="detail-section-title">💡 Wishlist &amp; Ideas</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Keep track of improvement ideas for the garden or this app — no need for a separate notes tool.
                Tick items off as they're done.
            </p>
            <div style="display:flex;gap:8px;margin-bottom:14px;">
                <input class="form-input" id="new-suggestion-input"
                       placeholder="Add an idea or improvement…" autocapitalize="sentences"
                       style="flex:1;">
                <button class="btn btn-primary" id="add-suggestion-btn" style="flex-shrink:0;">Add</button>
            </div>
            <div id="suggestions-list"></div>
        </div>

        <!-- Database summary -->
        <div class="detail-section">
            <div class="detail-section-title">Database Summary</div>
            <div class="admin-stats">
                ${statTile('🌿', counts.plants,    'Plants')}
                ${statTile('🗺️', counts.areas,     'Areas')}
                ${statTile('📍', counts.instances,  'Locations')}
                ${statTile('🌱', counts.specimens,  'Specimens')}
                ${statTile('📷', counts.photos,     'Photos')}
            </div>
            <div class="admin-stats" style="margin-top:10px;">
                ${statTile('📋', counts.tasks || 0,           'Tasks')}
                ${statTile('✅', counts.taskAssignments || 0, 'Assignments')}
                ${statTile('📝', counts.blogPosts || 0,       'Blog Posts')}
                ${statTile('🪵', counts.composted || 0,       'Composted')}
            </div>
            <p class="form-hint" style="margin-top:10px;">${total} total records in Firestore.</p>
        </div>

        <!-- Data Quality -->
        <div class="detail-section">
            <div class="detail-section-title">Data Quality</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Scan for plant entries that share the same Genus, Species, and Cultivar —
                which may be duplicates introduced by spreadsheet imports or accidental
                double-entry. Opens a full comparison report in a new tab.
            </p>
            <button class="btn btn-secondary" id="duplicate-report-btn">🔍 Find duplicate plants</button>
        </div>

        <!-- Backup -->
        <div class="detail-section">
            <div class="detail-section-title">Backup</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Download a <code>.json</code> snapshot of all your plants, areas, locations,
                and photo records. Save it somewhere safe — your Downloads folder, Google Drive,
                email it to yourself, etc.
            </p>
            <p class="form-hint" style="margin-bottom:14px;">
                ⚠️ Photo <em>images</em> are stored in Firebase Storage and are not included in this file —
                only the metadata (which photo belongs to which plant). Back up regularly before making
                large changes.
            </p>
            <button class="btn btn-primary" id="export-btn">⬇️ Download backup</button>
        </div>

        <!-- Restore -->
        <div class="detail-section">
            <div class="detail-section-title">Restore</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Choose a previously downloaded <code>.json</code> backup file to restore from.
                You can merge it into existing data, or wipe first for a clean restore.
            </p>

            <div class="admin-restore-options" id="restore-options">
                <label class="admin-radio-row">
                    <input type="radio" name="restore-mode" value="merge" checked>
                    <div>
                        <strong>Merge</strong>
                        <div class="form-hint">Adds or overwrites records from the backup. Existing records not in the backup are left alone.</div>
                    </div>
                </label>
                <label class="admin-radio-row">
                    <input type="radio" name="restore-mode" value="replace">
                    <div>
                        <strong>Replace (wipe first)</strong>
                        <div class="form-hint">Deletes all current data, then restores from the backup. Use this for a full rollback.</div>
                    </div>
                </label>
            </div>

            <div style="margin-top:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <label class="btn btn-secondary" style="cursor:pointer;">
                    📂 Choose backup file
                    <input type="file" id="import-file" accept=".json" style="display:none">
                </label>
                <span id="import-filename" class="form-hint"></span>
            </div>
            <div style="margin-top:10px;">
                <button class="btn btn-primary" id="import-btn" disabled>↩️ Restore from backup</button>
            </div>
            <div id="restore-progress" style="display:none;margin-top:12px;">
                <div class="upload-progress" style="margin-bottom:6px;">
                    <div class="upload-progress-bar" id="restore-progress-bar" style="width:0%"></div>
                </div>
                <span id="restore-progress-label" class="form-hint"></span>
            </div>
        </div>

        <!-- Spreadsheet Import -->
        <div class="detail-section">
            <div class="detail-section-title">Import from Spreadsheet</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Load plants from a prepared <code>plant-import.json</code> file. Any garden areas
                referenced in the file will be created automatically if they don't already exist.
                Existing plants are not affected — this only adds new records.
            </p>
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
                <label class="btn btn-secondary" style="cursor:pointer;">
                    📂 Choose import file
                    <input type="file" id="si-file" accept=".json" style="display:none">
                </label>
                <span id="si-filename" class="form-hint"></span>
            </div>
            <button class="btn btn-primary" id="si-btn" disabled>🌱 Import plants</button>
            <div id="si-progress" style="display:none;margin-top:12px;">
                <div class="upload-progress" style="margin-bottom:6px;">
                    <div class="upload-progress-bar" id="si-progress-bar" style="width:0%"></div>
                </div>
                <span id="si-progress-label" class="form-hint"></span>
            </div>
        </div>

        <!-- Danger zone -->
        <div class="detail-section" style="border:1.5px solid var(--grey-200);">
            <div class="detail-section-title danger">Danger Zone</div>
            <p style="font-size:0.92rem;color:var(--grey-600);margin-bottom:14px;line-height:1.5;">
                Permanently delete <strong>all</strong> plants, areas, locations, and photo records from
                Firestore. This cannot be undone. Download a backup first.
            </p>
            <button class="btn btn-danger btn-sm" id="clear-btn">🗑️ Delete all data</button>
        </div>
    `;
}

function statTile(icon, count, label) {
    return `
        <div class="admin-stat-tile">
            <div class="admin-stat-icon">${icon}</div>
            <div class="admin-stat-count">${count}</div>
            <div class="admin-stat-label">${label}</div>
        </div>
    `;
}

// =============================================
//  EVENTS
// =============================================

function bindAdminEvents(container) {

    // ---- IRRIGATION SHORTCUT ----
    container.querySelector('#goto-irrigation-btn')?.addEventListener('click', () => {
        navigate('irrigation', null);
    });

    // ---- SUGGESTIONS ----
    const suggListEl = container.querySelector('#suggestions-list');

    async function renderSuggestions() {
        if (!suggListEl) return;
        let items;
        try { items = await getSuggestions(); } catch (_) {
            suggListEl.innerHTML = `<p class="form-hint">Could not load ideas.</p>`; return;
        }
        if (items.length === 0) {
            suggListEl.innerHTML = `<p class="form-hint">No ideas yet — add your first one above!</p>`;
            return;
        }
        // Pending items first, completed items last (preserving createdAt order within each group)
        items.sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));

        suggListEl.innerHTML = items.map(s => `
            <div class="suggestion-item${s.done ? ' done' : ''}" data-id="${s.id}">
                <label class="suggestion-label">
                    <input type="checkbox" class="suggestion-check"${s.done ? ' checked' : ''}>
                    <span class="suggestion-text">${escHtml(s.text)}</span>
                </label>
                <button class="suggestion-delete" title="Remove">✕</button>
            </div>`).join('');

        suggListEl.querySelectorAll('.suggestion-check').forEach(cb => {
            cb.addEventListener('change', async () => {
                const item = cb.closest('.suggestion-item');
                try {
                    await updateSuggestion(item.dataset.id, { done: cb.checked });
                    await renderSuggestions(); // re-render so completed items sink to the bottom
                } catch (_) { cb.checked = !cb.checked; }
            });
        });

        suggListEl.querySelectorAll('.suggestion-delete').forEach(btn => {
            btn.addEventListener('click', async () => {
                const item = btn.closest('.suggestion-item');
                try {
                    await deleteSuggestion(item.dataset.id);
                    item.remove();
                    if (!suggListEl.querySelector('.suggestion-item'))
                        suggListEl.innerHTML = `<p class="form-hint">No ideas yet — add your first one above!</p>`;
                } catch (_) {}
            });
        });
    }

    renderSuggestions();

    const suggInput = container.querySelector('#new-suggestion-input');
    const suggAddBtn = container.querySelector('#add-suggestion-btn');

    async function handleAddSuggestion() {
        const text = (suggInput?.value || '').trim();
        if (!text) return;
        try {
            await addSuggestion(text);
            suggInput.value = '';
            await renderSuggestions();
            suggInput.focus();
        } catch (_) { showToast('Could not save idea', 'error'); }
    }
    suggAddBtn?.addEventListener('click', handleAddSuggestion);
    suggInput?.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); handleAddSuggestion(); }
    });

    // ---- EXPORT ----
    container.querySelector('#export-btn').addEventListener('click', async () => {
        const btn = container.querySelector('#export-btn');
        btn.disabled = true;
        btn.textContent = 'Exporting…';
        try {
            const data = await exportAllData();
            const json = JSON.stringify(data, null, 2);
            const blob = new Blob([json], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const ts   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `garden-backup-${ts}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Backup downloaded!', 'success');
        } catch (e) {
            showToast('Export failed', 'error');
            console.error(e);
        } finally {
            btn.disabled = false;
            btn.textContent = '⬇️ Download backup';
        }
    });

    // ---- FILE PICKER ----
    const importFile = container.querySelector('#import-file');
    const importBtn  = container.querySelector('#import-btn');
    const fileLabel  = container.querySelector('#import-filename');

    importFile.addEventListener('change', () => {
        const file = importFile.files[0];
        fileLabel.textContent = file ? file.name : '';
        importBtn.disabled = !file;
    });

    // ---- IMPORT / RESTORE ----
    importBtn.addEventListener('click', async () => {
        const file = importFile.files[0];
        if (!file) return;

        const mode = container.querySelector('input[name="restore-mode"]:checked').value;
        const wipe = mode === 'replace';

        const confirmMsg = wipe
            ? `This will DELETE all current data and replace it with the backup.\n\n"${file.name}"\n\nThis cannot be undone. Are you sure?`
            : `This will merge the backup into your current data.\n\n"${file.name}"\n\nContinue?`;

        if (!confirm(confirmMsg)) return;

        const progressEl  = container.querySelector('#restore-progress');
        const progressBar = container.querySelector('#restore-progress-bar');
        const progressLbl = container.querySelector('#restore-progress-label');
        importBtn.disabled = true;
        progressEl.style.display = 'block';

        try {
            // Parse JSON
            progressLbl.textContent = 'Reading file…';
            progressBar.style.width = '10%';
            const text   = await file.text();
            const backup = JSON.parse(text);

            if (!backup.version || backup.source === 'spreadsheet-import') {
                throw new Error('This looks like a spreadsheet import file, not a backup. Use the Import from Spreadsheet section below.');
            }

            // Optionally wipe
            if (wipe) {
                progressLbl.textContent = 'Clearing existing data…';
                progressBar.style.width = '25%';
                await clearAllData();
            }

            // Restore
            progressLbl.textContent = 'Restoring data…';
            progressBar.style.width = wipe ? '50%' : '30%';
            await importAllData(backup);

            progressBar.style.width = '100%';
            progressLbl.textContent = 'Done!';

            const total = (backup.plants?.length || 0) + (backup.areas?.length || 0)
                        + (backup.instances?.length || 0) + (backup.photos?.length || 0);
            showToast(`Restored ${total} records successfully!`, 'success');

            // Refresh the stats
            setTimeout(() => location.reload(), 1200);

        } catch (e) {
            showToast('Restore failed: ' + e.message, 'error');
            console.error(e);
            progressEl.style.display = 'none';
            importBtn.disabled = false;
        }
    });

    // ---- SPREADSHEET IMPORT ----
    const siFile  = container.querySelector('#si-file');
    const siBtn   = container.querySelector('#si-btn');
    const siLabel = container.querySelector('#si-filename');

    siFile.addEventListener('change', () => {
        siLabel.textContent = siFile.files[0]?.name || '';
        siBtn.disabled = !siFile.files[0];
    });

    siBtn.addEventListener('click', async () => {
        const file = siFile.files[0];
        if (!file) return;
        if (!confirm(`Import plants from "${file.name}"?\n\nThis will add new plant, area, and location records. Existing data is not changed.`)) return;

        const progressEl  = container.querySelector('#si-progress');
        const progressBar = container.querySelector('#si-progress-bar');
        const progressLbl = container.querySelector('#si-progress-label');
        siBtn.disabled = true;
        progressEl.style.display = 'block';

        try {
            progressLbl.textContent = 'Reading file…';
            const text = await file.text();
            const data = JSON.parse(text);

            if (data.source !== 'spreadsheet-import' || !Array.isArray(data.plants)) {
                throw new Error('This does not look like a plant import file. Use the Restore section for backup files.');
            }

            const plants = data.plants;

            // Build area name → ID map from existing areas
            progressLbl.textContent = 'Loading existing areas…';
            const existingAreas = await getAreas();
            const areaMap = {};
            existingAreas.forEach(a => { areaMap[a.name.trim().toLowerCase()] = a.id; });

            let created = 0, errors = 0;

            for (let i = 0; i < plants.length; i++) {
                const p = plants[i];
                const pct = Math.round(((i + 1) / plants.length) * 100);
                progressBar.style.width = pct + '%';
                progressLbl.textContent = `Importing plant ${i + 1} of ${plants.length}…`;

                try {
                    const plantData = {
                        genus:         p.genus        || '',
                        species:       p.species      || '',
                        hybrid:        !!(p.hybrid || p.hybridType),
                        hybridType:    p.hybridType || (p.hybrid ? 'interspecific' : null),
                        cultivar:      p.cultivar     || '',
                        subspecies:    p.subspecies   || '',
                        variety:       p.variety      || '',
                        authority:     p.authority    || '',
                        commonName:    p.commonName   || '',
                        height:        p.height       || '',
                        width:         p.width        || '',
                        notes:         p.notes        || '',
                        dateAcquired:  p.datePlanted  || '',
                        careReminders: '',
                    };

                    const plantRef = await addPlant(plantData);

                    if (p.area) {
                        const areaKey = p.area.trim().toLowerCase();
                        if (!areaMap[areaKey]) {
                            const areaRef = await addArea({ name: p.area.trim(), description: '' });
                            areaMap[areaKey] = areaRef.id;
                        }
                        await addInstance({
                            plantId:     plantRef.id,
                            areaId:      areaMap[areaKey],
                            quantity:    p.qty || 1,
                            datePlanted: p.datePlanted || '',
                            notes:       '',
                        });
                    }

                    created++;
                } catch (err) {
                    errors++;
                    console.error('Failed to import plant:', p, err);
                }
            }

            progressBar.style.width = '100%';
            progressLbl.textContent = `Done! ${created} plants imported${errors ? `, ${errors} errors (see console)` : ''}.`;
            showToast(`${created} plants imported successfully!`, 'success');
            setTimeout(() => location.reload(), 1500);

        } catch (e) {
            showToast('Import failed: ' + e.message, 'error');
            console.error(e);
            progressEl.style.display = 'none';
            siBtn.disabled = false;
        }
    });

    // ---- CLEAR ALL ----
    container.querySelector('#clear-btn').addEventListener('click', async () => {
        if (!confirm('DELETE ALL DATA?\n\nThis will permanently remove every plant, area, location, and photo record from Firestore. The action cannot be undone.\n\nAre you absolutely sure?')) return;
        if (!confirm('Last chance — this is permanent. Proceed?')) return;
        try {
            await clearAllData();
            showToast('All data deleted.', 'success');
            setTimeout(() => location.reload(), 1000);
        } catch (e) {
            showToast('Error deleting data', 'error');
            console.error(e);
        }
    });

    // ---- DUPLICATE PLANTS REPORT ----
    container.querySelector('#duplicate-report-btn')?.addEventListener('click', async () => {
        const btn = container.querySelector('#duplicate-report-btn');
        btn.disabled = true;
        btn.textContent = 'Analysing…';
        try {
            const [plants, instances, areas] = await Promise.all([
                getPlants(), getInstances(), getAreas()
            ]);
            const html = buildDuplicateReportHTML(plants, instances, areas);
            const blob = new Blob([html], { type: 'text/html' });
            const url  = URL.createObjectURL(blob);
            const win  = window.open(url, '_blank');
            if (!win) showToast('Pop-up blocked — please allow pop-ups for this site', 'error');
        } catch (e) {
            showToast('Error generating report', 'error');
            console.error(e);
        } finally {
            btn.disabled = false;
            btn.textContent = '🔍 Find duplicate plants';
        }
    });
}

// =============================================
//  DUPLICATE PLANTS REPORT  (opens in new tab)
// =============================================

function buildDuplicateReportHTML(plants, instances, areas) {
    const date = new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    // Build lookup maps
    const areaMap = Object.fromEntries(areas.map(a => [a.id, a.name]));
    const instancesByPlant = {};
    for (const inst of instances) {
        if (!instancesByPlant[inst.plantId]) instancesByPlant[inst.plantId] = [];
        instancesByPlant[inst.plantId].push(inst);
    }

    // Similarity key: genus + species + cultivar (case-insensitive)
    function simKey(p) {
        return [
            (p.genus    || '').toLowerCase().trim(),
            (p.species  || '').toLowerCase().trim(),
            (p.cultivar || '').toLowerCase().trim(),
        ].join('||');
    }

    // Group plants with the same key; skip plants that have no genus at all
    const groups = {};
    for (const plant of plants) {
        if (!plant.genus) continue;
        const key = simKey(plant);
        if (!groups[key]) groups[key] = [];
        groups[key].push(plant);
    }

    const duplicateGroups = Object.values(groups)
        .filter(g => g.length >= 2)
        .sort((a, b) => (a[0].genus || '').localeCompare(b[0].genus || ''));

    // ---- No duplicates found ----
    if (duplicateGroups.length === 0) {
        return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Duplicate Plants Report</title>
<style>body{font-family:Arial,Helvetica,sans-serif;padding:32px;max-width:960px;margin:0 auto;color:#1a1a1a;}
h1{color:#2d6a4f;font-size:16pt;margin-bottom:4px;}.meta{font-size:9pt;color:#666;margin-bottom:20px;}
.ok{font-size:11pt;color:#166534;background:#dcfce7;padding:14px 18px;border-radius:6px;border-left:3px solid #16a34a;}</style>
</head><body>
<h1>Duplicate Plants Report</h1>
<div class="meta">Generated ${date} &middot; ${plants.length} plants checked</div>
<div class="ok">✅ No duplicate entries found. Every plant has a unique Genus / Species / Cultivar combination.</div>
</body></html>`;
    }

    // ---- Field definitions for comparison rows ----
    const FIELDS = [
        { key: 'genus',         label: 'Genus' },
        { key: 'species',       label: 'Species' },
        { key: 'hybrid',        label: 'Hybrid ×',       fmt: v => v ? 'Yes' : '' },
        { key: 'hybridType',    label: 'Hybrid type',    fmt: v => v || '' },
        { key: 'subspecies',    label: 'Subspecies' },
        { key: 'variety',       label: 'Variety' },
        { key: 'cultivar',      label: 'Cultivar' },
        { key: 'authority',     label: 'Authority' },
        { key: 'commonName',    label: 'Common name' },
        { key: 'dateAcquired',  label: 'Date acquired' },
        { key: 'height',        label: 'Height' },
        { key: 'width',         label: 'Width' },
        { key: 'notes',         label: 'Notes' },
        { key: 'careReminders', label: 'Care reminders' },
        { key: '_locations',    label: 'Garden locations' },
    ];

    function esc(s) {
        if (s === null || s === undefined) return '';
        return String(s)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function getVal(plant, field) {
        if (field.key === '_locations') {
            const insts = instancesByPlant[plant.id] || [];
            if (!insts.length) return '';
            return insts.map(i => {
                const parts = [areaMap[i.areaId] || 'Unknown area'];
                if (i.quantity > 1) parts.push(`×${i.quantity}`);
                if (i.datePlanted) parts.push(i.datePlanted);
                return parts.join(' ');
            }).join('; ');
        }
        const raw = plant[field.key];
        if (field.fmt) return field.fmt(raw) ?? '';
        return raw ?? '';
    }

    function buildGroupHTML(group) {
        const p0 = group[0];

        // Only show fields where at least one plant has a value
        const activeFields = FIELDS.filter(f =>
            group.some(p => String(getVal(p, f)).trim() !== '')
        );

        const colPct = Math.floor(68 / group.length);

        const headerCells = group.map((p, i) => `
            <th class="col-plant">
                Plant ${i + 1}
                <div class="plant-id">ID: ${esc(p.id.slice(0, 8))}…</div>
            </th>`).join('');

        const rows = activeFields.map(field => {
            const vals = group.map(p => String(getVal(p, field)));
            const allSame = vals.every(v => v.toLowerCase() === vals[0].toLowerCase());
            const cells = vals.map(v =>
                `<td class="val-cell${allSame ? '' : ' differs'}">${esc(v) || '<span class="empty">—</span>'}</td>`
            ).join('');
            return `<tr>
                <td class="field-label">${field.label}</td>
                ${cells}
                <td class="flag-cell">${allSame ? '' : '⚠ differs'}</td>
            </tr>`;
        }).join('');

        // Italic botanical heading — ×Genus for intergeneric, Genus × species for interspecific
        const p0ht = p0.hybridType || (p0.hybrid ? 'interspecific' : null);
        const botHead = [
            p0.genus   ? (p0ht === 'intergeneric' ? `×<em>${esc(p0.genus)}</em>` : `<em>${esc(p0.genus)}</em>`) : '',
            (p0ht === 'interspecific' && p0.species) ? '×' : '',
            p0.species ? `<em>${esc(p0.species)}</em>` : '',
            p0.cultivar ? `'${esc(p0.cultivar)}'` : '',
        ].filter(Boolean).join(' ');

        return `
        <div class="group">
            <h2>${botHead}
                <span class="group-count">${group.length} entries</span>
            </h2>
            <table>
                <colgroup>
                    <col style="width:18%">
                    ${group.map(() => `<col style="width:${colPct}%">`).join('')}
                    <col style="width:8%">
                </colgroup>
                <thead><tr>
                    <th class="col-field">Field</th>
                    ${headerCells}
                    <th class="col-flag"></th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
    }

    const totalEntries = duplicateGroups.reduce((s, g) => s + g.length, 0);
    const groupsHTML   = duplicateGroups.map(buildGroupHTML).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Duplicate Plants Report</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; color: #1a1a1a;
       padding: 24px 32px; max-width: 1100px; margin: 0 auto; }
h1 { font-size: 15pt; color: #2d6a4f; margin-bottom: 3px; }
.meta { font-size: 9pt; color: #666; margin-bottom: 10px; }
.summary { font-size: 10pt; color: #78350f; background: #fef9c3;
           padding: 10px 14px; border-left: 3px solid #f59e0b;
           border-radius: 4px; margin-bottom: 28px; }
.summary strong { color: #1a1a1a; }
.print-btn { display:inline-block; margin-bottom:22px; padding:7px 18px;
             background:#2d6a4f; color:#fff; border:none; border-radius:5px;
             cursor:pointer; font-size:10pt; }
em { font-style: italic; }
.group { margin-bottom: 40px; }
.group h2 { font-size: 12pt; color: #2d6a4f; border-bottom: 2px solid #2d6a4f;
            padding-bottom: 5px; margin-bottom: 10px; }
.group-count { font-size: 9pt; color: #666; font-weight: 400;
               font-style: normal; margin-left: 8px; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { padding: 7px 9px; text-align: left; font-size: 8.5pt; }
td { padding: 5px 9px; border-bottom: 1px solid #e8e8e8; vertical-align: top; }
.col-field { background: #f5f5f5; }
.col-plant { background: #2d6a4f; color: #fff; font-weight: 600; font-size: 9pt; }
.col-flag  { background: #f5f5f5; }
.field-label { font-weight: 600; color: #444; font-size: 8.5pt;
               white-space: nowrap; background: #f9f9f9; }
.val-cell { font-size: 9.5pt; }
.val-cell.differs { background: #fff8e1; }
.flag-cell { font-size: 8pt; color: #b45309; white-space: nowrap;
             vertical-align: middle; text-align: center; }
.plant-id { font-size: 7.5pt; font-weight: 400; opacity: 0.8; margin-top: 2px; }
.empty { color: #bbb; }
@media print {
    .print-btn { display: none; }
    body { padding: 0; font-size: 9.5pt; }
    .group { page-break-inside: avoid; }
}
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
  <h1>Duplicate Plants Report</h1>
  <div class="meta">Generated ${date} &nbsp;&middot;&nbsp; ${plants.length} plants checked</div>
  <div class="summary">
    Found <strong>${duplicateGroups.length} group${duplicateGroups.length !== 1 ? 's'  : ''}</strong>
    of potential duplicates covering <strong>${totalEntries} plant entries</strong>.
    Rows highlighted in yellow differ between entries — use these to judge
    whether they are true duplicates or legitimately separate records.
  </div>
  ${groupsHTML}
</body>
</html>`;
}
