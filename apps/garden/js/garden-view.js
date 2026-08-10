// =============================================================
//  garden-view.js — "Overview" dashboard
// =============================================================

import {
    getAreas, getInstances, getPlants,
    getTasks, getTaskAssignments,
    getSuggestions, addSuggestion, updateSuggestion, deleteSuggestion,
    getDeceasedPlants,
    formatBotanicalName, escHtml, todayStr, isOverdue
} from './db.js';
import { setLoading, navigate, showToast } from './ui-utils.js';
import { buildTaskRow, attachTaskHandlers } from './tasks-view.js';
import { getIrrigationBannerInfo }          from './irrigation-view.js';
import { causeMeta }                        from './compost-view.js';

// Date helpers come from db.js. This module also carried its own fmtDate, which
// nothing ever called — removed 2026-08-10 rather than re-pointed.

// =============================================
//  OVERVIEW PAGE
// =============================================

export async function renderGardenView(container, headerActionEl, backBtn) {
    setLoading(container, true);
    backBtn.classList.remove('visible');
    document.querySelector('.fab')?.remove();
    headerActionEl.innerHTML = '';

    let areas, instances, plants, allAssignments, deceased = [];
    try {
        [areas, instances, plants, allAssignments, deceased] = await Promise.all([
            getAreas(),
            getInstances(),
            getPlants(),
            getTaskAssignments(),
            getDeceasedPlants()
        ]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading overview data.</p></div>`;
        return;
    }

    // ---- Summary stats ----
    const totalPlants    = plants.length;
    const totalSpecimens = instances.reduce((sum, i) => sum + (i.quantity || 1), 0);
    const totalAreas     = areas.length;

    // ---- Tasks: overdue + due soon (active only, sorted by due date) ----
    const today = todayStr();
    const activeTasks = allAssignments
        .filter(a => a.status === 'todo' || a.status === 'in-progress')
        .sort((a, b) => {
            // Overdue first, then by due date, then undated last
            const aOverdue = isOverdue(a.dueDate, a.status);
            const bOverdue = isOverdue(b.dueDate, b.status);
            if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
            const da = a.dueDate || '9999-99-99';
            const db = b.dueDate || '9999-99-99';
            return da.localeCompare(db);
        });

    // Tasks with a due date (overdue or within 14 days) — show up to 5
    const urgentTasks = activeTasks.filter(a => {
        if (!a.dueDate) return false;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() + 14);
        const cd = cutoff; return a.dueDate <= `${cd.getFullYear()}-${String(cd.getMonth()+1).padStart(2,'0')}-${String(cd.getDate()).padStart(2,'0')}`;
    }).slice(0, 5);
    // If fewer than 5, top up with undated active tasks
    const shownTaskIds = new Set(urgentTasks.map(a => a.id));
    const topupTasks = activeTasks
        .filter(a => !shownTaskIds.has(a.id))
        .slice(0, Math.max(0, 5 - urgentTasks.length));
    const dashboardTasks = [...urgentTasks, ...topupTasks];

    // ---- Compost Bin (deceased) — recent deaths + totals ----
    const recentDeaths     = deceased.slice(0, 5);   // getDeceasedPlants() is newest-first
    const compostSpecimens = deceased.reduce((s, r) => s + (r.quantity || 1), 0);

    // ---- Recent plants (last 5 added by createdAt) ----
    const recentPlants = [...plants]
        .filter(p => p.createdAt)
        .sort((a, b) => {
            const ta = a.createdAt?.toMillis?.() ?? 0;
            const tb = b.createdAt?.toMillis?.() ?? 0;
            return tb - ta;
        })
        .slice(0, 5);

    // Build maps for task row rendering
    let taskMap = {};
    try {
        const tasks = await getTasks();
        taskMap = Object.fromEntries(tasks.map(t => [t.id, t]));
    } catch (_) {}

    const plantMap = Object.fromEntries(plants.map(p => [p.id, p]));
    const areaNameMap = Object.fromEntries(areas.map(a => [a.id, a.name]));

    // Group instances by area for plant context in task rows
    const instancesByArea = {};
    for (const inst of instances) {
        if (!instancesByArea[inst.areaId]) instancesByArea[inst.areaId] = [];
        instancesByArea[inst.areaId].push(inst);
    }
    function areaPlantMap(areaId) {
        const pm = {};
        for (const inst of (instancesByArea[areaId] || [])) {
            if (plantMap[inst.plantId]) pm[inst.plantId] = plantMap[inst.plantId];
        }
        return pm;
    }

    // Enrich assignments with full task objects
    const enrichedTasks = dashboardTasks
        .map(a => ({ ...a, task: taskMap[a.taskId] }))
        .filter(a => a.task);

    // ---- Irrigation banner (fetch asynchronously, non-blocking) ----
    let irrBanner = null;
    try { irrBanner = await getIrrigationBannerInfo(); } catch (_) {}

    // ---- Build HTML ----
    container.innerHTML = `
        <!-- Stats summary -->
        <div class="overview-stats">
            <div class="overview-stat" data-nav="plants">
                <div class="overview-stat-value">${totalPlants}</div>
                <div class="overview-stat-label">Plant types</div>
            </div>
            <div class="overview-stat" data-nav="plants">
                <div class="overview-stat-value">${totalSpecimens}</div>
                <div class="overview-stat-label">Specimens</div>
            </div>
            <div class="overview-stat" data-nav="areas">
                <div class="overview-stat-value">${totalAreas}</div>
                <div class="overview-stat-label">Areas</div>
            </div>
        </div>

        <!-- Irrigation banner -->
        ${irrBanner && irrBanner.due > 0 ? `
        <div class="irr-overview-banner ${irrBanner.pending === 0 ? 'all-done' : ''}"
             id="irr-overview-banner" role="button" tabindex="0" aria-label="Go to Irrigation">
            <div class="irr-banner-icon">${irrBanner.pending === 0 ? '✅' : '💧'}</div>
            <div class="irr-banner-body">
                <strong>${irrBanner.pending === 0
                    ? 'All irrigation done today'
                    : `${irrBanner.pending} zone${irrBanner.pending !== 1 ? 's' : ''} need watering today`}</strong>
                ${irrBanner.pending > 0 && irrBanner.pendingNames.length
                    ? `<span class="irr-banner-sub">${escHtml(irrBanner.pendingNames.slice(0, 3).join(' · '))}${irrBanner.pendingNames.length > 3 ? ' …' : ''}</span>`
                    : ''}
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                 style="flex-shrink:0;color:var(--grey-400)">
                <polyline points="9 18 15 12 9 6"/>
            </svg>
        </div>` : ''}

        <!-- Upcoming & Overdue Tasks -->
        <div class="overview-section">
            <div class="overview-section-header">
                <span class="overview-section-title">📋 Tasks</span>
                <button class="overview-section-link" data-nav="tasks">View all</button>
            </div>
            ${enrichedTasks.length === 0
                ? `<p class="overview-empty">No active tasks — all clear! 🌱</p>`
                : enrichedTasks.map(a => buildTaskRow(a, areaPlantMap(a.areaId), areaNameMap[a.areaId] || null, true)).join('')
            }
            ${activeTasks.length > 5
                ? `<p class="overview-more">+ ${activeTasks.length - dashboardTasks.length} more active task${activeTasks.length - dashboardTasks.length !== 1 ? 's' : ''}</p>`
                : ''}
        </div>

        <!-- Quick area links -->
        ${areas.length > 0 ? `
        <div class="overview-section">
            <div class="overview-section-header">
                <span class="overview-section-title">🗺️ Areas</span>
                <button class="overview-section-link" data-nav="areas">View all</button>
            </div>
            <div class="overview-area-chips">
                ${areas.map(a => `
                    <button class="overview-area-chip" data-area-id="${escHtml(a.id)}">
                        ${escHtml(a.name)}
                    </button>`).join('')}
            </div>
        </div>` : ''}

        <!-- Recent plant additions -->
        ${recentPlants.length > 0 ? `
        <div class="overview-section">
            <div class="overview-section-header">
                <span class="overview-section-title">🌿 Recently added</span>
                <button class="overview-section-link" data-nav="plants">View all</button>
            </div>
            ${recentPlants.map(p => {
                const name = formatBotanicalName(p) || escHtml(p.commonName || 'Unnamed plant');
                return `
                    <div class="overview-plant-row" data-plant-id="${p.id}">
                        <span class="overview-plant-name">${name}</span>
                        ${p.commonName && formatBotanicalName(p)
                            ? `<span class="overview-plant-common">${escHtml(p.commonName)}</span>`
                            : ''}
                    </div>`;
            }).join('')}
        </div>` : ''}

        <!-- Compost Bin (deceased plants) -->
        ${deceased.length > 0 ? `
        <div class="overview-section">
            <div class="overview-section-header">
                <span class="overview-section-title">🪵 Compost Bin</span>
                <button class="overview-section-link" data-nav="compost">View all</button>
            </div>
            <p class="overview-empty" style="margin:0 0 8px;text-align:left;">
                ${compostSpecimens} specimen${compostSpecimens !== 1 ? 's' : ''} lost across ${deceased.length} record${deceased.length !== 1 ? 's' : ''}.
            </p>
            ${recentDeaths.map(r => {
                const c = causeMeta(r.cause);
                return `
                    <div class="overview-plant-row" data-plant-id="${escHtml(r.plantId || '')}">
                        <span class="overview-plant-name">${r.plantName ? escHtml(r.plantName) : 'Unknown plant'}${(r.quantity || 1) > 1 ? ` <span class="text-muted">×${r.quantity}</span>` : ''}</span>
                        <span class="overview-plant-common">${c.icon} ${escHtml(c.label)}${r.areaName ? ` · ${escHtml(r.areaName)}` : ''}</span>
                    </div>`;
            }).join('')}
        </div>` : ''}

        <!-- Wishlist & Ideas (all roles) -->
        <div class="overview-section" id="wishlist-section">
            <div class="overview-section-header">
                <span class="overview-section-title">💡 Wishlist &amp; Ideas</span>
            </div>
            <div style="display:flex;gap:8px;margin-bottom:12px;">
                <input class="form-input" id="overview-suggestion-input"
                       placeholder="Add an idea or improvement…" autocapitalize="sentences"
                       style="flex:1;font-size:0.9rem;">
                <button class="btn btn-primary btn-sm" id="overview-add-suggestion-btn"
                        style="flex-shrink:0;">Add</button>
            </div>
            <div id="overview-suggestions-list"></div>
        </div>
    `;

    // ---- Stat tile & nav link clicks ----
    container.querySelectorAll('.overview-stat[data-nav]').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => navigate(el.dataset.nav));
    });
    container.querySelectorAll('.overview-section-link[data-nav]').forEach(btn => {
        btn.addEventListener('click', () => navigate(btn.dataset.nav));
    });

    // ---- Irrigation banner click → navigate to Water tab ----
    const irrBannerEl = container.querySelector('#irr-overview-banner');
    if (irrBannerEl) {
        const goIrr = () => navigate('irrigation');
        irrBannerEl.addEventListener('click',  goIrr);
        irrBannerEl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') goIrr(); });
    }

    // ---- Task row interactions (expand, status, edit, delete) ----
    attachTaskHandlers(container, () => renderGardenView(container, headerActionEl, backBtn));

    // ---- Area chip clicks → area detail ----
    container.querySelectorAll('.overview-area-chip[data-area-id]').forEach(btn => {
        btn.addEventListener('click', () => navigate('area-detail', btn.dataset.areaId));
    });

    // ---- Recent plant row clicks → plant detail ----
    container.querySelectorAll('.overview-plant-row[data-plant-id]').forEach(row => {
        row.addEventListener('click', () => navigate('plant-detail', row.dataset.plantId));
    });

    // ---- Wishlist ----
    const suggListEl = container.querySelector('#overview-suggestions-list');
    const suggInput  = container.querySelector('#overview-suggestion-input');
    const suggAddBtn = container.querySelector('#overview-add-suggestion-btn');

    async function renderSuggestions() {
        if (!suggListEl) return;
        let items;
        try { items = await getSuggestions(); } catch (_) {
            suggListEl.innerHTML = `<p class="form-hint">Could not load ideas.</p>`; return;
        }
        if (items.length === 0) {
            suggListEl.innerHTML = `<p class="form-hint">No ideas yet — add the first one above!</p>`;
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
                        suggListEl.innerHTML = `<p class="form-hint">No ideas yet — add the first one above!</p>`;
                } catch (_) {}
            });
        });
    }

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

    await renderSuggestions();

    setLoading(container, false);
}
