// =============================================================
//  batch-list.js — Batches list view with filters, search, sort
// =============================================================

import {
    getNurseryBatches, getNurseryLocations,
    METHOD_LABELS, STAGE_LABELS, STAGE_ORDER, escHtml, fmtDate
} from './db.js';
import { navigate } from './ui-utils.js';
import { isAtLeast } from './auth.js';
import { showBatchForm, invalidatePlantsCache } from './batch-form.js';

// sessionStorage key for sticky filter state
const FILTER_KEY = 'nursery-filter-state';

export async function renderBatchesList(container, headerActionEl, backBtn) {
    backBtn.classList.remove('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading batches…</p></div>`;

    let batches = [], locations = [];
    try {
        [batches, locations] = await Promise.all([getNurseryBatches(), getNurseryLocations()]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading batches.</p></div>`;
        return;
    }

    // ── Restore sticky filter state ────────────────────────────────────────
    // 1. Load persisted state (set by saveState() below, survives detail navigation)
    let _saved = null;
    try {
        const raw = sessionStorage.getItem(FILTER_KEY);
        if (raw) _saved = JSON.parse(raw);
    } catch (e) {}

    // 2. Dashboard single-stage override (nursery-batch-filter-stage) takes priority
    const _dashStage = sessionStorage.getItem('nursery-batch-filter-stage');
    if (_dashStage) {
        sessionStorage.removeItem('nursery-batch-filter-stage');
        _saved = { ...(_saved || {}), status: 'active', stages: [_dashStage] };
    }

    // 3. Initialise state from saved values (or sensible defaults)
    let currentStatus = _saved?.status || 'active';
    let currentStages = new Set(_saved?.stages?.length ? _saved.stages : []);
    let searchQuery   = _saved?.search  || '';
    let currentSort   = _saved?.sort    || 'name-asc';

    // ── FAB ───────────────────────────────────────────────────────────────
    if (isAtLeast('editor')) {
        const fab = document.createElement('button');
        fab.className = 'fab';
        fab.title     = 'New batch';
        fab.innerHTML = '+';
        fab.addEventListener('click', () => showBatchForm(null, locations, async () => {
            invalidatePlantsCache();
            await renderBatchesList(container, headerActionEl, backBtn);
        }));
        document.body.appendChild(fab);
    }

    const statusTabs = [
        { key: 'all',       label: 'All' },
        { key: 'active',    label: 'Active' },
        { key: 'completed', label: 'Completed' },
    ];
    const stagePills = STAGE_ORDER.filter(s => s !== 'completed').map(s => ({ key: s, label: STAGE_LABELS[s] }));

    container.innerHTML = `
        <div class="view-content view-content--list">
            <div class="filter-tabs" id="status-tabs">
                ${statusTabs.map(t => `
                    <button class="filter-tab ${t.key === currentStatus ? 'active' : ''}" data-status="${t.key}">${t.label}</button>
                `).join('')}
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <div class="search-bar" style="flex:1;margin-bottom:0;">
                    <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input class="search-input" id="batch-search" placeholder="Search by plant name…" autocomplete="off"
                           value="${escHtml(searchQuery)}">
                    <button class="search-clear" id="batch-search-clear" title="Clear search" style="display:${searchQuery ? 'flex' : 'none'};">✕</button>
                </div>
                <button id="sort-toggle" class="sort-toggle-btn ${currentSort === 'date-desc' ? 'active' : ''}" title="Change sort order">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 6l-4 4-4-4"/><path d="M4 10V2"/><path d="M16 18l4-4 4 4"/><path d="M20 14v8"/></svg>
                    <span id="sort-label">${currentSort === 'name-asc' ? 'A→Z' : 'Date'}</span>
                </button>
            </div>
            <div class="stage-filter-pills" id="stage-pills">
                <button class="filter-pill ${currentStages.size === 0 ? 'active' : ''}" data-stage="all">All stages</button>
                ${stagePills.map(p => `
                    <button class="filter-pill ${currentStages.has(p.key) ? 'active' : ''}" data-stage="${p.key}">${p.label}</button>
                `).join('')}
            </div>
            <div id="batch-results"></div>
        </div>
    `;

    // ── Save helper — call after every state change ────────────────────────
    function saveState() {
        sessionStorage.setItem(FILTER_KEY, JSON.stringify({
            status: currentStatus,
            stages: [...currentStages],
            search: searchQuery,
            sort:   currentSort,
        }));
    }

    // ── Render filtered/sorted list ────────────────────────────────────────
    function render() {
        const resultsEl = container.querySelector('#batch-results');
        let filtered = batches;
        if (currentStatus === 'active')    filtered = filtered.filter(b => b.stage !== 'completed');
        if (currentStatus === 'completed') filtered = filtered.filter(b => b.stage === 'completed');
        if (currentStatus === 'active' && currentStages.size > 0) {
            filtered = filtered.filter(b => currentStages.has(b.stage));
        }
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(b =>
                (b.plantName || '').toLowerCase().includes(q) ||
                (b.botanicalName || '').toLowerCase().includes(q)
            );
        }
        const pillsEl = container.querySelector('#stage-pills');
        if (pillsEl) pillsEl.style.display = (currentStatus === 'active') ? 'flex' : 'none';

        if (filtered.length === 0) {
            resultsEl.innerHTML = `<div class="empty-state" style="margin-top:32px;">
                ${batches.length === 0
                    ? `<div style="font-size:2.5rem;margin-bottom:12px;">🌱</div>
                       <h2 style="font-size:1rem;color:var(--green-800);margin-bottom:8px;">No batches yet</h2>
                       <p style="color:var(--grey-600);max-width:260px;margin:0 auto;">
                           Tap + to start tracking your first propagation batch.
                       </p>`
                    : `<p style="color:var(--grey-600);">No batches match this filter.</p>`}
            </div>`;
            return;
        }
        // Sort
        if (currentSort === 'name-asc') {
            filtered.sort((a, b) => (a.plantName || '').localeCompare(b.plantName || '', undefined, { sensitivity: 'base' })
                || (b.startDate || '').localeCompare(a.startDate || ''));
        } else {
            filtered.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''));
        }
        resultsEl.innerHTML = `<div class="batch-list">${filtered.map(b => batchRow(b)).join('')}</div>`;
        resultsEl.querySelectorAll('.batch-row[data-id]').forEach(row => {
            row.addEventListener('click', () => {
                saveState();  // persist filters before leaving the list
                navigate('batch-detail', row.dataset.id);
            });
        });
    }

    // ── Filter handlers ────────────────────────────────────────────────────
    container.querySelectorAll('#status-tabs .filter-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('#status-tabs .filter-tab').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentStatus = btn.dataset.status;
            currentStages = new Set();
            container.querySelectorAll('#stage-pills .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.stage === 'all'));
            saveState();
            render();
        });
    });

    container.querySelectorAll('#stage-pills .filter-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            const stage = btn.dataset.stage;
            if (stage === 'all') {
                currentStages = new Set();
            } else {
                if (currentStages.has(stage)) {
                    currentStages.delete(stage);
                } else {
                    currentStages.add(stage);
                }
            }
            container.querySelectorAll('#stage-pills .filter-pill').forEach(b => {
                const s = b.dataset.stage;
                if (s === 'all') {
                    b.classList.toggle('active', currentStages.size === 0);
                } else {
                    b.classList.toggle('active', currentStages.has(s));
                }
            });
            saveState();
            render();
        });
    });

    const batchSearchEl = container.querySelector('#batch-search');
    const batchClearBtn = container.querySelector('#batch-search-clear');
    batchSearchEl?.addEventListener('input', e => {
        searchQuery = e.target.value;
        if (batchClearBtn) batchClearBtn.style.display = searchQuery ? 'flex' : 'none';
        saveState();
        render();
    });
    batchClearBtn?.addEventListener('click', () => {
        searchQuery = '';
        if (batchSearchEl) batchSearchEl.value = '';
        batchClearBtn.style.display = 'none';
        batchSearchEl?.focus();
        saveState();
        render();
    });

    container.querySelector('#sort-toggle')?.addEventListener('click', () => {
        currentSort = currentSort === 'name-asc' ? 'date-desc' : 'name-asc';
        const label = container.querySelector('#sort-label');
        const btn   = container.querySelector('#sort-toggle');
        if (label) label.textContent = currentSort === 'name-asc' ? 'A→Z' : 'Date';
        if (btn)   btn.classList.toggle('active', currentSort === 'date-desc');
        saveState();
        render();
    });

    render();
}

function batchRow(b) {
    const method = METHOD_LABELS[b.method] || b.method || '—';
    const isStock = b.purpose === 'stock-plant';
    return `
        <div class="batch-row card-item" data-id="${escHtml(b.id)}">
            <div class="batch-row-main">
                <span class="batch-row-name">${escHtml(b.plantName || 'Unnamed')}</span>
                ${isStock
                    ? `<span class="stage-badge" style="background:#d97706;color:#fff;border-color:#b45309;">🪴 Stock plant</span>`
                    : `<span class="stage-badge stage-${escHtml(b.stage || 'propagating')}">${STAGE_LABELS[b.stage] || b.stage || '—'}</span>`}
            </div>
            <div class="batch-row-meta">
                <span class="method-badge">${escHtml(method)}</span>
                <span class="batch-row-qty">${b.currentQty ?? b.startQty ?? '?'} plants</span>
                <span class="batch-row-date">${fmtDate(b.startDate)}</span>
            </div>
            ${b.botanicalName ? `<div class="batch-row-botanical">${escHtml(b.botanicalName)}</div>` : ''}
        </div>
    `;
}

// renderBatchesList is exported inline above (export async function)
