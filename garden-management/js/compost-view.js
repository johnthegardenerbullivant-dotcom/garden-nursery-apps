// =============================================================
//  compost-view.js — "Compost Bin" (deceased plants log)
// =============================================================
//  Shows every recorded plant death. A death is per-area, so a plant can
//  appear here for one area while still alive in another. Records carry name
//  snapshots, so they stay readable even if the plant/area is later changed.

import { getDeceasedPlants, deleteDeceasedRecord, escHtml } from './db.js';
import { setLoading, navigate, showToast } from './ui-utils.js';
import { isAtLeast } from './auth.js';

// =============================================
//  CAUSES  (shared with the death form in plants-view.js)
// =============================================

export const DEATH_CAUSES = [
    { key: 'frost',        label: 'Frost / cold',              icon: '❄️' },
    { key: 'drought',      label: 'Drought / underwatering',   icon: '🏜️' },
    { key: 'overwatering', label: 'Overwatering / waterlogged', icon: '🌊' },
    { key: 'pests',        label: 'Pests',                     icon: '🐛' },
    { key: 'disease',      label: 'Disease',                   icon: '🦠' },
    { key: 'neglect',      label: 'Neglect',                   icon: '🥀' },
    { key: 'transplant',   label: 'Transplant failure',        icon: '🪴' },
    { key: 'wind',         label: 'Wind / storm damage',       icon: '🌬️' },
    { key: 'animal',       label: 'Animal damage',             icon: '🐰' },
    { key: 'old-age',      label: 'Old age / end of life',     icon: '⏳' },
    { key: 'unknown',      label: 'Unknown',                   icon: '❓' },
];

/** Look up the display metadata for a cause key (falls back gracefully) */
export function causeMeta(key) {
    return DEATH_CAUSES.find(c => c.key === key)
        || { key: key || 'unknown', label: key || 'Unknown', icon: '🍂' };
}

// =============================================
//  DATE HELPERS
// =============================================

const MONTH_FULL = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];

function fmtDate(dateStr) {
    if (!dateStr) return 'Undated';
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${d} ${months[m - 1]} ${y}`;
}

function monthKey(dateStr) {
    return (dateStr && dateStr.length >= 7) ? dateStr.slice(0, 7) : '0000-00';
}

function monthLabel(key) {
    if (key === '0000-00') return 'Undated';
    const [y, m] = key.split('-').map(Number);
    return `${MONTH_FULL[m - 1]} ${y}`;
}

// =============================================
//  MAIN RENDER
// =============================================

export async function renderCompostView(container, headerActionEl, backBtn) {
    setLoading(container, true);
    backBtn.classList.add('visible');   // came from the Overview — allow return
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();

    let records;
    try {
        records = await getDeceasedPlants();
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading the Compost Bin.</p></div>`;
        return;
    }

    if (records.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="margin-top:48px">
                <div class="empty-state-icon">🪵</div>
                <h3>The Compost Bin is empty</h3>
                <p>When a plant dies, open its detail page and use the
                   🍂 Died button on its location to record it here.</p>
            </div>`;
        setLoading(container, false);
        return;
    }

    const entries  = records.length;
    const specimens = records.reduce((sum, r) => sum + (r.quantity || 1), 0);

    // Group by month of death (newest first; records arrive pre-sorted)
    const groups = {};
    for (const r of records) {
        const k = monthKey(r.diedDate);
        if (!groups[k]) groups[k] = [];
        groups[k].push(r);
    }
    const groupKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    let html = `
        <div class="compost-intro">
            <div class="compost-intro-icon">🪵</div>
            <div>
                <div class="compost-intro-title">Compost Bin</div>
                <div class="compost-intro-sub">A record of plants that have died, and why.</div>
            </div>
        </div>
        <div class="compost-stats">
            <div class="compost-stat">
                <div class="compost-stat-num">${specimens}</div>
                <div class="compost-stat-lbl">Specimen${specimens !== 1 ? 's' : ''} lost</div>
            </div>
            <div class="compost-stat">
                <div class="compost-stat-num">${entries}</div>
                <div class="compost-stat-lbl">Entr${entries !== 1 ? 'ies' : 'y'}</div>
            </div>
        </div>`;

    for (const key of groupKeys) {
        html += `<div class="compost-group">
            <div class="compost-group-hdr">${escHtml(monthLabel(key))}</div>
            ${groups[key].map(rowHtml).join('')}
        </div>`;
    }

    container.innerHTML = html;

    // Row click → plant detail (if the plant still exists)
    container.querySelectorAll('.compost-row[data-plant-id]').forEach(row => {
        row.querySelector('.compost-row-main')?.addEventListener('click', () => {
            const pid = row.dataset.plantId;
            if (pid) navigate('plant-detail', pid);
        });
    });

    // Remove entry (editor+) — deletes the death record (does not replant)
    container.querySelectorAll('.compost-remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Remove this Compost Bin entry?\n\nThis deletes the death record. It does not replant the plant in its area. If this plant has no living locations left, it will reappear in the Plants list.')) return;
            try {
                await deleteDeceasedRecord(btn.dataset.id);
                showToast('Entry removed');
                await renderCompostView(container, headerActionEl, backBtn);
            } catch (err) {
                showToast('Could not remove entry', 'error');
                console.error(err);
            }
        });
    });

    setLoading(container, false);
}

function rowHtml(r) {
    const c        = causeMeta(r.cause);
    const name     = r.plantName ? escHtml(r.plantName) : 'Unknown plant';
    const common   = r.commonName ? `<span class="compost-common">(${escHtml(r.commonName)})</span>` : '';
    const area     = r.areaName ? `<span class="irr-area-chip">${escHtml(r.areaName)}</span>` : '';
    const qty      = (r.quantity || 1) > 1 ? `<span class="compost-qty">×${r.quantity}</span>` : '';
    const notes    = r.notes ? `<div class="compost-notes">${escHtml(r.notes)}</div>` : '';

    return `
        <div class="compost-row" data-plant-id="${escHtml(r.plantId || '')}">
            <div class="compost-row-main">
                <div class="compost-cause" title="${escHtml(c.label)}">${c.icon}</div>
                <div class="compost-info">
                    <div class="compost-name">${name} ${qty} ${common}</div>
                    <div class="compost-meta">${area}<span class="compost-date">${escHtml(fmtDate(r.diedDate))}</span><span class="compost-cause-lbl">${escHtml(c.label)}</span></div>
                    ${notes}
                </div>
            </div>
            ${isAtLeast('editor')
                ? `<button class="btn-icon compost-remove-btn" data-id="${escHtml(r.id)}" title="Remove entry">
                       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                   </button>`
          