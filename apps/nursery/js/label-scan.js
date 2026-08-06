// =============================================================
//  label-scan.js — Scan a nursery label to pre-fill the batch form
//  Captures front + back photos, compresses them, sends them to the
//  scan-label Netlify function, and fills empty form fields from the
//  structured result. Nothing is saved automatically — John reviews.
// =============================================================

import imageCompression from 'https://cdn.jsdelivr.net/npm/browser-image-compression@2/dist/browser-image-compression.mjs';
import { showToast } from './ui-utils.js';

const ENDPOINT = '/.netlify/functions/scan-label';

const COMPRESS_OPTIONS = {
    maxSizeMB:        0.9,
    maxWidthOrHeight: 1600,
    useWebWorker:     true,
    fileType:         'image/jpeg',
    initialQuality:   0.8,
};

// HTML for the scan card. Injected at the top of the New Batch form.
export function scanPanelHTML() {
    return `
    <div class="label-scan" id="label-scan">
        <div class="label-scan-head">
            <span class="label-scan-title">📷 Scan a nursery label</span>
            <span class="label-scan-sub">Optional — reads the label and fills the fields below for you to check.</span>
        </div>
        <div class="label-scan-slots">
            <div class="label-scan-slot" id="ls-slot-front">
                <div class="label-scan-thumb" id="ls-thumb-front">Front</div>
                <div class="label-scan-btns">
                    <label class="btn btn-secondary btn-sm">📸<input type="file" id="ls-cam-front" accept="image/*" capture="environment" style="display:none"></label>
                    <label class="btn btn-secondary btn-sm">🖼<input type="file" id="ls-gal-front" accept="image/*" style="display:none"></label>
                </div>
            </div>
            <div class="label-scan-slot" id="ls-slot-back">
                <div class="label-scan-thumb" id="ls-thumb-back">Back</div>
                <div class="label-scan-btns">
                    <label class="btn btn-secondary btn-sm">📸<input type="file" id="ls-cam-back" accept="image/*" capture="environment" style="display:none"></label>
                    <label class="btn btn-secondary btn-sm">🖼<input type="file" id="ls-gal-back" accept="image/*" style="display:none"></label>
                </div>
            </div>
        </div>
        <button type="button" class="btn btn-primary label-scan-go" id="ls-read-btn" disabled>Read label &amp; fill form</button>
        <p class="label-scan-status" id="ls-status"></p>
    </div>`;
}

// Scroll the scan card into view and pulse it — used when the form is
// opened from a "Scan label" shortcut so the card is obvious.
export function focusScanCard() {
    const panel = document.getElementById('label-scan');
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel.classList.remove('label-scan-pulse');
    // Force reflow so the animation restarts if called again.
    void panel.offsetWidth;
    panel.classList.add('label-scan-pulse');
    setTimeout(() => panel.classList.remove('label-scan-pulse'), 1800);
}

// Convert a File to a compressed base64 string (no data: prefix).
async function fileToBase64(file) {
    let toRead = file;
    try {
        toRead = await imageCompression(file, COMPRESS_OPTIONS);
    } catch {
        // fall back to the original file if compression fails
    }
    const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload  = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(toRead);
    });
    const comma = dataUrl.indexOf(',');
    return dataUrl.slice(comma + 1);
}

// Set a text input / textarea only if empty, and flash it green.
function setIfEmpty(id, value) {
    if (!value) return false;
    const el = document.getElementById(id);
    if (!el) return false;
    if (el.value && el.value.trim()) return false;
    el.value = value;
    flash(el);
    return true;
}

// Force a value onto an element (used for the required plant-name field).
function setForce(id, value) {
    if (!value) return false;
    const el = document.getElementById(id);
    if (!el) return false;
    el.value = value;
    flash(el);
    return true;
}

function flash(el) {
    el.classList.add('scan-filled');
    setTimeout(() => el.classList.remove('scan-filled'), 2200);
}

// Build a botanical display name from parsed parts.
function buildDisplayName(f) {
    // A scanned label rarely distinguishes hybrid type — default to interspecific
    // placement (Genus × species), the common case.
    const parts = [];
    if (f.genus) parts.push(f.genus);
    if (f.hybrid && f.species) parts.push('×');
    if (f.species) parts.push(f.species);
    if (f.cultivar) parts.push(`'${f.cultivar}'`);
    return parts.join(' ').trim();
}

// Apply the returned fields to the form. Returns the number of fields filled.
function applyFields(f) {
    let n = 0;

    // Botanical components (botanical-group is visible on a new, unlinked form)
    if (setIfEmpty('genus-input',       f.genus))      n++;
    if (setIfEmpty('species-input',     f.species))    n++;
    if (setIfEmpty('subspecies-input',  f.subspecies)) n++;
    if (setIfEmpty('variety-input',     f.variety))    n++;
    if (setIfEmpty('cultivar-input',    f.cultivar))   n++;
    if (setIfEmpty('authority-input',   f.authority))  n++;
    if (setIfEmpty('common-name-input', f.commonName)) n++;

    if (f.hybrid) {
        // A scanned label rarely states the type — default to interspecific.
        const htSel = document.getElementById('hybrid-type-select');
        if (htSel && !htSel.value) { htSel.value = 'interspecific'; flash(htSel); n++; }
    }

    // Plant name — the required field at the top. Prefer botanical, else common.
    const plantInput = document.getElementById('plant-input');
    if (plantInput && !plantInput.value.trim()) {
        const display = buildDisplayName(f) || f.commonName || '';
        if (display) { setForce('plant-input', display); n++; }
    }

    // Plant information
    if (setIfEmpty('description-input', f.description))    n++;
    if (setIfEmpty('care-input',        f.careNotes))      n++;
    if (setIfEmpty('height-input',      f.ultimateHeight)) n++;
    if (setIfEmpty('width-input',       f.ultimateWidth))  n++;

    // These are acquired plants → default the method (reveals stage/purpose UI).
    const methodSelect = document.getElementById('method-select');
    if (methodSelect && methodSelect.value !== 'acquired-potted') {
        methodSelect.value = 'acquired-potted';
        methodSelect.dispatchEvent(new Event('change'));
        flash(methodSelect);
    }

    // Supplier → set source to Purchased and fill the supplier field.
    if (f.supplier) {
        const sourceType = document.getElementById('source-type');
        if (sourceType) {
            sourceType.value = 'purchased';
            sourceType.dispatchEvent(new Event('change'));
        }
        if (setForce('src-supplier', f.supplier)) n++;
    }

    return n;
}

// Wire up the scan card. Call after the form HTML is in the DOM.
export function initLabelScan() {
    const panel = document.getElementById('label-scan');
    if (!panel) return;

    const files    = { front: null, back: null };
    const readBtn  = document.getElementById('ls-read-btn');
    const statusEl = document.getElementById('ls-status');

    function refreshReadBtn() {
        readBtn.disabled = !(files.front || files.back);
    }

    function showThumb(which, file) {
        const thumb = document.getElementById(`ls-thumb-${which}`);
        if (!thumb) return;
        const url = URL.createObjectURL(file);
        thumb.style.backgroundImage = `url("${url}")`;
        thumb.classList.add('has-image');
        thumb.textContent = '';
    }

    function bindInput(id, which) {
        const input = document.getElementById(id);
        if (!input) return;
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            if (!file) return;
            files[which] = file;
            showThumb(which, file);
            refreshReadBtn();
        });
    }

    bindInput('ls-cam-front', 'front');
    bindInput('ls-gal-front', 'front');
    bindInput('ls-cam-back',  'back');
    bindInput('ls-gal-back',  'back');

    readBtn.addEventListener('click', async () => {
        if (!files.front && !files.back) return;
        readBtn.disabled  = true;
        const original    = readBtn.textContent;
        readBtn.textContent = 'Reading…';
        statusEl.textContent = 'Compressing photos…';

        try {
            const images = [];
            if (files.front) images.push({ mimeType: 'image/jpeg', data: await fileToBase64(files.front) });
            if (files.back)  images.push({ mimeType: 'image/jpeg', data: await fileToBase64(files.back) });

            statusEl.textContent = 'Reading the label…';
            const resp = await fetch(ENDPOINT, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ images }),
            });

            let payload = {};
            try { payload = await resp.json(); } catch { /* non-JSON error */ }

            if (!resp.ok) {
                const parts = [payload.error || `Scan failed (${resp.status})`];
                if (payload.status) parts.push(`HTTP ${payload.status}`);
                if (payload.detail) parts.push(String(payload.detail).slice(0, 300));
                const msg = parts.join(' — ');
                console.error('Label scan server error:', resp.status, payload);
                statusEl.textContent = msg;
                showToast(payload.error || 'Scan failed', 'error');
                return;
            }

            const fields = payload.fields || {};
            const filled = applyFields(fields);

            if (filled > 0) {
                statusEl.textContent = `Filled ${filled} field${filled === 1 ? '' : 's'} — please check them below.`;
                showToast(`Filled ${filled} field${filled === 1 ? '' : 's'} from the label — please check`, 'success');
            } else {
                statusEl.textContent = 'Nothing new could be read from the label. Try clearer photos, or fill the form manually.';
                showToast('Could not read useful details from the label', 'info');
            }
        } catch (e) {
            console.error('Label scan error:', e);
            statusEl.textContent = 'Could not reach the label reader. Check your connection and try again.';
            showToast('Label scan failed — you can still fill the form manually', 'error');
        } finally {
            readBtn.textContent = original;
            refreshReadBtn();
        }
    });
}
