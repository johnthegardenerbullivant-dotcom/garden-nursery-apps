// =============================================================
//  batch-germination.js — Record germination / update the seedling count
//  A sown seed batch has no plant count until this is saved. Saving it
//  again as more seedlings come up replaces the count. The arithmetic is
//  in germination.js, which can be tested in Node.
// =============================================================

import {
    getLogsForBatch, getOutcomesForBatch, addNurseryLog, updateNurseryBatch,
    recomputeBatchState, fmtDate, todayStr
} from './db.js';
import { showModal, hideModal, showToast, datePicker, initDatePickers, isValidDateStr } from './ui-utils.js';
import { isUncounted, germinationUpdates, germinationRate } from './germination.js';

export function showGerminationForm(batch, onSaved) {
    const first   = isUncounted(batch);
    const current = first ? null : (batch.currentQty ?? batch.startQty ?? null);
    const minDate = batch.sownDate || batch.startDate || null;

    showModal(first ? 'Record germination' : 'Update seedling count', `
        <form id="germ-form" novalidate>
            <p class="form-hint" style="margin-top:0;">
                Count the seedlings in the tray now${first ? '' : ', including any that have come up since last time'}.
                Record losses and thinning as log entries rather than counting lower, so the germination rate stays right.
                ${first ? 'Enter 0 if nothing came up — the batch will be closed as lost.' : ''}
            </p>
            <div class="form-row-two">
                <div class="form-group">
                    <label class="form-label" for="germ-count">Seedlings now <span class="required">*</span></label>
                    <input class="form-input" type="number" id="germ-count" min="0" inputmode="numeric"
                           value="${current ?? ''}">
                    ${batch.seedCount > 0 ? `<p class="form-hint">From ${batch.seedCount} seeds sown</p>` : ''}
                </div>
                <div class="form-group">
                    <label class="form-label" for="germ-date">Date <span class="required">*</span></label>
                    ${datePicker('germ-date', 'date', todayStr())}
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" for="germ-note">Note (optional)</label>
                <textarea class="form-input" id="germ-note" rows="2"></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="germ-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" id="germ-save">Save count</button>
            </div>
        </form>`);

    initDatePickers(document.getElementById('modal-body') || document.body);
    document.getElementById('germ-cancel')?.addEventListener('click', hideModal);

    document.getElementById('germ-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const raw   = document.getElementById('germ-count')?.value.trim() || '';
        const count = Number(raw);
        if (!raw || !Number.isInteger(count) || count < 0) { showToast('Enter the number of seedlings, or 0', 'error'); return; }
        const date = document.getElementById('germ-date')?.value.trim() || '';
        if (!isValidDateStr(date))     { showToast('Please enter a valid date as YYYY-MM-DD', 'error'); return; }
        if (minDate && date < minDate) { showToast(`The date can't be before ${fmtDate(minDate)}`, 'error'); return; }
        if (current != null && count < current && !confirm(
            `That's fewer than the ${current} already counted. If some died or were thinned, cancel and add a log entry ` +
            `for them instead — otherwise the germination rate will read low.\n\nSave ${count} anyway?`)) return;

        const note    = document.getElementById('germ-note')?.value.trim() || '';
        const saveBtn = document.getElementById('germ-save');
        saveBtn.disabled = true;
        try {
            const [logs, outcomes] = await Promise.all([getLogsForBatch(batch.id), getOutcomesForBatch(batch.id)]);
            const lost      = logs.reduce((sum, l) => sum + (l.lossCount || 0), 0);
            const allocated = outcomes.reduce((sum, o) => sum + (o.quantity || 0), 0);
            const updates   = germinationUpdates(batch, { count, lost, allocated, date });
            await updateNurseryBatch(batch.id, updates);

            const rate = germinationRate({ ...batch, ...updates });
            const text = count === 0 && updates.startQty === 0
                ? 'No germination.'
                : `${first ? 'Germination' : 'Seedling count'}: ${count} seedling${count === 1 ? '' : 's'} in the tray` +
                  (rate != null ? ` — ${updates.startQty} of ${batch.seedCount} seeds have come up (${rate}%).` : '.');
            await addNurseryLog({
                batchId:      batch.id,
                date,
                observation:  note ? `${text}\n${note}` : text,
                lossCount:    0,
                lossReason:   null,
                stageTo:      updates.stage || null,
                locationId:   null,
                locationName: null,
                currentQty:   count,
                photos:       [],
            });
            // Completes the batch as lost if nothing came up; otherwise leaves it as saved.
            await recomputeBatchState(batch.id, date);

            hideModal();
            showToast(updates.stage ? 'Germinated 🌱' : 'Seedling count saved', 'success');
            if (onSaved) await onSaved();
        } catch (err) {
            console.error(err);
            showToast('Could not save the count', 'error');
            saveBtn.disabled = false;
        }
    });
}
