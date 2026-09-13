// =============================================================
//  batch-log-edit.js — Edit an existing log entry
// =============================================================

import {
    getNurseryBatch, updateNurseryBatch, updateNurseryLog,
    uploadNurseryPhoto, deleteNurseryPhoto,
    getNurseryLocations, recomputeBatchState,
    STAGE_LABELS, STAGE_ORDER, LOSS_REASON_LABELS, escHtml, todayStr
} from './db.js';
import { showModal, hideModal, showToast, initPhotoDragSort, initDatePickers, datePicker, isValidDateStr } from './ui-utils.js';
import { openNurseryPhotoLightbox } from './batch-photos.js';
import { sowUpdates } from './pretreatment.js';

// =============================================
//  EDIT LOG ENTRY
// =============================================

async function showEditLogForm(log, batch, onSaved) {
    // Fetch fresh batch state and locations at the moment the form opens
    const [freshBatch, locations] = await Promise.all([
        getNurseryBatch(batch.id).catch(() => batch),
        getNurseryLocations().catch(() => [])
    ]);

    const locOptions = locations.map(l =>
        `<option value="${escHtml(l.id)}" data-name="${escHtml(l.name)}" ${(log.locationId === l.id) ? 'selected' : ''}>${escHtml(l.name)}</option>`
    ).join('');

    showModal('Edit Log Entry', `
        <form id="edit-log-form" novalidate>

            <div class="form-group">
                <label class="form-label" for="edit-log-date">Date <span class="required">*</span></label>
                ${datePicker('edit-log-date', 'date', log.date || todayStr())}
            </div>

            <div class="form-group">
                <label class="form-label" for="edit-log-obs">Observation</label>
                <textarea class="form-input" id="edit-log-obs" rows="3"
                    placeholder="What did you notice?">${escHtml(log.observation || '')}</textarea>
            </div>

            <div class="form-row-two">
                <div class="form-group">
                    <label class="form-label" for="edit-log-losses">Plants removed</label>
                    <input class="form-input" type="number" id="edit-log-losses"
                        min="0" value="${log.lossCount || 0}">
                    <span class="form-hint">Losses or deliberate discards</span>
                </div>
                <div class="form-group" id="edit-loss-reason-group"
                     style="display:${(log.lossCount || 0) > 0 ? 'block' : 'none'};">
                    <label class="form-label" for="edit-log-loss-reason">Reason</label>
                    <select class="form-input" id="edit-log-loss-reason">
                        <option value="">Select reason…</option>
                        ${Object.entries(LOSS_REASON_LABELS).map(([v, l]) =>
                            `<option value="${v}" ${log.lossReason === v ? 'selected' : ''}>${l}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>

            <div class="form-group">
                <label class="form-label" for="edit-log-stage">Batch stage</label>
                <select class="form-input" id="edit-log-stage">
                    ${STAGE_ORDER.map(s =>
                        `<option value="${s}" ${freshBatch.stage === s ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`
                    ).join('')}
                </select>
                <p class="form-hint">Change this to correct a stage that was moved forward or back in error. Currently: <strong>${STAGE_LABELS[freshBatch.stage] || freshBatch.stage}</strong>.</p>
            </div>

            ${locations.length ? `
            <div class="form-group">
                <label class="form-label" for="edit-log-location">Location</label>
                <select class="form-input" id="edit-log-location">
                    <option value="" ${!log.locationId ? 'selected' : ''}>— Not specified —</option>
                    ${locOptions}
                </select>
                <p class="form-hint">Current batch location: <strong>${locations.find(l => l.id === freshBatch.locationId)?.name || 'Not set'}</strong>. Changing this will update the batch record.</p>
            </div>` : ''}

            <!-- Photos -->
            <div class="form-group" id="edit-log-photo-section">
                <label class="form-label">Photos</label>
                <div id="edit-log-photo-grid-wrap">
                    <p style="font-size:0.85rem;color:var(--grey-500);margin:4px 0;">Loading…</p>
                </div>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="edit-log-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="edit-log-save-btn">Save changes</button>
            </div>
        </form>
    `);

    initDatePickers(document.getElementById('modal-body') || document.body);
    document.getElementById('edit-log-cancel-btn')?.addEventListener('click', hideModal);

    // Show/hide loss reason
    const lossInput     = document.getElementById('edit-log-losses');
    const lossReasonGrp = document.getElementById('edit-loss-reason-group');
    lossInput?.addEventListener('input', () => {
        lossReasonGrp.style.display = (parseInt(lossInput.value) || 0) > 0 ? 'block' : 'none';
    });

    document.getElementById('edit-log-form')?.addEventListener('submit', async e => {
        e.preventDefault();

        const date        = document.getElementById('edit-log-date')?.value.trim() || '';
        if (!isValidDateStr(date)) { showToast('Please enter a valid date as YYYY-MM-DD', 'error'); return; }
        const observation = document.getElementById('edit-log-obs')?.value.trim() || '';
        const newLoss     = parseInt(document.getElementById('edit-log-losses')?.value) || 0;
        const lossReason  = newLoss > 0 ? (document.getElementById('edit-log-loss-reason')?.value || null) : null;
        const newStage    = document.getElementById('edit-log-stage')?.value;
        const locationEl  = document.getElementById('edit-log-location');
        const newLocationId   = locationEl?.value || null;
        const newLocationName = newLocationId
            ? locationEl.options[locationEl.selectedIndex]?.dataset?.name || ''
            : null;

        const saveBtn = document.getElementById('edit-log-save-btn');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        try {
            // Update the log document
            await updateNurseryLog(log.id, {
                date,
                observation,
                lossCount:    newLoss,
                lossReason,
                stageTo:      newStage,
                locationId:   newLocationId   || null,
                locationName: newLocationName || null,
            });

            // Sync batch stage and location to reflect the corrected log entry
            let batchUpdates = { stage: newStage };
            // Keep the sowing record in step when a correction crosses Pre-sowing.
            if (freshBatch.stage === 'pre-sowing' && newStage !== 'pre-sowing'
                && freshBatch.pretreatment && !freshBatch.sownDate) {
                batchUpdates = { ...sowUpdates(freshBatch, date), stage: newStage };
            } else if (newStage === 'pre-sowing' && freshBatch.stage !== 'pre-sowing') {
                batchUpdates.sownDate = null;
            }
            if (newLocationId) batchUpdates.locationId = newLocationId;
            await updateNurseryBatch(freshBatch.id, batchUpdates);

            // Recompute remaining quantity + completion after the loss change
            // (editing a log's losses can push the batch to 0 or back above it).
            await recomputeBatchState(freshBatch.id, date);

            showToast('Log updated', 'success');
            hideModal();
            onSaved();

        } catch (err) {
            console.error(err);
            showToast('Could not update log', 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save changes';
        }
    });

    // ── Photo management in edit log form ──────────────────────────────────
    let logPhotos = [...(log.photos || [])];

    function editLogPhotoGridHTML(photos) {
        const thumbs = photos.map(p =>
            `<div class="photo-thumb" data-id="${escHtml(p.storePath)}">` +
            `<img src="${escHtml(p.url)}" alt="Log photo" loading="lazy">` +
            `<button type="button" class="photo-delete edit-log-photo-del" ` +
            `data-path="${escHtml(p.storePath)}" title="Delete photo">✕</button>` +
            `</div>`
        ).join('');
        return `<div id="edit-log-photo-grid-wrap">` +
            (photos.length > 0
                ? `<div class="photo-grid" id="edit-log-photo-grid" style="margin-bottom:8px;">${thumbs}</div>`
                : `<p class="form-hint" style="margin:4px 0 8px;">No photos yet.</p>`) +
            `<div class="photo-upload-strip">` +
            `<label class="photo-upload-mini" style="cursor:pointer;" title="Choose from gallery">` +
            `🖼 Gallery<input type="file" id="elg-gallery" accept="image/*" multiple style="display:none"></label>` +
            `<label class="photo-upload-mini" style="cursor:pointer;" title="Take a photo">` +
            `📸 Camera<input type="file" id="elg-camera" accept="image/*" capture="environment" style="display:none"></label>` +
            `</div>` +
            `<div id="elg-progress" style="display:none;margin-top:6px;">` +
            `<div class="photo-upload-bar"><div class="photo-upload-fill" id="elg-fill"></div></div>` +
            `<p class="photo-upload-label" id="elg-label">Uploading…</p></div>` +
            `</div>`;
    }

    function refreshEditLogPhotoGrid() {
        const old = document.getElementById('edit-log-photo-grid-wrap');
        if (!old) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = editLogPhotoGridHTML(logPhotos);
        old.replaceWith(tmp.firstElementChild);
        bindEditLogPhotoHandlers();
    }

    function bindEditLogPhotoHandlers() {
        document.querySelectorAll('#edit-log-photo-grid .photo-thumb img').forEach(img => {
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', e => { e.stopPropagation(); openNurseryPhotoLightbox(img.src); });
        });
        const grid = document.getElementById('edit-log-photo-grid');
        if (grid && logPhotos.length > 1) {
            initPhotoDragSort(grid, async orderedPaths => {
                const reordered = orderedPaths.map(id => logPhotos.find(p => p.storePath === id)).filter(Boolean);
                logPhotos = [...reordered, ...logPhotos.filter(p => !orderedPaths.includes(p.storePath))];
                try { await updateNurseryLog(log.id, { photos: logPhotos }); }
                catch (e) { console.error(e); showToast('Could not save photo order', 'error'); }
            });
        }
        async function handleElgUpload(files) {
            if (!files.length) return;
            const prog  = document.getElementById('elg-progress');
            const fill  = document.getElementById('elg-fill');
            const label = document.getElementById('elg-label');
            if (prog) prog.style.display = 'block';
            try {
                for (let i = 0; i < files.length; i++) {
                    if (label) label.textContent = `Uploading ${i + 1} of ${files.length}...`;
                    const result = await uploadNurseryPhoto(batch.id, files[i], pct => {
                        if (fill) fill.style.width = `${pct}%`;
                    });
                    logPhotos.push(result);
                }
                await updateNurseryLog(log.id, { photos: logPhotos });
                showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
                refreshEditLogPhotoGrid();
            } catch (err) {
                console.error(err); showToast('Photo upload failed', 'error');
            } finally {
                if (prog) prog.style.display = 'none';
            }
        }
        document.getElementById('elg-gallery')?.addEventListener('change', e => handleElgUpload(Array.from(e.target.files)));
        document.getElementById('elg-camera')?.addEventListener('change',  e => handleElgUpload(Array.from(e.target.files)));
        document.querySelectorAll('.edit-log-photo-del').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                if (!confirm('Delete this photo?')) return;
                try {
                    const sp = btn.dataset.path;
                    await deleteNurseryPhoto(sp);
                    logPhotos = logPhotos.filter(p => p.storePath !== sp);
                    await updateNurseryLog(log.id, { photos: logPhotos });
                    showToast('Photo deleted', 'success');
                    refreshEditLogPhotoGrid();
                } catch (err) { console.error(err); showToast('Could not delete photo', 'error'); }
            });
        });
    }

    refreshEditLogPhotoGrid();
}

export { showEditLogForm };
