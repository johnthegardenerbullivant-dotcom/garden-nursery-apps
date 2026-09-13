// =============================================================
//  walkround-view.js — Walk-round: inventory one area on foot
// =============================================================
//
//  Walk an area with its plant list on a phone, tick off each plant as it is
//  found, say what happened to anything that isn't, and add what isn't listed.
//
//  Stored on existing documents, so there is no new collection and no rules
//  change (editors may already update both):
//    instances.lastSeen       YYYY-MM-DD  ticked "Seen" on a walk-round
//    instances.notFoundOn     YYYY-MM-DD  "can't find it, look again later";
//                                         cleared when the plant is next seen
//    areas.walkRoundStarted   YYYY-MM-DD  while a walk-round is in progress, else null
//    areas.lastWalkRound      YYYY-MM-DD  when the last walk-round was finished
//
//  A plant counts as checked on the current walk-round when
//  lastSeen >= walkRoundStarted, so progress survives closing the app and
//  carries on from any device.
//
//  Garden signal is patchy. Firestore applies a write to its local cache at
//  once but the promise only settles when the server has it, so awaiting each
//  tick would freeze the screen out of range. Ticks therefore update the screen
//  immediately and the write is tracked rather than awaited; a write the server
//  refuses is undone on screen with a toast. The cache is in memory, so closing
//  the page with writes still waiting loses them — hence the beforeunload guard.

import {
    getArea, updateArea, getAreas,
    getInstancesInArea, updateInstance, deleteInstance,
    getPlants, formatBotanicalName, escHtml
} from './db.js';
import { showModal, hideModal, showToast, setLoading, goBack } from './ui-utils.js';
import { isAtLeast } from './auth.js';
import { showDeathModal, showAddPlantToAreaModal } from './plants-view.js';

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Plain-text name. formatBotanicalName() returns escaped HTML, so decode it.
function plainName(plant) {
    if (!plant) return 'Unknown plant';
    const el = document.createElement('textarea');
    el.innerHTML = formatBotanicalName(plant).replace(/<[^>]+>/g, '');
    return el.value || plant.commonName || 'Unnamed plant';
}

// ---- Writes in flight ------------------------------------------------------

let pendingWrites = 0;

window.addEventListener('beforeunload', e => {
    if (pendingWrites > 0) { e.preventDefault(); e.returnValue = ''; }
});

function showPending() {
    const el = document.getElementById('wr-pending');
    if (!el) return;
    el.classList.toggle('waiting', pendingWrites > 0);
    el.textContent = pendingWrites === 0
        ? '✓ All changes saved'
        : `Saving ${pendingWrites} change${pendingWrites !== 1 ? 's' : ''}… Out of signal, they send when you’re back in range — keep this page open until then.`;
}

function track(promise, onFail) {
    pendingWrites++;
    showPending();
    promise
        .catch(err => {
            console.error('Walk-round write failed:', err);
            showToast('A change couldn’t be saved and has been undone', 'error');
            onFail?.();
        })
        .finally(() => { pendingWrites--; showPending(); });
}

// Filter, search text and undo memory survive re-renders of the same area.
let session = null;

// =============================================
//  WALK-ROUND VIEW
// =============================================

/**
 * @param opts.previousIds  Set of instance ids that existed before an add;
 *                          any others are new, so they were just found — mark them seen.
 * @param opts.markSeenIds  Set of instance ids to mark seen once reloaded
 *                          (the survivors of a partial death).
 */
export async function renderWalkRound(container, headerActionEl, backBtn, areaId, opts = {}) {
    setLoading(container, true);
    backBtn.classList.add('visible');
    document.querySelector('.fab')?.remove();
    headerActionEl.innerHTML = '';

    if (!isAtLeast('editor')) {
        container.innerHTML = `<div class="empty-state">
            <div class="empty-state-icon">🚶</div>
            <h3>Editors only</h3>
            <p>A walk-round updates the plant records, so it needs an editor account.</p>
        </div>`;
        return;
    }

    if (!session || session.areaId !== areaId) {
        session = { areaId, filter: 'todo', query: '', undo: new Map() };
    }

    let area, instances, plants, areas;
    try {
        [area, instances, plants, areas] = await Promise.all([
            getArea(areaId), getInstancesInArea(areaId), getPlants(), getAreas()
        ]);
    } catch (e) {
        console.error(e);
        container.innerHTML = `<div class="empty-state"><p>Error loading the walk-round.</p></div>`;
        return;
    }
    if (!area) {
        container.innerHTML = `<div class="empty-state"><h3>Area not found</h3></div>`;
        return;
    }

    const today    = todayISO();
    const plantMap = Object.fromEntries(plants.map(p => [p.id, p]));
    const allIds   = new Set(instances.map(i => i.id));
    const rows     = instances.map(inst => {
        const plant = plantMap[inst.plantId] || null;
        return { inst, plant, name: plainName(plant) };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const started   = () => area.walkRoundStarted || null;
    const isChecked = inst => !!(started() && inst.lastSeen && inst.lastSeen >= started());
    const isFlagged = inst => !!(started() && !isChecked(inst) && inst.notFoundOn && inst.notFoundOn >= started());
    const rerender  = (o = {}) => renderWalkRound(container, headerActionEl, backBtn, areaId, o);
    let undoTimer   = null;   // declared before renderWalk() first calls hideUndoBar()

    // Plants just added, and the survivors of a partial death, were seen a moment ago.
    if (started()) {
        for (const r of rows) {
            const isNew = opts.previousIds && !opts.previousIds.has(r.inst.id);
            if ((isNew || opts.markSeenIds?.has(r.inst.id)) && r.inst.lastSeen !== today) {
                const prev = { lastSeen: r.inst.lastSeen ?? null, notFoundOn: r.inst.notFoundOn ?? null };
                Object.assign(r.inst, { lastSeen: today, notFoundOn: null });
                track(updateInstance(r.inst.id, { lastSeen: today, notFoundOn: null }),
                      () => { Object.assign(r.inst, prev); renderList(); });
            }
        }
    }

    if (started()) renderWalk(); else renderIntro();
    setLoading(container, false);

    // ---------------------------------------------------------------------------

    function renderIntro() {
        container.innerHTML = `
            <div class="plant-detail-header">
                <div class="plant-detail-title">🚶 ${escHtml(area.name)}</div>
                <div class="plant-detail-subtitle">
                    <span>${rows.length} plant record${rows.length !== 1 ? 's' : ''}</span>&ensp;&middot;&ensp;
                    <span>${area.lastWalkRound ? `Last walk-round ${escHtml(area.lastWalkRound)}` : 'Never walked round'}</span>
                </div>
            </div>
            <div class="detail-section">
                <div class="detail-section-title">Walk-round</div>
                <p>Walk the area with this list and tick off each plant as you find it.
                   If something is missing or has changed, tap <strong>⋯</strong> to say what happened.
                   Add anything you find that isn’t listed.</p>
                <p class="form-hint">Progress is saved as you go, so you can stop and carry on later — on this phone or another.</p>
                <button type="button" class="btn btn-primary" id="wr-start" style="margin-top:12px;">🚶 Start walk-round</button>
            </div>`;

        container.querySelector('#wr-start').addEventListener('click', () => {
            area.walkRoundStarted = today;
            track(updateArea(areaId, { walkRoundStarted: today }), () => rerender());
            renderWalk();
        });
    }

    function renderWalk() {
        container.innerHTML = `
            <div class="plant-detail-header">
                <div class="plant-detail-title">🚶 ${escHtml(area.name)}</div>
                <div class="plant-detail-subtitle">
                    <span>Walk-round started ${started() === today ? 'today' : escHtml(started())}</span>&ensp;&middot;&ensp;
                    <button type="button" class="wr-link" id="wr-restart">start again</button>
                </div>
            </div>
            <div class="detail-section">
                <div class="wr-progress-text" id="wr-progress-text"></div>
                <div class="wr-progress"><i id="wr-progress-bar"></i></div>
                <div class="wr-pending" id="wr-pending"></div>
            </div>
            <input class="form-input wr-search" id="wr-search" type="search"
                   placeholder="Find by name or tag code…" autocomplete="off" autocapitalize="off">
            <div class="filter-chips" id="wr-filters">
                <button type="button" class="filter-chip" data-filter="todo">To check <span></span></button>
                <button type="button" class="filter-chip" data-filter="done">Checked <span></span></button>
                <button type="button" class="filter-chip" data-filter="all">All <span></span></button>
            </div>
            <div class="wr-list" id="wr-list"></div>
            <div class="wr-footer">
                <div class="wr-undo-bar" id="wr-undo-bar"></div>
                <div class="wr-footer-buttons">
                    <button type="button" class="btn btn-secondary" id="wr-add">+ Not listed</button>
                    <button type="button" class="btn btn-primary" id="wr-finish">Finish</button>
                </div>
            </div>`;

        const search = container.querySelector('#wr-search');
        search.value = session.query;
        search.addEventListener('input', () => { session.query = search.value; renderList(); });

        container.querySelectorAll('#wr-filters .filter-chip').forEach(chip =>
            chip.addEventListener('click', () => { session.filter = chip.dataset.filter; renderList(); }));

        container.querySelector('#wr-list').addEventListener('click', e => {
            const btn = e.target.closest('button[data-id]');
            const r   = btn && rows.find(x => x.inst.id === btn.dataset.id);
            if (!r) return;
            if (btn.classList.contains('wr-seen'))      markSeen(r);
            else if (btn.classList.contains('wr-undo')) undoSeen(r);
            else if (btn.classList.contains('wr-more')) showMoreSheet(r);
        });

        container.querySelector('#wr-restart').addEventListener('click', () => {
            if (!confirm('Start this walk-round again? Every plant goes back to “to check”, apart from any already seen today.')) return;
            const prev = area.walkRoundStarted;
            area.walkRoundStarted = today;
            track(updateArea(areaId, { walkRoundStarted: today }), () => { area.walkRoundStarted = prev; renderWalk(); });
            renderWalk();
        });

        container.querySelector('#wr-add').addEventListener('click', () => {
            showAddPlantToAreaModal(areaId, area.name, () => rerender({ previousIds: allIds }));
        });

        container.querySelector('#wr-finish').addEventListener('click', showFinish);

        hideUndoBar();
        renderList();
        showPending();
    }

    function renderList() {
        const listEl = document.getElementById('wr-list');
        if (!listEl) return;

        const total   = rows.length;
        const checked = rows.filter(r => isChecked(r.inst)).length;
        const flagged = rows.filter(r => isFlagged(r.inst)).length;

        document.getElementById('wr-progress-text').innerHTML =
            `<strong>${checked}</strong> of ${total} checked`
            + (flagged ? ` · <span class="wr-flag-count">${flagged} not found</span>` : '');
        document.getElementById('wr-progress-bar').style.width = total ? `${Math.round(100 * checked / total)}%` : '0%';

        const counts = { todo: total - checked, done: checked, all: total };
        container.querySelectorAll('#wr-filters .filter-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.filter === session.filter);
            c.querySelector('span').textContent = counts[c.dataset.filter];
        });

        const words = session.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
        const shown = rows.filter(r => {
            const done = isChecked(r.inst);
            if (session.filter === 'todo' && done)  return false;
            if (session.filter === 'done' && !done) return false;
            if (!words.length) return true;
            const hay = [r.name, r.plant?.commonName, r.plant?.tagCode, r.inst.notes]
                .filter(Boolean).join(' ').toLowerCase();
            return words.every(w => hay.includes(w));
        });

        const empty = words.length               ? 'Nothing matches that search.'
                    : session.filter === 'done'  ? 'Nothing checked yet.'
                    : total === 0                ? 'No plants are recorded in this area yet. Use “+ Not listed” to add what you find.'
                    : session.filter === 'todo'  ? 'Everything here has been checked. Tap Finish when you’re done. 🎉'
                    : 'No plants recorded here.';

        listEl.innerHTML = shown.length ? shown.map(rowHTML).join('') : `<div class="wr-empty">${empty}</div>`;
    }

    function rowHTML(r) {
        const { inst, plant } = r;
        const botName = plant ? formatBotanicalName(plant) : '';
        const name    = botName || escHtml(plant?.commonName || (plant ? 'Unnamed plant' : 'Unknown plant'));
        const common  = botName && plant?.commonName ? escHtml(plant.commonName) : '';
        const qty     = inst.quantity || 1;
        const meta    = [
            `${qty} plant${qty !== 1 ? 's' : ''}`,
            plant?.tagCode   ? `🏷️ ${escHtml(plant.tagCode)}` : null,
            inst.datePlanted ? `planted ${escHtml(inst.datePlanted)}` : null,
        ].filter(Boolean).join(' · ');

        const checked = isChecked(inst);
        const flagged = isFlagged(inst);
        const status  = checked ? `<span class="wr-status seen">✓ Seen ${inst.lastSeen === today ? 'today' : escHtml(inst.lastSeen)}</span>`
                      : flagged ? `<span class="wr-status flagged">⚠ Not found ${inst.notFoundOn === today ? 'today' : escHtml(inst.notFoundOn)} — look again</span>`
                      : `<span class="wr-status">${inst.lastSeen ? `Last seen ${escHtml(inst.lastSeen)}` : 'Not checked before'}</span>`;

        return `
            <div class="wr-row${checked ? ' checked' : ''}${flagged ? ' flagged' : ''}">
                <div class="wr-row-info">
                    <div class="wr-row-name">${name}${common ? ` <span class="wr-row-common">(${common})</span>` : ''}</div>
                    <div class="wr-row-meta">${meta}</div>
                    ${inst.notes ? `<div class="wr-row-meta">${escHtml(inst.notes)}</div>` : ''}
                    ${status}
                </div>
                <div class="wr-row-actions">
                    ${checked
                        ? `<button type="button" class="btn btn-sm btn-secondary wr-undo" data-id="${inst.id}">Undo</button>`
                        : `<button type="button" class="btn btn-sm btn-primary wr-seen" data-id="${inst.id}">✓ Seen</button>`}
                    <button type="button" class="btn btn-sm btn-secondary wr-more" data-id="${inst.id}"
                            title="Not here, or something has changed" aria-label="Not here, or something has changed">⋯</button>
                </div>
            </div>`;
    }

    // ---- Seen / undo -----------------------------------------------------------

    function markSeen(r) {
        const prev = { lastSeen: r.inst.lastSeen ?? null, notFoundOn: r.inst.notFoundOn ?? null };
        if (!session.undo.has(r.inst.id)) session.undo.set(r.inst.id, prev);
        Object.assign(r.inst, { lastSeen: today, notFoundOn: null });
        renderList();
        showUndoBar(r);
        track(updateInstance(r.inst.id, { lastSeen: today, notFoundOn: null }),
              () => { Object.assign(r.inst, prev); session.undo.delete(r.inst.id); hideUndoBar(); renderList(); });
    }

    // Restores what the record said before it was first ticked on this device.
    // After a reload that memory is gone, so undo just clears the tick.
    function undoSeen(r) {
        const restore = session.undo.get(r.inst.id) ?? { lastSeen: null, notFoundOn: null };
        const was     = { lastSeen: r.inst.lastSeen ?? null, notFoundOn: r.inst.notFoundOn ?? null };
        session.undo.delete(r.inst.id);
        Object.assign(r.inst, restore);
        hideUndoBar();
        renderList();
        track(updateInstance(r.inst.id, restore), () => { Object.assign(r.inst, was); renderList(); });
    }

    // A ticked row leaves the "To check" list at once, so its Undo lives down here.
    // The bar never collapses: if it did, the footer buttons would jump just as a
    // thumb reached for Undo, and the tap would land on whatever moved underneath.
    function showUndoBar(r) {
        const bar = document.getElementById('wr-undo-bar');
        if (!bar) return;
        bar.innerHTML = `<span class="wr-undo-name">✓ ${escHtml(r.name)}</span>
                         <button type="button" class="btn btn-sm btn-secondary">Undo</button>`;
        bar.querySelector('button').addEventListener('click', () => undoSeen(r));
        clearTimeout(undoTimer);
        undoTimer = setTimeout(hideUndoBar, 10000);
    }
    function hideUndoBar() {
        clearTimeout(undoTimer);
        const bar = document.getElementById('wr-undo-bar');
        if (bar) bar.innerHTML = `<span class="wr-undo-hint">Tap ✓ Seen as you find each plant</span>`;
    }

    // ---- Not as recorded -------------------------------------------------------

    function summaryHTML(r) {
        const had = r.inst.quantity || 1;
        return `<div class="death-summary">
            <strong>${escHtml(r.name)}</strong>
            <span>📍 ${escHtml(area.name)} · recorded as ${had} plant${had !== 1 ? 's' : ''}</span>
        </div>`;
    }

    function showMoreSheet(r) {
        const had = r.inst.quantity || 1;
        showModal('Not as recorded?', `
            ${summaryHTML(r)}
            <div class="wr-sheet">
                <button type="button" class="wr-sheet-btn" data-act="count">
                    <b>🔢 The count is different</b><span>It’s here, but not ${had}</span></button>
                <button type="button" class="wr-sheet-btn" data-act="moved">
                    <b>📍 It’s in another area</b><span>Move the record there and mark it seen</span></button>
                ${r.plant ? `<button type="button" class="wr-sheet-btn" data-act="died">
                    <b>🍂 It died</b><span>Record it in the Compost Bin</span></button>` : ''}
                <button type="button" class="wr-sheet-btn" data-act="later">
                    <b>🔍 Can’t find it — look again later</b><span>Flag it and keep the record</span></button>
                <button type="button" class="wr-sheet-btn danger" data-act="gone">
                    <b>🗑️ It’s gone — remove it</b><span>Delete it from this area, with no Compost Bin entry. The plant stays in the catalogue.</span></button>
            </div>`);

        document.querySelectorAll('#modal-body .wr-sheet-btn').forEach(b => b.addEventListener('click', () => {
            switch (b.dataset.act) {
                case 'count': showCountForm(r); break;
                case 'moved': showMoveForm(r);  break;
                case 'died':
                    hideModal();
                    showDeathModal(r.plant, { ...r.inst, area }, () => rerender({ markSeenIds: new Set([r.inst.id]) }));
                    break;
                case 'later': hideModal(); flagNotFound(r); break;
                case 'gone':  removeRecord(r); break;
            }
        }));
    }

    function showCountForm(r) {
        const had = r.inst.quantity || 1;
        showModal('How many are there?', `
            <form id="wr-count-form" autocomplete="off">
                ${summaryHTML(r)}
                <div class="form-group">
                    <label class="form-label" for="wr-count">Number growing here now</label>
                    <input class="form-input" type="number" id="wr-count" min="1" step="1" inputmode="numeric" value="${had}">
                    <div class="form-hint">If there are fewer because some died, use “It died” instead, so they reach the Compost Bin.</div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="wr-count-cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary">Save and mark seen</button>
                </div>
            </form>`);

        document.getElementById('wr-count-cancel').addEventListener('click', hideModal);
        document.getElementById('wr-count-form').addEventListener('submit', e => {
            e.preventDefault();
            const n = parseInt(document.getElementById('wr-count').value, 10);
            if (!(n >= 1)) { showToast('Enter at least 1 — for none, use “It died” or “It’s gone”', 'error'); return; }
            hideModal();
            const prev = { quantity: r.inst.quantity, lastSeen: r.inst.lastSeen ?? null, notFoundOn: r.inst.notFoundOn ?? null };
            if (!session.undo.has(r.inst.id)) session.undo.set(r.inst.id, { lastSeen: prev.lastSeen, notFoundOn: prev.notFoundOn });
            Object.assign(r.inst, { quantity: n, lastSeen: today, notFoundOn: null });
            renderList();
            showToast(`Count updated to ${n}`, 'success');
            track(updateInstance(r.inst.id, { quantity: n, lastSeen: today, notFoundOn: null }),
                  () => { Object.assign(r.inst, prev); renderList(); });
        });
    }

    function showMoveForm(r) {
        const others = areas.filter(a => a.id !== areaId)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        showModal('Which area is it in?', `
            <form id="wr-move-form" autocomplete="off">
                ${summaryHTML(r)}
                <div class="form-group">
                    <label class="form-label" for="wr-move-area">Garden area</label>
                    <select class="form-input" id="wr-move-area">
                        <option value="">— select an area —</option>
                        ${others.map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join('')}
                    </select>
                    <div class="form-hint">If it’s already recorded there too, you’ll have two entries — merge them from the plant’s page.</div>
                </div>
                <div class="form-actions">
                    <button type="button" class="btn btn-secondary" id="wr-move-cancel">Cancel</button>
                    <button type="submit" class="btn btn-primary">Move and mark seen</button>
                </div>
            </form>`);

        document.getElementById('wr-move-cancel').addEventListener('click', hideModal);
        document.getElementById('wr-move-form').addEventListener('submit', e => {
            e.preventDefault();
            const to = document.getElementById('wr-move-area').value;
            if (!to) { showToast('Please select an area', 'error'); return; }
            hideModal();
            const idx = rows.indexOf(r);
            rows.splice(idx, 1);
            renderList();
            showToast(`Moved to ${areas.find(a => a.id === to)?.name || 'the other area'}`, 'success');
            track(updateInstance(r.inst.id, { areaId: to, lastSeen: today, notFoundOn: null }),
                  () => { rows.splice(idx, 0, r); renderList(); });
        });
    }

    function flagNotFound(r) {
        const prev = r.inst.notFoundOn ?? null;
        r.inst.notFoundOn = today;
        renderList();
        showToast('Flagged — it stays on the “To check” list');
        track(updateInstance(r.inst.id, { notFoundOn: today }), () => { r.inst.notFoundOn = prev; renderList(); });
    }

    function removeRecord(r) {
        if (!confirm(`Remove ${r.name} from ${area.name}? The plant stays in the catalogue.`)) return;
        hideModal();
        const idx = rows.indexOf(r);
        rows.splice(idx, 1);
        renderList();
        showToast('Removed from this area', 'success');
        track(deleteInstance(r.inst.id), () => { rows.splice(idx, 0, r); renderList(); });
    }

    // ---- Finish ----------------------------------------------------------------

    function showFinish() {
        const total     = rows.length;
        const checked   = rows.filter(r => isChecked(r.inst)).length;
        const flagged   = rows.filter(r => isFlagged(r.inst)).length;
        const unchecked = total - checked;

        showModal('Finish walk-round?', `
            <p><strong>${checked} of ${total}</strong> plant record${total !== 1 ? 's' : ''} checked in ${escHtml(area.name)}.</p>
            ${unchecked
                ? `<p class="form-hint" style="margin-top:8px;">${unchecked} not checked${flagged ? `, including ${flagged} you couldn’t find` : ''}.
                   They keep their previous “last seen” date${flagged ? ', and flagged plants stay flagged' : ''}.</p>`
                : `<p style="margin-top:8px;">Every plant here has been checked. 🎉</p>`}
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="wr-finish-cancel">Keep going</button>
                <button type="button" class="btn btn-primary" id="wr-finish-ok">Finish</button>
            </div>`);

        document.getElementById('wr-finish-cancel').addEventListener('click', hideModal);
        document.getElementById('wr-finish-ok').addEventListener('click', () => {
            hideModal();
            track(updateArea(areaId, { walkRoundStarted: null, lastWalkRound: today }));
            session = null;
            showToast('Walk-round finished', 'success');
            goBack();
        });
    }
}
