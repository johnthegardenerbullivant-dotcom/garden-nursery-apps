// =============================================================
//  batch-log-form.js — Add a new log entry to a batch
// =============================================================

import {
    addNurseryLog, updateNurseryBatch, uploadNurseryPhoto,
    getNurseryLocations,
    STAGE_LABELS, STAGE_ORDER, LOSS_REASON_LABELS, todayStr
} from './db.js';
import { showModal, hideModal, showToast, initDatePickers } from './ui-utils.js';

// =============================================
//  LOG FORM (add a log entry)
// =============================================

async function showLogForm(batch, onSaved) {
    const nextStages = STAGE_ORDER.filter(s => {
        const idx = STAGE_ORDER.indexOf(batch.stage || 'propagating');
        return STAGE_ORDER.indexOf(s) > idx && s !== 'completed';
    });

    // Fetch locations for the "move to location" picker
    let locations = [];
    try { locations = await getNurseryLocations(); } catch (e) {}

    const locOptions = locations.map(l =>
        `<option value="${l.id}" data-name="${l.name.replace(/"/g, '&quot;')}">${l.name}</option>`
    ).join('');

    showModal('Add Log Entry', `
        <form id="log-form" novalidate>
            <div class="form-group">
                <label class="form-label" for="log-date">Date <span class="required">*</span></label>
                <input class="form-input date-picker" type="date" id="log-date" name="date" value="${todayStr()}" required>
            </div>

            <div class="form-group">
                <label class="form-label" for="log-obs">Observation</label>
                <textarea class="form-input" id="log-obs" name="observation" rows="3"
                    placeholder="What did you notice? Any changes in the plants?"></textarea>
            </div>

            <div class="form-row-two">
                <div class="form-group">
                    <label class="form-label" for="log-losses">Plants removed</label>
                    <input class="form-input" type="number" id="log-losses" name="lossCount"
                        min="0" max="${batch.currentQty ?? batch.startQty ?? 999}" value="0">
                    <span class="form-hint">Losses or deliberate discards</span>
                </div>
                <div class="form-group" id="loss-reason-group" style="display:none;">
                    <label class="form-label" for="log-loss-reason">Reason</label>
                    <select class="form-input" id="log-loss-reason" name="lossReason">
                        <option value="">Select reason…</option>
                        ${Object.entries(LOSS_REASON_LABELS).map(([v,l]) =>
                            `<option value="${v}">${l}</option>`).join('')}
                    </select>
                </div>
            </div>

            ${nextStages.length ? `
            <div class="form-group">
                <label class="form-label" for="log-stage">Advance stage? (optional)</label>
                <select class="form-input" id="log-stage" name="stageTo">
                    <option value="">No change</option>
                    ${nextStages.map(s => `<option value="${s}">${STAGE_LABELS[s]}</option>`).join('')}
                </select>
            </div>` : ''}

            ${locations.length ? `
            <div class="form-group">
                <label class="form-label" for="log-location">Move to location? (optional)</label>
                <select class="form-input" id="log-location" name="locationTo">
                    <option value="">No change</option>
                    ${locOptions}
                </select>
                <p class="form-hint">If you're moving the batch as a result of this action, select the new location — the batch record will be updated.</p>
            </div>` : ''}

            <div class="form-group">
                <label class="form-label">Photos (optional)</label>
                <div class="photo-upload-strip">
                    <label class="photo-upload-mini" title="Choose from gallery" style="cursor:pointer;">
                        🖼 Gallery
                        <input type="file" id="log-gallery-input" accept="image/*" multiple style="display:none">
                    </label>
                    <label class="photo-upload-mini" title="Take a photo" style="cursor:pointer;">
                        📸 Camera
                        <input type="file" id="log-camera-input" accept="image/*" capture="environment" style="display:none">
                    </label>
                </div>
                <div id="photo-upload-progress" style="display:none;margin-top:6px;">
                    <div class="photo-upload-bar"><div class="photo-upload-fill" id="upload-fill"></div></div>
                    <p class="photo-upload-label" id="upload-label">Uploading…</p>
                </div>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="log-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="log-save-btn">Save entry</button>
            </div>
        </form>
    `);

    initDatePickers(document.getElementById('modal-body') || document.body);

    document.getElementById('log-cancel-btn')?.addEventListener('click', hideModal);

    // Show/hide loss reason when loss count > 0
    const lossInput     = document.getElementById('log-losses');
    const lossReasonGrp = document.getElementById('loss-reason-group');
    lossInput?.addEventListener('input', () => {
        const n = parseInt(lossInput.value) || 0;
        lossReasonGrp.style.display = n > 0 ? 'block' : 'none';
    });

    document.getElementById('log-form')?.addEventListener('submit', async e => {
        e.preventDefault();

        const date        = document.getElementById('log-date')?.value || todayStr();
        const observation = document.getElementById('log-obs')?.value.trim() || '';
        const lossCount   = parseInt(document.getElementById('log-losses')?.value) || 0;
        const lossReason  = lossCount > 0 ? (document.getElementById('log-loss-reason')?.value || null) : null;
        const stageTo     = document.getElementById('log-stage')?.value || null;
        const locationEl  = document.getElementById('log-location');
        const locationToId = locationEl?.value || null;
        const locationToName = locationToId
            ? locationEl.options[locationEl.selectedIndex]?.dataset?.name || ''
            : null;
        const galleryFiles = Array.from(document.getElementById('log-gallery-input')?.files || []);
        const cameraFiles  = Array.from(document.getElementById('log-camera-input')?.files || []);
        const photoFiles   = [...galleryFiles, ...cameraFiles];

        if (!observation && lossCount === 0 && !stageTo && !locationToId && photoFiles.length === 0) {
            showToast('Please add an observation, loss count, stage change, location move, or photo', 'error');
            return;
        }

        const saveBtn       = document.getElementById('log-save-btn');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        try {
            // Upload photos if any
            const photos = [];
            if (photoFiles.length > 0) {
                const progressBar   = document.getElementById('photo-upload-progress');
                const uploadFill    = document.getElementById('upload-fill');
                const uploadLabel   = document.getElementById('upload-label');
                progressBar.style.display = 'block';

                for (let i = 0; i < photoFiles.length; i++) {
                    uploadLabel.textContent = `Uploading photo ${i + 1} of ${photoFiles.length}…`;
                    const result = await uploadNurseryPhoto(batch.id, photoFiles[i], pct => {
                        uploadFill.style.width = `${pct}%`;
                    });
                    photos.push(result);
                }
                progressBar.style.display = 'none';
            }

            // Save log entry
            const currentQtySnapshot = (batch.currentQty ?? batch.startQty ?? 0) - lossCount;
            await addNurseryLog({
                batchId:      batch.id,
                date,
                observation,
                lossCount,
                lossReason,
                stageTo:      stageTo || null,
                locationId:   locationToId   || null,
                locationName: locationToName || null,
                currentQty:   Math.max(0, currentQtySnapshot),
                photos
            });

            // Update batch fields if needed
            const batchUpdates = {};
            if (lossCount > 0)  batchUpdates.currentQty = Math.max(0, currentQtySnapshot);
            if (stageTo)         batchUpdates.stage      = stageTo;
            if (locationToId)    batchUpdates.locationId = locationToId;
            if (Object.keys(batchUpdates).length > 0) {
                await updateNurseryBatch(batch.id, batchUpdates);
            }

            hideModal();
            showToast('Log entry saved', 'success');
            if (onSaved) await onSaved();

        } catch (err) {
            console.error(err);
            showToast('Could not save log entry', 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Save entry';
        }
    });
}


export { showLogForm };
