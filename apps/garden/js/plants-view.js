// =============================================================
//  plants-view.js — Plants list & detail views
// =============================================================

import {
    getPlants, getPlant, addPlant, updatePlant, deletePlant,
    getAreas,
    getInstances, getInstancesForPlant, addInstance, updateInstance, deleteInstance,
    getPhotosForPlant, uploadPhoto, deletePhoto, updatePhotoOrders, getPlantIdsWithPhotos,
    getDeceasedPlants, recordPlantDeath,
    getNurseryLocations, transferToNursery,
    formatBotanicalName, escHtml, ensureTagCode
} from './db.js';
import { showModal, hideModal, showToast, setLoading, navigate, goBack, initPhotoCarousel, datePicker, initDatePickers, initPhotoDragSort } from './ui-utils.js';
import { isAtLeast } from './auth.js';
import { DEATH_CAUSES } from './compost-view.js';
import { scanPanelHTML, initLabelScan, focusScanCard } from './label-scan.js';
import { lookupPanelHTML, initPlantLookup } from './plant-lookup.js';
import { plantQrSvg, plantTagUrl, openTagSheet, openTapeLabels,
         tapeQrPlan, qrModulesAcross, TAPE_MARGIN_PINS,
         TAG_STOCK, DEFAULT_TAG_STOCK, tapeLabelPlan } from './qr.js';

// Plain-text botanical name (strips the HTML that formatBotanicalName returns)
function plainName(plant) {
    return (formatBotanicalName(plant) || plant.commonName || 'Unnamed plant')
        .replace(/<[^>]+>/g, '');
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// =============================================
//  PLANTS LIST
// =============================================

// Persists the last search query so Back navigation restores the filtered view.
let savedPlantQuery = '';

/** Call this when navigating to Plants fresh (e.g. tapping the nav tab). */
export function clearPlantSearch() { savedPlantQuery = ''; }

export async function renderPlantsList(container, headerActionEl, backBtn) {
    setLoading(container, true);
    backBtn.classList.remove('visible');

    let plants = [], photoPlantIds = new Set(), instances = [], areas = [], deceased = [];
    try {
        [plants, photoPlantIds, instances, areas, deceased] = await Promise.all([
            getPlants(), getPlantIdsWithPhotos(), getInstances(), getAreas(), getDeceasedPlants()
        ]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading plants. Check your Firebase connection.</p></div>`;
        return;
    }

    // Hide plants that have died everywhere: at least one death record AND no
    // remaining living location. A plant still alive in another area stays.
    const livingPlantIds   = new Set(instances.map(i => i.plantId));
    const deceasedPlantIds = new Set(deceased.map(d => d.plantId));
    plants = plants.filter(p => !(deceasedPlantIds.has(p.id) && !livingPlantIds.has(p.id)));

    // Build plantId → area names map for location display
    const areaNameMap = Object.fromEntries(areas.map(a => [a.id, a.name]));
    const plantAreaNames = {};
    for (const inst of instances) {
        const name = areaNameMap[inst.areaId];
        if (!name) continue;
        if (!plantAreaNames[inst.plantId]) plantAreaNames[inst.plantId] = [];
        if (!plantAreaNames[inst.plantId].includes(name)) plantAreaNames[inst.plantId].push(name);
    }

    // Build FAB — editors and admins only
    headerActionEl.innerHTML = '';
    if (isAtLeast('editor')) {
        const fab = document.createElement('button');
        fab.className = 'fab';
        fab.title = 'Add plant';
        fab.innerHTML = '+';
        fab.addEventListener('click', () => showPlantForm(null, async () => {
            await renderPlantsList(container, headerActionEl, backBtn);
        }));
        document.body.appendChild(fab);
    }

    // Restore the previous search query (empty when arriving via nav tab)
    let query = savedPlantQuery;
    let debounceTimer = null;

    container.innerHTML = `
        <div class="search-bar">
            <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="search-input" id="plant-search" placeholder="Search by name, genus, species…"
                   autocomplete="off" value="${query.replace(/"/g, '&quot;')}">
            <button class="search-clear" id="search-clear-btn" title="Clear search" aria-label="Clear search">✕</button>
        </div>
        <div id="plant-results"></div>
    `;

    const filtered = () => plants.filter(p => {
        const q = query.toLowerCase().trim();
        if (!q) return true;

        // Split into individual words so multi-word queries like "Acer palmatum"
        // work across fields — every word must match at least one field,
        // but each word can match a *different* field.
        const words = q.split(/\s+/);
        const fields = [
            (p.genus       || '').toLowerCase(),
            (p.species     || '').toLowerCase(),
            (p.cultivar    || '').toLowerCase(),
            (p.subspecies  || '').toLowerCase(),
            (p.variety     || '').toLowerCase(),
            (p.commonName  || '').toLowerCase(),
        ];
        return words.every(word => fields.some(field => field.includes(word)));
    });

    const renderResults = () => {
        const list = filtered();
        const resultsEl = container.querySelector('#plant-results');
        if (!resultsEl) return;

        resultsEl.innerHTML = `
            <div class="list-header">
                <span class="list-title">Plants</span>
                <span class="list-count">${list.length} plant${list.length !== 1 ? 's' : ''}</span>
            </div>
            ${list.length === 0 ? `
                <div class="empty-state">
                    <div class="empty-state-icon">🌱</div>
                    <h3>${query ? 'No plants found' : 'No plants yet'}</h3>
                    <p>${query ? 'Try a different search term.' : 'Tap the + button to add your first plant.'}</p>
                </div>
            ` : `
                <div class="card-grid">
                    ${list.map(p => plantCard(p, photoPlantIds.has(p.id), plantAreaNames[p.id] || [])).join('')}
                </div>
            `}
        `;

        // Bind card clicks
        resultsEl.querySelectorAll('.plant-card').forEach(card => {
            card.addEventListener('click', () => navigate('plant-detail', card.dataset.id));
        });

        // Genus badge — filter to that genus without navigating into the card
        resultsEl.querySelectorAll('.genus-badge').forEach(badge => {
            badge.addEventListener('click', e => {
                e.stopPropagation();
                const genus = badge.dataset.genus;
                query = genus;
                savedPlantQuery = genus;
                searchInput.value = genus;
                syncClearBtn();
                clearTimeout(debounceTimer);
                renderResults();
            });
        });
    };

    const searchInput = container.querySelector('#plant-search');
    const clearBtn    = container.querySelector('#search-clear-btn');

    function syncClearBtn() {
        clearBtn.style.display = searchInput.value ? 'flex' : 'none';
    }

    // Show the clear button immediately if the search was restored from saved state
    syncClearBtn();

    // Debounced search — waits 300ms after last keystroke before filtering
    searchInput.addEventListener('input', e => {
        query = e.target.value;
        savedPlantQuery = query;   // persist so Back restores it
        syncClearBtn();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(renderResults, 300);
    });

    // Clear button — wipe the input, reset query, re-render immediately
    clearBtn.addEventListener('click', () => {
        searchInput.value = '';
        query = '';
        savedPlantQuery = '';
        syncClearBtn();
        clearTimeout(debounceTimer);
        renderResults();
        searchInput.focus();
    });

    renderResults();
    setLoading(container, false);
}

function plantCard(plant, hasPhotos = false, areaNames = []) {
    const name = formatBotanicalName(plant);
    let locationLine = '';
    if (areaNames.length === 1) {
        locationLine = `<span class="plant-card-location">📍 ${escHtml(areaNames[0])}</span>`;
    } else if (areaNames.length > 1) {
        locationLine = `<span class="plant-card-location">📍 ${areaNames.length} locations</span>`;
    } else {
        locationLine = `<span class="plant-card-location plant-card-location--unplaced">Not placed</span>`;
    }
    return `
        <div class="card plant-card" data-id="${plant.id}">
            <div class="plant-card-banner"></div>
            <div class="card-body">
                <div class="card-title">${name || '<span class="text-muted">Unnamed plant</span>'}</div>
                ${plant.commonName ? `<div class="card-subtitle">${escHtml(plant.commonName)}</div>` : ''}
                <div class="card-meta">
                    ${plant.genus ? `<button class="card-badge genus-badge" data-genus="${escHtml(plant.genus)}" title="Show all ${escHtml(plant.genus)}">${escHtml(plant.genus)}</button>` : ''}
                    ${plant.dateAcquired ? `<span class="card-badge" style="background:var(--grey-100);color:var(--grey-600);">📅 ${escHtml(plant.dateAcquired)}</span>` : ''}
                    ${hasPhotos ? `<span class="card-badge" style="background:var(--grey-100);color:var(--grey-600);" title="Has photos">📷</span>` : ''}
                </div>
                ${locationLine}
            </div>
        </div>
    `;
}

// =============================================
//  PLANT DETAIL
// =============================================

export async function renderPlantDetail(container, headerActionEl, backBtn, plantId) {
    setLoading(container, true);
    backBtn.classList.add('visible');

    // Remove any FAB from plant list
    document.querySelector('.fab')?.remove();

    let plant, instances, areas, photos;
    try {
        [plant, instances, areas, photos] = await Promise.all([
            getPlant(plantId),
            getInstancesForPlant(plantId),
            getAreas(),
            getPhotosForPlant(plantId)
        ]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading plant details.</p></div>`;
        return;
    }

    if (!plant) {
        container.innerHTML = `<div class="empty-state"><h3>Plant not found</h3></div>`;
        return;
    }

    // Enrich instances with area names
    const areaMap = Object.fromEntries(areas.map(a => [a.id, a]));
    const enriched = instances.map(i => ({ ...i, area: areaMap[i.areaId] }));

    // Header actions — tag + edit buttons for editor+
    headerActionEl.innerHTML = isAtLeast('editor')
        ? `<button class="btn-icon" id="plant-qr-btn" title="Plant tag QR code">🏷️</button>
           <button class="btn-icon" id="edit-plant-btn" title="Edit plant">✏️</button>`
        : '';

    container.innerHTML = buildPlantDetailHTML(plant, enriched, photos);

    // Web search chip — opens a Google search for the botanical name in a new tab
    container.querySelector('#botanic-search-btn')?.addEventListener('click', () => {
        const btn = container.querySelector('#botanic-search-btn');
        window.open(`https://www.google.com/search?q=${btn.dataset.query}`, '_blank');
    });

    // Plant tag (editor+) — the QR code a printed label carries, and the two
    // ways of printing it. A whole area's worth of paper tags prints from Area
    // detail; label tape is one plant at a time, which is how a label printer
    // is used in practice.
    headerActionEl.querySelector('#plant-qr-btn')?.addEventListener('click', async () => {
        await showPlantTagModal(plant);
    });

    // Edit button (editor+)
    headerActionEl.querySelector('#edit-plant-btn')?.addEventListener('click', () => {
        showPlantForm(plant, async (updated) => {
            await renderPlantDetail(container, headerActionEl, backBtn, plantId);
        });
    });

    // Delete plant (admin only)
    container.querySelector('#delete-plant-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${formatBotanicalName(plant).replace(/<[^>]+>/g,'')}"? This cannot be undone.`)) return;
        try {
            await deletePlant(plantId);
            showToast('Plant deleted', 'success');
            goBack();
        } catch (e) {
            showToast('Error deleting plant', 'error');
        }
    });

    // Add location — editor+
    container.querySelector('#add-location-btn')?.addEventListener('click', () => {
        showInstanceModal(plantId, null, areas, async () => {
            await renderPlantDetail(container, headerActionEl, backBtn, plantId);
        });
    });

    // Edit location buttons — editor+
    container.querySelectorAll('.instance-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const inst = instances.find(i => i.id === btn.dataset.id);
            if (!inst) return;
            showInstanceModal(plantId, inst, areas, async () => {
                await renderPlantDetail(container, headerActionEl, backBtn, plantId);
            });
        });
    });

    // Delete instance buttons — editor+
    container.querySelectorAll('.instance-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Remove this location entry?')) return;
            await deleteInstance(btn.dataset.id);
            showToast('Location removed');
            await renderPlantDetail(container, headerActionEl, backBtn, plantId);
        });
    });

    // Record-death buttons — editor+ (moves the plant, or some of it, to the Compost Bin)
    container.querySelectorAll('.instance-died-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const inst = enriched.find(i => i.id === btn.dataset.id);
            if (!inst) return;
            showDeathModal(plant, inst, async () => {
                await renderPlantDetail(container, headerActionEl, backBtn, plantId);
            });
        });
    });

    // Transfer-to-nursery buttons — editor+ (starts a propagation batch in the
    // Nursery app and reduces / removes the plants from this area)
    container.querySelectorAll('.instance-transfer-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const inst = enriched.find(i => i.id === btn.dataset.id);
            if (!inst) return;
            showTransferModal(plant, inst, async () => {
                await renderPlantDetail(container, headerActionEl, backBtn, plantId);
            });
        });
    });


    // Photo upload straight from the detail view — editor+. Mirrors the Area
    // detail handler; both inputs share one function so Gallery and Camera behave
    // identically. uploadPhoto() writes to the `photos` collection, which allows
    // create for editors.
    async function handleDetailPhotoUpload(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const progressEl  = container.querySelector('#plant-upload-progress');
        const progressBar = container.querySelector('#plant-upload-progress-bar');
        if (progressEl) progressEl.style.display = 'block';
        try {
            for (let i = 0; i < files.length; i++) {
                await uploadPhoto(plantId, files[i], pct => {
                    const overall = ((i / files.length) + (pct / 100 / files.length)) * 100;
                    if (progressBar) progressBar.style.width = overall + '%';
                });
            }
            showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
            await renderPlantDetail(container, headerActionEl, backBtn, plantId);
        } catch (err) {
            showToast('Photo upload failed', 'error');
            console.error(err);
        } finally {
            if (progressEl) progressEl.style.display = 'none';
        }
    }
    container.querySelector('#plant-detail-photo-input')?.addEventListener('change', handleDetailPhotoUpload);
    container.querySelector('#plant-detail-camera-input')?.addEventListener('change', handleDetailPhotoUpload);

    // Lightbox — tap photo in carousel to enlarge
    container.querySelectorAll('.photo-carousel-slide--clickable img').forEach(img => {
        img.addEventListener('click', () => openPlantLightbox(img.src));
    });

    // Initialise carousel navigation
    initPhotoCarousel(container);

    setLoading(container, false);
}

// =============================================
//  PLANT LIGHTBOX
// =============================================

function openPlantLightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `
        <button class="lightbox-close">✕</button>
        <img src="${src}" alt="Plant photo">
    `;
    lb.querySelector('.lightbox-close').addEventListener('click', () => lb.remove());
    lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
    document.body.appendChild(lb);
}

function buildPlantDetailHTML(plant, instances, photos) {
    const name = formatBotanicalName(plant);

    // Build plain-text botanical name for the web search chip
    // Intergeneric hybrids: ×Genus; interspecific: Genus × species.
    const searchHt = plant.hybridType || (plant.hybrid ? 'interspecific' : null);
    const searchParts = [];
    if (plant.genus)      searchParts.push(searchHt === 'intergeneric' ? '×' + plant.genus : plant.genus);
    if (searchHt === 'interspecific' && plant.species) searchParts.push('×');
    if (plant.species)    searchParts.push(plant.species);
    if (plant.subspecies) searchParts.push(`subsp. ${plant.subspecies}`);
    if (plant.variety)    searchParts.push(`var. ${plant.variety}`);
    let plainBotName = searchParts.join(' ');
    if (plant.cultivar)   plainBotName += ` '${plant.cultivar}'`;

    // Nomenclature details
    const nomenclatureRows = [
        ['Genus',        plant.genus],
        ['Species',      plant.species],
        ['Cultivar',     plant.cultivar ? `'${plant.cultivar}'` : null],
        ['Hybrid',       (plant.hybridType || plant.hybrid) ? ((plant.hybridType || 'interspecific') === 'intergeneric' ? 'Intergeneric (×Genus)' : 'Interspecific (Genus × species)') : null],
        ['Subspecies',   plant.subspecies],
        ['Variety',      plant.variety],
        ['Authority',    plant.authority],
        ['Common name',  plant.commonName],
        ['Date acquired', plant.dateAcquired],
        ['Height at maturity', plant.height],
        ['Width at maturity', plant.width],
    ].filter(([, v]) => v);

    return `
        <!-- Plant detail header -->
        <div class="plant-detail-header">
            <div class="plant-detail-title">${name || '<em>Unnamed plant</em>'}</div>
            ${plainBotName ? `
            <div style="margin:4px 0 6px;">
                <button id="botanic-search-btn"
                        data-query="${encodeURIComponent(plainBotName)}"
                        style="display:inline-flex;align-items:center;gap:5px;background:var(--green-50);
                               color:var(--green-700);border:1px solid var(--green-200);border-radius:20px;
                               padding:3px 10px;font-size:0.78rem;cursor:pointer;font-family:inherit;">
                    🔍 Search web
                </button>
            </div>` : ''}
            <div class="plant-detail-subtitle">
                ${plant.commonName ? `<span>${escHtml(plant.commonName)}&ensp;&middot;&ensp;</span>` : ''}
                <span>${instances.length} specimen${instances.length !== 1 ? 's' : ''} recorded</span>
            </div>
        </div>



        <!-- Nomenclature -->
        <div class="detail-section">
            <div class="detail-section-title">Nomenclature</div>
            ${nomenclatureRows.map(([label, value]) => `
                <div class="field-row">
                    <span class="field-label">${label}</span>
                    <span class="field-value">${escHtml(String(value))}</span>
                </div>
            `).join('')}
            ${nomenclatureRows.length === 0 ? '<p class="text-muted" style="font-size:0.9rem">No details recorded yet.</p>' : ''}
        </div>

        <!-- Notes & Care -->
        ${(plant.notes || plant.careReminders) ? `
        <div class="detail-section">
            <div class="detail-section-title">Notes & Care</div>
            ${plant.notes ? `
                <div class="field-row">
                    <span class="field-label">Notes / Observations</span>
                    <span class="field-value">${escHtml(plant.notes)}</span>
                </div>
            ` : ''}
            ${plant.careReminders ? `
                <div class="field-row">
                    <span class="field-label">Care reminders</span>
                    <span class="field-value">${escHtml(plant.careReminders)}</span>
                </div>
            ` : ''}
        </div>
        ` : ''}

        <!-- Photos. The section renders even with no photos so the Gallery/Camera
             strip is always reachable — previously it was hidden at zero photos,
             which meant the plants most in need of one offered no way to add it.
             Reordering and deleting still live in the edit form; deleting a photo
             is admin-only in firestore.rules, adding is editor+. -->
        <div class="detail-section">
            <div class="detail-section-title">Photos
                ${photos.length > 0 ? `
                <span style="font-size:0.75rem;color:var(--grey-400);font-weight:400;
                             margin-left:6px;">tap to enlarge · reorder via Edit</span>` : ''}
            </div>
            ${photos.length > 0 ? `
            <div class="photo-carousel">
                <div class="photo-carousel-track">
                    ${photos.map(photo => `
                        <div class="photo-carousel-slide photo-carousel-slide--clickable">
                            <img src="${photo.url}" alt="Plant photo" loading="lazy">
                        </div>
                    `).join('')}
                </div>
                ${photos.length > 1 ? `
                    <button class="photo-carousel-btn prev" title="Previous photo">&#8249;</button>
                    <button class="photo-carousel-btn next" title="Next photo">&#8250;</button>
                    <div class="photo-carousel-counter">1 / ${photos.length}</div>
                ` : ''}
            </div>
            ` : `<p class="text-muted" style="font-size:0.9rem;padding:4px 0">No photos yet.</p>`}
            ${isAtLeast('editor') ? `
            <div class="photo-upload-strip">
                <label class="photo-upload-mini" title="Choose from gallery">
                    🖼 Gallery
                    <input type="file" id="plant-detail-photo-input" accept="image/*" multiple style="display:none">
                </label>
                <label class="photo-upload-mini" title="Take a photo">
                    📸 Camera
                    <input type="file" id="plant-detail-camera-input" accept="image/*" capture="environment" style="display:none">
                </label>
            </div>
            <div class="upload-progress" id="plant-upload-progress" style="display:none;margin-top:8px;">
                <div class="upload-progress-bar" id="plant-upload-progress-bar" style="width:0%"></div>
            </div>
            ` : ''}
        </div>

        <!-- Locations (Instances) -->
        <div class="detail-section">
            <div class="flex-between" style="margin-bottom:10px;">
                <div class="detail-section-title" style="margin-bottom:0">Garden Locations</div>
                ${isAtLeast('editor') ? `<button class="btn btn-sm btn-primary" id="add-location-btn">+ Add location</button>` : ''}
            </div>
            ${instances.length === 0
                ? `<p class="text-muted" style="font-size:0.9rem;padding:4px 0">Not assigned to any garden area yet.</p>`
                : instances.map(inst => instanceRow(inst)).join('')
            }
        </div>

        <!-- Danger zone — admin only -->
        ${isAtLeast('admin') ? `
        <div class="detail-section" style="border: 1.5px solid var(--grey-200);">
            <div class="detail-section-title danger">Danger Zone</div>
            <button class="btn btn-danger btn-sm" id="delete-plant-btn">Delete this plant</button>
        </div>
        ` : ''}
    `;
}

function instanceRow(inst) {
    const areaName = inst.area ? escHtml(inst.area.name) : 'Unknown area';
    const details  = [
        inst.quantity > 1 ? `${inst.quantity} plants` : null,
        inst.datePlanted ? `Planted ${inst.datePlanted}` : null,
        inst.lastSeen    ? `Seen ${escHtml(inst.lastSeen)}` : null,
        inst.notFoundOn  ? `⚠ Not found ${escHtml(inst.notFoundOn)}` : null,
        inst.notes ? escHtml(inst.notes) : null,
    ].filter(Boolean);

    return `
        <div class="instance-row">
            <div class="instance-info">
                <div class="instance-area-name">📍 ${areaName}</div>
                ${details.length ? `<div class="instance-detail">${details.join(' · ')}</div>` : ''}
            </div>
            ${isAtLeast('editor') ? `
            <div style="display:flex;gap:6px;flex-shrink:0;">
                <button class="instance-edit-btn btn-icon" data-id="${inst.id}" title="Edit location">✏️</button>
                <button class="instance-died-btn btn-icon" data-id="${inst.id}" title="Record as died (move to Compost Bin)">🍂</button>
                <button class="instance-transfer-btn btn-icon" data-id="${inst.id}" title="Transfer to the nursery (start a propagation batch)">🪴</button>
                <button class="instance-delete-btn btn-icon" data-id="${inst.id}" title="Remove location">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
            </div>` : ''}
        </div>
    `;
}

// =============================================
//  RECORD DEATH MODAL  (move to Compost Bin)
// =============================================

export function showDeathModal(plant, instance, onSave) {
    const had      = instance.quantity || 1;
    const areaName = instance.area ? instance.area.name : 'Unknown area';
    const pName    = plainName(plant);

    const causeOpts = DEATH_CAUSES.map(c =>
        `<option value="${c.key}">${c.icon}  ${escHtml(c.label)}</option>`
    ).join('');

    const qtyField = had > 1 ? `
        <div class="form-group">
            <label class="form-label" for="death-qty">How many died?</label>
            <input class="form-input" type="number" id="death-qty" name="quantity"
                   min="1" max="${had}" value="${had}">
            <div class="form-hint">${had} growing in ${escHtml(areaName)}. The rest stay alive here.</div>
        </div>` : '';

    const html = `
        <form id="death-form" autocomplete="off">
            <div class="death-summary">
                <strong>${escHtml(pName)}</strong>
                <span>📍 ${escHtml(areaName)}</span>
            </div>
            ${qtyField}
            <div class="form-group">
                <label class="form-label" for="death-cause">Cause of death</label>
                <select class="form-input" id="death-cause" name="cause">${causeOpts}</select>
            </div>
            <div class="form-group">
                <label class="form-label" for="death-date">Date of death</label>
                <input class="form-input" type="date" id="death-date" name="diedDate" value="${todayISO()}">
            </div>
            <div class="form-group">
                <label class="form-label" for="death-notes">Notes <span class="optional">optional</span></label>
                <textarea class="form-textarea" id="death-notes" name="notes"
                          placeholder="e.g. Lost over a hard winter; rootball rotted…"></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="death-cancel-btn">Cancel</button>
                <button type="submit"  class="btn btn-primary"   id="death-save-btn">🍂 Move to Compost Bin</button>
            </div>
        </form>`;

    showModal('Record Plant Death', html);

    const form = document.getElementById('death-form');
    document.getElementById('death-cancel-btn')?.addEventListener('click', hideModal);

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd  = new FormData(form);
        const qty = had > 1 ? Math.min(had, Math.max(1, parseInt(fd.get('quantity')) || had)) : had;
        const cause = fd.get('cause') || 'unknown';

        const record = {
            plantId:    plant.id,
            plantName:  pName,
            commonName: plant.commonName || '',
            areaId:     instance.areaId || '',
            areaName,
            quantity:   qty,
            cause,
            notes:      (fd.get('notes') || '').trim(),
            diedDate:   fd.get('diedDate') || todayISO(),
        };

        const saveBtn = document.getElementById('death-save-btn');
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        try {
            await recordPlantDeath(record, { id: instance.id, quantity: had });
            showToast('Moved to the Compost Bin', 'success');
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Could not record death', 'error');
            console.error(err);
            saveBtn.disabled = false; saveBtn.textContent = '🍂 Move to Compost Bin';
        }
    });
}

// =============================================
//  TRANSFER TO NURSERY MODAL  (start a propagation batch)
// =============================================

// How the plants are going into the nursery. Mirrors the Nursery app's
// propagation methods, plus "lifted whole plant" for moving an established
// specimen across.
const NURSERY_METHODS = {
    'division':         '⚡ Division',
    'stem-cutting':     '✂️ Stem / softwood cutting',
    'hardwood-cutting': '🪵 Hardwood cutting',
    'root-cutting':     '🌿 Root cutting',
    'leaf-cutting':     '🍃 Leaf cutting',
    'layering-offset':  '🔄 Layering / offset / bulbil',
    'seed':             '🌱 Seed (collected)',
    'grafting':         '🔗 Grafting',
    'acquired-potted':  '🪴 Lifted whole plant',
};

// Nursery lifecycle stages (where the batch is right now).
const NURSERY_STAGES = {
    'propagating':   'Propagating',
    'rooted':        'Rooted',
    'potted-up':     'Potted up',
    'hardening-off': 'Hardening off',
    'ready':         'Ready to plant out',
};

async function showTransferModal(plant, instance, onSave) {
    const had      = instance.quantity || 1;
    const areaName = instance.area ? instance.area.name : 'Unknown area';
    const pName    = plainName(plant);

    // Nursery locations for the picker (may be empty if none set up yet).
    let locations = [];
    try { locations = await getNurseryLocations(); } catch (_) { /* offline / none */ }

    const locationOpts = ['<option value="">— No location yet —</option>']
        .concat(locations.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`))
        .join('');
    const methodOpts = Object.entries(NURSERY_METHODS)
        .map(([v, l]) => `<option value="${v}"${v === 'division' ? ' selected' : ''}>${l}</option>`)
        .join('');
    const stageOpts = Object.entries(NURSERY_STAGES)
        .map(([v, l]) => `<option value="${v}"${v === 'propagating' ? ' selected' : ''}>${l}</option>`)
        .join('');

    const qtyField = had > 1 ? `
        <div class="form-group">
            <label class="form-label" for="transfer-qty">How many are you moving to the nursery?</label>
            <input class="form-input" type="number" id="transfer-qty" name="quantity"
                   min="1" max="${had}" value="1">
            <div class="form-hint">${had} growing in ${escHtml(areaName)}. Any left over stay in this area.</div>
        </div>` : `
        <div class="form-hint" style="margin-bottom:12px;">Moving the 1 plant from ${escHtml(areaName)} — this area entry will be removed.</div>`;

    const html = `
        <form id="transfer-form" autocomplete="off">
            <div class="death-summary">
                <strong>${escHtml(pName)}</strong>
                <span>📍 ${escHtml(areaName)} → 🪴 Nursery</span>
            </div>
            ${qtyField}
            <div class="form-group">
                <label class="form-label" for="transfer-method">How is it going into the nursery?</label>
                <select class="form-input" id="transfer-method" name="method">${methodOpts}</select>
            </div>
            <div class="form-group">
                <label class="form-label" for="transfer-stage">Current stage</label>
                <select class="form-input" id="transfer-stage" name="stage">${stageOpts}</select>
            </div>
            <div class="form-group">
                <label class="form-label" for="transfer-location">Nursery location <span class="optional">optional</span></label>
                <select class="form-input" id="transfer-location" name="locationId">${locationOpts}</select>
            </div>
            <div class="form-group">
                <label class="form-label" for="transfer-date">Date moved</label>
                <input class="form-input" type="date" id="transfer-date" name="startDate" value="${todayISO()}">
            </div>
            <div class="form-group">
                <label class="form-label" for="transfer-notes">Notes <span class="optional">optional</span></label>
                <textarea class="form-textarea" id="transfer-notes" name="notes"
                          placeholder="e.g. Took 4 semi-ripe cuttings from the south wall shrub…"></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="transfer-cancel-btn">Cancel</button>
                <button type="submit"  class="btn btn-primary"   id="transfer-save-btn">🪴 Send to nursery</button>
            </div>
        </form>`;

    showModal('Transfer to Nursery', html);

    const form = document.getElementById('transfer-form');
    document.getElementById('transfer-cancel-btn')?.addEventListener('click', hideModal);

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd     = new FormData(form);
        const qty    = had > 1 ? Math.min(had, Math.max(1, parseInt(fd.get('quantity')) || 1)) : had;
        const method = fd.get('method') || 'division';
        const stage  = fd.get('stage')  || 'propagating';
        const notes  = (fd.get('notes') || '').trim();
        const startDate  = fd.get('startDate') || todayISO();
        const locationId = fd.get('locationId') || null;

        // Build a nursery_batches document compatible with the Nursery app schema.
        const batchData = {
            plantId:       plant.id,
            plantName:     pName,
            botanicalName: pName,
            genus:         plant.genus      || '',
            species:       plant.species    || '',
            subspecies:    plant.subspecies || '',
            variety:       plant.variety    || '',
            cultivar:      plant.cultivar   || '',
            authority:     plant.authority  || '',
            commonName:    plant.commonName || '',
            hybrid:        !!plant.hybrid,
            hybridType:    plant.hybridType || (plant.hybrid ? 'interspecific' : null),
            // Carry care/size details so a future "plant out" round-trips cleanly.
            description:    plant.notes         || '',
            careNotes:      plant.careReminders || '',
            ultimateHeight: plant.height        || '',
            ultimateWidth:  plant.width         || '',
            method,
            purpose:             null,
            sourceParentBatchId: null,
            source: {
                type:           'own-garden',
                plantHint:      areaName,
                personName:     '',
                supplier:       '',
                notes:          `Transferred from the garden (${areaName})`,
                seedYear:       null,
                stockPlantName: '',
                parentBatchId:  null,
            },
            startDate,
            startQty:   qty,
            currentQty: qty,
            medium:     '',
            locationId,
            notes,
            tags:       ['from-garden'],
            stage,
            outcome:    null,
        };

        const saveBtn = document.getElementById('transfer-save-btn');
        saveBtn.disabled = true; saveBtn.textContent = 'Sending…';
        try {
            await transferToNursery(batchData, { id: instance.id, quantity: had });
            showToast(`Sent ${qty} to the nursery`, 'success');
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Could not transfer to the nursery', 'error');
            console.error(err);
            saveBtn.disabled = false; saveBtn.textContent = '🪴 Send to nursery';
        }
    });
}

// =============================================
//  PLANT FORM (add / edit)
// =============================================

export async function showPlantForm(plant, onSave, preselectedAreaId = null, opts = {}) {
    const isEdit = !!plant;

    // For new plants, fetch areas so we can offer inline location assignment
    let areas = [];
    if (!isEdit) {
        try { areas = await getAreas(); } catch (e) { /* no areas yet — fine */ }
    }

    // Fetch existing photos upfront in edit mode so the grid is populated immediately
    let photos = [];
    if (isEdit) {
        try { photos = await getPhotosForPlant(plant.id); } catch (_) {}
    }

    showModal(isEdit ? 'Edit Plant' : 'Add Plant',
        buildPlantFormHTML(plant, areas, photos, preselectedAreaId));

    initDatePickers(document.getElementById('modal-body'));

    // Label scanner (new plants only — the scan card is rendered only then)
    if (!isEdit) {
        initLabelScan();
        if (opts && opts.focusScan) focusScanCard();
    }

    // Plant lookup — offered when editing too. Enriching a plant added years
    // ago is the main thing it is for, and it only ever appends to Notes.
    initPlantLookup({
        fields: {
            genus:      'genus',
            species:    'species',
            subspecies: 'subspecies',
            variety:    'variety',
            cultivar:   'cultivar',
            commonName: 'commonName',
        },
        targets: {
            notes:     'notes',
            careNotes: 'careReminders',
            height:    'height',
            width:     'width',
        },
    });

    // Location visibility toggle (add mode only)
    if (!isEdit) {
        const areaSelect = document.getElementById('new-plant-area');
        const locationDetails = document.getElementById('location-details');
        const locationNotesGroup = document.getElementById('location-notes-group');

        // If an area was pre-selected, reveal the location details immediately
        if (preselectedAreaId && areaSelect) {
            areaSelect.value = preselectedAreaId;
            if (locationDetails) locationDetails.style.display = '';
            if (locationNotesGroup) locationNotesGroup.style.display = '';
        }

        if (areaSelect) {
            areaSelect.addEventListener('change', () => {
                const show = !!areaSelect.value;
                if (locationDetails) locationDetails.style.display = show ? '' : 'none';
                if (locationNotesGroup) locationNotesGroup.style.display = show ? '' : 'none';
            });
        }

        // Photo file name preview
        const photoInput = document.getElementById('new-plant-photos');
        const cameraInput = document.getElementById('new-plant-camera');
        const photoNames = document.getElementById('photo-file-names');
        const updatePhotoNames = (input) => {
            if (!photoNames) return;
            const files = Array.from(input.files);
            photoNames.textContent = files.length ? files.map(f => f.name).join(', ') : '';
        };
        if (photoInput && photoNames) photoInput.addEventListener('change', () => updatePhotoNames(photoInput));
        if (cameraInput && photoNames) cameraInput.addEventListener('change', () => updatePhotoNames(cameraInput));
    }

    // ── Photo management (edit mode only) ──────────────────────────────────

    function plantPhotoGridHTML(photosArr) {
        return `
            <div id="plant-form-photo-grid">
                ${photosArr.length > 0 ? `
                <div class="photo-grid" style="margin-bottom:8px;">
                    ${photosArr.map(ph => `
                        <div class="photo-thumb" data-id="${ph.id}">
                            <img src="${ph.url}" alt="Plant photo" loading="lazy">
                            <button type="button" class="photo-delete plant-modal-delete"
                                data-id="${ph.id}" data-path="${escHtml(ph.storagePath)}"
                                title="Delete photo">✕</button>
                        </div>
                    `).join('')}
                </div>` : ''}
                <div class="photo-upload-strip">
                    <label class="photo-upload-mini" title="Choose from gallery" style="cursor:pointer;">
                        🖼 Gallery
                        <input type="file" id="plant-modal-photo-input" accept="image/*" multiple style="display:none">
                    </label>
                    <label class="photo-upload-mini" title="Take a photo" style="cursor:pointer;">
                        📸 Camera
                        <input type="file" id="plant-modal-camera-input" accept="image/*" capture="environment" style="display:none">
                    </label>
                </div>
            </div>
        `;
    }

    async function refreshPlantPhotoGrid() {
        try { photos = await getPhotosForPlant(plant.id); } catch (e) {}
        const grid = document.getElementById('plant-form-photo-grid');
        if (grid) { grid.outerHTML = plantPhotoGridHTML(photos); bindPlantPhotoHandlers(); }
    }

    async function handlePlantPhotoFiles(e) {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        try {
            for (const file of files) await uploadPhoto(plant.id, file);
            showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
            await refreshPlantPhotoGrid();
        } catch (err) {
            showToast('Photo upload failed', 'error');
            console.error(err);
        }
    }

    function bindPlantPhotoHandlers() {
        const photoGrid = document.querySelector('#plant-form-photo-grid .photo-grid');
        if (photoGrid) {
            initPhotoDragSort(photoGrid, async orderedIds => {
                try { await updatePhotoOrders(orderedIds); }
                catch (err) { showToast('Could not save photo order', 'error'); console.error(err); }
            });
        }

        document.getElementById('plant-modal-photo-input')?.addEventListener('change', handlePlantPhotoFiles);
        document.getElementById('plant-modal-camera-input')?.addEventListener('change', handlePlantPhotoFiles);
        document.querySelectorAll('.plant-modal-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Delete this photo?')) return;
                try {
                    await deletePhoto(btn.dataset.id, btn.dataset.path);
                    showToast('Photo deleted');
                    await refreshPlantPhotoGrid();
                } catch (err) { showToast('Error deleting photo', 'error'); }
            });
        });
    }

    if (isEdit) bindPlantPhotoHandlers();

    document.getElementById('cancel-plant-btn')?.addEventListener('click', hideModal);

    // Handle form submit
    document.getElementById('plant-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = {
            genus:        fd.get('genus').trim(),
            species:      fd.get('species').trim(),
            hybridType:   fd.get('hybridType') || null,
            hybrid:       !!fd.get('hybridType'),
            cultivar:     fd.get('cultivar').trim(),
            subspecies:   fd.get('subspecies').trim(),
            variety:      fd.get('variety').trim(),
            authority:    fd.get('authority').trim(),
            commonName:   fd.get('commonName').trim(),
            dateAcquired: fd.get('dateAcquired'),
            width:        fd.get('width').trim(),
            height:       fd.get('height').trim(),
            notes:        fd.get('notes').trim(),
            careReminders: fd.get('careReminders').trim(),
        };

        // Capture files + location before modal closes (gallery + camera)
        const photoInput  = document.getElementById('new-plant-photos');
        const cameraInput = document.getElementById('new-plant-camera');
        const photoFiles  = [
            ...(photoInput  ? Array.from(photoInput.files)  : []),
            ...(cameraInput ? Array.from(cameraInput.files) : []),
        ];

        const areaId = fd.get('newPlantAreaId') || '';
        const locationData = areaId ? {
            areaId,
            quantity:    parseInt(fd.get('newPlantQty')) || 1,
            datePlanted: fd.get('newPlantDate') || '',
            notes:       (fd.get('newPlantNotes') || '').trim(),
        } : null;

        const saveBtn = e.target.querySelector('#save-plant-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        try {
            if (isEdit) {
                await updatePlant(plant.id, data);
                showToast('Plant updated!', 'success');
                hideModal();
                if (onSave) await onSave(data);
            } else {
                const docRef = await addPlant(data);
                const plantId = docRef.id;

                // Add location instance if an area was chosen
                if (locationData) {
                    await addInstance({ plantId, ...locationData });
                }

                showToast('Plant added!', 'success');
                hideModal();
                if (onSave) await onSave(data);

                // Upload photos in the background after the list has refreshed
                if (photoFiles.length > 0) {
                    showToast(`Uploading ${photoFiles.length} photo${photoFiles.length !== 1 ? 's' : ''}…`);
                    try {
                        for (const file of photoFiles) {
                            await uploadPhoto(plantId, file);
                        }
                        showToast(`${photoFiles.length} photo${photoFiles.length !== 1 ? 's' : ''} uploaded!`, 'success');
                    } catch (err) {
                        showToast('Some photos failed to upload', 'error');
                        console.error(err);
                    }
                }
            }
        } catch (err) {
            showToast('Error saving plant', 'error');
            console.error(err);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    });
}

function buildPlantFormHTML(plant, areas = [], photos = [], preselectedAreaId = null) {
    plant = plant || {};
    const isEdit = !!(plant && plant.id);
    const v = (key) => escHtml(plant[key] || '');
    // Effective hybrid type (legacy boolean hybrid → interspecific)
    const ht = plant.hybridType || (plant.hybrid ? 'interspecific' : '');
    return `
        <form id="plant-form" autocomplete="off">
            ${!isEdit ? scanPanelHTML() : ''}
            <div class="form-section-label">Botanical Identity</div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="genus">Genus</label>
                    <input class="form-input" id="genus" name="genus" value="${v('genus')}" placeholder="e.g. Rosa" autocapitalize="words">
                </div>
                <div class="form-group">
                    <label class="form-label" for="species">Species <span class="optional">(epithet)</span></label>
                    <input class="form-input" id="species" name="species" value="${v('species')}" placeholder="e.g. canina" autocapitalize="none">
                </div>
            </div>

            <div class="form-group">
                <label class="form-label" for="hybridType">Hybrid <span class="optional">optional</span></label>
                <select class="form-input" id="hybridType" name="hybridType">
                    <option value="">Not a hybrid</option>
                    <option value="interspecific" ${ht === 'interspecific' ? 'selected' : ''}>Interspecific — × before species (e.g. Salvia × jamensis)</option>
                    <option value="intergeneric" ${ht === 'intergeneric' ? 'selected' : ''}>Intergeneric — × before genus (e.g. ×Chitalpa tashkentensis)</option>
                </select>
                <div class="form-hint">Interspecific = cross between two species of one genus. Intergeneric = cross between two genera (rarer).</div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="subspecies">Subspecies <span class="optional">optional</span></label>
                    <input class="form-input" id="subspecies" name="subspecies" value="${v('subspecies')}" placeholder="subsp. …" autocapitalize="none">
                </div>
                <div class="form-group">
                    <label class="form-label" for="variety">Variety <span class="optional">optional</span></label>
                    <input class="form-input" id="variety" name="variety" value="${v('variety')}" placeholder="var. …" autocapitalize="none">
                </div>
            </div>

            <div class="form-group">
                <label class="form-label" for="cultivar">Cultivar <span class="optional">optional — without quotes</span></label>
                <input class="form-input" id="cultivar" name="cultivar" value="${v('cultivar')}" placeholder="e.g. Albertine" autocapitalize="words">
                <div class="form-hint">Will be displayed in single quotes per ICNCP convention, e.g. 'Albertine'</div>
            </div>

            <!-- Sits here rather than at the top of the form because it follows the
                 order of work: name the plant, look it up, then fill in the rest. -->
            ${lookupPanelHTML()}

            <div class="form-group">
                <label class="form-label" for="authority">Authority / Author citation <span class="optional">optional</span></label>
                <input class="form-input" id="authority" name="authority" value="${v('authority')}" placeholder="e.g. L. or (Mill.) T.Nees">
            </div>

            <div class="form-section-label">Common Information</div>

            <div class="form-group">
                <label class="form-label" for="commonName">Common name <span class="optional">optional</span></label>
                <input class="form-input" id="commonName" name="commonName" value="${v('commonName')}" placeholder="e.g. Dog Rose" autocapitalize="words">
            </div>

            <div class="form-group">
                <label class="form-label" for="dateAcquired">Date acquired / planted <span class="optional">optional</span></label>
                ${datePicker('dateAcquired', 'dateAcquired', v('dateAcquired'))}
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="height">Height at maturity <span class="optional">optional</span></label>
                    <input class="form-input" id="height" name="height" value="${v('height')}" placeholder="e.g. 2m">
                </div>
                <div class="form-group">
                    <label class="form-label" for="width">Width at maturity <span class="optional">optional</span></label>
                    <input class="form-input" id="width" name="width" value="${v('width')}" placeholder="e.g. 1.5m">
                </div>
            </div>

            <div class="form-section-label">Notes & Care</div>

            <div class="form-group">
                <label class="form-label" for="notes">Notes <span class="optional">optional</span></label>
                <textarea class="form-textarea" id="notes" name="notes" placeholder="Observations, origin, history…">${v('notes')}</textarea>
            </div>

            <div class="form-group">
                <label class="form-label" for="careReminders">Care reminders <span class="optional">optional</span></label>
                <textarea class="form-textarea" id="careReminders" name="careReminders" placeholder="Pruning, feeding, watering notes…">${v('careReminders')}</textarea>
            </div>

            ${!isEdit ? `
            <div class="form-section-label">Garden Location <span class="optional">optional</span></div>
            <div class="form-group">
                <label class="form-label" for="new-plant-area">Add to area</label>
                <select class="form-input" id="new-plant-area" name="newPlantAreaId">
                    <option value="">— skip for now —</option>
                    ${areas.map(a =>
                        `<option value="${a.id}"${a.id === preselectedAreaId ? ' selected' : ''}>${escHtml(a.name)}</option>`
                    ).join('')}
                </select>
            </div>
            <div id="location-details" style="display:none">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="new-plant-qty">Quantity</label>
                        <input class="form-input" type="number" id="new-plant-qty" name="newPlantQty" value="1" min="1">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="new-plant-date">Date planted <span class="optional">optional</span></label>
                        ${datePicker('new-plant-date', 'newPlantDate')}
                    </div>
                </div>
            </div>
            <div id="location-notes-group" style="display:none" class="form-group">
                <label class="form-label" for="new-plant-notes">Location notes <span class="optional">optional</span></label>
                <input class="form-input" id="new-plant-notes" name="newPlantNotes" placeholder="e.g. Back fence, south-facing">
            </div>

            <div class="form-section-label">Photos <span class="optional">optional</span></div>
            <div class="form-group">
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <label class="btn btn-secondary" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;">
                    🖼 Gallery
                    <input type="file" id="new-plant-photos" accept="image/*" multiple style="display:none">
                </label>
                <label class="btn btn-secondary" style="cursor:pointer;display:inline-flex;align-items:center;gap:8px;">
                    📸 Camera
                    <input type="file" id="new-plant-camera" accept="image/*" capture="environment" style="display:none">
                </label>
                </div>
                <div id="photo-file-names" class="form-hint" style="margin-top:6px"></div>
            </div>
            ` : `
            <div class="form-section-label">Photos</div>
            <div id="plant-form-photo-grid">
                ${photos.length > 0 ? `
                <div class="photo-grid" style="margin-bottom:8px;">
                    ${photos.map(ph => `
                        <div class="photo-thumb" data-id="${ph.id}">
                            <img src="${ph.url}" alt="Plant photo" loading="lazy">
                            <button type="button" class="photo-delete plant-modal-delete"
                                data-id="${ph.id}" data-path="${escHtml(ph.storagePath)}" title="Delete photo">✕</button>
                        </div>
                    `).join('')}
                </div>` : ''}
                <div class="photo-upload-strip">
                    <label class="photo-upload-mini" title="Choose from gallery" style="cursor:pointer;">
                        🖼 Gallery
                        <input type="file" id="plant-modal-photo-input" accept="image/*" multiple style="display:none">
                    </label>
                    <label class="photo-upload-mini" title="Take a photo" style="cursor:pointer;">
                        📸 Camera
                        <input type="file" id="plant-modal-camera-input" accept="image/*" capture="environment" style="display:none">
                    </label>
                </div>
            </div>
            `}

            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-plant-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="save-plant-btn">Save</button>
            </div>
        </form>
    `;
}


// =============================================
//  ADD / EDIT LOCATION MODAL (from plant detail)
//  Pass instance=null to add a new location;
//  pass an existing instance object to edit it.
// =============================================

function showInstanceModal(plantId, instance, areas, onSave) {
    const isEdit     = !!instance;
    const areaOptions = areas.map(a =>
        `<option value="${a.id}"${isEdit && a.id === instance.areaId ? ' selected' : ''}>${escHtml(a.name)}</option>`
    ).join('');

    const html = `
        <form id="instance-form">
            <div class="form-group">
                <label class="form-label" for="inst-area">Garden area</label>
                <select class="form-input" id="inst-area" name="areaId" required>
                    <option value="">— select an area —</option>
                    ${areaOptions}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="inst-qty">Quantity</label>
                    <input class="form-input" type="number" id="inst-qty" name="quantity"
                           value="${isEdit ? (instance.quantity || 1) : 1}" min="1">
                </div>
                <div class="form-group">
                    <label class="form-label" for="inst-date">
                        Date planted <span class="optional">optional</span>
                    </label>
                    ${datePicker('inst-date', 'datePlanted', isEdit ? (instance.datePlanted || '') : '')}
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" for="inst-notes">
                    Notes <span class="optional">optional</span>
                </label>
                <input class="form-input" id="inst-notes" name="notes"
                       placeholder="e.g. Back fence, south-facing"
                       value="${isEdit ? escHtml(instance.notes || '') : ''}">
            </div>
            <div class="form-actions">
                ${isEdit ? `
                    <button type="button" class="btn btn-danger btn-sm" id="remove-inst-btn"
                            style="margin-right:auto;">Remove location</button>` : ''}
                <button type="button" class="btn btn-secondary" id="cancel-inst-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="save-inst-btn">
                    ${isEdit ? 'Save changes' : 'Add location'}
                </button>
            </div>
        </form>
    `;

    showModal(isEdit ? 'Edit Location' : 'Add Garden Location', html);

    initDatePickers(document.getElementById('modal-body'));

    document.getElementById('cancel-inst-btn')?.addEventListener('click', hideModal);

    // Remove button (edit mode only)
    document.getElementById('remove-inst-btn')?.addEventListener('click', async () => {
        if (!confirm('Remove this location entry?')) return;
        try {
            await deleteInstance(instance.id);
            hideModal();
            showToast('Location removed');
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error removing location', 'error');
            console.error(err);
        }
    });

    document.getElementById('instance-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const areaId = fd.get('areaId');
        if (!areaId) { showToast('Please select an area', 'error'); return; }

        const saveBtn = e.target.querySelector('#save-inst-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        const data = {
            areaId,
            quantity:    parseInt(fd.get('quantity')) || 1,
            datePlanted: fd.get('datePlanted').trim() || '',
            notes:       fd.get('notes').trim(),
        };

        try {
            if (isEdit) {
                await updateInstance(instance.id, data);
                showToast('Location updated!', 'success');
            } else {
                await addInstance({ plantId, ...data });
                showToast('Location added!', 'success');
            }
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error saving location', 'error');
            console.error(err);
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'Save changes' : 'Add location';
        }
    });
}

// =============================================
//  ADD PLANT TO AREA MODAL (called from area detail)
//  Lets the user pick a plant and add it to a pre-set area.
// =============================================

export async function showAddPlantToAreaModal(areaId, areaName, onSave) {
    let plants;
    try {
        plants = await getPlants();
    } catch (e) {
        showToast('Error loading plants', 'error');
        return;
    }

    // Sort plants alphabetically by botanical / common name
    const sorted = [...plants].sort((a, b) => {
        const na = (formatBotanicalName(a).replace(/<[^>]+>/g,'') || a.commonName || '').toLowerCase();
        const nb = (formatBotanicalName(b).replace(/<[^>]+>/g,'') || b.commonName || '').toLowerCase();
        return na.localeCompare(nb);
    });

    const html = `
        <form id="add-plant-to-area-form" autocomplete="off">
            <div class="form-group">
                <label class="form-label">Area</label>
                <div class="form-input" style="background:var(--grey-50);color:var(--grey-500);
                     cursor:default;pointer-events:none;">${escHtml(areaName)}</div>
            </div>
            <div class="form-group">
                <label class="form-label" for="apta-search">Plant</label>
                <div class="plant-picker-wrap">
                    <input class="form-input" id="apta-search" placeholder="Search by name, genus, species…"
                           autocomplete="off" autocapitalize="off">
                    <div class="plant-picker-results" id="apta-results"></div>
                </div>
                <input type="hidden" id="apta-plant-id" name="plantId">
                <div id="apta-selected" class="plant-picker-selected" style="display:none;"></div>
                <div class="form-hint" style="margin-top:8px;">
                    Brand-new plant, not in the list yet?
                    <button type="button" id="apta-new-plant-btn" style="background:none;border:none;padding:0;color:var(--green-700);font-weight:600;cursor:pointer;text-decoration:underline;font:inherit;">📷 Add a new plant from its label</button>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="apta-qty">Quantity</label>
                    <input class="form-input" type="number" id="apta-qty" name="quantity"
                           value="1" min="1">
                </div>
                <div class="form-group">
                    <label class="form-label" for="apta-date">
                        Date planted <span class="optional">optional</span>
                    </label>
                    ${datePicker('apta-date', 'datePlanted')}
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" for="apta-notes">
                    Notes <span class="optional">optional</span>
                </label>
                <input class="form-input" id="apta-notes" name="notes"
                       placeholder="e.g. Back fence, south-facing">
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-apta-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="save-apta-btn">Add plant</button>
            </div>
        </form>
    `;

    showModal('Add Plant to Area', html);
    initDatePickers(document.getElementById('modal-body'));

    // ---- Searchable plant picker ----
    const searchInput  = document.getElementById('apta-search');
    const resultsEl    = document.getElementById('apta-results');
    const hiddenInput  = document.getElementById('apta-plant-id');
    const selectedEl   = document.getElementById('apta-selected');

    function plantLabel(p) {
        const bot    = formatBotanicalName(p).replace(/<[^>]+>/g,'');
        const common = p.commonName;
        let label    = bot || common || 'Unnamed plant';
        if (bot && common) label += ` (${common})`;
        return label;
    }

    function filterPlants(q) {
        if (!q) return sorted.slice(0, 25);
        const words = q.toLowerCase().trim().split(/\s+/);
        return sorted.filter(p => {
            const fields = [p.genus, p.species, p.cultivar, p.commonName, p.subspecies, p.variety]
                .map(f => (f || '').toLowerCase());
            return words.every(w => fields.some(f => f.includes(w)));
        }).slice(0, 40);
    }

    function renderResults(q) {
        const results = filterPlants(q);
        if (!results.length) {
            resultsEl.innerHTML = `<div class="plant-picker-empty">No plants found</div>`;
        } else {
            resultsEl.innerHTML = results.map(p =>
                `<div class="plant-picker-option" data-id="${p.id}">${escHtml(plantLabel(p))}</div>`
            ).join('');
            resultsEl.querySelectorAll('.plant-picker-option').forEach(opt => {
                opt.addEventListener('mousedown', e => e.preventDefault()); // prevent blur
                opt.addEventListener('click', () => {
                    const plant = sorted.find(p => p.id === opt.dataset.id);
                    if (!plant) return;
                    hiddenInput.value = plant.id;
                    searchInput.value = '';
                    resultsEl.style.display = 'none';
                    selectedEl.style.display = 'flex';
                    selectedEl.innerHTML = `
                        <span class="plant-picker-selected-name">🌱 ${escHtml(plantLabel(plant))}</span>
                        <button type="button" class="plant-picker-clear" title="Change plant">✕</button>`;
                    selectedEl.querySelector('.plant-picker-clear').addEventListener('click', () => {
                        hiddenInput.value = '';
                        selectedEl.style.display = 'none';
                        searchInput.value = '';
                        searchInput.focus();
                        renderResults('');
                        resultsEl.style.display = 'block';
                    });
                });
            });
        }
        resultsEl.style.display = 'block';
    }

    // Show initial list
    renderResults('');

    let debounce = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => renderResults(searchInput.value), 200);
    });
    searchInput.addEventListener('focus', () => {
        if (!hiddenInput.value) renderResults(searchInput.value);
    });
    searchInput.addEventListener('blur', () => {
        // Slight delay so click on option registers first
        setTimeout(() => { resultsEl.style.display = 'none'; }, 150);
    });

    document.getElementById('cancel-apta-btn')?.addEventListener('click', hideModal);

    // "Add a new plant from its label" — open the full Add Plant form for this
    // area with the scanner focused, so a brand-new plant can be scanned in.
    document.getElementById('apta-new-plant-btn')?.addEventListener('click', () => {
        hideModal();
        showPlantForm(null, onSave, areaId, { focusScan: true });
    });

    document.getElementById('add-plant-to-area-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const plantId = fd.get('plantId');
        if (!plantId) { showToast('Please select a plant', 'error'); return; }

        const saveBtn = e.target.querySelector('#save-apta-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        try {
            await addInstance({
                plantId,
                areaId,
                quantity:    parseInt(fd.get('quantity')) || 1,
                datePlanted: fd.get('datePlanted').trim() || '',
                notes:       (fd.get('notes') || '').trim(),
            });
            showToast('Plant added to area!', 'success');
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error adding plant', 'error');
            console.error(err);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Add plant';
        }
    });
}

// =============================================
//  Plant tag
// =============================================

/**
 * The plant tag modal: the code a printed label carries, and the two ways of
 * getting it onto something physical.
 *
 * Minting the tag code is a write, so this is editor-only — which the button
 * that opens it already is.
 */
async function showPlantTagModal(plant) {
    showModal('Plant tag', `<div class="qr-tag-modal">
        <div class="loading"><div class="spinner"></div></div>
    </div>`);

    let code;
    try {
        code = await ensureTagCode(plant);
    } catch (err) {
        hideModal();
        showToast('Could not create a tag code for this plant', 'error');
        return;
    }

    const tagUrl  = plantTagUrl(code);
    const svg     = plantQrSvg(code);
    const modules = qrModulesAcross(svg);

    // Only the tape widths that can actually carry this code. Anything under
    // 12 mm cannot hold it at even one dot per module, so it is not offered.
    const tapeOptions = Object.keys(TAPE_MARGIN_PINS)
        .map(Number)
        .filter(w => w >= 12)
        .sort((a, b) => a - b)
        .map(w => ({ w, plan: tapeQrPlan(w, modules) }))
        .filter(o => o.plan && o.plan.ok);

    const defaultTape = (tapeOptions.find(o => o.plan.good) || tapeOptions[tapeOptions.length - 1])?.w;

    const tapeBlock = tapeOptions.length ? `
        <div class="qr-tape-row">
            <label for="qr-tape-width">Label tape</label>
            <select id="qr-tape-width">
                ${tapeOptions.map(o => `<option value="${o.w}" ${o.w === defaultTape ? 'selected' : ''}>${o.w} mm</option>`).join('')}
            </select>
        </div>
        <div class="qr-tape-row">
            <label for="qr-tape-stock">Aluminum tag</label>
            <select id="qr-tape-stock">
                ${Object.values(TAG_STOCK).map(t => `<option value="${t.id}" ${t.id === DEFAULT_TAG_STOCK ? 'selected' : ''}>${escHtml(t.label)}</option>`).join('')}
            </select>
            <button class="btn btn-secondary" id="qr-tape-btn">🏷️ Print tape</button>
        </div>
        <p class="qr-tag-hint" id="qr-tape-note"></p>
    ` : '';

    showModal('Plant tag', `
        <div class="qr-tag-modal">
            <div class="qr-tag-code">${svg}</div>
            <p class="qr-tag-id">${escHtml(code)}</p>
            <p class="qr-tag-url">${escHtml(tagUrl)}</p>
            <p class="qr-tag-hint">
                Scanning this opens this plant's page. On paper, print it at 30&nbsp;mm or bigger,
                matte rather than glossy, and leave the white margin around the code alone.
            </p>
            <button class="btn btn-primary" id="qr-print-btn">🖨️ Print paper tag</button>
            ${tapeBlock}
        </div>
    `);

    document.getElementById('qr-print-btn')?.addEventListener('click', () => {
        hideModal();
        openTagSheet([{ plant, note: '' }], plainName(plant));
    });

    // Live read-out of how the code lands on the chosen tape. The number that
    // matters is dots per module: a QR module has to be a whole number of
    // printer dots, and two is the floor for something that lives outdoors.
    const tapeSel  = document.getElementById('qr-tape-width');
    const stockSel = document.getElementById('qr-tape-stock');
    const tapeNote = document.getElementById('qr-tape-note');
    function describeTape() {
        if (!tapeSel || !tapeNote) return;
        const plan = tapeLabelPlan([{ plant, note: '' }],
                                   Number(tapeSel.value), stockSel?.value, modules);
        if (!plan) return;
        // Length is the number worth showing: it is the tape this label will
        // actually spend, and it moves with the tag as much as with the name.
        tapeNote.textContent =
            `${plan.labelLengthMm} mm label (${(plan.labelLengthMm / 25.4).toFixed(1)}"), `
            + `name on ${plan.nameLines === 1 ? 'one line' : 'two lines'} — `
            + `${plan.sideMm.toFixed(1)} mm code at ${plan.dotsPerModule} printer dots per module`
            + (plan.good ? '.' : ', which is tight. Wider tape scans more reliably.')
            + (plan.fitsTag ? '' : ' This name is too long for the tag and will be clipped.');
    }
    tapeSel?.addEventListener('change', describeTape);
    stockSel?.addEventListener('change', describeTape);
    describeTape();

    document.getElementById('qr-tape-btn')?.addEventListener('click', () => {
        const width = Number(tapeSel.value);
        const stock = stockSel?.value || DEFAULT_TAG_STOCK;
        hideModal();
        openTapeLabels([{ plant, note: '' }], width, stock);
    });
}
