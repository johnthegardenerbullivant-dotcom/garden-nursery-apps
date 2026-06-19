// =============================================================
//  batch-outcomes.js — Outcome recording, editing, and rendering
// =============================================================

import {
    getGardenAreas, getOutcomesForBatch,
    addNurseryOutcome, updateNurseryOutcome, deleteNurseryOutcome,
    plantOutToGarden, updateNurseryBatch,
    escHtml, fmtDate, todayStr, LOSS_REASON_LABELS
} from './db.js';
import { showModal, hideModal, showToast } from './ui-utils.js';
import { isAtLeast } from './auth.js';

// =============================================
//  GARDEN AREAS CACHE
// =============================================

let _gardenAreasCache = null;
async function getGardenAreasOnce() {
    if (!_gardenAreasCache) _gardenAreasCache = await getGardenAreas();
    return _gardenAreasCache;
}

// =============================================
//  RENDER OUTCOMES
// =============================================

async function loadAndRenderOutcomes(container, batch) {
    const section = container.querySelector('#outcomes-section');
    if (!section) return;

    let outcomes = [];
    try {
        outcomes = await getOutcomesForBatch(batch.id);
    } catch (e) {
        section.innerHTML = `<p style="color:var(--grey-500);font-size:0.85rem;margin-top:8px;">Could not load outcomes.</p>`;
        return;
    }

    if (outcomes.length === 0) {
        section.innerHTML = `<div class="empty-state" style="margin-top:8px;">
            <p style="color:var(--grey-600);font-size:0.9rem;">No outcomes recorded yet.</p>
        </div>`;
        return;
    }

    section.innerHTML = outcomes.map(o => outcomeCard(o)).join('');

    // Edit handlers
    section.querySelectorAll('.outcome-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.closest('[data-outcome-id]')?.dataset.outcomeId;
            const o  = outcomes.find(x => x.id === id);
            if (o) showEditOutcomeForm(o, batch, () => loadAndRenderOutcomes(container, batch));
        });
    });

    // Delete handlers
    section.querySelectorAll('.outcome-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const id = btn.closest('[data-outcome-id]')?.dataset.outcomeId;
            const o  = outcomes.find(x => x.id === id);
            if (!o) return;

            const warn = o.type === 'planted-out'
                ? '\n\nNote: the corresponding entry in Garden Management will not be removed automatically.'
                : '';
            if (!confirm(`Delete this outcome (${o.quantity} plant${o.quantity !== 1 ? 's' : ''} ${o.type.replace('-', ' ')})?${warn}`)) return;

            try {
                await deleteNurseryOutcome(o.id);

                // Restore qty to batch
                const restoredQty = Math.min(
                    batch.startQty ?? 0,
                    (batch.currentQty ?? 0) + o.quantity
                );
                const batchUpdates = { currentQty: restoredQty };

                // Roll back completed stage if plants are back
                if (batch.stage === 'completed' && restoredQty > 0) {
                    batchUpdates.stage       = 'ready';
                    batchUpdates.completedAt = null;
                    batchUpdates.outcome     = null;
                }
                await updateNurseryBatch(batch.id, batchUpdates);
                batch.currentQty = restoredQty;
                if (batchUpdates.stage) batch.stage = batchUpdates.stage;

                showToast('Outcome deleted', 'success');
                await loadAndRenderOutcomes(container, batch);

                // Refresh qty display on detail page
                const qtyEl = container.querySelector('.detail-qty-value');
                if (qtyEl) qtyEl.textContent =
                    `${batch.currentQty ?? '—'} of ${batch.startQty ?? '—'} started`;

            } catch (err) {
                console.error(err);
                showToast('Could not delete outcome', 'error');
            }
        });
    });
}

// =============================================
//  OUTCOME CARD
// =============================================

function outcomeCard(o) {
    const icons  = { 'planted-out': '🏡', 'given-away': '🎁', 'lost': '💀', 'retired': '🏷️' };
    const labels = { 'planted-out': 'Planted out', 'given-away': 'Given away', 'lost': 'Lost', 'retired': 'Retired as stock plant' };
    const icon  = icons[o.type]  || '📦';
    const label = labels[o.type] || o.type || '—';

    let detail = '';
    if (o.type === 'planted-out' && o.areaName)       detail = `→ ${escHtml(o.areaName)}`;
    if (o.type === 'given-away'  && o.recipientName)  detail = `→ ${escHtml(o.recipientName)}`;
    if (o.type === 'lost'        && o.lossReason)     detail = escHtml(LOSS_REASON_LABELS[o.lossReason] || o.lossReason);

    const editBtn = isAtLeast('editor') ? `
        <button class="icon-btn outcome-edit-btn" title="Edit outcome">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>` : '';
    const deleteBtn = isAtLeast('admin') ? `
        <button class="icon-btn danger outcome-delete-btn" title="Delete outcome">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>` : '';

    return `
        <div class="outcome-card" data-outcome-id="${escHtml(o.id)}">
            <div class="outcome-card-header">
                <span class="outcome-icon">${icon}</span>
                <div class="outcome-card-info">
                    <span class="outcome-label">${label}</span>
                    <span class="outcome-meta">
                        <span class="outcome-qty">${o.quantity} plant${o.quantity !== 1 ? 's' : ''}</span>
                        <span class="outcome-sep">·</span>
                        <span class="outcome-date">${fmtDate(o.date)}</span>
                    </span>
                    ${detail ? `<span class="outcome-detail">${detail}</span>` : ''}
                </div>
                <div class="outcome-card-actions">${editBtn}${deleteBtn}</div>
            </div>
            ${o.notes ? `<div class="outcome-notes">${escHtml(o.notes)}</div>` : ''}
        </div>
    `;
}

// =============================================
//  SHARED FORM BUILDER
// =============================================

function buildOutcomeFormHTML(batch, existing) {
    const isEdit = !!existing;
    const src    = existing || {};
    const maxQty = isEdit
        ? (batch.currentQty ?? 0) + (existing.quantity ?? 0)   // restore old qty into the headroom
        : (batch.currentQty ?? batch.startQty ?? 1);
    const initQty  = src.quantity ?? maxQty;
    const initDate = src.date     ?? todayStr();
    const initType = src.type     ?? (batch.purpose === 'stock-plant' ? 'given-away' : 'planted-out');

    const typeOptions = [
        ...(batch.purpose !== 'stock-plant' ? [{ type: 'planted-out', icon: '🏡', label: 'Planted out' }] : []),
        { type: 'given-away', icon: '🎁', label: 'Given away' },
        { type: 'lost',       icon: '💀', label: 'Lost' },
        ...(batch.purpose === 'stock-plant' ? [{ type: 'retired', icon: '🏷️', label: 'Retire' }] : []),
    ];

    return `
        <form id="outcome-form" novalidate>

            <div class="form-group">
                <label class="form-label">Outcome type</label>
                <div class="outcome-type-pills" id="outcome-type-pills">
                    ${typeOptions.map(t => `
                        <button type="button" class="outcome-type-pill${t.type === initType ? ' active' : ''}"
                                data-type="${t.type}">
                            <span>${t.icon}</span> ${t.label}
                        </button>`).join('')}
                </div>
                <input type="hidden" id="outcome-type-hidden" value="${initType}">
            </div>

            <div class="form-row-two">
                <div class="form-group">
                    <label class="form-label" for="outcome-qty">Quantity <span class="required">*</span></label>
                    <input class="form-input" type="number" id="outcome-qty" name="quantity"
                        min="1" max="${maxQty}" value="${initQty}" required>
                    <p class="form-hint">${maxQty} available</p>
                </div>
                <div class="form-group">
                    <label class="form-label" for="outcome-date">Date <span class="required">*</span></label>
                    <input class="form-input" type="date" id="outcome-date" name="date"
                        value="${initDate}" required>
                </div>
            </div>

            <!-- Planted out -->
            <div id="fields-planted-out" style="display:${initType === 'planted-out' ? 'block' : 'none'};">
                <div class="form-group">
                    <label class="form-label" for="outcome-area">Area in garden <span class="required">*</span></label>
                    <select class="form-input" id="outcome-area" name="areaId">
                        <option value="">— Select area —</option>
                    </select>
                    <p class="form-hint" id="areas-loading-hint">Loading areas…</p>
                </div>
            </div>

            <!-- Given away -->
            <div id="fields-given-away" style="display:${initType === 'given-away' ? 'block' : 'none'};">
                <div class="form-group">
                    <label class="form-label" for="outcome-recipient">Recipient (optional)</label>
                    <input class="form-input" type="text" id="outcome-recipient"
                        value="${escHtml(src.recipientName || '')}"
                        placeholder="e.g. Sarah, Plant swap">
                </div>
            </div>

            <!-- Lost -->
            <div id="fields-lost" style="display:${initType === 'lost' ? 'block' : 'none'};">
                <div class="form-group">
                    <label class="form-label" for="outcome-loss-reason">Reason (optional)</label>
                    <select class="form-input" id="outcome-loss-reason">
                        <option value="">Unknown / not recorded</option>
                        ${Object.entries(LOSS_REASON_LABELS).map(([v, l]) =>
                            `<option value="${v}" ${src.lossReason === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select>
                </div>
            </div>

            <!-- Retired -->
            <div id="fields-retired" style="display:${initType === 'retired' ? 'block' : 'none'};">
                <p class="form-hint">The stock plant will be marked as completed.</p>
            </div>

            <div class="form-group">
                <label class="form-label" for="outcome-notes">Notes (optional)</label>
                <textarea class="form-input" id="outcome-notes" rows="2"
                    placeholder="Any extra details…">${escHtml(src.notes || '')}</textarea>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="outcome-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="outcome-save-btn">
                    ${isEdit ? 'Save changes' : 'Save outcome'}
                </button>
            </div>
        </form>
    `;
}

function wireOutcomeTypeUI(initType) {
    let selectedType = initType;

    function updateTypeUI() {
        document.querySelectorAll('.outcome-type-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === selectedType);
        });
        const hidden = document.getElementById('outcome-type-hidden');
        if (hidden) hidden.value = selectedType;
        const po = document.getElementById('fields-planted-out');
        const ga = document.getElementById('fields-given-away');
        const lo = document.getElementById('fields-lost');
        const re = document.getElementById('fields-retired');
        if (po) po.style.display = selectedType === 'planted-out' ? 'block' : 'none';
        if (ga) ga.style.display = selectedType === 'given-away'  ? 'block' : 'none';
        if (lo) lo.style.display = selectedType === 'lost'        ? 'block' : 'none';
        if (re) re.style.display = selectedType === 'retired'     ? 'block' : 'none';
    }

    document.querySelectorAll('.outcome-type-pill').forEach(btn => {
        btn.addEventListener('click', () => { selectedType = btn.dataset.type; updateTypeUI(); });
    });

    return () => document.getElementById('outcome-type-hidden')?.value || selectedType;
}

function wireAreaSelect(initAreaId) {
    getGardenAreasOnce().then(areas => {
        const sel  = document.getElementById('outcome-area');
        const hint = document.getElementById('areas-loading-hint');
        if (sel) {
            sel.innerHTML = '<option value="">— Select area —</option>' +
                areas.map(a =>
                    `<option value="${escHtml(a.id)}" ${a.id === initAreaId ? 'selected' : ''}>${escHtml(a.name)}</option>`
                ).join('');
        }
        if (hint) hint.style.display = 'none';
    }).catch(() => {
        const hint = document.getElementById('areas-loading-hint');
        if (hint) hint.textContent = 'Could not load areas.';
    });
}

// =============================================
//  ADD OUTCOME FORM
// =============================================

async function showOutcomeForm(batch, onSaved) {
    const initType = batch.purpose === 'stock-plant' ? 'given-away' : 'planted-out';
    showModal('Record Outcome', buildOutcomeFormHTML(batch, null));

    const getSelectedType = wireOutcomeTypeUI(initType);
    wireAreaSelect(null);
    let gardenAreas = await getGardenAreasOnce().catch(() => []);

    document.getElementById('outcome-cancel-btn')?.addEventListener('click', hideModal);

    document.getElementById('outcome-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const selectedType = getSelectedType();
        const qty  = parseInt(document.getElementById('outcome-qty')?.value) || 0;
        const maxQ = batch.currentQty ?? batch.startQty ?? 0;
        if (qty < 1)    { showToast('Please enter a quantity', 'error'); return; }
        if (qty > maxQ) { showToast(`Only ${maxQ} plants remaining`, 'error'); return; }

        const date  = document.getElementById('outcome-date')?.value || todayStr();
        const notes = document.getElementById('outcome-notes')?.value.trim() || '';
        const saveBtn = document.getElementById('outcome-save-btn');
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

        try {
            const outcomeData = { batchId: batch.id, date, type: selectedType, quantity: qty, notes };
            let resolvedPlantId = null;

            if (selectedType === 'planted-out') {
                const areaId = document.getElementById('outcome-area')?.value || null;
                if (!areaId) {
                    showToast('Please select a garden area to plant out to', 'error');
                    saveBtn.disabled = false; saveBtn.textContent = 'Save outcome';
                    return;
                }
                const areaName = gardenAreas.find(a => a.id === areaId)?.name || '';
                outcomeData.areaId = areaId; outcomeData.areaName = areaName;
                resolvedPlantId = await plantOutToGarden(batch, areaId, areaName, qty, date, notes);
            } else if (selectedType === 'given-away') {
                outcomeData.recipientName = document.getElementById('outcome-recipient')?.value.trim() || '';
                await addNurseryOutcome(outcomeData);
            } else {
                if (selectedType === 'lost') {
                    outcomeData.lossReason = document.getElementById('outcome-loss-reason')?.value || null;
                }
                await addNurseryOutcome(outcomeData);
            }

            const newQty = Math.max(0, (batch.currentQty ?? batch.startQty ?? 0) - qty);
            const batchUpdates = { currentQty: newQty };
            // If a new Garden plant was created, link its ID back to this batch for future reference
            if (resolvedPlantId && !batch.plantId) {
                batchUpdates.plantId = resolvedPlantId;
                batch.plantId = resolvedPlantId;
            }
            if (newQty === 0) {
                const allOutcomes = await getOutcomesForBatch(batch.id);
                const types = [...new Set(allOutcomes.map(o => o.type))];
                batchUpdates.stage       = 'completed';
                batchUpdates.completedAt = date;
                batchUpdates.outcome     = types.length === 1 ? types[0] : 'mixed';
            }
            await updateNurseryBatch(batch.id, batchUpdates);

            hideModal();
            showToast(
                newQty === 0
                    ? 'Batch completed 🎉'
                    : `Outcome recorded — ${newQty} plant${newQty !== 1 ? 's' : ''} remaining`,
                'success'
            );
            if (onSaved) await onSaved();
        } catch (err) {
            console.error(err);
            showToast('Could not save outcome', 'error');
            saveBtn.disabled = false; saveBtn.textContent = 'Save outcome';
        }
    });
}

// =============================================
//  EDIT OUTCOME FORM
// =============================================

async function showEditOutcomeForm(outcome, batch, onSaved) {
    showModal('Edit Outcome', buildOutcomeFormHTML(batch, outcome));

    const getSelectedType = wireOutcomeTypeUI(outcome.type);
    wireAreaSelect(outcome.areaId || null);
    let gardenAreas = await getGardenAreasOnce().catch(() => []);

    document.getElementById('outcome-cancel-btn')?.addEventListener('click', hideModal);

    document.getElementById('outcome-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const selectedType = getSelectedType();
        const newQty = parseInt(document.getElementById('outcome-qty')?.value) || 0;
        const oldQty = outcome.quantity;
        const maxAvail = (batch.currentQty ?? 0) + oldQty;
        if (newQty < 1)        { showToast('Please enter a quantity', 'error'); return; }
        if (newQty > maxAvail) { showToast(`Only ${maxAvail} plants available`, 'error'); return; }

        const date  = document.getElementById('outcome-date')?.value || todayStr();
        const notes = document.getElementById('outcome-notes')?.value.trim() || '';
        const saveBtn = document.getElementById('outcome-save-btn');
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

        try {
            const updatedData = { type: selectedType, quantity: newQty, date, notes };

            if (selectedType === 'planted-out') {
                const areaId   = document.getElementById('outcome-area')?.value || null;
                const areaName = areaId ? (gardenAreas.find(a => a.id === areaId)?.name || '') : '';
                updatedData.areaId = areaId; updatedData.areaName = areaName;
                // Note: planted-out creates an instance in Garden Management on add only;
                // editing here corrects the nursery record but does not update that instance.
            } else if (selectedType === 'given-away') {
                updatedData.recipientName = document.getElementById('outcome-recipient')?.value.trim() || '';
            } else if (selectedType === 'lost') {
                updatedData.lossReason = document.getElementById('outcome-loss-reason')?.value || null;
            }

            await updateNurseryOutcome(outcome.id, updatedData);

            // Recalculate batch currentQty: restore old qty, deduct new qty
            const newBatchQty = Math.max(0, (batch.currentQty ?? 0) + oldQty - newQty);
            const batchUpdates = { currentQty: newBatchQty };

            // Handle completion state
            if (newBatchQty === 0 && batch.stage !== 'completed') {
                const allOutcomes = await getOutcomesForBatch(batch.id);
                const types = [...new Set(allOutcomes.map(o => o.id === outcome.id ? selectedType : o.type))];
                batchUpdates.stage       = 'completed';
                batchUpdates.completedAt = date;
                batchUpdates.outcome     = types.length === 1 ? types[0] : 'mixed';
            } else if (newBatchQty > 0 && batch.stage === 'completed') {
                batchUpdates.stage       = 'ready';
                batchUpdates.completedAt = null;
                batchUpdates.outcome     = null;
            }
            await updateNurseryBatch(batch.id, batchUpdates);

            hideModal();
            showToast('Outcome updated', 'success');
            if (onSaved) await onSaved();
        } catch (err) {
            console.error(err);
            showToast('Could not update outcome', 'error');
            saveBtn.disabled = false; saveBtn.textContent = 'Save changes';
        }
    });
}


export { loadAndRenderOutcomes, showOutcomeForm };
