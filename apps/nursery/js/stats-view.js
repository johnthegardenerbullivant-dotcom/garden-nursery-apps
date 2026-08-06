// =============================================================
//  stats-view.js — Propagation statistics  (Phase 5)
// =============================================================

import {
    getNurseryBatches, getAllNurseryLogs,
    escHtml, METHOD_LABELS, STAGE_LABELS, STAGE_ORDER, LOSS_REASON_LABELS, formatBotanicalName
} from './db.js';

export async function renderStats(container, headerActionEl, backBtn) {
    backBtn.classList.remove('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading stats…</p></div>`;

    let batches = [], logs = [];
    try {
        [batches, logs] = await Promise.all([getNurseryBatches(), getAllNurseryLogs()]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading data.</p></div>`;
        return;
    }

    if (batches.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div style="font-size:2.5rem;margin-bottom:12px;">📊</div>
                <h2 style="font-size:1rem;color:var(--green-800);margin-bottom:8px;">No data yet</h2>
                <p style="color:var(--grey-600);max-width:260px;margin:0 auto;">
                    Stats will appear here once you've started recording propagation batches.
                </p>
            </div>`;
        return;
    }

    // Exclude acquired/purchased batches from propagation statistics —
    // these are plants passing through the nursery, not propagated here.
    const propBatches = batches.filter(b => b.method !== 'acquired-potted');

    // ---- Core aggregations ----
    const completed  = propBatches.filter(b => b.stage === 'completed');
    const active     = propBatches.filter(b => b.stage !== 'completed');
    const succeeded  = completed.filter(b => b.outcome && b.outcome !== 'lost');
    const successRate = completed.length > 0
        ? Math.round(succeeded.length / completed.length * 100)
        : null;

    // Total plants successfully propagated
    const totalPropagated = succeeded.reduce((sum, b) => sum + (b.currentQty || 0), 0);

    // ---- Active stage pipeline ----
    const stageCounts = {};
    for (const b of active) {
        const s = b.stage || 'propagating';
        stageCounts[s] = (stageCounts[s] || 0) + 1;
    }

    // ---- By method ----
    const byMethod = {};
    for (const b of propBatches) {
        const m = b.method || 'unknown';
        if (!byMethod[m]) byMethod[m] = { total: 0, completed: 0, succeeded: 0, active: 0 };
        byMethod[m].total++;
        if (b.stage === 'completed') {
            byMethod[m].completed++;
            if (b.outcome && b.outcome !== 'lost') byMethod[m].succeeded++;
        } else {
            byMethod[m].active++;
        }
    }

    // ---- By month started ----
    const byMonth = {};
    for (const b of propBatches) {
        if (!b.startDate) continue;
        const [y, m] = b.startDate.split('-');
        const key = `${y}-${m}`;
        if (!byMonth[key]) byMonth[key] = 0;
        byMonth[key]++;
    }
    const months = Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-12);

    // ---- Loss reasons — split true losses from deliberate discards ----
    const trueLossReasons = {};   // involuntary losses only
    let totalTrueLost  = 0;
    let totalDiscarded = 0;
    for (const log of logs) {
        if (!log.lossCount || log.lossCount <= 0) continue;
        if (log.lossReason === 'discarded') {
            totalDiscarded += log.lossCount;
        } else {
            totalTrueLost += log.lossCount;
            const r = log.lossReason || 'unknown';
            trueLossReasons[r] = (trueLossReasons[r] || 0) + log.lossCount;
        }
    }

    // ---- "What's working" — top plant+method combos ----
    const combos = {};
    for (const b of completed) {
        const key = `${b.plantName || 'Unknown'}|||${b.method || 'unknown'}`;
        if (!combos[key]) combos[key] = {
            succeeded: 0, total: 0,
            plantName: b.plantName || 'Unknown',
            displayName: formatBotanicalName(b) || b.plantName || 'Unknown',
            method:    b.method || 'unknown'
        };
        combos[key].total++;
        if (b.outcome && b.outcome !== 'lost') combos[key].succeeded++;
    }
    const topCombos = Object.values(combos)
        .map(c => ({ ...c, rate: Math.round(c.succeeded / c.total * 100) }))
        .sort((a, b) => b.rate - a.rate || b.total - a.total)
        .slice(0, 3);

    // Top loss reasons for "watch out for"
    // "Watch out for" uses only true (involuntary) losses
    const topLossReasons = Object.entries(trueLossReasons)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

    // ---- Helpers ----
    function rateClass(r) { return r >= 70 ? 'good' : r >= 40 ? 'ok' : 'poor'; }

    // ---- Render ----
    container.innerHTML = `
        <div class="view-content">

            <!-- Overview summary -->
            <section class="dashboard-section">
                <h2 class="section-heading">Overview</h2>
                <div class="summary-strip four">
                    <div class="summary-stat">
                        <span class="summary-num">${propBatches.length}</span>
                        <span class="summary-label">Batches</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-num">${active.length}</span>
                        <span class="summary-label">Active</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-num">${completed.length}</span>
                        <span class="summary-label">Completed</span>
                    </div>
                    <div class="summary-stat">
                        <span class="summary-num">${successRate !== null ? successRate + '%' : '—'}</span>
                        <span class="summary-label">Success rate</span>
                    </div>
                </div>
                ${totalPropagated > 0 ? `
                <p class="stats-propagated-note">🌿 <strong>${totalPropagated}</strong> plant${totalPropagated !== 1 ? 's' : ''} successfully propagated</p>
                ` : ''}
            </section>

            <!-- Active stage pipeline -->
            ${active.length > 0 ? `
            <section class="dashboard-section">
                <h2 class="section-heading">Active batches by stage</h2>
                <div class="stats-pipeline">
                    ${STAGE_ORDER.filter(s => s !== 'completed').map((s, i, arr) => {
                        const count = stageCounts[s] || 0;
                        return `
                        <div class="pipeline-step ${count > 0 ? 'has-batches' : 'empty'}">
                            <span class="pipeline-count">${count}</span>
                            <span class="pipeline-label">${STAGE_LABELS[s]}</span>
                        </div>${i < arr.length - 1 ? '<div class="pipeline-arrow">›</div>' : ''}`;
                    }).join('')}
                </div>
            </section>
            ` : ''}

            <!-- Insights: What's working / Watch out for -->
            ${(topCombos.length > 0 || topLossReasons.length > 0) ? `
            <section class="dashboard-section">
                <h2 class="section-heading">Insights</h2>
                <div class="stats-insights">
                    ${topCombos.length > 0 ? `
                    <div class="insight-card good">
                        <div class="insight-icon">✅</div>
                        <div class="insight-body">
                            <div class="insight-title">What's working</div>
                            <ul class="insight-list">
                                ${topCombos.map(c => `
                                <li>
                                    <span class="insight-plant">${escHtml(c.displayName || c.plantName)}</span>
                                    <span class="insight-method">via ${escHtml(METHOD_LABELS[c.method] || c.method)}</span>
                                    <span class="stats-rate ${rateClass(c.rate)}">${c.rate}%</span>
                                </li>`).join('')}
                            </ul>
                        </div>
                    </div>` : ''}
                    ${topLossReasons.length > 0 ? `
                    <div class="insight-card warn">
                        <div class="insight-icon">⚠️</div>
                        <div class="insight-body">
                            <div class="insight-title">Watch out for</div>
                            <ul class="insight-list">
                                ${topLossReasons.map(([r, n]) => `
                                <li>
                                    <span class="insight-plant">${escHtml(LOSS_REASON_LABELS[r] || r)}</span>
                                    <span class="insight-method">${n} plant${n !== 1 ? 's' : ''} lost</span>
                                </li>`).join('')}
                            </ul>
                        </div>
                    </div>` : ''}
                </div>
            </section>
            ` : ''}

            <!-- By propagation method -->
            <section class="dashboard-section">
                <h2 class="section-heading">By propagation method</h2>
                <div class="stats-method-list">
                    ${Object.entries(byMethod)
                        .sort(([, a], [, b]) => b.total - a.total)
                        .map(([method, counts]) => {
                            const rate = counts.completed > 0
                                ? Math.round(counts.succeeded / counts.completed * 100)
                                : null;
                            const barW = Math.round(counts.total / propBatches.length * 100);
                            return `
                            <div class="stats-method-row">
                                <div class="stats-method-header">
                                    <span class="method-badge">${escHtml(METHOD_LABELS[method] || method)}</span>
                                    <span class="stats-method-count">${counts.total} batch${counts.total !== 1 ? 'es' : ''}${counts.active > 0 ? ` · ${counts.active} active` : ''}</span>
                                    ${rate !== null ? `<span class="stats-rate ${rateClass(rate)}">${rate}% success</span>` : ''}
                                </div>
                                <div class="stats-bar-track">
                                    <div class="stats-bar-fill" style="width:${barW}%"></div>
                                </div>
                            </div>`;
                        }).join('')}
                </div>
            </section>

            <!-- Loss reasons (true losses only) -->
            ${totalTrueLost > 0 ? `
            <section class="dashboard-section">
                <h2 class="section-heading">Loss reasons</h2>
                <div class="stats-method-list">
                    ${Object.entries(trueLossReasons)
                        .sort(([, a], [, b]) => b - a)
                        .map(([reason, count]) => {
                            const barW = Math.round(count / totalTrueLost * 100);
                            return `
                            <div class="stats-method-row">
                                <div class="stats-method-header">
                                    <span class="method-badge">${escHtml(LOSS_REASON_LABELS[reason] || reason)}</span>
                                    <span class="stats-method-count">${count} plant${count !== 1 ? 's' : ''} lost</span>
                                    <span class="stats-rate poor">${barW}%</span>
                                </div>
                                <div class="stats-bar-track">
                                    <div class="stats-bar-fill loss" style="width:${barW}%"></div>
                                </div>
                            </div>`;
                        }).join('')}
                </div>
                ${totalDiscarded > 0 ? `<p class="stats-discard-note">+ ${totalDiscarded} plant${totalDiscarded !== 1 ? 's' : ''} deliberately thinned or discarded (not counted as losses)</p>` : ''}
            </section>
            ` : totalDiscarded > 0 ? `
            <section class="dashboard-section">
                <h2 class="section-heading">Plants removed</h2>
                <p class="stats-discard-note">${totalDiscarded} plant${totalDiscarded !== 1 ? 's' : ''} deliberately thinned or discarded — no involuntary losses recorded.</p>
            </section>
            ` : ''}

            <!-- Activity by month -->
            ${months.length > 1 ? `
            <section class="dashboard-section">
                <h2 class="section-heading">Batches started by month</h2>
                <div class="stats-month-chart">
                    ${(() => {
                        const maxCount = Math.max(...months.map(([, c]) => c));
                        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                        return months.map(([key, count]) => {
                            const [y, m] = key.split('-');
                            const label = `${monthNames[parseInt(m) - 1]} '${y.slice(2)}`;
                            const h = Math.max(4, Math.round(count / maxCount * 80));
                            return `
                            <div class="month-bar-col">
                                <div class="month-bar-wrap">
                                    <div class="month-bar" style="height:${h}px" title="${count} batch${count !== 1 ? 'es' : ''}"></div>
                                </div>
                                <span class="month-bar-label">${label}</span>
                            </div>`;
                        }).join('');
                    })()}
                </div>
            </section>
            ` : ''}

            ${completed.length === 0 ? `
            <div class="info-box" style="margin:0 0 24px;">
                <p>Success rate and insights will appear once you've completed some batches.</p>
            </div>` : ''}

        </div>
    `;
}
