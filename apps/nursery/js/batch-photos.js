// =============================================================
//  batch-photos.js — Photo lightbox and inline batch photo management
// =============================================================

import {
    uploadNurseryPhoto, deleteNurseryPhoto, updateNurseryBatch,
    getLogsForBatch, escHtml, fmtDate
} from './db.js';
import { showToast, initPhotoDragSort } from './ui-utils.js';
import { isAtLeast } from './auth.js';

// =============================================
//  PHOTO LIGHTBOX
// =============================================

function openNurseryPhotoLightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML =
        '<button class="lightbox-close">✕</button>' +
        `<img src="${src}" alt="Photo">`;
    lb.querySelector('.lightbox-close').addEventListener('click', () => lb.remove());
    lb.addEventListener('click', e => { if (e.target === lb) lb.remove(); });
    document.body.appendChild(lb);
}

// =============================================
//  BATCH PHOTOS (inline management on detail page)
// =============================================

async function loadAndRenderBatchPhotos(container, batch) {
    const section = container.querySelector('#batch-photos-section');
    if (!section) return;

    const batchPhotos = batch.photos || [];
    const canEdit     = isAtLeast('editor');

    // Collect log photos (FIX 1 – merge log-entry photos into the batch gallery)
    let logPhotos = [];
    try {
        const logs = await getLogsForBatch(batch.id);
        for (const log of logs) {
            if (log.photos?.length) {
                for (const p of log.photos) {
                    logPhotos.push({ url: p.url, storePath: p.storePath, logDate: log.date });
                }
            }
        }
        // Oldest log first so the gallery reads chronologically
        logPhotos.sort((a, b) => (a.logDate || '').localeCompare(b.logDate || ''));
    } catch (e) {
        // Non-fatal — fall back to batch-level photos only
        console.warn('loadAndRenderBatchPhotos: could not fetch log photos', e);
    }

    const totalPhotos = batchPhotos.length + logPhotos.length;
    const hasMixed    = logPhotos.length > 0;  // used to disable drag-reorder

    // Batch-level photo thumbs (deletable, drag-sortable)
    const batchThumbsHTML = batchPhotos.map(p =>
        `<div class="photo-thumb" data-id="${escHtml(p.storePath)}">` +
        `<img src="${escHtml(p.url)}" alt="Batch photo" loading="lazy">` +
        (canEdit
            ? `<button type="button" class="photo-delete batch-ph-del" data-path="${escHtml(p.storePath)}" title="Delete photo">✕</button>`
            : '') +
        `</div>`
    ).join('');

    // Log-entry photo thumbs (read-only with a date badge; delete from log edit)
    const logThumbsHTML = logPhotos.map(p =>
        `<div class="photo-thumb photo-thumb--log" ` +
        `title="From log entry (${fmtDate(p.logDate) || 'log'}) — edit the log to delete" ` +
        `style="position:relative;">` +
        `<img src="${escHtml(p.url)}" alt="Log photo" loading="lazy">` +
        `<span style="position:absolute;bottom:3px;left:3px;right:3px;` +
              `font-size:0.6rem;background:rgba(0,0,0,0.55);color:#fff;` +
              `border-radius:3px;padding:1px 3px;text-align:center;` +
              `pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">` +
        `${fmtDate(p.logDate) || 'Log'}</span>` +
        `</div>`
    ).join('');

    const uploadStrip = canEdit ? (
        `<div class="photo-upload-strip" style="margin-top:8px;">` +
        `<label class="photo-upload-mini" title="Choose from gallery" style="cursor:pointer;">` +
        `🖼 Gallery<input type="file" id="bph-gallery" accept="image/*" multiple style="display:none"></label>` +
        `<label class="photo-upload-mini" title="Take a photo" style="cursor:pointer;">` +
        `📸 Camera<input type="file" id="bph-camera" accept="image/*" capture="environment" style="display:none"></label>` +
        `</div>` +
        `<div id="bph-progress" style="display:none;margin-top:8px;">` +
        `<div class="photo-upload-bar"><div class="photo-upload-fill" id="bph-fill"></div></div>` +
        `<p class="photo-upload-label" id="bph-label">Uploading…</p></div>`
    ) : '';

    section.innerHTML =
        (totalPhotos > 0
            ? `<div class="photo-grid" id="batch-photo-grid">${batchThumbsHTML}${logThumbsHTML}</div>`
            : `<p class="form-hint" style="margin:6px 0 8px;">No photos yet.</p>`) +
        uploadStrip;

    // Lightbox for all photos
    section.querySelectorAll('.photo-thumb img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', e => { e.stopPropagation(); openNurseryPhotoLightbox(img.src); });
    });

    // Drag-to-reorder: only when there are 2+ batch-level photos and no log photos mixed in
    // (mixing sources would corrupt the reorder since log photos aren't stored on the batch doc)
    if (canEdit && batchPhotos.length > 1 && !hasMixed) {
        const grid = section.querySelector('#batch-photo-grid');
        if (grid) {
            initPhotoDragSort(grid, async orderedPaths => {
                const reordered = orderedPaths.map(id => batchPhotos.find(p => p.storePath === id)).filter(Boolean);
                const missing   = batchPhotos.filter(p => !orderedPaths.includes(p.storePath));
                const newPhotos = [...reordered, ...missing];
                try {
                    await updateNurseryBatch(batch.id, { photos: newPhotos });
                    batch.photos = newPhotos;
                } catch (e) {
                    console.error(e); showToast('Could not save photo order', 'error');
                }
            });
        }
    }

    // Upload
    async function handleBphUpload(files) {
        if (!files.length) return;
        const prog  = section.querySelector('#bph-progress');
        const fill  = section.querySelector('#bph-fill');
        const label = section.querySelector('#bph-label');
        if (prog) prog.style.display = 'block';
        try {
            const newPhotos = [...(batch.photos || [])];
            for (let i = 0; i < files.length; i++) {
                if (label) label.textContent = `Uploading ${i + 1} of ${files.length}…`;
                const result = await uploadNurseryPhoto(batch.id, files[i], pct => {
                    if (fill) fill.style.width = `${pct}%`;
                });
                newPhotos.push(result);
            }
            await updateNurseryBatch(batch.id, { photos: newPhotos });
            batch.photos = newPhotos;
            showToast(files.length === 1 ? 'Photo added!' : `${files.length} photos added!`, 'success');
            loadAndRenderBatchPhotos(container, batch);
        } catch (err) {
            console.error(err); showToast('Photo upload failed', 'error');
        } finally {
            if (prog) prog.style.display = 'none';
        }
    }

    section.querySelector('#bph-gallery')?.addEventListener('change', e => handleBphUpload(Array.from(e.target.files)));
    section.querySelector('#bph-camera')?.addEventListener('change',  e => handleBphUpload(Array.from(e.target.files)));

    // Delete (batch-level photos only)
    section.querySelectorAll('.batch-ph-del').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            if (!confirm('Delete this photo?')) return;
            try {
                const sp = btn.dataset.path;
                await deleteNurseryPhoto(sp);
                const newPhotos = (batch.photos || []).filter(p => p.storePath !== sp);
                await updateNurseryBatch(batch.id, { photos: newPhotos });
                batch.photos = newPhotos;
                showToast('Photo deleted', 'success');
                loadAndRenderBatchPhotos(container, batch);
            } catch (err) {
                console.error(err); showToast('Could not delete photo', 'error');
            }
        });
    });
}


export { openNurseryPhotoLightbox, loadAndRenderBatchPhotos };
