// =============================================================
//  batch-pretreatment.js — Pre-sowing treatment UI
//  The batch-form section, the batch-detail card, and the step,
//  check and sow actions. Dates and status come from pretreatment.js,
//  which holds no UI and can be tested in Node.
// =============================================================

import { addNurseryLog, updateNurseryBatch, escHtml, fmtDate, todayStr } from './db.js';
import { showModal, hideModal, showToast, datePicker, initDatePickers, isValidDateStr } from './ui-utils.js';
import {
    PRETREATMENT_TYPES, DEFAULT_CHECK_EVERY_DAYS,
    pretreatmentStatus, stepLabel, stepDurationText, stepDateBounds, daysBetween, isTimed,
    checkUpdates, advanceStepUpdates, finishStepUpdates, setStepDatesUpdates, undoStepUpdates, sowUpdates
} from './pretreatment.js';

// =============================================
//  BATCH FORM SECTION
// =============================================

let _rowSeq = 0;

function stepRowHTML(step = {}) {
    const k    = ++_rowSeq;
    const type = PRETREATMENT_TYPES[step.type] ? step.type : 'cold-moist';
    const days = step.type ? step.days : PRETREATMENT_TYPES[type].days;
    // Dates a step has already been marked with ride along on the row, so
    // editing the plan never loses what has been done.
    return `
        <div class="pretreat-step-row" data-start="${escHtml(step.startDate || '')}" data-end="${escHtml(step.endDate || '')}">
            <div class="pretreat-step-row-head">
                <span class="pretreat-step-num" aria-hidden="true"></span>
                <select class="form-input pt-type" id="pt-type-${k}" aria-label="Treatment" data-prev="${type}">
                    ${Object.entries(PRETREATMENT_TYPES).map(([v, t]) =>
                        `<option value="${v}" ${v === type ? 'selected' : ''}>${t.icon} ${t.label}</option>`).join('')}
                </select>
                <button type="button" class="btn-icon danger pt-remove" title="Remove step" aria-label="Remove step">✕</button>
            </div>
            <div class="pretreat-days-row">
                <div class="form-group">
                    <label class="form-label" for="pt-days-${k}">Min days</label>
                    <input class="form-input pt-days" type="number" id="pt-days-${k}" min="0" max="730"
                           value="${days > 0 ? days : ''}" placeholder="One-off">
                </div>
                <div class="form-group">
                    <label class="form-label" for="pt-max-${k}">Max days</label>
                    <input class="form-input pt-max" type="number" id="pt-max-${k}" min="0" max="730"
                           value="${step.maxDays > 0 ? step.maxDays : ''}">
                </div>
            </div>
            <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" for="pt-notes-${k}">Notes (optional)</label>
                <input class="form-input pt-notes" type="text" id="pt-notes-${k}"
                       value="${escHtml(step.notes || '')}" placeholder="${escHtml(PRETREATMENT_TYPES[type].hint)}">
            </div>
        </div>`;
}

/** The "Pre-sowing treatment" block of the batch form. Shown only for seed. */
export function pretreatmentFormHTML(existing, isEdit) {
    const pt      = existing?.pretreatment || null;
    const enabled = !!pt?.steps?.length;
    const visible = (existing?.method || 'seed') === 'seed';
    return `
        <div id="pretreatment-group" style="display:${visible ? 'block' : 'none'};">
            <label class="pretreat-toggle">
                <input type="checkbox" id="pt-enabled" ${enabled ? 'checked' : ''}>
                <span>Seeds need treatment before sowing
                    <span class="form-hint" style="display:block;margin:2px 0 0;">Cleaning, stratifying, scarifying, soaking…</span>
                </span>
            </label>
            <div id="pt-body" style="display:${enabled ? 'block' : 'none'};">
                <p class="form-hint">List the steps in order. This saves the plan — mark each step on the batch page as you do it. Leave min days blank for a one-off step like cleaning.</p>
                <div id="pt-steps" class="pretreat-steps-edit">
                    ${enabled ? pt.steps.map(stepRowHTML).join('') : ''}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" id="pt-add-step" style="margin-bottom:12px;">+ Add step</button>
                <div class="form-row-two">
                    <div class="form-group">
                        <label class="form-label" for="pt-check-every">Check every (days)</label>
                        <input class="form-input" type="number" id="pt-check-every" min="1" max="365"
                               value="${pt?.checkEveryDays || DEFAULT_CHECK_EVERY_DAYS}">
                        <p class="form-hint">While a timed step is running.</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="pt-sow-not-before">Don't sow before (optional)</label>
                        ${datePicker('pt-sow-not-before', 'sowNotBefore', pt?.sowNotBefore || '')}
                    </div>
                </div>
                ${isEdit ? `
                <div class="form-group">
                    <label class="form-label" for="pt-sown-date">Sown on</label>
                    ${datePicker('pt-sown-date', 'sownDate', existing?.sownDate || '')}
                    <p class="form-hint">Leave blank until the seeds are sown — the Sow now button fills this in.</p>
                </div>` : ''}
            </div>
        </div>`;
}

/** Wire the section. Call once after the form is in the DOM. */
export function initPretreatmentForm() {
    const enabledEl = document.getElementById('pt-enabled');
    const bodyEl    = document.getElementById('pt-body');
    const stepsEl   = document.getElementById('pt-steps');
    if (!enabledEl || !stepsEl) return;

    enabledEl.addEventListener('change', () => {
        bodyEl.style.display = enabledEl.checked ? 'block' : 'none';
        if (enabledEl.checked && !stepsEl.querySelector('.pretreat-step-row')) {
            stepsEl.insertAdjacentHTML('beforeend', stepRowHTML());
        }
    });

    document.getElementById('pt-add-step')?.addEventListener('click', () => {
        stepsEl.insertAdjacentHTML('beforeend', stepRowHTML());
    });

    stepsEl.addEventListener('click', e => {
        const btn = e.target.closest('.pt-remove');
        if (btn) btn.closest('.pretreat-step-row')?.remove();
    });

    // Changing the treatment updates the suggested days — unless they were typed by hand.
    stepsEl.addEventListener('change', e => {
        const sel = e.target.closest('.pt-type');
        if (!sel) return;
        const row    = sel.closest('.pretreat-step-row');
        const daysEl = row.querySelector('.pt-days');
        const prev   = PRETREATMENT_TYPES[sel.dataset.prev]?.days;
        const next   = PRETREATMENT_TYPES[sel.value];
        if (!daysEl.value || Number(daysEl.value) === prev) daysEl.value = next.days || '';
        row.querySelector('.pt-notes').placeholder = next.hint;
        sel.dataset.prev = sel.value;
    });
}

/**
 * Read the section on submit.
 * Returns { pretreatment, sownDate } or { error } — never writes undefined,
 * which Firestore rejects.
 */
export function readPretreatmentForm({ method, existing, startDate }) {
    if (method !== 'seed' || !document.getElementById('pt-enabled')?.checked) {
        return { pretreatment: null, sownDate: null };
    }
    const intOrNull = el => {
        const v = el?.value.trim();
        if (!v) return null;
        const n = Number(v);
        return Number.isInteger(n) && n >= 0 ? n : NaN;
    };

    const rows = [...document.querySelectorAll('#pt-steps .pretreat-step-row')];
    if (!rows.length) return { error: 'Add at least one treatment step, or untick "Seeds need treatment"' };

    const steps = [];
    for (const [i, row] of rows.entries()) {
        const days    = intOrNull(row.querySelector('.pt-days'));
        const maxDays = intOrNull(row.querySelector('.pt-max'));
        if (Number.isNaN(days) || Number.isNaN(maxDays)) return { error: `Step ${i + 1}: days must be whole numbers` };
        if (days && maxDays && maxDays < days)          return { error: `Step ${i + 1}: max days is less than min days` };
        steps.push({
            type:      row.querySelector('.pt-type').value,
            days:      days || null,
            maxDays:   maxDays || null,
            notes:     row.querySelector('.pt-notes').value.trim(),
            startDate: row.dataset.start || null,
            endDate:   row.dataset.end   || null,
        });
    }

    const checkEvery = intOrNull(document.getElementById('pt-check-every'));
    if (!checkEvery || checkEvery > 365) return { error: 'Check every must be between 1 and 365 days' };

    const sowNotBefore = document.getElementById('pt-sow-not-before')?.value.trim() || null;
    if (sowNotBefore && !isValidDateStr(sowNotBefore)) return { error: "Please enter Don't sow before as YYYY-MM-DD" };

    const sownDate = document.getElementById('pt-sown-date')?.value.trim() || null;
    if (sownDate && !isValidDateStr(sownDate)) return { error: 'Please enter Sown on as YYYY-MM-DD' };
    if (sownDate && startDate && sownDate < startDate) return { error: 'Sown on is before the start date' };

    return {
        pretreatment: {
            steps,
            checkEveryDays: checkEvery,
            sowNotBefore,
            lastCheckDate:  existing?.pretreatment?.lastCheckDate || null,
        },
        sownDate,
    };
}

// =============================================
//  BATCH DETAIL CARD
// =============================================

function stateLabel(st, pt) {
    switch (st.state) {
        case 'not-started':   return 'Not started';
        case 'in-progress':   return 'In treatment';
        case 'step-due':      return 'Time for the next step';
        case 'between-steps': return `Next: ${stepLabel(st.steps[st.nextIndex])}`;
        case 'waiting':       return `Holding until ${fmtDate(pt.sowNotBefore)}`;
        case 'ready-to-sow':  return 'Ready to sow';
        case 'overdue':       return st.pendingTimed ? "Past this step's maximum" : 'Past the latest sowing date';
        default:              return '';
    }
}

function stepDatesText(st, s) {
    if (s.state === 'done') {
        const n = daysBetween(s.start, s.end);
        return n > 0 ? `${fmtDate(s.start)} – ${fmtDate(s.end)} · ${n} days` : `Done ${fmtDate(s.end)}`;
    }
    if (s.state === 'active') return `Started ${fmtDate(s.start)} · day ${st.dayOfStep}${s.days ? ` of ${s.days}` : ''}`;
    return s.index === st.nextIndex ? 'Next' : '';
}

function sowFromText(st, pt) {
    const hold = pt.sowNotBefore ? `, not before ${fmtDate(pt.sowNotBefore)}` : '';
    if (st.sowFrom)     return fmtDate(st.sowFrom);
    if (st.sowFromDays) return `${st.sowFromDays} days after ${escHtml(st.sowFromAfter)} starts${hold}`;
    return 'Once the steps are done';
}

/** The live card for a batch at the Pre-sowing stage. */
export function pretreatmentCardHTML(batch, canEdit) {
    const today = todayStr();
    const st    = pretreatmentStatus(batch, today);
    if (!st) return '';
    const pt     = batch.pretreatment;
    const active = st.activeIndex !== -1 ? st.steps[st.activeIndex] : null;
    const pct    = active?.days > 0 ? Math.min(100, Math.round(st.dayOfStep / active.days * 100)) : 0;
    // Sowing is the main action once no timed step is left to start; before that it's the next step.
    const sowIsNext = !st.pendingTimed && ['ready-to-sow', 'waiting', 'overdue'].includes(st.state);

    const stepHTML = s => {
        const icon    = PRETREATMENT_TYPES[s.type]?.icon || '';
        const dur     = stepDurationText(s);
        const actions = !canEdit ? '' : [
            s.state !== 'pending'
                ? `<button type="button" class="btn-icon pt-edit-step" data-idx="${s.index}" title="Change date or undo" aria-label="Change date or undo">✎</button>` : '',
            s.state === 'active'
                ? `<button type="button" class="btn btn-secondary btn-sm pt-finish-btn">Finish</button>` : '',
            s.index === st.nextIndex
                ? `<button type="button" class="btn ${sowIsNext ? 'btn-secondary' : 'btn-primary'} btn-sm pt-advance-btn" data-idx="${s.index}">${isTimed(s) ? 'Start' : 'Mark done'}</button>` : '',
        ].join('');
        return `
                <li class="pretreat-step ${s.state}">
                    <div class="pretreat-step-body">
                        <span class="pretreat-step-name">${icon} ${escHtml(stepLabel(s))}${dur ? ` <span class="pretreat-step-dur">${dur}</span>` : ''}</span>
                        ${stepDatesText(st, s) ? `<span class="pretreat-step-dates">${stepDatesText(st, s)}</span>` : ''}
                        ${s.notes ? `<span class="pretreat-step-notes">${escHtml(s.notes)}</span>` : ''}
                    </div>
                    ${actions ? `<div class="pretreat-step-actions">${actions}</div>` : ''}
                </li>`;
    };

    return `
        <div class="pretreat-card pretreat-${st.state}">
            <div class="pretreat-head">
                <h3 class="pretreat-title">Pre-sowing treatment</h3>
                <span class="pretreat-state">${escHtml(stateLabel(st, pt))}</span>
            </div>
            ${active ? `
            <p class="pretreat-now">${PRETREATMENT_TYPES[active.type]?.icon || ''} <strong>${escHtml(stepLabel(active))}</strong>
                · day ${st.dayOfStep} of ${active.days}${active.maxDays ? ` (max ${active.maxDays})` : ''}</p>
            <div class="pretreat-bar"><div class="pretreat-bar-fill" style="width:${pct}%;"></div></div>` : ''}
            <ol class="pretreat-steps">
                ${st.steps.map(stepHTML).join('')}
            </ol>
            <div class="pretreat-dates">
                ${st.nextCheck ? `
                <div class="pretreat-date ${st.checkDue ? 'due' : ''}">
                    <span class="detail-label">Next check</span>
                    <span class="detail-value">${st.checkDue ? '⚠️ Due ' : ''}${fmtDate(st.nextCheck)}</span>
                </div>` : ''}
                <div class="pretreat-date ${st.sowFrom ? '' : 'wide'}">
                    <span class="detail-label">Sow from</span>
                    <span class="detail-value">${sowFromText(st, pt)}</span>
                </div>
                ${st.sowBy ? `
                <div class="pretreat-date">
                    <span class="detail-label">Sow by</span>
                    <span class="detail-value">${fmtDate(st.sowBy)}</span>
                </div>` : ''}
            </div>
            ${canEdit ? `
            <div class="pretreat-actions">
                <button class="btn ${sowIsNext ? 'btn-primary' : 'btn-secondary'} btn-sm" id="pt-sow-btn">🌱 Sow now</button>
                ${active ? `<button class="btn btn-secondary btn-sm" id="pt-check-btn">✓ Checked — all fine</button>` : ''}
            </div>` : ''}
        </div>`;
}

/** A one-line record of the treatment, for a batch that has been sown. */
export function pretreatmentHistoryHTML(batch) {
    const st = pretreatmentStatus(batch, batch.sownDate || todayStr());
    if (!st) return '';
    const parts = st.steps.map(s => {
        if (s.state === 'pending') return `${escHtml(stepLabel(s))} (skipped)`;
        // A step still open when "Sown on" was typed into the form ran until sowing.
        const end = s.end || batch.sownDate;
        const n   = end ? daysBetween(s.start, end) : 0;
        return escHtml(stepLabel(s)) + (n > 0 ? ` (${n} days)` : '');
    });
    return `
        <div class="detail-notes pretreat-history">
            <h3 class="detail-notes-label">Pre-sowing treatment</h3>
            <p>${parts.join(' → ')}${batch.sownDate ? ` · sown ${fmtDate(batch.sownDate)}` : ''}</p>
        </div>`;
}

// =============================================
//  ACTIONS
// =============================================

function logFor(batch, date, observation, stageTo = null) {
    return addNurseryLog({
        batchId:      batch.id,
        date,
        observation,
        lossCount:    0,
        lossReason:   null,
        stageTo,
        locationId:   null,
        locationName: null,
        currentQty:   batch.currentQty ?? batch.startQty ?? 0,
        photos:       [],
    });
}

function wireModalSubmit(formId, saveId, handler) {
    initDatePickers(document.getElementById('modal-body') || document.body);
    document.getElementById(formId)?.addEventListener('submit', async e => {
        e.preventDefault();
        const saveBtn = document.getElementById(saveId);
        saveBtn.disabled = true;
        try {
            if (await handler() !== false) hideModal();
        } catch (err) {
            console.error(err);
            showToast('Could not save', 'error');
        }
        saveBtn.disabled = false;
    });
}

/** Modal with a date and an optional note; resolves via onSubmit(date, note). */
function showDateNoteModal({ title, intro, submitLabel, minDate, onSubmit }) {
    showModal(title, `
        <form id="pt-action-form" novalidate>
            ${intro ? `<p class="form-hint" style="margin-top:0;">${intro}</p>` : ''}
            <div class="form-group">
                <label class="form-label" for="pt-action-date">Date <span class="required">*</span></label>
                ${datePicker('pt-action-date', 'date', todayStr())}
            </div>
            <div class="form-group">
                <label class="form-label" for="pt-action-note">Note (optional)</label>
                <textarea class="form-input" id="pt-action-note" rows="2"></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="pt-action-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" id="pt-action-save">${submitLabel}</button>
            </div>
        </form>`);
    document.getElementById('pt-action-cancel')?.addEventListener('click', hideModal);
    wireModalSubmit('pt-action-form', 'pt-action-save', async () => {
        const date = document.getElementById('pt-action-date')?.value.trim() || '';
        if (!isValidDateStr(date))     { showToast('Please enter a valid date as YYYY-MM-DD', 'error'); return false; }
        if (minDate && date < minDate) { showToast(`The date can't be before ${fmtDate(minDate)}`, 'error'); return false; }
        await onSubmit(date, document.getElementById('pt-action-note')?.value.trim() || '');
    });
}

/** Correct a marked step's dates, or put it back to not done. */
function showStepEditModal(batch, st, s, reload) {
    const timed   = isTimed(s);
    const { min, max } = stepDateBounds(st, s.index);
    // Only the most recently marked step can be undone, so the steps stay in order.
    const canUndo = st.steps.every(o => o.index <= s.index || !o.start);

    showModal(stepLabel(s), `
        <form id="pt-edit-form" novalidate>
            <div class="form-group">
                <label class="form-label" for="pt-edit-start">${timed ? 'Started' : 'Done on'}</label>
                ${datePicker('pt-edit-start', 'startDate', s.start || '')}
            </div>
            ${timed && s.end ? `
            <div class="form-group">
                <label class="form-label" for="pt-edit-end">Ended</label>
                ${datePicker('pt-edit-end', 'endDate', s.end)}
            </div>` : ''}
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="pt-edit-cancel">Cancel</button>
                <button type="submit" class="btn btn-primary" id="pt-edit-save">Save</button>
            </div>
            ${canUndo ? `
            <button type="button" class="btn btn-secondary" id="pt-edit-undo" style="width:100%;margin-top:10px;">↩ Undo — mark as not done</button>` : ''}
        </form>`);
    document.getElementById('pt-edit-cancel')?.addEventListener('click', hideModal);

    document.getElementById('pt-edit-undo')?.addEventListener('click', async () => {
        if (!confirm(`Mark ${stepLabel(s)} as not done?`)) return;
        try {
            await updateNurseryBatch(batch.id, undoStepUpdates(batch, s.index));
            hideModal();
            showToast(`${stepLabel(s)} marked as not done`, 'success');
            await reload();
        } catch (err) { console.error(err); showToast('Could not undo', 'error'); }
    });

    wireModalSubmit('pt-edit-form', 'pt-edit-save', async () => {
        const start = document.getElementById('pt-edit-start')?.value.trim() || '';
        const endEl = document.getElementById('pt-edit-end');
        const end   = endEl ? endEl.value.trim() : null;
        const bad = msg => { showToast(msg, 'error'); return false; };
        if (!isValidDateStr(start))                return bad('Please enter a valid date as YYYY-MM-DD');
        if (endEl && !isValidDateStr(end))         return bad('Please enter a valid end date as YYYY-MM-DD');
        if (min && start < min)                    return bad(`Can't be before ${fmtDate(min)}, when the step before it was marked`);
        if (end && end < start)                    return bad('The end is before the start');
        if (max && (end || start) > max)           return bad(`Can't be after ${fmtDate(max)}, when the next step started`);
        await updateNurseryBatch(batch.id, setStepDatesUpdates(batch, s.index, {
            startDate: start,
            endDate:   timed ? (end || null) : start,
        }));
        showToast('Dates updated', 'success');
        await reload();
    });
}

const withNote = (text, note) => note ? `${text}\n${note}` : text;

/** Wire the card's buttons. Call after pretreatmentCardHTML() is in the DOM. */
export function initPretreatmentActions(container, batch, reload) {
    const st = pretreatmentStatus(batch, todayStr());
    if (!st) return;
    const active = st.activeIndex !== -1 ? st.steps[st.activeIndex] : null;

    container.querySelector('#pt-check-btn')?.addEventListener('click', async e => {
        const btn = e.currentTarget;   // null once the handler awaits
        btn.disabled = true;
        const today = todayStr();
        try {
            await logFor(batch, today, 'Pre-sowing check — all fine.');
            await updateNurseryBatch(batch.id, checkUpdates(batch, today));
            showToast('Check recorded', 'success');
            await reload();
        } catch (err) {
            console.error(err);
            showToast('Could not record check', 'error');
            btn.disabled = false;
        }
    });

    container.querySelectorAll('.pt-advance-btn').forEach(btn => btn.addEventListener('click', () => {
        const s     = st.steps[Number(btn.dataset.idx)];
        const timed = isTimed(s);
        const ends  = active && active.index !== s.index ? active : null;
        showDateNoteModal({
            title:       `${timed ? 'Start' : 'Done'}: ${stepLabel(s)}`,
            intro:       ends ? `This also ends ${escHtml(stepLabel(ends))}, which started ${fmtDate(ends.start)}.` : '',
            submitLabel: timed ? 'Start' : 'Mark done',
            minDate:     st.lastDate,
            onSubmit: async (date, note) => {
                await updateNurseryBatch(batch.id, advanceStepUpdates(batch, s.index, date));
                const ended = ends ? `${stepLabel(ends)} finished after ${daysBetween(ends.start, date)} days. ` : '';
                await logFor(batch, date, withNote(`${ended}${timed ? 'Started' : 'Done:'} ${stepLabel(s)}.`, note));
                showToast(timed ? `Started ${stepLabel(s)}` : `${stepLabel(s)} done`, 'success');
                await reload();
            },
        });
    }));

    container.querySelector('.pt-finish-btn')?.addEventListener('click', () => {
        showDateNoteModal({
            title:       `Finish: ${stepLabel(active)}`,
            intro:       `Started ${fmtDate(active.start)}. Use this if it ends before the next step begins.`,
            submitLabel: 'Finish',
            minDate:     active.start,
            onSubmit: async (date, note) => {
                await updateNurseryBatch(batch.id, finishStepUpdates(batch, date));
                await logFor(batch, date, withNote(`${stepLabel(active)} finished after ${daysBetween(active.start, date)} days.`, note));
                showToast(`${stepLabel(active)} finished`, 'success');
                await reload();
            },
        });
    });

    container.querySelectorAll('.pt-edit-step').forEach(btn => btn.addEventListener('click', () => {
        showStepEditModal(batch, st, st.steps[Number(btn.dataset.idx)], reload);
    }));

    container.querySelector('#pt-sow-btn')?.addEventListener('click', () => {
        const notDone = st.steps.filter(s => s.state === 'pending').map(s => escHtml(stepLabel(s)));
        const intro = [
            notDone.length ? `Not done yet: ${notDone.join(', ')} — recorded as skipped.` : '',
            st.sowFrom && todayStr() < st.sowFrom ? `This is before the planned sow-from date of ${fmtDate(st.sowFrom)} — fine if they have started to germinate.` : '',
            'Moves the batch to Propagating.',
        ].filter(Boolean).join(' ');
        showDateNoteModal({
            title:       'Sow seeds',
            intro,
            submitLabel: '🌱 Sow',
            minDate:     st.lastDate || batch.startDate,
            onSubmit: async (date, note) => {
                const text = st.firstStart
                    ? `Sown after ${daysBetween(st.firstStart, date)} days of pre-sowing treatment.`
                    : 'Sown.';
                await updateNurseryBatch(batch.id, sowUpdates(batch, date));
                await logFor(batch, date, withNote(text, note), 'propagating');
                showToast('Sown — moved to Propagating', 'success');
                await reload();
            },
        });
    });
}
