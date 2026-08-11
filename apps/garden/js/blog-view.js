// =============================================================
//  blog-view.js — Garden Journal (Blog) — list, post, editor
// =============================================================

import {
    getBlogPosts, getBlogPost, saveBlogPost, deleteBlogPost, uploadBlogPhoto,
    getPlants, getAreas, formatBotanicalName, escHtml, todayStr, fmtDateLong
} from './db.js';
import { showModal, hideModal, showToast, navigate, goBack, navigateReplace, setLoading, datePicker, initDatePickers } from './ui-utils.js';
import { isAtLeast, getCurrentUser } from './auth.js';

// =============================================
//  HELPERS
// =============================================

// todayStr comes from db.js, and formatDisplayDate is now db.js's fmtDateLong —
// same output ("14 September 2026"), one definition instead of a per-module copy.

function stripHtml(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || '';
}

function extractFirstImage(html) {
    if (!html) return null;
    const m = html.match(/<img[^>]+src="([^"]+)"/);
    return m ? m[1] : null;
}

function extractPlantRefs(delta) {
    const refs = [];
    const seen = new Set();
    for (const op of (delta.ops || [])) {
        if (op.insert && typeof op.insert === 'object' && op.insert.plantChip) {
            const { plantId, name } = op.insert.plantChip;
            if (plantId && !seen.has(plantId)) {
                seen.add(plantId);
                refs.push({ plantId, name: name || '' });
            }
        }
    }
    return refs;
}

function extractAreaRefs(delta) {
    const refs = [];
    const seen = new Set();
    for (const op of (delta.ops || [])) {
        if (op.insert && typeof op.insert === 'object' && op.insert.areaChip) {
            const { areaId, name } = op.insert.areaChip;
            if (areaId && !seen.has(areaId)) {
                seen.add(areaId);
                refs.push({ areaId, name: name || '' });
            }
        }
    }
    return refs;
}

/** Register the Quill blots for plant and area chips (idempotent) */
function ensureQuillBlots() {
    if (!window.Quill || window._blogBlotsRegistered) return;
    const Embed = window.Quill.import('blots/embed');

    class PlantChipBlot extends Embed {
        static create(value) {
            const node = super.create();
            node.setAttribute('data-plant-id', value.plantId);
            node.setAttribute('data-plant-name', value.name || '');
            node.setAttribute('contenteditable', 'false');
            node.textContent = '🌱 ' + (value.name || 'Plant');
            return node;
        }
        static value(node) {
            return {
                plantId: node.getAttribute('data-plant-id') || '',
                name:    node.getAttribute('data-plant-name') || '',
            };
        }
    }
    PlantChipBlot.blotName  = 'plantChip';
    PlantChipBlot.tagName   = 'span';
    PlantChipBlot.className = 'blog-plant-chip';

    class AreaChipBlot extends Embed {
        static create(value) {
            const node = super.create();
            node.setAttribute('data-area-id', value.areaId);
            node.setAttribute('data-area-name', value.name || '');
            node.setAttribute('contenteditable', 'false');
            node.textContent = '🗺️ ' + (value.name || 'Area');
            return node;
        }
        static value(node) {
            return {
                areaId: node.getAttribute('data-area-id') || '',
                name:   node.getAttribute('data-area-name') || '',
            };
        }
    }
    AreaChipBlot.blotName  = 'areaChip';
    AreaChipBlot.tagName   = 'span';
    AreaChipBlot.className = 'blog-area-chip';

    window.Quill.register(PlantChipBlot);
    window.Quill.register(AreaChipBlot);
    window._blogBlotsRegistered = true;
}

// =============================================
//  BLOG LIST VIEW
// =============================================

export async function renderBlogList(container, headerActionEl, backBtn) {
    setLoading(container, true);
    backBtn.classList.remove('visible');
    document.querySelector('.fab')?.remove();
    headerActionEl.innerHTML = '';

    const isAdmin = isAtLeast('admin');
    let posts = [];
    try {
        posts = await getBlogPosts(!isAdmin); // admins see drafts too
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading journal. Check your connection.</p></div>`;
        return;
    }

    // Collect all unique tags
    const allTags = [...new Set(posts.flatMap(p => p.tags || []))].sort();

    // FAB for admins
    if (isAdmin) {
        const fab = document.createElement('button');
        fab.className = 'fab';
        fab.title = 'New journal entry';
        fab.innerHTML = '+';
        fab.addEventListener('click', () => navigate('blog-compose', null));
        document.body.appendChild(fab);
    }

    let activeTag   = '';
    let searchQuery = '';

    container.innerHTML = `
        <div class="blog-list-controls">
            <div class="search-bar">
                <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <input class="search-input" id="blog-search" placeholder="Search entries…" autocomplete="off">
                <button class="search-clear" id="blog-search-clear" title="Clear" style="display:none">✕</button>
            </div>
            ${allTags.length ? `
            <div class="blog-tag-filters" id="blog-tag-filters">
                ${allTags.map(t =>
                    `<button class="blog-tag-filter-btn" data-tag="${escHtml(t)}">${escHtml(t)}</button>`
                ).join('')}
            </div>` : ''}
        </div>
        <div id="blog-post-list"></div>
    `;

    function getFiltered() {
        return posts.filter(p => {
            if (activeTag && !(p.tags || []).includes(activeTag)) return false;
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return (p.title || '').toLowerCase().includes(q)
                || (p.tags || []).some(t => t.toLowerCase().includes(q))
                || stripHtml(p.contentHtml).toLowerCase().includes(q)
                || (p.plantRefs || []).some(r => (r.name || '').toLowerCase().includes(q));
        });
    }

    function renderList() {
        const filtered  = getFiltered();
        const listEl    = container.querySelector('#blog-post-list');
        if (!listEl) return;

        if (filtered.length === 0) {
            listEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📝</div>
                    <h3>${posts.length === 0 ? 'No entries yet' : 'No entries match'}</h3>
                    <p>${posts.length === 0
                        ? (isAdmin ? 'Tap + to write your first journal entry.' : 'Check back soon.')
                        : 'Try a different search or tag.'}</p>
                </div>`;
            return;
        }

        listEl.innerHTML = `
            <div class="blog-post-cards">
                ${filtered.map(p => blogPostCard(p)).join('')}
            </div>`;

        listEl.querySelectorAll('.blog-post-card').forEach(card => {
            card.addEventListener('click', () => navigate('blog-post', card.dataset.id));
        });
    }

    // Search
    const searchEl  = container.querySelector('#blog-search');
    const clearBtn  = container.querySelector('#blog-search-clear');
    let debounce    = null;

    searchEl?.addEventListener('input', () => {
        searchQuery = searchEl.value;
        clearBtn.style.display = searchQuery ? 'flex' : 'none';
        clearTimeout(debounce);
        debounce = setTimeout(renderList, 250);
    });
    clearBtn?.addEventListener('click', () => {
        searchEl.value = '';
        searchQuery    = '';
        clearBtn.style.display = 'none';
        renderList();
    });

    // Tag filters
    container.querySelectorAll('.blog-tag-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tag = btn.dataset.tag;
            if (activeTag === tag) {
                activeTag = '';
                btn.classList.remove('active');
            } else {
                activeTag = tag;
                container.querySelectorAll('.blog-tag-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            }
            renderList();
        });
    });

    renderList();
    setLoading(container, false);
}

function blogPostCard(post) {
    const thumb    = extractFirstImage(post.contentHtml);
    const excerpt  = stripHtml(post.contentHtml).trim().slice(0, 160);
    const tags     = (post.tags || []).slice(0, 5);
    const isDraft  = !post.published;

    return `
        <div class="blog-post-card" data-id="${post.id}">
            ${thumb ? `
            <div class="blog-post-card-thumb">
                <img src="${escHtml(thumb)}" alt="" loading="lazy">
            </div>` : ''}
            <div class="blog-post-card-body">
                <div class="blog-post-card-meta">
                    <span class="blog-post-date">${fmtDateLong(post.postDate)}</span>
                    ${isDraft ? `<span class="blog-draft-badge">Draft</span>` : ''}
                </div>
                <div class="blog-post-card-title">${escHtml(post.title || 'Untitled')}</div>
                ${excerpt ? `<div class="blog-post-card-excerpt">${escHtml(excerpt)}</div>` : ''}
                ${tags.length ? `
                <div class="blog-post-card-tags">
                    ${tags.map(t => `<span class="blog-tag">${escHtml(t)}</span>`).join('')}
                </div>` : ''}
            </div>
        </div>
    `;
}

// =============================================
//  BLOG POST (READER) VIEW
// =============================================

export async function renderBlogPost(container, headerActionEl, backBtn, postId) {
    setLoading(container, true);
    backBtn.classList.add('visible');
    document.querySelector('.fab')?.remove();

    let post;
    try {
        post = await getBlogPost(postId);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading entry.</p></div>`;
        return;
    }

    if (!post || (!post.published && !isAtLeast('admin'))) {
        container.innerHTML = `<div class="empty-state"><h3>Entry not found</h3></div>`;
        return;
    }

    const isAdmin = isAtLeast('admin');

    headerActionEl.innerHTML = isAdmin ? `
        <button class="btn-icon" id="edit-post-btn" title="Edit entry">✏️</button>` : '';

    headerActionEl.querySelector('#edit-post-btn')?.addEventListener('click', () => {
        navigate('blog-edit', postId);
    });

    // Post-process contentHtml: ensure images are lazy-loaded (they may not have been)
    const safeHtml = (post.contentHtml || '')
        .replace(/<img(?![^>]*loading)/g, '<img loading="lazy"');

    container.innerHTML = `
        <div class="blog-post-view">
            <div class="blog-post-header">
                <h1 class="blog-post-title">${escHtml(post.title || 'Untitled')}</h1>
                <div class="blog-post-meta-row">
                    <span class="blog-post-date-large">${fmtDateLong(post.postDate)}</span>
                    ${!post.published ? `<span class="blog-draft-badge" style="margin-left:8px;">Draft</span>` : ''}
                </div>
                ${(post.tags || []).length ? `
                <div class="blog-post-tags-row">
                    ${post.tags.map(t => `<span class="blog-tag">${escHtml(t)}</span>`).join('')}
                </div>` : ''}
                ${(post.plantRefs || []).length ? `
                <div class="blog-post-plants-row">
                    <span style="font-size:0.82rem;color:var(--grey-500);">Plants mentioned: </span>
                    ${post.plantRefs.map(r =>
                        `<button class="blog-plant-ref-btn" data-plant-id="${r.plantId}">🌱 ${escHtml(r.name)}</button>`
                    ).join('')}
                </div>` : ''}
                ${(post.areaRefs || []).length ? `
                <div class="blog-post-areas-row">
                    <span style="font-size:0.82rem;color:var(--grey-500);">Areas mentioned: </span>
                    ${post.areaRefs.map(r =>
                        `<button class="blog-area-ref-btn" data-area-id="${r.areaId}">🗺️ ${escHtml(r.name)}</button>`
                    ).join('')}
                </div>` : ''}
            </div>

            <div class="blog-post-content ql-editor ql-snow">${safeHtml}</div>

            ${isAdmin ? `
            <div class="detail-section" style="border:1.5px solid var(--grey-200);margin-top:24px;">
                <div class="detail-section-title danger">Danger Zone</div>
                <button class="btn btn-danger btn-sm" id="delete-post-btn">Delete this entry</button>
            </div>` : ''}
        </div>
    `;

    // Plant chip clicks (inline in body)
    container.querySelectorAll('.blog-plant-chip').forEach(chip => {
        chip.style.cursor = 'pointer';
        chip.addEventListener('click', () => navigate('plant-detail', chip.dataset.plantId));
    });

    // Plant ref buttons (header row)
    container.querySelectorAll('.blog-plant-ref-btn').forEach(btn => {
        btn.addEventListener('click', () => navigate('plant-detail', btn.dataset.plantId));
    });

    // Area chip clicks (inline in body)
    container.querySelectorAll('.blog-area-chip').forEach(chip => {
        chip.style.cursor = 'pointer';
        chip.addEventListener('click', () => navigate('area-detail', chip.dataset.areaId));
    });

    // Area ref buttons (header row)
    container.querySelectorAll('.blog-area-ref-btn').forEach(btn => {
        btn.addEventListener('click', () => navigate('area-detail', btn.dataset.areaId));
    });

    // Delete
    container.querySelector('#delete-post-btn')?.addEventListener('click', async () => {
        if (!confirm('Delete this journal entry? This cannot be undone.')) return;
        try {
            await deleteBlogPost(postId);
            showToast('Entry deleted', 'success');
            navigate('blog', null);
        } catch (e) {
            showToast('Error deleting entry', 'error');
        }
    });

    setLoading(container, false);
}

// =============================================
//  BLOG EDITOR (admin only, full-page view)
// =============================================

export async function renderBlogEditor(container, headerActionEl, backBtn, postId) {
    if (!isAtLeast('admin')) {
        container.innerHTML = `<div class="empty-state"><p>Admin access required.</p></div>`;
        return;
    }

    setLoading(container, true);
    backBtn.classList.add('visible');
    document.querySelector('.fab')?.remove();
    headerActionEl.innerHTML = '';

    // Load existing post (if editing), plant list and area list (for pickers)
    let post    = null;
    let plants  = [];
    let areas   = [];
    try {
        [post, plants, areas] = await Promise.all([
            postId ? getBlogPost(postId) : Promise.resolve(null),
            getPlants(),
            getAreas(),
        ]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading editor.</p></div>`;
        return;
    }

    // Generate a draft ID for new posts (used for photo storage paths)
    const draftId = postId || (Date.now().toString(36) + Math.random().toString(36).slice(2));

    // Sorted plants for picker
    const sortedPlants = [...plants].sort((a, b) => {
        const na = (formatBotanicalName(a).replace(/<[^>]+>/g, '') || a.commonName || '').toLowerCase();
        const nb = (formatBotanicalName(b).replace(/<[^>]+>/g, '') || b.commonName || '').toLowerCase();
        return na.localeCompare(nb);
    });

    // Sorted areas for picker
    const sortedAreas = [...areas].sort((a, b) =>
        (a.name || '').localeCompare(b.name || '')
    );

    function plantDisplayName(p) {
        const bot    = formatBotanicalName(p).replace(/<[^>]+>/g, '');
        const common = p.commonName;
        let label    = bot || common || 'Unnamed plant';
        if (bot && common) label += ` (${common})`;
        return label;
    }

    // Current tags (mutable array)
    let currentTags = [...(post?.tags || [])];

    container.innerHTML = `
        <div class="blog-editor-wrap">
            <div class="blog-editor-fields">
                <div class="form-group">
                    <label class="form-label" for="blog-title">Title</label>
                    <input class="form-input" id="blog-title" placeholder="Entry title…"
                           value="${escHtml(post?.title || '')}" autocapitalize="sentences">
                </div>

                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="blog-date">Date</label>
                        ${datePicker('blog-date', 'blog-date-val', post?.postDate || todayStr())}
                    </div>
                    <div class="form-group" style="flex:2;">
                        <label class="form-label">Tags</label>
                        <div class="blog-tag-input-wrap" id="blog-tag-input-wrap">
                            ${currentTags.map(t => tagChipHTML(t)).join('')}
                            <input class="blog-tag-input" id="blog-tag-input"
                                   placeholder="${currentTags.length ? '' : 'Add tag…'}"
                                   autocomplete="off" autocapitalize="off">
                        </div>
                    </div>
                </div>
            </div>

            <!-- Quill toolbar + editor -->
            <div class="blog-editor-toolbar-extra">
                <button type="button" class="btn btn-secondary btn-sm" id="blog-plant-ref-btn">
                    🌱 Add plant reference
                </button>
                <button type="button" class="btn btn-secondary btn-sm" id="blog-area-ref-btn">
                    🗺️ Add area reference
                </button>
            </div>
            <div id="blog-quill-editor" class="blog-quill-container"></div>

            <!-- Actions -->
            <div class="blog-editor-actions">
                <button type="button" class="btn btn-secondary" id="blog-save-draft-btn">Save draft</button>
                <button type="button" class="btn btn-primary"   id="blog-publish-btn">
                    ${post?.published ? 'Save changes' : 'Publish'}
                </button>
            </div>
        </div>
    `;

    initDatePickers(container);

    // ---- Tag input logic ----
    const tagWrap  = container.querySelector('#blog-tag-input-wrap');
    const tagInput = container.querySelector('#blog-tag-input');

    function tagChipHTML(tag) {
        return `<span class="blog-tag-chip" data-tag="${escHtml(tag)}">${escHtml(tag)}<button type="button" class="blog-tag-chip-remove" title="Remove tag">✕</button></span>`;
    }

    function syncTagChips() {
        // Remove existing chips (keep the input)
        tagWrap.querySelectorAll('.blog-tag-chip').forEach(c => c.remove());
        // Prepend all chips before the input
        currentTags.forEach(t => {
            const chip = document.createElement('span');
            chip.className = 'blog-tag-chip';
            chip.dataset.tag = t;
            chip.innerHTML = `${escHtml(t)}<button type="button" class="blog-tag-chip-remove" title="Remove">✕</button>`;
            chip.querySelector('.blog-tag-chip-remove').addEventListener('click', () => {
                currentTags = currentTags.filter(x => x !== t);
                chip.remove();
                tagInput.placeholder = currentTags.length ? '' : 'Add tag…';
            });
            tagWrap.insertBefore(chip, tagInput);
        });
        tagInput.placeholder = currentTags.length ? '' : 'Add tag…';
    }

    // Initial chips from existing post
    syncTagChips();

    function addTag(raw) {
        const tag = raw.trim().toLowerCase().replace(/[,;]+$/, '');
        if (!tag || currentTags.includes(tag)) { tagInput.value = ''; return; }
        currentTags.push(tag);
        syncTagChips();
        tagInput.value = '';
    }

    tagInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            addTag(tagInput.value);
        } else if (e.key === 'Backspace' && !tagInput.value && currentTags.length) {
            currentTags.pop();
            syncTagChips();
        }
    });
    tagInput.addEventListener('blur', () => {
        if (tagInput.value.trim()) addTag(tagInput.value);
    });

    // ---- Quill editor ----
    ensureQuillBlots();

    const quill = new window.Quill('#blog-quill-editor', {
        theme: 'snow',
        placeholder: 'Write your journal entry here…',
        modules: {
            toolbar: {
                container: [
                    ['bold', 'italic', 'underline'],
                    [{ header: 2 }, { header: 3 }],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    ['blockquote'],
                    ['link', 'image'],
                    ['clean'],
                ],
            },
        },
    });

    // Load existing content
    if (post?.contentDelta) {
        try {
            quill.setContents(JSON.parse(post.contentDelta));
        } catch (_) {
            if (post?.contentHtml) quill.clipboard.dangerouslyPasteHTML(post.contentHtml);
        }
    }

    // Override Quill image handler — compress + upload to Storage
    const toolbar = quill.getModule('toolbar');
    toolbar.addHandler('image', async function () {
        const input = document.createElement('input');
        input.type   = 'file';
        input.accept = 'image/*';
        input.click();
        input.onchange = async () => {
            const file = input.files[0];
            if (!file) return;
            const range = quill.getSelection() || { index: quill.getLength() };
            showToast('Uploading image…');
            try {
                const { url } = await uploadBlogPhoto(draftId, file);
                quill.insertEmbed(range.index, 'image', url, 'user');
                quill.setSelection(range.index + 1, 0);
                showToast('Image uploaded!', 'success');
            } catch (err) {
                showToast('Image upload failed', 'error');
                console.error(err);
            }
        };
    });

    // ---- Plant reference picker ----
    container.querySelector('#blog-plant-ref-btn').addEventListener('click', () => {
        openBlogPlantPicker(sortedPlants, plantDisplayName, (plant) => {
            const range = quill.getSelection() || { index: quill.getLength() };
            quill.insertEmbed(range.index, 'plantChip', {
                plantId: plant.id,
                name:    plantDisplayName(plant).split(' (')[0], // botanical name only
            }, 'user');
            quill.setSelection(range.index + 1, 0);
            quill.focus();
        });
    });

    // ---- Area reference picker ----
    container.querySelector('#blog-area-ref-btn').addEventListener('click', () => {
        openBlogAreaPicker(sortedAreas, (area) => {
            const range = quill.getSelection() || { index: quill.getLength() };
            quill.insertEmbed(range.index, 'areaChip', {
                areaId: area.id,
                name:   area.name || 'Area',
            }, 'user');
            quill.setSelection(range.index + 1, 0);
            quill.focus();
        });
    });

    // ---- Save helpers ----
    async function savePost(publish) {
        const title   = container.querySelector('#blog-title').value.trim();
        const dateVal = container.querySelector('[name="blog-date-val"]')?.value
                     || container.querySelector('#blog-date')?.value
                     || todayStr();

        if (!title) { showToast('Please add a title', 'error'); return; }

        const delta       = quill.getContents();
        const contentHtml = quill.root.innerHTML
            .replace(/<img(?![^>]*loading)/g, '<img loading="lazy"');
        const plantRefs   = extractPlantRefs(delta);
        const areaRefs    = extractAreaRefs(delta);

        const data = {
            title,
            postDate:     dateVal,
            tags:         [...currentTags],
            contentDelta: JSON.stringify(delta),
            contentHtml,
            plantRefs,
            areaRefs,
            published:    publish,
        };

        if (!postId) data.createdAt_flag = true; // marker for new doc

        const saveDraftBtn   = container.querySelector('#blog-save-draft-btn');
        const publishBtn     = container.querySelector('#blog-publish-btn');
        [saveDraftBtn, publishBtn].forEach(b => { if (b) b.disabled = true; });

        try {
            await saveBlogPost(draftId, data);
            showToast(publish ? 'Entry published!' : 'Draft saved!', 'success');
            if (postId) {
                // Editing an existing post: go back to the blog-post view that's
                // already in the nav stack, so the editor doesn't linger in history
                goBack();
            } else {
                // New post: replace the compose screen with the new post view
                // so back goes straight to the journal list
                navigateReplace('blog-post', draftId);
            }
        } catch (err) {
            showToast('Error saving entry', 'error');
            console.error(err);
            [saveDraftBtn, publishBtn].forEach(b => { if (b) b.disabled = false; });
        }
    }

    container.querySelector('#blog-save-draft-btn').addEventListener('click', () => savePost(false));
    container.querySelector('#blog-publish-btn').addEventListener('click', () => savePost(true));

    setLoading(container, false);
}

// =============================================
//  PLANT PICKER MODAL (for blog editor)
// =============================================

function openBlogPlantPicker(sortedPlants, plantDisplayName, onSelect) {
    const html = `
        <div class="plant-picker-wrap" style="margin-bottom:0;">
            <input class="form-input" id="bpp-search"
                   placeholder="Search by name, genus, species…"
                   autocomplete="off" autocapitalize="off"
                   style="margin-bottom:8px;">
            <div class="plant-picker-results" id="bpp-results"
                 style="position:relative;max-height:320px;overflow-y:auto;display:block;border:1px solid var(--grey-200);border-radius:var(--radius-sm);"></div>
        </div>
    `;
    showModal('Add Plant Reference', html);

    const searchInput = document.getElementById('bpp-search');
    const resultsEl   = document.getElementById('bpp-results');

    function filterPlants(q) {
        if (!q) return sortedPlants.slice(0, 30);
        const words = q.toLowerCase().trim().split(/\s+/);
        return sortedPlants.filter(p => {
            const fields = [p.genus, p.species, p.cultivar, p.commonName, p.subspecies, p.variety]
                .map(f => (f || '').toLowerCase());
            return words.every(w => fields.some(f => f.includes(w)));
        }).slice(0, 50);
    }

    function renderPickerResults(q) {
        const results = filterPlants(q);
        if (!results.length) {
            resultsEl.innerHTML = `<div class="plant-picker-empty">No plants found</div>`;
            return;
        }
        resultsEl.innerHTML = results.map(p =>
            `<div class="plant-picker-option" data-id="${p.id}">${escHtml(plantDisplayName(p))}</div>`
        ).join('');
        resultsEl.querySelectorAll('.plant-picker-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const plant = sortedPlants.find(p => p.id === opt.dataset.id);
                if (plant) {
                    hideModal();
                    onSelect(plant);
                }
            });
        });
    }

    renderPickerResults('');
    let debounce = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => renderPickerResults(searchInput.value), 200);
    });
    searchInput.focus();
}

// =============================================
//  AREA PICKER MODAL (for blog editor)
// =============================================

function openBlogAreaPicker(sortedAreas, onSelect) {
    const html = `
        <div class="plant-picker-wrap" style="margin-bottom:0;">
            <input class="form-input" id="bap-search"
                   placeholder="Search areas…"
                   autocomplete="off" autocapitalize="off"
                   style="margin-bottom:8px;">
            <div class="plant-picker-results" id="bap-results"
                 style="position:relative;max-height:320px;overflow-y:auto;display:block;border:1px solid var(--grey-200);border-radius:var(--radius-sm);"></div>
        </div>
    `;
    showModal('Add Area Reference', html);

    const searchInput = document.getElementById('bap-search');
    const resultsEl   = document.getElementById('bap-results');

    function filterAreas(q) {
        if (!q) return sortedAreas;
        const words = q.toLowerCase().trim().split(/\s+/);
        return sortedAreas.filter(a => {
            const name = (a.name || '').toLowerCase();
            const desc = (a.description || '').toLowerCase();
            return words.every(w => name.includes(w) || desc.includes(w));
        });
    }

    function renderPickerResults(q) {
        const results = filterAreas(q);
        if (!results.length) {
            resultsEl.innerHTML = `<div class="plant-picker-empty">No areas found</div>`;
            return;
        }
        resultsEl.innerHTML = results.map(a =>
            `<div class="plant-picker-option" data-id="${a.id}">🗺️ ${escHtml(a.name || 'Unnamed area')}</div>`
        ).join('');
        resultsEl.querySelectorAll('.plant-picker-option').forEach(opt => {
            opt.addEventListener('click', () => {
                const area = sortedAreas.find(a => a.id === opt.dataset.id);
                if (area) {
                    hideModal();
                    onSelect(area);
                }
            });
        });
    }

    renderPickerResults('');
    let debounce = null;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => renderPickerResults(searchInput.value), 200);
    });
    searchInput.focus();
}
