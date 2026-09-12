// =============================================================
//  dashboard-view.js — Nursery dashboard (home screen)
// =============================================================

import { getNurseryBatches, escHtml, fmtDate, todayStr, STAGE_LABELS, STAGE_ORDER, METHOD_LABELS, formatBatchQty, formatBotanicalName } from './db.js';
import { pretreatmentNeedsAttention } from './pretreatment.js';
import { navigate } from './ui-utils.js';
import { isAtLeast } from './auth.js';

export async function renderDashboard(container, headerActionEl, backBtn) {
    backBtn.classList.remove('visible');
    headerActionEl.innerHTML = '';
    document.querySelectorAll('.fab').forEach(el => el.remove());
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading…</p></div>`;

    let batches = [];
    try {
        batches = await getNurseryBatches();
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading data. Check your connection.</p></div>`;
        return;
    }

    const active    = batches.filter(b => b.stage !== 'completed');
    const completed = batches.filter(b => b.stage === 'completed');

    // Stage counts for active batches
    const stageCounts = {};
    for (const s of STAGE_ORDER.filter(s => s !== 'completed')) stageCounts[s] = 0;
    for (const b of active) {
        if (stageCounts[b.stage] !== undefined) stageCounts[b.stage]++;
    }

    // "Needs attention" — active batches with no updatedAt in last 10 days
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    // Pre-sowing batches run on their own clock instead: a check every N days,
    // and whenever a step is due, sowing is due, or a maximum has passed.
    const today = todayStr();
    const needsAttention = active.filter(b => {
        if (b.stage === 'pre-sowing' && b.pretreatment) return pretreatmentNeedsAttention(b, today);
        if (!b.updatedAt) return true;
        const updated = b.updatedAt.toDate ? b.updatedAt.toDate() : new Date(b.updatedAt);
        return updated < tenDaysAgo;
    }).slice(0, 5);

    // Recent activity — last 5 active batches by updatedAt
    const recent = [...active]
        .sort((a, b) => {
            const ta = a.updatedAt?.toDate ? a.updatedAt.toDate() : new Date(0);
            const tb = b.updatedAt?.toDate ? b.updatedAt.toDate() : new Date(0);
            return tb - ta;
        })
        .slice(0, 5);

    // One FAB only. A second 📷 label-scan FAB used to sit above this one, but
    // it opened the same form the + reaches, and that form already offers the
    // scan card — so it was a duplicate route to one destination.
    if (isAtLeast('editor')) {
        const fab = document.createElement('button');
        fab.className = 'fab';
        fab.title     = 'Start new batch';
        fab.innerHTML = '+';
        fab.addEventListener('click', () => navigate('batches'));
        document.body.appendChild(fab);
    }

    container.innerHTML = `
        <div class="view-content">

            ${active.length === 0 && completed.length === 0 ? `
            <div class="empty-state" style="margin-top:48px;">
                <div style="font-size:3rem;margin-bottom:16px;">🌱</div>
                <h2 style="font-size:1.1rem;margin-bottom:8px;color:var(--green-800);">Welcome to your nursery!</h2>
                <p style="color:var(--grey-600);max-width:280px;margin:0 auto 20px;">
                    Start tracking your first propagation batch — seeds sown, cuttings taken, divisions made.
                </p>
                ${isAtLeast('editor') ? `<button class="btn btn-primary" id="dash-new-btn">+ Start first batch</button>` : ''}
            </div>
            ` : `

            <!-- Stage pipeline -->
            <section class="dashboard-section">
                <h2 class="section-heading">Active batches</h2>
                ${active.length === 0
                    ? `<p class="empty-hint">No active batches — everything's been completed or you haven't started yet.</p>`
                    : `<div class="stage-pipeline">
                        ${STAGE_ORDER.filter(s => s !== 'completed' && (s !== 'pre-sowing' || stageCounts[s] > 0)).map(s => `
                            <button class="stage-pill ${stageCounts[s] > 0 ? 'has-count' : ''}"
                                    data-stage="${s}"
                                    title="View ${STAGE_LABELS[s]} batches">
                                <span class="stage-pill-count">${stageCounts[s]}</span>
                                <span class="stage-pill-label">${STAGE_LABELS[s]}</span>
                            </button>
                        `).join('')}
                    </div>`
                }
            </section>

            ${needsAttention.length > 0 ? `
            <!-- Needs attention -->
            <section class="dashboard-section">
                <h2 class="section-heading">⚠️ Needs a check-in</h2>
                <div class="batch-list">
                    ${needsAttention.map(b => batchRow(b)).join('')}
                </div>
            </section>
            ` : ''}

            <!-- Recent activity -->
            ${recent.length > 0 ? `
            <section class="dashboard-section">
                <h2 class="section-heading">Recently updated</h2>
                <div class="batch-list">
                    ${recent.map(b => batchRow(b)).join('')}
                </div>
                ${active.length > 5 ? `
                <button class="btn btn-secondary" id="dash-all-btn" style="margin-top:10px;width:100%;">
                    View all ${active.length} active batches
                </button>` : ''}
            </section>
            ` : ''}

            <!-- Summary strip -->
            <section class="dashboard-section">
                <div class="summary-strip">
                    <div class="summary-stat">
                        <span class="summary-num">${active.length}</span>
                        <span class="summary-label">Active</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-num">${completed.length}</span>
                        <span class="summary-label">Completed</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-num">${batches.length}</span>
                        <span class="summary-label">Total batches</span>
                    </div>
                </div>
            </section>

            `}
        </div>
    `;

    // Wire up buttons
    container.querySelector('#dash-new-btn')?.addEventListener('click', () => navigate('batches'));
    container.querySelector('#dash-all-btn')?.addEventListener('click', () => navigate('batches'));

    container.querySelectorAll('.stage-pill[data-stage]').forEach(btn => {
        btn.addEventListener('click', () => {
            // Navigate to batches with stage filter — store in sessionStorage for batches-view to pick up
            sessionStorage.setItem('nursery-batch-filter-stage', btn.dataset.stage);
            navigate('batches');
        });
    });

    container.querySelectorAll('.batch-row[data-id]').forEach(row => {
        row.addEventListener('click', () => navigate('batch-detail', row.dataset.id));
    });
}

function batchRow(b) {
    const method = METHOD_LABELS[b.method] || b.method || '—';
    return `
        <div class="batch-row card-item" data-id="${escHtml(b.id)}">
            <div class="batch-row-main">
                <span class="batch-row-name">${escHtml(formatBotanicalName(b) || b.plantName || 'Unnamed')}</span>
                <span class="stage-badge stage-${escHtml(b.stage || 'propagating')}">${STAGE_LABELS[b.stage] || b.stage || '—'}</span>
            </div>
            <div class="batch-row-meta">
                <span class="method-badge">${escHtml(method)}</span>
                <span class="batch-row-qty">${formatBatchQty(b, { noun: true })}</span>
                <span class="batch-row-date">${fmtDate(b.startDate)}</span>
            </div>
        </div>
    `;
}
