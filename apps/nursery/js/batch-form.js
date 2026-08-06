// =============================================================
//  batch-form.js — New / edit batch form
// =============================================================

import {
    getNurseryBatches, getGardenPlants,
    addNurseryBatch, updateNurseryBatch, escHtml, todayStr,
    formatBotanicalName, hybridTypeOf,
    getDerivedBatchQty, recomputeBatchState
} from './db.js';
import { showModal, hideModal, showToast, initDatePickers, datePicker, isValidDateStr } from './ui-utils.js';
import { scanPanelHTML, initLabelScan, focusScanCard } from './label-scan.js';

// Cache garden plants for the session (fetched once per form open)
let _gardenPlantsCache = null;
async function getGardenPlantsOnce() {
    if (!_gardenPlantsCache) _gardenPlantsCache = await getGardenPlants();
    return _gardenPlantsCache;
}

// Cache nursery stock plants for the source picker (invalidated when a new stock batch is saved)
let _stockPlantsCache = null;
async function getStockPlantsOnce() {
    if (!_stockPlantsCache) {
        const all = await getNurseryBatches();
        _stockPlantsCache = all.filter(b => (b.purpose === 'stock-plant' || b.stage === 'ready') && b.stage !== 'completed');
    }
    return _stockPlantsCache;
}


// Exported so sibling modules can invalidate the caches without touching the variables directly.
export function invalidatePlantsCache()  { _gardenPlantsCache = null; }
export function invalidateStockCache()   { _stockPlantsCache  = null; }

// =============================================
//  NEW / EDIT BATCH FORM
// =============================================

async function showBatchForm(existing, locations, onSaved, prefill = null, options = {}) {
    // Apply prefill (from "Take cuttings" button on a stock plant).
    // Synthesises a template object so the form pre-populates botanical fields and source.
    // isEdit stays false — prefill always creates a new batch, never edits one.
    if (prefill && !existing) {
        existing = {
            plantName:      prefill.plantName      || '',
            genus:          prefill.genus          || '',
            species:        prefill.species        || '',
            subspecies:     prefill.subspecies     || '',
            variety:        prefill.variety        || '',
            cultivar:       prefill.cultivar       || '',
            authority:      prefill.authority      || '',
            commonName:     prefill.commonName     || '',
            hybrid:         prefill.hybrid         || false,
            hybridType:     prefill.hybridType     || (prefill.hybrid ? 'interspecific' : null),
            ultimateHeight: prefill.ultimateHeight || '',
            ultimateWidth:  prefill.ultimateWidth  || '',
            method:         'stem-cutting',
            source: {
                type:           'nursery-stock',
                stockPlantName: prefill.sourceParentName    || '',
                parentBatchId:  prefill.sourceParentBatchId || null,
            },
        };
    }
    // isEdit only true when existing has a Firestore document id
    const isEdit = !!(existing?.id);

    // Fetch garden plants in the background while modal opens
    let gardenPlants = [];
    getGardenPlantsOnce().then(p => { gardenPlants = p; }).catch(() => {});

    // State for the plant picker
    let selectedPlantId   = existing?.plantId      || null;
    let selectedPlantName = existing?.plantName     || '';
    let selectedBotanical = existing?.botanicalName || '';

    const locOptions = locations.map(l =>
        `<option value="${escHtml(l.id)}" ${(existing?.locationId === l.id) ? 'selected' : ''}>${escHtml(l.name)}</option>`
    ).join('');

    const src = existing?.source || {};
    // Effective hybrid type for the selector (legacy boolean hybrid → interspecific)
    const existingHt = existing?.hybridType || (existing?.hybrid ? 'interspecific' : '');

    showModal(isEdit ? 'Edit Batch' : 'New Propagation Batch', `
        <form id="batch-form" novalidate>

            ${!isEdit ? scanPanelHTML() : ''}

            <!-- METHOD -->
            <div class="form-section-label">Method</div>
            <div class="form-group">
                <label class="form-label" for="method-select">Propagation method <span class="required">*</span></label>
                <select class="form-input" id="method-select" name="method">
                    ${Object.entries({
                        'seed':             '🌱 Seed',
                        'stem-cutting':     '✂️ Stem / softwood cutting',
                        'hardwood-cutting': '🪵 Hardwood cutting',
                        'root-cutting':     '🌿 Root cutting',
                        'leaf-cutting':     '🍃 Leaf cutting',
                        'division':         '⚡ Division',
                        'layering-offset':  '🔄 Layering / offset / bulbil',
                        'grafting':         '🔗 Grafting',
                        'acquired-potted':  '🪴 Acquired (potted plant)',
                    }).map(([v,l]) => `<option value="${v}" ${(existing?.method || 'seed') === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div class="form-group" id="seed-year-group" style="display:${existing?.method === 'acquired-potted' ? 'none' : (existing?.method === 'seed' && src.seedYear) || (!existing?.id && !src.type) ? 'block' : 'none'};">
                <label class="form-label" for="seed-year">Seed year (optional)</label>
                <input class="form-input" type="number" id="seed-year" name="seedYear"
                       min="2000" max="${new Date().getFullYear()}"
                       value="${escHtml(String(src.seedYear || ''))}"
                       placeholder="${new Date().getFullYear()}">
            </div>
            <div class="form-group" id="starting-stage-group" style="display:${existing?.method === 'acquired-potted' ? 'block' : 'none'};">
                <label class="form-label" for="starting-stage">Current stage <span class="required">*</span></label>
                <select class="form-input" id="starting-stage" name="startingStage">
                    <option value="potted-up"     ${existing?.stage === 'potted-up'     ? 'selected' : ''}>Potted up — needs growing on</option>
                    <option value="hardening-off" ${existing?.stage === 'hardening-off' ? 'selected' : ''}>Hardening off</option>
                    <option value="ready"         ${existing?.stage === 'ready'         ? 'selected' : ''}>Ready to plant out</option>
                </select>
            </div>
            <div class="form-group" id="purpose-group" style="display:${existing?.method === 'acquired-potted' ? 'block' : 'none'};">
                <label class="form-label" for="purpose-select">Purpose</label>
                <select class="form-input" id="purpose-select" name="purpose">
                    <option value="plant-out"   ${(!existing?.purpose || existing?.purpose === 'plant-out')  ? 'selected' : ''}>Grow on and plant out</option>
                    <option value="stock-plant" ${existing?.purpose === 'stock-plant' ? 'selected' : ''}>Stock plant — source of cuttings / divisions</option>
                </select>
                <p class="form-hint" id="stock-plant-hint" style="display:${existing?.purpose === 'stock-plant' ? 'block' : 'none'};">
                    Stock plants stay in the nursery indefinitely as a source of propagation material.
                </p>
            </div>

            <!-- SOURCE -->
            <div class="form-section-label">Source</div>
            <div class="form-group">
                <label class="form-label" for="source-type">Where did the material come from?</label>
                <select class="form-input" id="source-type" name="sourceType">
                    ${[
                        ['own-garden',    'Own garden'],
                        ['friend',        'Friend / gift'],
                        ['purchased',     'Purchased'],
                        ['wild-collected','Wild collected'],
                        ['other',         'Other'],
                        ['nursery-stock', 'Another nursery plant'],
                    ].map(([v,l]) => `<option value="${v}" ${(src.type || 'own-garden') === v ? 'selected' : ''}>${l}</option>`).join('')}
                </select>
            </div>
            <div class="source-fields" id="source-own-garden" style="display:${(!src.type || src.type === 'own-garden') ? 'flex' : 'none'};">
                <div class="form-group" style="margin:0 0 10px;">
                    <label class="form-label" for="src-garden-search">Which plant in your garden? (pick to copy its details)</label>
                    <div class="plant-picker-wrap">
                        <input class="form-input" type="text" id="src-garden-search"
                               placeholder="Search your garden library…" autocomplete="off">
                        <div class="plant-picker-dropdown" id="src-garden-dropdown" style="display:none;"></div>
                    </div>
                </div>
                <div class="form-group" style="margin:0;">
                    <label class="form-label" for="src-hint">Or just note the plant / location (optional)</label>
                    <input class="form-input" type="text" id="src-hint" name="srcHint"
                           value="${escHtml(src.plantHint || '')}"
                           placeholder="e.g. the big rose in the Back Border">
                </div>
            </div>
            <div class="source-fields" id="source-friend" style="display:${src.type === 'friend' ? 'flex' : 'none'};">
                <div class="form-group" style="margin:0;">
                    <label class="form-label" for="src-person">Person's name (optional)</label>
                    <input class="form-input" type="text" id="src-person" name="srcPerson"
                           value="${escHtml(src.personName || '')}" placeholder="e.g. Sarah">
                </div>
            </div>
            <div class="source-fields" id="source-purchased" style="display:${src.type === 'purchased' ? 'flex' : 'none'};">
                <div class="form-group" style="margin:0;">
                    <label class="form-label" for="src-supplier">Supplier (optional)</label>
                    <input class="form-input" type="text" id="src-supplier" name="srcSupplier"
                           value="${escHtml(src.supplier || '')}" placeholder="e.g. Chiltern Seeds">
                </div>
            </div>
            <div class="source-fields" id="source-other" style="display:${(src.type === 'wild-collected' || src.type === 'other') ? 'flex' : 'none'};">
                <div class="form-group" style="margin:0;">
                    <label class="form-label" for="src-notes">Notes (optional)</label>
                    <input class="form-input" type="text" id="src-notes" name="srcNotes"
                           value="${escHtml(src.notes || '')}" placeholder="Any details about the source…">
                </div>
            </div>
            <div class="source-fields" id="source-nursery-stock" style="display:${src.type === 'nursery-stock' ? 'flex' : 'none'};">
                <div class="form-group" style="margin:0;">
                    <label class="form-label" for="src-stock-search">Nursery plant — 'ready' or stock (pick to copy its details)</label>
                    <div class="plant-picker-wrap">
                        <input class="form-input" type="text" id="src-stock-search"
                               value="${escHtml(src.stockPlantName || '')}"
                               placeholder="Search your nursery plants…" autocomplete="off">
                        <div class="plant-picker-dropdown" id="src-stock-dropdown" style="display:none;"></div>
                    </div>
                    <input type="hidden" id="src-stock-id" value="${escHtml(src.parentBatchId || '')}">
                </div>
            </div>

            <!-- PLANT -->
            <div class="form-section-label">Plant</div>
            <div class="form-group">
                <label class="form-label" for="plant-input">Plant name <span class="required">*</span></label>
                <div class="plant-picker-wrap">
                    <input class="form-input" type="text" id="plant-input" name="plantName"
                           value="${escHtml(selectedPlantName)}"
                           placeholder="Type to search library or enter a new name…"
                           autocomplete="off" required>
                    <div class="plant-picker-dropdown" id="plant-dropdown" style="display:none;"></div>
                </div>
                <div class="plant-linked-chip" id="plant-linked-chip" style="display:${selectedPlantId ? 'flex' : 'none'}; margin-top:6px;">
                    <span id="linked-chip-label">${escHtml(selectedPlantName)}</span>
                    <button type="button" id="unlink-plant-btn">✕ Unlink</button>
                </div>
                <p class="form-hint" id="library-hint" style="display:${selectedPlantId ? 'none' : 'block'};">
                    Linking to the library lets the Stats and Plants views track this species over time.
                </p>
            </div>
            <div id="botanical-group" style="display:${selectedPlantId ? 'none' : 'block'};">
                <div class="form-row-two">
                    <div class="form-group">
                        <label class="form-label" for="genus-input">Genus (optional)</label>
                        <input class="form-input" type="text" id="genus-input" name="genus"
                               value="${escHtml(existing?.genus || '')}"
                               placeholder="e.g. Rosa" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="species-input">Species (optional)</label>
                        <input class="form-input" type="text" id="species-input" name="species"
                               value="${escHtml(existing?.species || '')}"
                               placeholder="e.g. canina" autocomplete="off"
                               autocapitalize="none" spellcheck="false">
                    </div>
                </div>
                <div class="form-row-two">
                    <div class="form-group">
                        <label class="form-label" for="subspecies-input">Subspecies (optional)</label>
                        <input class="form-input" type="text" id="subspecies-input" name="subspecies"
                               value="${escHtml(existing?.subspecies || '')}"
                               placeholder="e.g. alpina" autocomplete="off"
                               autocapitalize="none" spellcheck="false">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="variety-input">Variety (optional)</label>
                        <input class="form-input" type="text" id="variety-input" name="variety"
                               value="${escHtml(existing?.variety || '')}"
                               placeholder="e.g. variegata" autocomplete="off"
                               autocapitalize="none" spellcheck="false">
                    </div>
                </div>
                <div class="form-row-two">
                    <div class="form-group">
                        <label class="form-label" for="cultivar-input">Cultivar (optional)</label>
                        <input class="form-input" type="text" id="cultivar-input" name="cultivar"
                               value="${escHtml(existing?.cultivar || '')}"
                               placeholder="e.g. New Dawn" autocomplete="off">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="authority-input">Authority (optional)</label>
                        <input class="form-input" type="text" id="authority-input" name="authority"
                               value="${escHtml(existing?.authority || '')}"
                               placeholder="e.g. L. or Thunb." autocomplete="off">
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label" for="common-name-input">Common name (optional)</label>
                    <input class="form-input" type="text" id="common-name-input" name="commonName"
                           value="${escHtml(existing?.commonName || '')}"
                           placeholder="e.g. Dog rose" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label" for="hybrid-type-select">Hybrid (optional)</label>
                    <select class="form-input" id="hybrid-type-select" name="hybridType">
                        <option value="">Not a hybrid</option>
                        <option value="interspecific" ${existingHt === 'interspecific' ? 'selected' : ''}>Interspecific — × before species (e.g. Salvia × jamensis)</option>
                        <option value="intergeneric" ${existingHt === 'intergeneric' ? 'selected' : ''}>Intergeneric — × before genus (e.g. ×Chitalpa tashkentensis)</option>
                    </select>
                </div>
            </div>

            <!-- PLANT INFORMATION -->
            <div class="form-section-label">Plant information</div>
            <div class="form-group">
                <label class="form-label" for="description-input">Description (optional)</label>
                <textarea class="form-input" id="description-input" name="description" rows="3"
                          placeholder="What kind of plant is it? What will it look like when mature?">${escHtml(existing?.description || '')}</textarea>
            </div>
            <div class="form-group">
                <label class="form-label" for="care-input">Care notes (optional)</label>
                <textarea class="form-input" id="care-input" name="careNotes" rows="3"
                          placeholder="Watering, feeding, hardiness, pruning…">${escHtml(existing?.careNotes || '')}</textarea>
            </div>
            <div class="form-row-two">
                <div class="form-group">
                    <label class="form-label" for="height-input">Ultimate height (optional)</label>
                    <input class="form-input" type="text" id="height-input" name="ultimateHeight"
                           value="${escHtml(existing?.ultimateHeight || '')}"
                           placeholder="e.g. 1.5m" autocomplete="off">
                </div>
                <div class="form-group">
                    <label class="form-label" for="width-input">Ultimate spread (optional)</label>
                    <input class="form-input" type="text" id="width-input" name="ultimateWidth"
                           value="${escHtml(existing?.ultimateWidth || '')}"
                           placeholder="e.g. 1m" autocomplete="off">
                </div>
            </div>

            <!-- DETAILS -->
            <div class="form-section-label">Details</div>
            <div class="form-row-two">
                <div class="form-group">
                    <label class="form-label" for="start-date">Start date <span class="required">*</span></label>
                    ${datePicker('start-date', 'startDate', existing?.startDate || todayStr())}
                </div>
                <div class="form-group">
                    <label class="form-label" for="start-qty">Starting quantity <span class="required">*</span></label>
                    <input class="form-input" type="number" id="start-qty" name="startQty"
                           min="1" value="${existing?.startQty ?? 1}" required>
                </div>
            </div>
            ${isEdit ? `
            <div class="form-group">
                <label class="form-label" for="current-qty">Number remaining</label>
                <input class="form-input" type="number" id="current-qty" name="currentQty"
                       min="0" max="${existing?.startQty ?? 1}"
                       value="${existing?.currentQty ?? existing?.startQty ?? 0}">
                <p class="form-hint" id="current-qty-hint">
                    Correct the count by hand if it has drifted — up or down.
                </p>
            </div>` : ''}
            <div class="form-group">
                <label class="form-label" for="medium-input">Growing medium (optional)</label>
                <input class="form-input" type="text" id="medium-input" name="medium"
                       value="${escHtml(existing?.medium || '')}"
                       placeholder="e.g. Multipurpose compost, Perlite mix, Water"
                       list="medium-suggestions" autocomplete="off">
                <datalist id="medium-suggestions">
                    <option value="Multipurpose compost">
                    <option value="Perlite / vermiculite mix">
                    <option value="Seed compost">
                    <option value="Coir">
                    <option value="Water">
                    <option value="Sharp sand / grit mix">
                    <option value="Bark / perlite mix">
                </datalist>
            </div>
            <div class="form-group">
                <label class="form-label" for="location-select">Propagation location (optional)</label>
                <select class="form-input" id="location-select" name="locationId">
                    <option value="">— Not specified —</option>
                    ${locOptions}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label" for="notes-input">Initial notes (optional)</label>
                <textarea class="form-input" id="notes-input" name="notes" rows="2"
                          placeholder="Anything worth noting at the start…">${escHtml(existing?.notes || '')}</textarea>
            </div>
            <div class="form-group">
                <label class="form-label" for="tags-input">Tags (optional, comma-separated)</label>
                <input class="form-input" type="text" id="tags-input" name="tags"
                       value="${escHtml((existing?.tags || []).join(', '))}"
                       placeholder="e.g. 2026, greenhouse, hardy">
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="batch-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="batch-save-btn">
                    ${isEdit ? 'Save changes' : 'Create batch'}
                </button>
            </div>
        </form>
    `);

    initDatePickers(document.getElementById('modal-body') || document.body);
    document.getElementById('batch-cancel-btn')?.addEventListener('click', hideModal);

    // ---- Remaining-quantity correction (edit only) ----
    // `derivedQty` is what the logs and outcomes say is left. Saving a different
    // figure stores the difference as `qtyAdjustment` so the correction sticks
    // through every later log entry and outcome. Fetched after the form renders
    // so the modal opens immediately.
    let derivedQty = null;
    if (isEdit) {
        // Keep the remaining field's ceiling in step with the starting quantity.
        const startQtyEl = document.getElementById('start-qty');
        const curQtyEl   = document.getElementById('current-qty');
        startQtyEl?.addEventListener('input', () => {
            const max = parseInt(startQtyEl.value) || 1;
            if (curQtyEl) curQtyEl.max = max;
        });

        getDerivedBatchQty(existing).then(qty => {
            derivedQty = qty;
            const hint = document.getElementById('current-qty-hint');
            if (!hint) return;
            const adj = existing.qtyAdjustment || 0;
            hint.innerHTML = `Logs and outcomes account for <strong>${qty}</strong> remaining.`
                + (adj ? ` A manual correction of ${adj > 0 ? '+' : ''}${adj} is currently applied.` : '')
                + ` Type a different number to correct the count — it will stick.`;
        }).catch(() => { /* leave the generic hint in place */ });
    }

    // Label scanner (new batches only)
    if (!isEdit) {
        initLabelScan();
        // When opened from a "Scan label" shortcut, draw attention to the card.
        if (options.autoScan) focusScanCard();
    }

    // ---- Plant picker ----
    const plantInput  = document.getElementById('plant-input');
    const dropdown    = document.getElementById('plant-dropdown');
    const linkedChip  = document.getElementById('plant-linked-chip');
    const chipLabel   = document.getElementById('linked-chip-label');
    const unlinkBtn   = document.getElementById('unlink-plant-btn');
    const libraryHint = document.getElementById('library-hint');
    const botanicalGrp= document.getElementById('botanical-group');

    function setSelectedPlant(plant) {
        selectedPlantId   = plant.id;
        // Use botanical name (correct × placement) as the display/save name for linked plants
        selectedBotanical = formatBotanicalName(plant);
        selectedPlantName = selectedBotanical || plant.commonName || `${plant.genus || ''} ${plant.species || ''}`.trim() || 'Unnamed';
        plantInput.value  = selectedPlantName;
        chipLabel.textContent = selectedPlantName;
        linkedChip.style.display  = 'flex';
        libraryHint.style.display = 'none';
        botanicalGrp.style.display= 'none';
        dropdown.style.display    = 'none';
        // Reflect the linked plant's hybrid type in the selector
        const htSel = document.getElementById('hybrid-type-select');
        if (htSel) htSel.value = hybridTypeOf(plant) || '';

        // Auto-fill description, care, height & spread from the garden plant record (only if not already typed)
        const descEl   = document.getElementById('description-input');
        const careEl   = document.getElementById('care-input');
        const heightEl = document.getElementById('height-input');
        const widthEl  = document.getElementById('width-input');
        if (descEl   && !descEl.value.trim())   descEl.value   = plant.description || '';
        if (careEl   && !careEl.value.trim())   careEl.value   = plant.careNotes || plant.care || '';
        if (heightEl && !heightEl.value.trim()) heightEl.value = plant.ultimateHeight || '';
        if (widthEl  && !widthEl.value.trim())  widthEl.value  = plant.ultimateWidth  || '';
    }

    unlinkBtn?.addEventListener('click', () => {
        selectedPlantId = null;
        linkedChip.style.display  = 'none';
        libraryHint.style.display = 'block';
        botanicalGrp.style.display= 'block';
        plantInput.value = '';
        plantInput.focus();
    });

    plantInput?.addEventListener('input', () => {
        if (selectedPlantId) {
            selectedPlantId = null;
            linkedChip.style.display  = 'none';
            libraryHint.style.display = 'block';
            botanicalGrp.style.display= 'block';
        }
        const q = plantInput.value.trim().toLowerCase();
        if (gardenPlants.length === 0) { dropdown.style.display = 'none'; return; }

        // FIX 4: Show all plants when field is empty; narrow as user types
        const matches = q
            ? gardenPlants.filter(p => {
                const name = (p.commonName || '').toLowerCase();
                const bot  = `${p.genus || ''} ${p.species || ''}`.toLowerCase();
                const cult = (p.cultivar || '').toLowerCase();
                return name.includes(q) || bot.includes(q) || cult.includes(q);
              }).slice(0, 10)
            : gardenPlants.slice(0, 15);  // all plants (up to 15) on empty query

        if (matches.length === 0) { dropdown.style.display = 'none'; return; }

        dropdown.innerHTML = matches.map(p => {
            const name = p.commonName || `${p.genus} ${p.species}`;
            const bot  = formatBotanicalName(p);
            return `<div class="plant-dropdown-item" data-id="${escHtml(p.id)}">
                <span class="plant-dropdown-name">${escHtml(name)}</span>
                ${bot && bot !== name ? `<span class="plant-dropdown-bot">${escHtml(bot)}</span>` : ''}
            </div>`;
        }).join('');
        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.plant-dropdown-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                const plant = gardenPlants.find(p => p.id === item.dataset.id);
                if (plant) setSelectedPlant(plant);
            });
        });
    });

    plantInput?.addEventListener('blur', () => {
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
    });
    plantInput?.addEventListener('focus', async () => {
        if (!selectedPlantId) {
            // FIX 4: Ensure plants are loaded before showing dropdown on focus
            if (gardenPlants.length === 0) {
                gardenPlants = await getGardenPlantsOnce().catch(() => []);
            }
            plantInput.dispatchEvent(new Event('input'));
        }
    });

    // ---- Nursery stock plant picker (for nursery-stock source type) ----
    const stockSearchEl = document.getElementById('src-stock-search');
    const stockDropEl   = document.getElementById('src-stock-dropdown');
    let stockPlants = [];
    if (stockSearchEl) {
        getStockPlantsOnce().then(sp => { stockPlants = sp; }).catch(() => {});
        stockSearchEl.addEventListener('input', () => {
            document.getElementById('src-stock-id').value = '';  // clear link when typing
            const q = stockSearchEl.value.trim().toLowerCase();
            if (!q || stockPlants.length === 0) { stockDropEl.style.display = 'none'; return; }
            const hits = stockPlants.filter(sp =>
                (sp.plantName || '').toLowerCase().includes(q) ||
                (sp.botanicalName || '').toLowerCase().includes(q)
            ).slice(0, 8);
            if (hits.length === 0) { stockDropEl.style.display = 'none'; return; }
            stockDropEl.innerHTML = hits.map(sp => `
                <div class="plant-dropdown-item" data-id="${escHtml(sp.id)}" data-name="${escHtml(sp.plantName || 'Unnamed')}">
                    <span class="plant-dropdown-name">${escHtml(sp.plantName || 'Unnamed')}</span>
                    ${sp.botanicalName && sp.botanicalName !== sp.plantName ? `<span class="plant-dropdown-bot">${escHtml(sp.botanicalName)}</span>` : ''}
                </div>`).join('');
            stockDropEl.style.display = 'block';
            stockDropEl.querySelectorAll('.plant-dropdown-item').forEach(item => {
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
                    stockSearchEl.value = item.dataset.name;
                    document.getElementById('src-stock-id').value = item.dataset.id;
                    stockDropEl.style.display = 'none';
                    // Copy the parent plant's botanical details into the batch fields.
                    const parent = stockPlants.find(sp => sp.id === item.dataset.id);
                    if (parent) fillFromNurseryBatch(parent);
                });
            });
        });
        stockSearchEl.addEventListener('blur', () => {
            setTimeout(() => { stockDropEl.style.display = 'none'; }, 150);
        });
    }

    // Copy a nursery batch's stored botanical details into the Plant fields.
    // Used when the source is another nursery plant ('ready' or stock). Leaves
    // the batch unlinked from the garden library (we copy the stored values),
    // filling the visible botanical inputs so they save with the new batch.
    function fillFromNurseryBatch(b) {
        selectedPlantId = null;
        if (linkedChip)   linkedChip.style.display   = 'none';
        if (libraryHint)  libraryHint.style.display  = 'block';
        if (botanicalGrp) botanicalGrp.style.display = 'block';
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
        setVal('plant-input',       b.plantName || b.botanicalName || '');
        setVal('genus-input',       b.genus);
        setVal('species-input',     b.species);
        setVal('subspecies-input',  b.subspecies);
        setVal('variety-input',     b.variety);
        setVal('cultivar-input',    b.cultivar);
        setVal('authority-input',   b.authority);
        setVal('common-name-input', b.commonName);
        const htSel = document.getElementById('hybrid-type-select');
        if (htSel) htSel.value = hybridTypeOf(b) || '';
        // Description / care / size — fill only if the user hasn't typed something.
        const fillIfEmpty = (id, v) => {
            const el = document.getElementById(id);
            if (el && v && !el.value.trim()) el.value = v;
        };
        fillIfEmpty('description-input', b.description);
        fillIfEmpty('care-input',        b.careNotes);
        fillIfEmpty('height-input',      b.ultimateHeight);
        fillIfEmpty('width-input',       b.ultimateWidth);
    }

    // ---- Own-garden source: garden library picker (copies details + links) ----
    const gardenSearchEl = document.getElementById('src-garden-search');
    const gardenDropEl   = document.getElementById('src-garden-dropdown');
    if (gardenSearchEl) {
        const renderGardenHits = () => {
            const q = gardenSearchEl.value.trim().toLowerCase();
            const list = q
                ? gardenPlants.filter(p => {
                    const name = (p.commonName || '').toLowerCase();
                    const bot  = `${p.genus || ''} ${p.species || ''}`.toLowerCase();
                    const cult = (p.cultivar || '').toLowerCase();
                    return name.includes(q) || bot.includes(q) || cult.includes(q);
                  }).slice(0, 10)
                : gardenPlants.slice(0, 15);
            if (list.length === 0) { gardenDropEl.style.display = 'none'; return; }
            gardenDropEl.innerHTML = list.map(p => {
                const name = p.commonName || `${p.genus || ''} ${p.species || ''}`.trim() || 'Unnamed';
                const bot  = formatBotanicalName(p);
                return `<div class="plant-dropdown-item" data-id="${escHtml(p.id)}">
                    <span class="plant-dropdown-name">${escHtml(name)}</span>
                    ${bot && bot !== name ? `<span class="plant-dropdown-bot">${escHtml(bot)}</span>` : ''}
                </div>`;
            }).join('');
            gardenDropEl.style.display = 'block';
            gardenDropEl.querySelectorAll('.plant-dropdown-item').forEach(item => {
                item.addEventListener('mousedown', e => {
                    e.preventDefault();
                    const plant = gardenPlants.find(p => p.id === item.dataset.id);
                    if (plant) {
                        setSelectedPlant(plant);          // links + copies all details into the Plant section
                        gardenSearchEl.value = selectedPlantName;
                    }
                    gardenDropEl.style.display = 'none';
                });
            });
        };
        gardenSearchEl.addEventListener('input', async () => {
            if (gardenPlants.length === 0) gardenPlants = await getGardenPlantsOnce().catch(() => []);
            renderGardenHits();
        });
        gardenSearchEl.addEventListener('focus', async () => {
            if (gardenPlants.length === 0) gardenPlants = await getGardenPlantsOnce().catch(() => []);
            renderGardenHits();
        });
        gardenSearchEl.addEventListener('blur', () => {
            setTimeout(() => { gardenDropEl.style.display = 'none'; }, 150);
        });
    }

    // ---- Method / seed year / source dynamic show/hide ----
    const methodSelect      = document.getElementById('method-select');
    const sourceTypeEl      = document.getElementById('source-type');
    const seedYearGrp       = document.getElementById('seed-year-group');
    const startingStageGrp  = document.getElementById('starting-stage-group');
    const purposeGrp        = document.getElementById('purpose-group');
    const purposeSelect     = document.getElementById('purpose-select');
    const stockHint         = document.getElementById('stock-plant-hint');

    function updateMethodUI(isInitial = false) {
        const isAcquired = methodSelect?.value === 'acquired-potted';
        seedYearGrp.style.display      = (methodSelect?.value === 'seed') ? 'block' : 'none';
        if (startingStageGrp) startingStageGrp.style.display = isAcquired ? 'block' : 'none';
        if (purposeGrp)       purposeGrp.style.display       = isAcquired ? 'block' : 'none';
        // When switching to acquired on a new batch, apply sensible defaults
        if (isAcquired && !isInitial && !existing?.id) {
            if (sourceTypeEl) sourceTypeEl.value = 'purchased';
            updateSourceUI();
            if (startingStageGrp) {
                const stageEl = document.getElementById('starting-stage');
                if (stageEl) stageEl.value = 'ready';
            }
        }
    }
    function updateSourceUI() {
        const v = sourceTypeEl?.value || 'own-garden';
        document.getElementById('source-own-garden').style.display     = (v === 'own-garden')    ? 'flex' : 'none';
        document.getElementById('source-friend').style.display          = (v === 'friend')        ? 'flex' : 'none';
        document.getElementById('source-purchased').style.display       = (v === 'purchased')     ? 'flex' : 'none';
        document.getElementById('source-other').style.display           = (v === 'wild-collected' || v === 'other') ? 'flex' : 'none';
        document.getElementById('source-nursery-stock').style.display   = (v === 'nursery-stock') ? 'flex' : 'none';
    }

    methodSelect?.addEventListener('change', () => updateMethodUI(false));
    sourceTypeEl?.addEventListener('change', updateSourceUI);
    purposeSelect?.addEventListener('change', () => {
        if (stockHint) stockHint.style.display = purposeSelect.value === 'stock-plant' ? 'block' : 'none';
    });
    updateMethodUI(true);
    updateSourceUI();

    // ---- Form submit ----
    document.getElementById('batch-form')?.addEventListener('submit', async e => {
        e.preventDefault();

        // Resolve the linked garden plant and hybrid type up front.
        const linkedPlant = selectedPlantId ? gardenPlants.find(p => p.id === selectedPlantId) : null;
        const hybridType  = linkedPlant
            ? (hybridTypeOf(linkedPlant) || null)
            : (document.getElementById('hybrid-type-select')?.value || null);
        const hybrid = !!hybridType;

        // If the name field is blank, build it from the botanical inputs (correct × placement)
        let plantName = plantInput?.value.trim();
        if (!plantName) {
            plantName = formatBotanicalName({
                genus:    document.getElementById('genus-input')?.value.trim()    || '',
                species:  document.getElementById('species-input')?.value.trim()  || '',
                cultivar: document.getElementById('cultivar-input')?.value.trim() || '',
                hybridType,
            });
            if (plantName && plantInput) plantInput.value = plantName;  // reflect in field
        }
        if (!plantName) { showToast('Please enter a plant name or fill in at least the genus', 'error'); return; }

        const startQty      = parseInt(document.getElementById('start-qty')?.value) || 1;

        // Start date is a text field (so it can be typed on mobile) — validate the format.
        const startDate = document.getElementById('start-date')?.value.trim() || '';
        if (!isValidDateStr(startDate)) {
            showToast('Please enter a valid start date as YYYY-MM-DD', 'error');
            return;
        }

        // Remaining quantity: convert a hand-typed figure into a signed offset
        // from what the logs and outcomes derive, so the correction survives
        // future recomputes. Falls back to the existing adjustment if the
        // derived figure has not loaded yet.
        let currentQty    = isEdit ? (existing.currentQty ?? startQty) : startQty;
        let qtyAdjustment = isEdit ? (existing.qtyAdjustment || 0) : 0;
        if (isEdit) {
            const typedQty = parseInt(document.getElementById('current-qty')?.value);
            if (Number.isFinite(typedQty)) {
                if (typedQty < 0 || typedQty > startQty) {
                    showToast(`Number remaining must be between 0 and ${startQty}`, 'error');
                    return;
                }
                currentQty = typedQty;
                if (derivedQty !== null) qtyAdjustment = typedQty - derivedQty;
            }
        }

        const srcType       = sourceTypeEl?.value || 'own-garden';
        const purpose       = document.getElementById('purpose-select')?.value       || null;
        const startingStage = document.getElementById('starting-stage')?.value       || null;
        const srcStockId    = document.getElementById('src-stock-id')?.value         || null;

        // Build botanical components — from linked plant or from individual inputs
        const genus      = linkedPlant?.genus      || document.getElementById('genus-input')?.value.trim()      || '';
        const species    = linkedPlant?.species    || document.getElementById('species-input')?.value.trim()    || '';
        const subspecies = linkedPlant?.subspecies || document.getElementById('subspecies-input')?.value.trim() || '';
        const variety    = linkedPlant?.variety    || document.getElementById('variety-input')?.value.trim()    || '';
        const cultivar   = linkedPlant?.cultivar   || document.getElementById('cultivar-input')?.value.trim()  || '';
        const authority  = linkedPlant?.authority  || document.getElementById('authority-input')?.value.trim() || '';
        const commonName = linkedPlant?.commonName || document.getElementById('common-name-input')?.value.trim() || '';

        // Build full botanical name string (correct × placement)
        const botanicalName = formatBotanicalName({ genus, species, subspecies, variety, cultivar, authority, hybridType });

        const data = {
            plantId:      selectedPlantId || null,
            plantName,
            genus,
            species,
            subspecies,
            variety,
            cultivar,
            authority,
            commonName,
            hybrid,
            hybridType,
            botanicalName,
            description:     document.getElementById('description-input')?.value.trim() || '',
            careNotes:       document.getElementById('care-input')?.value.trim() || '',
            ultimateHeight:  document.getElementById('height-input')?.value.trim() || '',
            ultimateWidth:   document.getElementById('width-input')?.value.trim() || '',
            method:       methodSelect?.value || 'seed',
            purpose:             methodSelect?.value === 'acquired-potted' ? (purpose || 'plant-out') : null,
            sourceParentBatchId: srcType === 'nursery-stock' && srcStockId ? srcStockId : null,
            source: {
                type:           srcType,
                plantHint:      document.getElementById('src-hint')?.value.trim()        || '',
                personName:     document.getElementById('src-person')?.value.trim()      || '',
                supplier:       document.getElementById('src-supplier')?.value.trim()    || '',
                notes:          document.getElementById('src-notes')?.value.trim()       || '',
                seedYear:       methodSelect?.value === 'seed'
                    ? (parseInt(document.getElementById('seed-year')?.value) || null)
                    : null,
                stockPlantName: srcType === 'nursery-stock'
                    ? (document.getElementById('src-stock-search')?.value.trim() || '')
                    : '',
                parentBatchId:  srcType === 'nursery-stock' ? srcStockId : null,
            },
            startDate,
            startQty,
            currentQty,
            qtyAdjustment,
            medium:     document.getElementById('medium-input')?.value.trim() || '',
            locationId: document.getElementById('location-select')?.value || null,
            notes:      document.getElementById('notes-input')?.value.trim() || '',
            tags:       document.getElementById('tags-input')?.value
                            .split(',').map(t => t.trim()).filter(Boolean),
            stage:      methodSelect?.value === 'acquired-potted'
                ? (startingStage || 'potted-up')
                : (existing?.id ? existing.stage : 'propagating'),
        };

        const saveBtn = document.getElementById('batch-save-btn');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        try {
            if (isEdit) {
                await updateNurseryBatch(existing.id, data);
                // Re-apply the quantity/completion rules so a hand-typed
                // remaining of 0 completes the batch (and a figure above 0
                // reopens a completed one).
                await recomputeBatchState(existing.id, todayStr());
                showToast('Batch updated', 'success');
            } else {
                await addNurseryBatch(data);
                showToast('Batch created', 'success');
            }
            _stockPlantsCache = null;  // re-fetch in case a stock plant was added/edited
            hideModal();
            if (onSaved) await onSaved();
        } catch (err) {
            console.error(err);
            showToast('Could not save batch', 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = isEdit ? 'Save changes' : 'Create batch';
        }
    });
}

// =============================================
//  SOURCE LABEL helper
// =============================================

function buildSourceLabel(source) {
    if (!source?.type) return '';
    switch (source.type) {
        case 'own-garden':
            return source.plantHint ? `Own garden — ${source.plantHint}` : 'Own garden';
        case 'friend':
            return source.personName ? `From ${source.personName}` : 'From a friend';
        case 'purchased':
            return [source.supplier, source.seedYear ? `${source.seedYear} seed` : ''].filter(Boolean).join(', ') || 'Purchased';
        case 'wild-collected':
            return source.notes ? `Wild collected — ${source.notes}` : 'Wild collected';
        case 'other':
            return source.notes || 'Other';
        case 'nursery-stock':
            return source.stockPlantName ? `Nursery stock — ${source.stockPlantName}` : 'Nursery stock plant';
        default:
            return '';
    }
}


export { showBatchForm, buildSourceLabel };
// label-scan feature wired in above (scanPanelHTML + initLabelScan)
