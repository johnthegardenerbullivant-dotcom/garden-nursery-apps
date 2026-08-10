// =============================================================
//  areas-view.js — Areas list & detail views
// =============================================================

import {
    getAreas, getArea, addArea, updateArea, deleteArea,
    getInstancesInArea, getPlants,
    getPhotosForArea, uploadAreaPhoto, deletePhoto, updatePhotoOrders, getFirstPhotoForPlants,
    getTaskAssignments,
    formatBotanicalName, escHtml
} from './db.js';
import { showModal, hideModal, showToast, setLoading, navigate, initPhotoCarousel, initPhotoDragSort } from './ui-utils.js';
import { renderAreaTasksSection } from './tasks-view.js';
import { showAddPlantToAreaModal, showPlantForm } from './plants-view.js';
import { isAtLeast } from './auth.js';

// =============================================
//  AREAS LIST
// =============================================

export async function renderAreasList(container, headerActionEl, backBtn) {
    setLoading(container, true);
    backBtn.classList.remove('visible');
    document.querySelector('.fab')?.remove();

    let areas = [], allAssignments = [];
    try {
        [areas, allAssignments] = await Promise.all([getAreas(), getTaskAssignments()]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading areas.</p></div>`;
        return;
    }

    // Compute active and overdue task counts per area
    const _t = new Date(); const today = `${_t.getFullYear()}-${String(_t.getMonth()+1).padStart(2,'0')}-${String(_t.getDate()).padStart(2,'0')}`;
    const activeTasksByArea = {};
    const overdueTasksByArea = {};
    for (const a of allAssignments) {
        if (a.status === 'todo' || a.status === 'in-progress') {
            activeTasksByArea[a.areaId] = (activeTasksByArea[a.areaId] || 0) + 1;
            if (a.dueDate && a.dueDate < today) {
                overdueTasksByArea[a.areaId] = (overdueTasksByArea[a.areaId] || 0) + 1;
            }
        }
    }

    // FAB — editor+. Areas used to be admin-only on the grounds that they are
    // structural, but an editor who can add a plant could not add the bed to put
    // it in. Deleting an area still requires admin, in both the UI and the rules.
    if (isAtLeast('editor')) {
        const fab = document.createElement('button');
        fab.className = 'fab';
        fab.title = 'Add garden area';
        fab.innerHTML = '+';
        fab.addEventListener('click', async () => { await showAreaForm(null, async () => {
            await renderAreasList(container, headerActionEl, backBtn);
        }); });
        document.body.appendChild(fab);
    }

    headerActionEl.innerHTML = '';

    container.innerHTML = `
        <div class="list-header">
            <span class="list-title">Garden Areas</span>
            <span class="list-count">${areas.length} area${areas.length !== 1 ? 's' : ''}</span>
        </div>
        ${areas.length === 0 ? `
            <div class="empty-state">
                <div class="empty-state-icon">🗺️</div>
                <h3>No areas yet</h3>
                <p>Tap + to define garden areas like "Front border", "Greenhouse", or "Raised bed 1".</p>
            </div>
        ` : `
            <div class="card-grid">
                ${areas.map(a => areaCard(a, activeTasksByArea[a.id] || 0, overdueTasksByArea[a.id] || 0)).join('')}
            </div>
        `}
    `;

    // Card body clicks → area detail (but not the edit button)
    container.querySelectorAll('.area-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.closest('.area-card-edit-btn')) return;
            navigate('area-detail', card.dataset.id);
        });
    });

    // Edit button clicks → open form inline
    container.querySelectorAll('.area-card-edit-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const area = areas.find(a => a.id === btn.dataset.id);
            if (area) (async () => { await showAreaForm(area, async () => {
                await renderAreasList(container, headerActionEl, backBtn);
            }); })();
        });
    });

    setLoading(container, false);
}

function areaCard(area, activeTasks = 0, overdueTasks = 0) {
    const taskBadge = activeTasks > 0
        ? `<span class="area-task-badge${overdueTasks > 0 ? ' overdue' : ''}">
               ${overdueTasks > 0 ? '⚠️ ' : ''}${activeTasks} task${activeTasks !== 1 ? 's' : ''}
           </span>`
        : '';
    return `
        <div class="card area-card" data-id="${area.id}" style="position:relative;">
            <div class="plant-card-banner" style="background:linear-gradient(90deg, var(--green-500), var(--green-300))"></div>
            <div class="card-body">
                <div class="card-title">${escHtml(area.name)}</div>
                ${area.description ? `<div class="card-subtitle">${escHtml(area.description)}</div>` : ''}
                ${taskBadge ? `<div class="card-meta" style="margin-top:6px;">${taskBadge}</div>` : ''}
            </div>
            ${isAtLeast('editor') ? `
            <button class="area-card-edit-btn btn-icon" data-id="${area.id}" title="Edit area"
                style="position:absolute;top:8px;right:8px;background:rgba(255,255,255,0.85);border-radius:50%;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;cursor:pointer;font-size:0.9rem;">✏️</button>
            ` : ''}
        </div>
    `;
}

// =============================================
//  AREA DETAIL
// =============================================

export async function renderAreaDetail(container, headerActionEl, backBtn, areaId, initialTab = null) {
    setLoading(container, true);
    backBtn.classList.add('visible');
    document.querySelector('.fab')?.remove();

    let area, instances, photos;
    try {
        [area, instances, photos] = await Promise.all([
            getArea(areaId),
            getInstancesInArea(areaId),
            getPhotosForArea(areaId)
        ]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading area.</p></div>`;
        return;
    }

    if (!area) {
        container.innerHTML = `<div class="empty-state"><h3>Area not found</h3></div>`;
        return;
    }

    // Build the list of unique plant IDs in this area upfront — needed for both
    // the plant lookup and the photo fetch below.
    const uniquePlantIds = [...new Set(instances.map(i => i.plantId))];

    // Fetch all plants (one collection read) and the first photo for each plant in
    // the area concurrently.  This replaces a previous serial loop that did one
    // getPlant() call per instance — an N+1 pattern that made large areas very slow.
    let allPlants = [], plantFirstPhotos = {};
    try {
        [allPlants, plantFirstPhotos] = await Promise.all([
            getPlants(),
            getFirstPhotoForPlants(uniquePlantIds)
        ]);
    } catch (_) {}
    const plantMap = Object.fromEntries(allPlants.map(p => [p.id, p]));

    // Header buttons — print (all roles) + edit (editor+)
    headerActionEl.innerHTML = isAtLeast('editor')
        ? `<button class="btn-icon" id="print-area-btn" title="Print plant list">🖨️</button>
           <button class="btn-icon" id="edit-area-btn" title="Edit area">✏️</button>`
        : `<button class="btn-icon" id="print-area-btn" title="Print plant list">🖨️</button>`;

    headerActionEl.querySelector('#edit-area-btn')?.addEventListener('click', () => {
        (async () => { await showAreaForm(area, async () => {
            await renderAreaDetail(container, headerActionEl, backBtn, areaId);
        }); })();
    });

    headerActionEl.querySelector('#print-area-btn').addEventListener('click', () => {
        showPrintOptions(area, instances, plantMap);
    });

    // ---- Build plants HTML ----
    const plantsHtml = instances.length === 0
        ? `<p class="text-muted" style="font-size:0.9rem">No plants recorded here yet. Add them from a plant's detail page.</p>`
        : [...instances].sort((a, b) => {
                const pa = plantMap[a.plantId] || {};
                const pb = plantMap[b.plantId] || {};
                const ka = `${pa.genus||''} ${pa.species||''} ${pa.cultivar||''}`.toLowerCase();
                const kb = `${pb.genus||''} ${pb.species||''} ${pb.cultivar||''}`.toLowerCase();
                return ka.localeCompare(kb);
            }).map(inst => {
                const plant     = plantMap[inst.plantId];
                const botName   = plant ? (formatBotanicalName(plant) || escHtml(plant.commonName || 'Unnamed plant')) : 'Unknown plant';
                const commonName = plant?.commonName && formatBotanicalName(plant) ? escHtml(plant.commonName) : '';
                const details   = [
                    inst.quantity > 1 ? `${inst.quantity} plants` : null,
                    inst.datePlanted  ? `Planted ${inst.datePlanted}` : null,
                    inst.notes || null,
                ].filter(Boolean);
                return `
                    <div class="instance-row">
                        <div class="instance-info" style="cursor:pointer" data-plant-id="${inst.plantId}">
                            <div class="instance-area-name">🌱 ${botName}${commonName
                                ? ` <span style="font-size:0.82rem;color:var(--grey-500);font-style:normal;">(${commonName})</span>` : ''}</div>
                            ${details.length ? `<div class="instance-detail">${details.map(d => escHtml(d)).join(' · ')}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');

    // ---- Build plant photo gallery HTML ----
    const uniquePlantCount = uniquePlantIds.length;
    const sortedInstances  = [...instances].sort((a, b) => {
        const pa = plantMap[a.plantId] || {}, pb = plantMap[b.plantId] || {};
        const ka = `${pa.genus||''} ${pa.species||''} ${pa.cultivar||''}`.toLowerCase();
        const kb = `${pb.genus||''} ${pb.species||''} ${pb.cultivar||''}`.toLowerCase();
        return ka.localeCompare(kb);
    });
    const galleryPlantIds = [];
    const seenInGallery   = new Set();
    for (const inst of sortedInstances) {
        if (plantFirstPhotos[inst.plantId] && !seenInGallery.has(inst.plantId)) {
            seenInGallery.add(inst.plantId);
            galleryPlantIds.push(inst.plantId);
        }
    }
    const noPhotoCount = uniquePlantCount - galleryPlantIds.length;

    const galleryHtml = instances.length === 0
        ? `<p class="text-muted" style="font-size:0.9rem">No plants recorded here yet.</p>`
        : galleryPlantIds.length === 0
            ? `<p class="text-muted" style="font-size:0.9rem;padding:8px 0">None of the plants in this area have photos yet.</p>`
            : `
                <div class="plant-photo-grid">
                    ${galleryPlantIds.map(pid => {
                        const plant = plantMap[pid];
                        const photo = plantFirstPhotos[pid];
                        const label = plant
                            ? (formatBotanicalName(plant) || escHtml(plant.commonName || 'Unknown'))
                            : 'Unknown';
                        return `
                            <div class="plant-photo-card" data-plant-id="${pid}">
                                <img src="${photo.url}" alt="${label}" loading="lazy">
                                <div class="plant-photo-caption">${label}</div>
                            </div>`;
                    }).join('')}
                </div>
                ${noPhotoCount > 0 ? `
                    <p style="margin-top:14px;font-size:0.82rem;color:var(--grey-500);">
                        ${noPhotoCount} plant${noPhotoCount !== 1 ? 's' : ''} in this area
                        ${noPhotoCount !== 1 ? 'have' : 'has'} no photos yet.
                    </p>` : ''}`;

    container.innerHTML = `
        <!-- Area detail header -->
        <div class="plant-detail-header">
            <div class="plant-detail-title">${escHtml(area.name)}</div>
            <div class="plant-detail-subtitle">
                ${area.description ? `<span>${escHtml(area.description)}&ensp;&middot;&ensp;</span>` : ''}
                <span>${instances.length} plant record${instances.length !== 1 ? 's' : ''}</span>
            </div>
        </div>

        <!-- Area Photos -->
        <div class="detail-section">
            <div class="detail-section-title">Photos</div>
            ${photos.length > 0 ? `
            <div class="photo-carousel">
                <div class="photo-carousel-track">
                    ${photos.map(photo => `
                        <div class="photo-carousel-slide">
                            <img src="${photo.url}" alt="Area photo" loading="lazy">
                            ${isAtLeast('admin') ? `
                            <button class="photo-delete area-photo-delete" data-id="${photo.id}"
                                    data-path="${escHtml(photo.storagePath)}" title="Delete photo">✕</button>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
                ${photos.length > 1 ? `
                    <button class="photo-carousel-btn prev" title="Previous photo">&#8249;</button>
                    <button class="photo-carousel-btn next" title="Next photo">&#8250;</button>
                    <div class="photo-carousel-counter">1 / ${photos.length}</div>
                ` : ''}
            </div>
            ` : ''}
            ${isAtLeast('editor') ? `
            <div class="photo-upload-strip">
                <label class="photo-upload-mini" title="Choose from gallery">
                    🖼 Gallery
                    <input type="file" id="area-photo-input" accept="image/*" multiple style="display:none">
                </label>
                <label class="photo-upload-mini" title="Take a photo">
                    📸 Camera
                    <input type="file" id="area-camera-input" accept="image/*" capture="environment" style="display:none">
                </label>
            </div>
            <div class="upload-progress" id="area-upload-progress" style="display:none;margin-top:8px;">
                <div class="upload-progress-bar" id="area-upload-progress-bar" style="width:0%"></div>
            </div>
            ` : ''}
        </div>

        <!-- Plants / Tasks / Gallery toggle -->
        <div class="detail-section" id="plants-tasks-section">
            <div class="view-toggle">
                <button class="view-toggle-btn active" id="tab-plants">🌱 Plants</button>
                <button class="view-toggle-btn" id="tab-tasks">📋 Tasks</button>
                <button class="view-toggle-btn" id="tab-gallery">📷 Gallery</button>
            </div>

            <!-- Plants tab content -->
            <div id="area-plants-tab">
                <div style="display:flex;align-items:center;justify-content:space-between;
                            margin-bottom:12px;gap:12px;flex-wrap:wrap;">
                    <div class="detail-section-title" style="margin-bottom:0;">Plants in this area</div>
                    ${isAtLeast('editor') ? `
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button class="btn btn-sm btn-primary" id="new-plant-to-area-btn">+ New plant</button>
                        <button class="btn btn-sm btn-secondary" id="existing-plant-to-area-btn">+ Existing</button>
                    </div>` : ''}
                </div>
                ${plantsHtml}
            </div>

            <!-- Tasks tab content (loaded on demand) -->
            <div id="area-tasks-tab" style="display:none;">
                <div id="area-tasks-section">
                    <div class="empty-state" style="padding:24px 0">
                        <div class="leaf-spinner">🌿</div>
                        <p>Loading tasks&#8230;</p>
                    </div>
                </div>
            </div>

            <!-- Gallery tab content -->
            <div id="area-gallery-tab" style="display:none;">
                ${galleryHtml}
            </div>
        </div>

        <!-- Danger zone — admin only -->
        ${isAtLeast('admin') ? `
        <div class="detail-section" style="border:1.5px solid var(--grey-200);">
            <div class="detail-section-title" style="color:var(--red)">Danger Zone</div>
            <button class="btn btn-danger btn-sm" id="delete-area-btn">Delete this area</button>
            <p class="form-hint" style="margin-top:6px">
                Deleting an area removes all plant location records and task assignments for it,
                but not the plants or tasks themselves.
            </p>
        </div>
        ` : ''}
    `;

    // Navigate to plant on click
    container.querySelectorAll('[data-plant-id]').forEach(el => {
        el.addEventListener('click', () => navigate('plant-detail', el.dataset.plantId));
    });

    // ---- Plants / Tasks / Gallery toggle ----
    let tasksLoaded  = false;
    const plantsTab   = container.querySelector('#tab-plants');
    const tasksTab    = container.querySelector('#tab-tasks');
    const galleryTab  = container.querySelector('#tab-gallery');
    const plantsPane  = container.querySelector('#area-plants-tab');
    const tasksPane   = container.querySelector('#area-tasks-tab');
    const galleryPane = container.querySelector('#area-gallery-tab');

    function showTab(active, pane) {
        [plantsTab, tasksTab, galleryTab].forEach(t => t?.classList.remove('active'));
        active?.classList.add('active');
        [plantsPane, tasksPane, galleryPane].forEach(p => { if (p) p.style.display = 'none'; });
        if (pane) pane.style.display = 'block';
    }

    plantsTab?.addEventListener('click', () => showTab(plantsTab, plantsPane));

    galleryTab?.addEventListener('click', () => showTab(galleryTab, galleryPane));

    // ---- New plant — opens full plant form with this area pre-selected ----
    container.querySelector('#new-plant-to-area-btn')?.addEventListener('click', async () => {
        await showPlantForm(null, async () => {
            await renderAreaDetail(container, headerActionEl, backBtn, areaId);
        }, areaId);
    });

    // ---- Existing plant — pick from the plant catalogue ----
    container.querySelector('#existing-plant-to-area-btn')?.addEventListener('click', async () => {
        await showAddPlantToAreaModal(areaId, area.name, async () => {
            await renderAreaDetail(container, headerActionEl, backBtn, areaId);
        });
    });

    tasksTab?.addEventListener('click', async () => {
        showTab(tasksTab, tasksPane);
        if (!tasksLoaded) {
            tasksLoaded = true;
            // Build a full plant map from all loaded plants
            const allPlants = await getPlants().catch(() => []);
            const fullPlantMap = Object.fromEntries(allPlants.map(p => [p.id, p]));
            await renderAreaTasksSection(container, areaId, instances, fullPlantMap);
        }
    });

    // Area photo upload (multiple files)
    container.querySelector('#area-photo-input')?.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const progressEl  = container.querySelector('#area-upload-progress');
        const progressBar = container.querySelector('#area-upload-progress-bar');
        if (progressEl) progressEl.style.display = 'block';
        try {
            for (let i = 0; i < files.length; i++) {
                await uploadAreaPhoto(areaId, files[i], pct => {
                    const overall = ((i / files.length) + (pct / 100 / files.length)) * 100;
                    if (progressBar) progressBar.style.width = overall + '%';
                });
            }
            showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
            await renderAreaDetail(container, headerActionEl, backBtn, areaId);
        } catch (err) {
            showToast('Photo upload failed', 'error');
            console.error(err);
        }
    });
    container.querySelector('#area-camera-input')?.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (!files.length) return;
        const progressEl  = container.querySelector('#area-upload-progress');
        const progressBar = container.querySelector('#area-upload-progress-bar');
        if (progressEl) progressEl.style.display = 'block';
        try {
            for (let i = 0; i < files.length; i++) {
                await uploadAreaPhoto(areaId, files[i], pct => {
                    const overall = ((i / files.length) + (pct / 100 / files.length)) * 100;
                    if (progressBar) progressBar.style.width = overall + '%';
                });
            }
            showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
            await renderAreaDetail(container, headerActionEl, backBtn, areaId);
        } catch (err) {
            showToast('Photo upload failed', 'error');
            console.error(err);
        } finally {
            if (progressEl) progressEl.style.display = 'none';
        }
    });

    // Area photo lightbox (tap slide image to enlarge)
    container.querySelectorAll('.photo-carousel-slide img').forEach(img => {
        img.addEventListener('click', () => openAreaLightbox(img.src));
    });

    // Initialise carousel navigation
    initPhotoCarousel(container);

    // Delete area photo
    container.querySelectorAll('.area-photo-delete').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!confirm('Delete this photo?')) return;
            await deletePhoto(btn.dataset.id, btn.dataset.path);
            showToast('Photo deleted');
            await renderAreaDetail(container, headerActionEl, backBtn, areaId);
        });
    });

    // Delete area (admin only — button is not rendered for other roles)
    container.querySelector('#delete-area-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${area.name}"? Plant location records in this area will also be removed.`)) return;
        try {
            await deleteArea(areaId);
            showToast('Area deleted', 'success');
            navigate('areas');
        } catch (e) {
            showToast('Error deleting area', 'error');
        }
    });

    // Restore the tab that was active when the user navigated away (Back navigation).
    // Tasks tab is lazy-loaded, so we eagerly fetch it here if needed.
    if (initialTab === 'tab-tasks') {
        showTab(tasksTab, tasksPane);
        if (!tasksLoaded) {
            tasksLoaded = true;
            const allPlants = await getPlants().catch(() => []);
            const fullPlantMap = Object.fromEntries(allPlants.map(p => [p.id, p]));
            await renderAreaTasksSection(container, areaId, instances, fullPlantMap);
        }
    } else if (initialTab === 'tab-gallery') {
        showTab(galleryTab, galleryPane);
    }
    // 'tab-plants' (default) needs no special action — it's already active in the HTML

    setLoading(container, false);
}

// =============================================
//  AREA FORM (add / edit)
// =============================================

export async function showAreaForm(area, onSave) {
    const isEdit = !!area;

    // Fetch existing photos upfront when editing
    let photos = [];
    if (isEdit) {
        try { photos = await getPhotosForArea(area.id); } catch (_) {}
    }

    function photoGridHTML(photosArr) {
        return `
            <div id="area-form-photo-grid">
                ${photosArr.length > 0 ? `
                <div class="photo-grid" style="margin-bottom:8px;">
                    ${photosArr.map(ph => `
                        <div class="photo-thumb" data-id="${ph.id}">
                            <img src="${ph.url}" alt="Area photo" loading="lazy">
                            <button type="button" class="photo-delete area-modal-delete"
                                data-id="${ph.id}" data-path="${escHtml(ph.storagePath)}"
                                title="Delete photo">✕</button>
                        </div>
                    `).join('')}
                </div>` : ''}
                <div class="photo-upload-strip">
                    <label class="photo-upload-mini" title="Choose from gallery" style="cursor:pointer;">
                        🖼 Gallery
                        <input type="file" id="area-modal-photo-input" accept="image/*" multiple style="display:none">
                    </label>
                    <label class="photo-upload-mini" title="Take a photo" style="cursor:pointer;">
                        📸 Camera
                        <input type="file" id="area-modal-camera-input" accept="image/*" capture="environment" style="display:none">
                    </label>
                </div>
                <div class="upload-progress" id="area-modal-progress" style="display:none;margin-top:8px;">
                    <div class="upload-progress-bar" id="area-modal-progress-bar" style="width:0%"></div>
                </div>
            </div>
        `;
    }

    const html = `
        <form id="area-form">
            <div class="form-group">
                <label class="form-label" for="area-name">Area name</label>
                <input class="form-input" id="area-name" name="name" required
                    value="${escHtml(area?.name || '')}"
                    placeholder="e.g. Front border, Greenhouse, Raised bed 1"
                    autocapitalize="words">
            </div>
            <div class="form-group">
                <label class="form-label" for="area-desc">Description <span class="optional">optional</span></label>
                <textarea class="form-textarea" id="area-desc" name="description"
                    placeholder="Location, size, soil type, aspect…">${escHtml(area?.description || '')}</textarea>
            </div>
            ${isEdit ? `
            <div class="form-section-label">Photos</div>
            ${photoGridHTML(photos)}
            ` : ''}
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-area-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="save-area-btn">Save area</button>
            </div>
        </form>
    `;

    showModal(isEdit ? 'Edit Area' : 'Add Garden Area', html);

    // ---- Refresh photo grid in-place (without closing the modal) ----
    async function refreshPhotoGrid() {
        try { photos = await getPhotosForArea(area.id); } catch (_) {}
        const grid = document.getElementById('area-form-photo-grid');
        if (!grid) return;
        grid.outerHTML = photoGridHTML(photos);
        bindPhotoHandlers();
    }

    // ---- Bind photo upload + delete handlers ----
    function bindPhotoHandlers() {
        const photoGrid = document.querySelector('#area-form-photo-grid .photo-grid');
        if (photoGrid) {
            initPhotoDragSort(photoGrid, async orderedIds => {
                try { await updatePhotoOrders(orderedIds); }
                catch (err) { showToast('Could not save photo order', 'error'); console.error(err); }
            });
        }

        document.getElementById('area-modal-photo-input')?.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            const progressEl  = document.getElementById('area-modal-progress');
            const progressBar = document.getElementById('area-modal-progress-bar');
            if (progressEl) progressEl.style.display = 'block';
            try {
                for (let i = 0; i < files.length; i++) {
                    await uploadAreaPhoto(area.id, files[i], pct => {
                        const overall = ((i / files.length) + (pct / 100 / files.length)) * 100;
                        if (progressBar) progressBar.style.width = overall + '%';
                    });
                }
                showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
                await refreshPhotoGrid();
            } catch (err) {
                showToast('Photo upload failed', 'error');
                console.error(err);
            } finally {
                if (progressEl) progressEl.style.display = 'none';
            }
        });
        document.getElementById('area-modal-camera-input')?.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files);
            if (!files.length) return;
            const progressEl  = document.getElementById('area-modal-progress');
            const progressBar = document.getElementById('area-modal-progress-bar');
            if (progressEl) progressEl.style.display = 'block';
            try {
                for (let i = 0; i < files.length; i++) {
                    await uploadAreaPhoto(area.id, files[i], pct => {
                        const overall = ((i / files.length) + (pct / 100 / files.length)) * 100;
                        if (progressBar) progressBar.style.width = overall + '%';
                    });
                }
                showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
                await refreshPhotoGrid();
            } catch (err) {
                showToast('Photo upload failed', 'error');
                console.error(err);
            } finally {
                if (progressEl) progressEl.style.display = 'none';
            }
        });

        document.querySelectorAll('.area-modal-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Delete this photo?')) return;
                try {
                    await deletePhoto(btn.dataset.id, btn.dataset.path);
                    showToast('Photo deleted');
                    await refreshPhotoGrid();
                } catch (err) {
                    showToast('Error deleting photo', 'error');
                }
            });
        });
    }

    if (isEdit) bindPhotoHandlers();

    // ---- Save name + description ----
    document.getElementById('area-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const data = {
            name:        fd.get('name').trim(),
            description: fd.get('description').trim(),
        };
        const saveBtn = e.target.querySelector('#save-area-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        try {
            if (isEdit) {
                await updateArea(area.id, data);
                showToast('Area updated!', 'success');
            } else {
                await addArea(data);
                showToast('Area added!', 'success');
            }
            hideModal();
            if (onSave) await onSave(data);
        } catch (err) {
            showToast('Error saving area', 'error');
            console.error(err);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save area';
        }
    });

    document.getElementById('cancel-area-btn')?.addEventListener('click', hideModal);
}
// =============================================
//  LIGHTBOX
// =============================================

function openAreaLightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `
        <button class="lightbox-close">✕</button>
        <img src="${src}" alt="Area photo">
    `;
    lb.querySelector('.lightbox-close').addEventListener('click', () => lb.remove());
    lb.addEventListener('click', (e) => { if (e.target === lb) lb.remove(); });
    document.body.appendChild(lb);
}

// =============================================
//  PRINT PLANT LIST
// =============================================

function showPrintOptions(area, instances, plantMap) {
    const total = instances.length;
    const html = `
        <p style="margin-bottom:16px;color:var(--grey-600);">
            ${total} plant record${total !== 1 ? 's' : ''} in <strong>${area.name}</strong>.<br>
            Choose a format:
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
            <button class="btn btn-primary" id="print-summary-btn" style="text-align:left;padding:12px 16px;">
                <div style="font-weight:700;">Summary</div>
                <div style="font-size:0.82rem;font-weight:400;opacity:0.9;margin-top:2px;">Botanical name &middot; Quantity &middot; Date planted</div>
            </button>
            <button class="btn btn-secondary" id="print-detailed-btn" style="text-align:left;padding:12px 16px;">
                <div style="font-weight:700;">Detailed</div>
                <div style="font-size:0.82rem;font-weight:400;opacity:0.75;margin-top:2px;">Summary + Height &middot; Width &middot; Notes</div>
            </button>
        </div>
    `;
    showModal('Print Plant List', html);

    document.getElementById('print-summary-btn').addEventListener('click', () => {
        hideModal();
        openPrintWindow(area, instances, plantMap, 'summary');
    });
    document.getElementById('print-detailed-btn').addEventListener('click', () => {
        hideModal();
        openPrintWindow(area, instances, plantMap, 'detailed');
    });
}

function openPrintWindow(area, instances, plantMap, mode) {
    const date = new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    // Sort alphabetically by genus then species
    const sorted = [...instances].sort((a, b) => {
        const pa = plantMap[a.plantId] || {};
        const pb = plantMap[b.plantId] || {};
        const na = (pa.genus || pa.commonName || '').toLowerCase();
        const nb = (pb.genus || pb.commonName || '').toLowerCase();
        return na.localeCompare(nb);
    });

    const rows = sorted.map((inst, idx) => {
        const p = plantMap[inst.plantId];
        if (!p) return '';

        // Build italic botanical name (use HTML <em> tags)
        // Intergeneric hybrids: ×Genus; interspecific: Genus × species.
        const pHt = p.hybridType || (p.hybrid ? 'interspecific' : null);
        const nameParts = [];
        if (p.genus)      nameParts.push(pHt === 'intergeneric' ? '×' + p.genus : p.genus);
        if (pHt === 'interspecific' && p.species) nameParts.push('×');
        if (p.species)    nameParts.push(p.species);
        if (p.subspecies) nameParts.push(`subsp. ${p.subspecies}`);
        if (p.variety)    nameParts.push(`var. ${p.variety}`);
        const botanicalItalic = nameParts.length
            ? `<em>${nameParts.join(' ')}</em>`
            : '';
        const cultivar  = p.cultivar ? ` '${p.cultivar}'` : '';
        const authority = p.authority ? ` <span style="font-size:0.8em;">${p.authority}</span>` : '';
        const plantCell = `${botanicalItalic}${cultivar}${authority}`
            + (p.commonName ? `<br><span class="common">${p.commonName}</span>` : '');

        const qty         = inst.quantity || 1;
        const datePlanted = inst.datePlanted || '—';
        const rowClass    = idx % 2 === 1 ? ' class="alt"' : '';

        if (mode === 'summary') {
            return `<tr${rowClass}><td>${plantCell}</td><td class="c">${qty}</td><td>${datePlanted}</td></tr>`;
        } else {
            const height = p.height || '—';
            const width  = p.width  || '—';
            const notes  = p.notes  || '—';
            return `<tr${rowClass}><td>${plantCell}</td><td class="c">${qty}</td><td>${datePlanted}</td><td class="c">${height}</td><td class="c">${width}</td><td class="notes">${notes}</td></tr>`;
        }
    }).join('');

    const headers = mode === 'summary'
        ? `<tr><th>Plant</th><th>Qty</th><th>Date Planted</th></tr>`
        : `<tr><th>Plant</th><th>Qty</th><th>Date Planted</th><th>Height</th><th>Width</th><th>Notes / Description</th></tr>`;

    const colgroup = mode === 'summary'
        ? `<colgroup><col style="width:60%"><col style="width:10%"><col style="width:30%"></colgroup>`
        : `<colgroup><col style="width:28%"><col style="width:5%"><col style="width:12%"><col style="width:8%"><col style="width:8%"><col></colgroup>`;

    const emptyRow = mode === 'summary'
        ? `<tr><td colspan="3" style="text-align:center;color:#999;padding:20px;">No plants recorded in this area.</td></tr>`
        : `<tr><td colspan="6" style="text-align:center;color:#999;padding:20px;">No plants recorded in this area.</td></tr>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Plant List — ${area.name}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #1a1a1a; padding: 24px 32px; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 16pt; color: #2d6a4f; margin-bottom: 2px; }
  .meta { font-size: 9pt; color: #666; margin-bottom: 6px; }
  .desc { font-size: 10pt; color: #444; margin-bottom: 16px; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #2d6a4f; color: #fff; padding: 7px 9px; text-align: left; font-size: 9.5pt; }
  td { padding: 6px 9px; border-bottom: 1px solid #e0e0e0; font-size: 10pt; vertical-align: top; }
  tr.alt td { background: #f5faf7; }
  em { font-style: italic; }
  .common { font-size: 8.5pt; color: #555; }
  .c { text-align: center; }
  .notes { font-size: 9pt; color: #444; }
  .print-btn { display: inline-block; margin-bottom: 18px; padding: 8px 20px; background: #2d6a4f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 10pt; }
  @media print {
    .print-btn { display: none; }
    body { padding: 0; }
    h1 { color: #000; }
    th { background: #444; }
  }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">&#128438; Print / Save as PDF</button>
  <h1>${area.name}</h1>
  <div class="meta">${mode === 'summary' ? 'Summary' : 'Detailed'} listing &nbsp;&middot;&nbsp; ${instances.length} record${instances.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; Printed ${date}</div>
  ${area.description ? `<div class="desc">${area.description}</div>` : ''}
  <table>
    ${colgroup}
    <thead>${headers}</thead>
    <tbody>${rows || emptyRow}</tbody>
  </table>
</body>
</html>`;

    // Use a Blob URL so document.write() restrictions don't apply
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (!win) {
        showToast('Pop-up blocked — please allow pop-ups for this site', 'error');
        URL.revokeObjectURL(url);
    }
    // Browser keeps the blob URL alive until the tab loads; it will be GC'd after
}
