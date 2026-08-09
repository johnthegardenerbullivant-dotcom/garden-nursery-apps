// =============================================================
//  batch-detail.js — Batch detail view, log rendering
// =============================================================

import {
    getNurseryBatch, getNurseryLocations, deleteNurseryBatch,
    getLogsForBatch, deleteNurseryLog, deleteNurseryPhoto,
    getChildBatches, updateNurseryBatch, recomputeBatchState,
    METHOD_LABELS, STAGE_LABELS, STAGE_ORDER, LOSS_REASON_LABELS,
    formatBatchQty, formatBotanicalName, escHtml, fmtDate
} from './db.js';
import { goBack, navigate, showToast } from './ui-utils.js';
import { isAtLeast } from './auth.js';
import { openNurseryPhotoLightbox, loadAndRenderBatchPhotos } from './batch-photos.js';
import { showLogForm } from './batch-log-form.js';
import { showEditLogForm } from './batch-log-edit.js';
import { loadAndRenderOutcomes, showOutcomeForm } from './batch-outcomes.js';
import { showBatchForm, buildSourceLabel, invalidatePlantsCache, invalidateStockCache } from './batch-form.js';

// =============================================
//  BATCH DETAIL
// =============================================

export async function renderBatchDetail(container, headerActionEl, backBtn, id) {
    backBtn.classList.add('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading batch…</p></div>`;

    let batch, locations;
    try {
        [batch, locations] = await Promise.all([getNurseryBatch(id), getNurseryLocations()]);
        if (!batch) { container.innerHTML = `<div class="empty-state"><p>Batch not found.</p></div>`; return; }
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading batch.</p></div>`; return;
    }

    // Self-heal: a batch that reached 0 left by any means (e.g. losses logged
    // one by one before this fix existed) but was never marked complete gets
    // finalised now. Guarded so it runs at most once, then re-renders.
    if (isAtLeast('editor') && (batch.currentQty ?? batch.startQty ?? 0) <= 0 && batch.stage !== 'completed') {
        try {
            await recomputeBatchState(id);
            return renderBatchDetail(container, headerActionEl, backBtn, id);
        } catch (e) { console.error('Could not finalise emptied batch', e); }
    }

    const location = locations.find(l => l.id === batch.locationId) || null;
    const reload   = () => renderBatchDetail(container, headerActionEl, backBtn, id);

    // Header action buttons
    const editBtn   = isAtLeast('editor') ? `<button class="icon-btn" id="edit-batch-btn" title="Edit batch">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
    </button>` : '';
    const deleteBtn = isAtLeast('admin') ? `<button class="icon-btn danger" id="delete-batch-btn" title="Delete batch">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
    </button>` : '';
    headerActionEl.innerHTML = `<div style="display:flex;gap:6px;">${editBtn}${deleteBtn}</div>`;

    // Stage pipeline (excluding completed)
    const activeStages    = STAGE_ORDER.filter(s => s !== 'completed');
    const currentStageIdx = activeStages.indexOf(batch.stage || 'propagating');
    const nextStage       = batch.stage !== 'ready' && batch.stage !== 'completed'
        ? activeStages[currentStageIdx + 1] : null;
    const sourceLabel  = buildSourceLabel(batch.source);
    const isStockPlant = batch.purpose === 'stock-plant';

    // Pre-compute stage pipeline and action bar to avoid deep template nesting
    const stagePipelineHtml = isStockPlant ? '' : `<div class="stage-progress">
                ${activeStages.map((s, i) => `
                    <div class="stage-step ${i < currentStageIdx ? 'done' : ''} ${s === batch.stage ? 'current' : ''}">
                        <div class="stage-step-dot"></div>
                        <span class="stage-step-label">${STAGE_LABELS[s]}</span>
                    </div>
                    ${i < activeStages.length - 1 ? '<div class="stage-connector"></div>' : ''}
                `).join('')}
            </div>`;

    const stockPlantBarHtml = isStockPlant ? `
            <div class="stage-advance-bar" style="background:#fef3c7;border-color:#d97706;">
                <p style="margin:0 0 8px;font-size:0.9rem;font-weight:600;color:#92400e;">🪴 Nursery stock plant — held as a source of propagation material</p>
                ${isAtLeast('editor') ? `<button class="btn btn-primary btn-sm" id="take-cuttings-btn" style="width:100%;">✂️ Take cuttings / divisions from this plant</button>` : ''}
            </div>` : '';

    const advanceBarHtml = (!isStockPlant && isAtLeast('editor') && batch.stage !== 'completed') ? `
            <div class="stage-advance-bar">
                ${nextStage ? `
                <button class="btn btn-primary btn-sm" id="advance-stage-btn">
                    → Advance to ${STAGE_LABELS[nextStage]}
                </button>` : `
                <button class="btn btn-primary btn-sm" id="record-outcome-btn">
                    🏡 Record Outcome
                </button>
                <button class="btn btn-secondary btn-sm" id="take-cuttings-btn" style="margin-top:8px;width:100%;">
                    ✂️ Take cuttings / divisions from this plant
                </button>`}
            </div>` : '';

    // Botanical name is computed from parts (correct × placement) so existing
    // hybrids render properly without a data migration.
    const computedBotanical = formatBotanicalName(batch);
    const displayName       = computedBotanical || batch.plantName || 'Unnamed';
    const displaySecondary  = (batch.commonName && batch.commonName !== displayName) ? batch.commonName : '';
    const showBotanicalLine = false; // primary line already shows the botanical name

    container.innerHTML = `
        <div class="view-content">

            <!-- Header card -->
            <div class="detail-header-card">
                <h2 class="detail-plant-name">${escHtml(displayName)}</h2>
                ${displaySecondary ? `<p class="detail-common-name" style="margin:2px 0 4px; font-size:0.9rem; color:var(--grey-500);">${escHtml(displaySecondary)}</p>` : ''}
                ${showBotanicalLine ? `<p class="detail-botanical">${escHtml(batch.botanicalName)}</p>` : ''}
                ${batch.hybrid && !computedBotanical ? `<p class="detail-botanical">× Hybrid</p>` : ''}
                <div class="detail-meta-row">
                    <span class="method-badge">${escHtml(METHOD_LABELS[batch.method] || batch.method || '—')}</span>
                    <span class="stage-badge stage-${escHtml(batch.stage || 'propagating')} detail-stage-badge">${STAGE_LABELS[batch.stage] || batch.stage || '—'}</span>
                </div>
                ${batch.plantId ? `<a class="view-in-garden-link" href="https://johnandkath.garden/#plant-detail/${escHtml(batch.plantId)}" target="_blank" rel="noopener">🌿 View in garden →</a>` : ''}
            </div>

            <!-- Stage progress (hidden for stock plants) -->
            ${stagePipelineHtml}

            <!-- Stock plant banner / stage advance -->
            ${stockPlantBarHtml}
            ${advanceBarHtml}

            <!-- Details grid -->
            <div class="detail-grid">
                <div class="detail-field">
                    <span class="detail-label">Started</span>
                    <span class="detail-value">${fmtDate(batch.startDate) || '—'}</span>
                </div>
                <div class="detail-field">
                    <span class="detail-label">Quantity</span>
                    <span class="detail-value detail-qty-value">${formatBatchQty(batch)}</span>
                </div>
                ${batch.medium ? `
                <div class="detail-field">
                    <span class="detail-label">Medium</span>
                    <span class="detail-value">${escHtml(batch.medium)}</span>
                </div>` : ''}
                ${location ? `
                <div class="detail-field">
                    <span class="detail-label">Location</span>
                    <span class="detail-value">${escHtml(location.name)}</span>
                </div>` : ''}
                ${sourceLabel ? `
                <div class="detail-field" style="grid-column: 1 / -1;">
                    <span class="detail-label">Source</span>
                    <span class="detail-value">${sourceLabel}</span>
                </div>` : ''}
                ${batch.method === 'seed' && batch.source?.seedYear ? `
                <div class="detail-field">
                    <span class="detail-label">Seed year</span>
                    <span class="detail-value">${escHtml(String(batch.source.seedYear))}</span>
                </div>` : ''}
                ${batch.tags?.length ? `
                <div class="detail-field" style="grid-column: 1 / -1;">
                    <span class="detail-label">Tags</span>
                    <span class="detail-value">${batch.tags.map(t => `<span class="tag-chip">${escHtml(t)}</span>`).join(' ')}</span>
                </div>` : ''}
                ${batch.ultimateHeight ? `
                <div class="detail-field">
                    <span class="detail-label">Ult. height</span>
                    <span class="detail-value">${escHtml(batch.ultimateHeight)}</span>
                </div>` : ''}
                ${batch.ultimateWidth ? `
                <div class="detail-field">
                    <span class="detail-label">Ult. spread</span>
                    <span class="detail-value">${escHtml(batch.ultimateWidth)}</span>
                </div>` : ''}
                ${batch.authority ? `
                <div class="detail-field" style="grid-column: 1 / -1;">
                    <span class="detail-label">Authority</span>
                    <span class="detail-value">${escHtml(batch.authority)}</span>
                </div>` : ''}
            </div>

            ${batch.notes ? `
            <div class="detail-notes">
                <h3 class="detail-notes-label">Initial notes</h3>
                <p>${escHtml(batch.notes)}</p>
            </div>` : ''}

            <!-- Plant information -->
            ${(batch.description || batch.careNotes) ? `
            <div class="detail-plant-info">
                ${batch.description ? `
                <div class="detail-plant-info-block">
                    <h3 class="detail-notes-label">About this plant</h3>
                    <p>${escHtml(batch.description)}</p>
                </div>` : ''}
                ${batch.careNotes ? `
                <div class="detail-plant-info-block">
                    <h3 class="detail-notes-label">Care notes</h3>
                    <p>${escHtml(batch.careNotes)}</p>
                </div>` : ''}
            </div>` : ''}

            <!-- Batch photos -->
            <div class="section-header-row" style="margin-top:24px;">
                <h3 class="section-heading" style="margin:0;">Photos</h3>
            </div>
            <div id="batch-photos-section">
                <div class="loading-state" style="padding:8px 0;"><div class="leaf-spinner" style="font-size:0.9rem;">🌱</div></div>
            </div>

            <!-- Outcomes -->
            <div class="section-header-row" style="margin-top:24px;">
                <h3 class="section-heading" style="margin:0;">Outcomes</h3>
                ${isAtLeast('editor') && batch.stage !== 'completed' ? `<button class="btn btn-sm btn-secondary" id="record-outcome-btn2">+ Record outcome</button>` : ''}
            </div>
            <div id="outcomes-section">
                <div class="loading-state" style="padding:12px 0;">
                    <div class="leaf-spinner" style="font-size:1.1rem;">🌱</div>
                </div>
            </div>

                        <!-- Log entries -->
            <div class="section-header-row" style="margin-top:24px;">
                <h3 class="section-heading" style="margin:0;">Log entries</h3>
                ${isAtLeast('editor') ? `<button class="btn btn-sm btn-primary" id="add-log-btn">+ Add entry</button>` : ''}
            </div>
            <div id="log-entries-section">
                <div class="loading-state" style="padding:16px 0;">
                    <div class="leaf-spinner" style="font-size:1.2rem;">🌱</div>
                </div>
            </div>

            ${isStockPlant ? `
            <!-- Batches originated from this stock plant -->
            <div class="section-header-row" style="margin-top:24px;">
                <h3 class="section-heading" style="margin:0;">Batches from this stock plant</h3>
            </div>
            <div id="child-batches-section">
                <div class="loading-state" style="padding:12px 0;"><div class="leaf-spinner">🌱</div></div>
            </div>` : ''}

        </div>
    `;

    // Edit / Delete — buttons are in headerActionEl, not container, so query document
    document.querySelector('#edit-batch-btn')?.addEventListener('click', async () => {
        const locs = await getNurseryLocations();
        showBatchForm(batch, locs, reload);
    });

    document.querySelector('#delete-batch-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${batch.plantName || 'Unnamed'}"? This cannot be undone.`)) return;
        try {
            await deleteNurseryBatch(id);
            showToast('Batch deleted', 'success');
            goBack();
        } catch (e) { console.error(e); showToast('Could not delete batch', 'error'); }
    });

    // Take cuttings from stock plant — open new batch form pre-filled from this plant
    container.querySelector('#take-cuttings-btn')?.addEventListener('click', async () => {
        invalidateStockCache();  // invalidate so picker list is fresh
        const locs = await getNurseryLocations();
        showBatchForm(null, locs, reload, {
            sourceParentBatchId: batch.id,
            sourceParentName:    batch.plantName      || '',
            plantName:           batch.plantName      || '',
            genus:               batch.genus          || '',
            species:             batch.species        || '',
            subspecies:          batch.subspecies     || '',
            variety:             batch.variety        || '',
            cultivar:            batch.cultivar       || '',
            authority:           batch.authority      || '',
            commonName:          batch.commonName     || '',
            hybrid:              batch.hybrid         || false,
            hybridType:          batch.hybridType     || (batch.hybrid ? 'interspecific' : null),
            ultimateHeight:      batch.ultimateHeight || '',
            ultimateWidth:       batch.ultimateWidth  || '',
        });
    });

    // Load child batches (for stock plants)
    if (isStockPlant) {
        getChildBatches(id).then(children => {
            const sec = container.querySelector('#child-batches-section');
            if (!sec) return;
            if (children.length === 0) {
                sec.innerHTML = `<p class="form-hint" style="padding:8px 0;">No batches recorded yet. Use "Take cuttings / divisions" to create the first one.</p>`;
                return;
            }
            sec.innerHTML = children.map(c => `
                <div class="batch-row card-item" data-id="${escHtml(c.id)}" style="cursor:pointer;">
                    <div class="batch-row-main">
                        <span class="batch-row-name">${escHtml(formatBotanicalName(c) || c.plantName || 'Unnamed')}</span>
                        <span class="stage-badge stage-${escHtml(c.stage || 'propagating')}">${STAGE_LABELS[c.stage] || '—'}</span>
                    </div>
                    <div class="batch-row-meta">
                        <span class="method-badge">${METHOD_LABELS[c.method] || c.method || '—'}</span>
                        <span class="batch-row-date">${fmtDate(c.startDate)}</span>
                        <span class="batch-row-qty">${formatBatchQty(c, { noun: true })}</span>
                    </div>
                </div>
            `).join('');
            sec.querySelectorAll('.batch-row').forEach(row => {
                row.addEventListener('click', () => navigate('batch-detail', row.dataset.id));
            });
        }).catch(err => {
            console.error(err);
            const sec = container.querySelector('#child-batches-section');
            if (sec) sec.innerHTML = `<p class="form-hint">Could not load child batches.</p>`;
        });
    }

    // Advance stage
    container.querySelector('#advance-stage-btn')?.addEventListener('click', async () => {
        if (!nextStage) return;
        try {
            await updateNurseryBatch(id, { stage: nextStage });
            showToast(`Moved to ${STAGE_LABELS[nextStage]}`, 'success');
            reload();
        } catch (e) { console.error(e); showToast('Could not update stage', 'error'); }
    });

    // Record outcome (stage-advance-bar button when at 'ready')
    // Full reload so quantity, stage badge and action bars all reflect the
    // new state (including auto-completion when the batch empties).
    container.querySelector('#record-outcome-btn')?.addEventListener('click', () => {
        showOutcomeForm(batch, async () => { await reload(); });
    });
    // Record outcome button in outcomes section (available at any stage)
    container.querySelector('#record-outcome-btn2')?.addEventListener('click', () => {
        showOutcomeForm(batch, async () => { await reload(); });
    });

    // Add log entry
    container.querySelector('#add-log-btn')?.addEventListener('click', () => {
        showLogForm(batch, async () => { await reload(); });
    });

    // Load outcomes + logs + photos (async, after DOM is ready)
    loadAndRenderOutcomes(container, batch);
    loadAndRenderLogs(container, batch, reload);
    loadAndRenderBatchPhotos(container, batch);
}

// =============================================
//  PHASE 3: LOG ENTRIES
// =============================================

async function loadAndRenderLogs(container, batch, reload) {
    const section = container.querySelector('#log-entries-section');
    if (!section) return;

    let logs = [];
    try {
        logs = await getLogsForBatch(batch.id);
    } catch (e) {
        section.innerHTML = `<p style="color:var(--grey-500);font-size:0.85rem;margin-top:12px;">Could not load log entries.</p>`;
        return;
    }

    if (logs.length === 0) {
        section.innerHTML = `<div class="empty-state" style="margin-top:12px;">
            <p style="color:var(--grey-600);font-size:0.9rem;">No log entries yet. Tap "+ Add entry" to record an observation.</p>
        </div>`;
        return;
    }

    section.innerHTML = logs.map(log => logEntryCard(log, batch)).join('');

    // Lightbox for log photo thumbnails
    section.querySelectorAll('.nursery-log-lb').forEach(img => {
        img.addEventListener('click', () => openNurseryPhotoLightbox(img.src));
    });

    // Attach edit handlers
    section.querySelectorAll('.log-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const logId = btn.closest('[data-log-id]')?.dataset.logId;
            const log   = logs.find(l => l.id === logId);
            if (log) showEditLogForm(log, batch, async () => {
                // Log edit already recomputed quantity + completion; full reload
                // refreshes quantity, stage badge and action bars together.
                if (reload) await reload();
            });
        });
    });

    // Attach delete handlers
    section.querySelectorAll('.log-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const logId = btn.closest('[data-log-id]')?.dataset.logId;
            if (!logId) return;
            if (!confirm('Delete this log entry?')) return;
            try {
                // Delete any photos from Storage first
                const log = logs.find(l => l.id === logId);
                if (log?.photos?.length) {
                    await Promise.all(log.photos.map(p => deleteNurseryPhoto(p.storePath).catch(() => {})));
                }
                await deleteNurseryLog(logId);

                // Recalculate batch stage from remaining logs.
                // The batch stage must always reflect the most recent stageTo
                // across all logs; deleting a log may need to roll it back.
                const remainingLogs = await getLogsForBatch(batch.id); // newest-first
                const latestStageLog = remainingLogs.find(l => l.stageTo);
                const correctStage   = latestStageLog ? latestStageLog.stageTo : 'propagating';
                if (correctStage !== batch.stage) {
                    const stageUpdate = { stage: correctStage };
                    if (correctStage !== 'completed') {
                        stageUpdate.completedAt = null;
                        stageUpdate.outcome     = null;
                    }
                    await updateNurseryBatch(batch.id, stageUpdate);
                    batch.stage = correctStage; // keep local reference current
                }

                // Recompute remaining quantity + completion — deleting a loss
                // restores plants (and reopens the batch if it had emptied).
                await recomputeBatchState(batch.id);

                showToast('Log entry deleted', 'success');
                if (reload) await reload();
            } catch (err) {
                console.error(err);
                showToast('Could not delete log entry', 'error');
            }
        });
    });
}

function logEntryCard(log, batch) {
    const isDiscard = log.lossReason === 'discarded';
    const lossHtml = log.lossCount > 0 ? `
        <div class="log-loss">
            <span class="${isDiscard ? 'log-discard-count' : 'log-loss-count'}">−${log.lossCount} ${isDiscard ? 'thinned' : 'lost'}</span>
            ${log.lossReason && !isDiscard ? `<span class="log-loss-reason">${escHtml(LOSS_REASON_LABELS[log.lossReason] || log.lossReason)}</span>` : ''}
        </div>` : '';

    const stageHtml = log.stageTo ? `
        <div class="log-stage-change">
            <span class="log-stage-arrow">→</span>
            <span class="stage-badge stage-${escHtml(log.stageTo)}">${STAGE_LABELS[log.stageTo] || log.stageTo}</span>
        </div>` : '';

    const locationHtml = log.locationName ? `
        <div class="log-location-change">
            <span class="log-stage-arrow">📍</span>
            <span class="log-location-name">${escHtml(log.locationName)}</span>
        </div>` : '';

    const photosHtml = log.photos?.length ? `
        <div class="log-photos">
            ${log.photos.map(p => `
                <img class="log-photo-thumb nursery-log-lb" src="${escHtml(p.url)}" alt="Log photo" loading="lazy" style="cursor:zoom-in;">`).join('')}
        </div>` : '';

    const editBtn = isAtLeast('editor') ? `
        <button class="icon-btn log-edit-btn" title="Edit entry">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>` : '';

    const deleteBtn = isAtLeast('admin') ? `
        <button class="icon-btn danger log-delete-btn" title="Delete entry">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>` : '';

    return `
        <div class="log-entry-card" data-log-id="${escHtml(log.id)}">
            <div class="log-entry-header">
                <span class="log-entry-date">${fmtDate(log.date)}</span>
                ${stageHtml}
                ${locationHtml}
                <div class="log-entry-actions">${editBtn}${deleteBtn}</div>
            </div>
            ${lossHtml}
            ${log.observation ? `<p class="log-entry-obs">${escHtml(log.observation)}</p>` : ''}
            ${photosHtml}
        </div>
    `;
}



// renderBatchDetail is exported inline above (export async function)
