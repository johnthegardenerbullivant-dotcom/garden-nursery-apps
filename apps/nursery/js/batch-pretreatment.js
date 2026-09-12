// =============================================================
//  batch-pretreatment.js — Pre-sowing treatment UI
//  The batch-form section, the batch-detail card, and the Check /
//  Next step / Sow now actions. Dates and status come from
//  pretreatment.js, which holds no UI and can be tested in Node.
// =============================================================

import { addNurseryLog, updateNurseryBatch, escHtml, fmtDate, todayStr } from './db.js';
import { showModal, hideModal, showToast, datePicker, initDatePickers, isValidDateStr } from './ui-utils.js';
import {
    PRETREATMENT_TYPES, DEFAULT_CHECK_EVERY_DAYS,
    pretreatmentStatus, stepLabel, stepDurationText, daysBetween,
    checkUpdates, nextStepUpdates, sowUpdates
} from './pretreatment.js';

// =============================================
//  BATCH FORM SECTION
// =============================================

let _rowSeq = 0;

function stepRowHTML(step = {}) {
    const k    = ++_rowSeq;
    const type = PRETREATMENT_TYPES[step.type] ? step.type : 'cold-moist';
    const days = step.type ? step.days : PRETREATMENT_TYPES[type].days;
    return `
        <div class="pretreat-step-row" data-end="${escHtml(step.endDate || '')}">
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
                <p class="form-hint">Steps run in order from the start date. Leave minimum days blank for a one-off step done on the day.</p>
                <div id="pt-steps" class="pretreat-steps-edit">
                    ${enabled ? pt.steps.map(stepRowHTML).join('') : ''}
                </div>
                <button type="button" class="btn btn-secondary btn-sm" id="pt-add-step" style="margin-bottom:12px;">+ Add step</button>
                <div class="form-row-two">
                    <div class="form-group">
                        <label class="form-label" for="pt-check-every">Check every (days)</label>
                        <input class="form-input" type="number" id="pt-check-every" min="1" max="365"
                               value="${pt?.checkEveryDays || DEFAULT_CHECK_EVERY_DAYS}">
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

    const rows  = [...document.querySelectorAll('#pt-steps .pretreat-step-row')];
    if (!rows.length) return { error: 'Add at least one treatment step, or untick "Seeds need treatment"' };

    const steps = [];
    for (const [i, row] of rows.entries()) {
        const days    = intOrNull(row.querySelector('.pt-days'));
        const maxDays = intOrNull(row.querySelector('.pt-max'));
        if (Number.isNaN(days) || Number.isNaN(maxDays)) return { error: `Step ${i + 1}: days must be whole numbers` };
        if (days && maxDays && maxDays < days)          return { error: `Step ${i + 1}: maximum days is less than the minimum` };
        steps.push({
            type:    row.querySelector('.pt-type').value,
            days:    days || null,
            maxDays: maxDays || null,
            notes:   row.querySelector('.pt-notes').value.trim(),
            endDate: row.dataset.end || null,
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
        case 'ready-to-sow': return 'Ready to sow';
        case 'step-due':     return 'Time for the next step';
        case 'waiting':      return pt.sowNotBefore ? `Holding until ${fmtDate(pt.sowNotBefore)}` : 'Treatment complete';
        case 'overdue':      return st.isLastActive ? 'Past the latest sowing date' : "Past this step's maximum";
        default:             return 'In treatment';
    }
}

function stepDatesText(s) {
    if (s.state === 'done') {
        const n = daysBetween(s.start, s.end);
        return n > 0 ? `${fmtDate(s.start)} – ${fmtDate(s.end)} · ${n} days` : fmtDate(s.end);
    }
    if (s.state === 'active') return `since ${fmtDate(s.start)}`;
    return `from about ${fmtDate(s.start)}`;
}

/** The live card for a batch at the Pre-sowing stage. */
export function pretreatmentCardHTML(batch, canEdit) {
    const today = todayStr();
    const st    = pretreatmentStatus(batch, today);
    if (!st) return '';
    const pt     = batch.pretreatment;
    const active = st.activeIndex !== -1 ? st.steps[st.activeIndex] : null;
    const next   = st.nextIndex   !== -1 ? st.steps[st.nextIndex]   : null;
    const pct    = active?.days > 0 ? Math.min(100, Math.round(st.dayOfStep / active.days * 100)) : 0;
    const moveOn = active && !st.isLastActive;

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
                ${st.steps.map(s => `
                <li class="pretreat-step ${s.state}">
                    <span class="pretreat-step-name">${PRETREATMENT_TYPES[s.type]?.icon || ''} ${escHtml(stepLabel(s))}${stepDurationText(s) ? ` <span class="pretreat-step-dur">${stepDurationText(s)}</span>` : ''}</span>
                    <span class="pretreat-step-dates">${stepDatesText(s)}</span>
                    ${s.notes ? `<span class="pretreat-step-notes">${escHtml(s.notes)}</span>` : ''}
                </li>`).join('')}
            </ol>
            <div class="pretreat-dates">
                <div class="pretreat-date ${st.checkDue ? 'due' : ''}">
                    <span class="detail-label">Next check</span>
                    <span class="detail-value">${st.checkDue ? '⚠️ Due ' : ''}${fmtDate(st.nextCheck)}</span>
                </div>
                <div class="pretreat-date">
                    <span class="detail-label">Sow from</span>
                    <span class="detail-value">${fmtDate(st.sowFrom)}</span>
                </div>
                ${st.sowBy ? `
                <div class="pretreat-date">
                    <span class="detail-label">Sow by</span>
                    <span class="detail-value">${fmtDate(st.sowBy)}</span>
                </div>` : ''}
            </div>
            ${canEdit ? `
            <div class="pretreat-actions">
                ${moveOn ? `<button class="btn btn-primary btn-sm" id="pt-next-btn">→ Start ${escHtml(stepLabel(next))}</button>` : ''}
                <button class="btn ${moveOn ? 'btn-secondary' : 'btn-primary'} btn-sm" id="pt-sow-btn">🌱 Sow now</button>
                <button class="btn btn-secondary btn-sm" id="pt-check-btn">✓ Checked — all fine</button>
            </div>` : ''}
        </div>`;
}

/** A one-line record of the treatment, for a batch that has been sown. */
export function pretreatmentHistoryHTML(batch) {
    const st = pretreatmentStatus(batch, batch.sownDate || todayStr());
    if (!st) return '';
    const parts = st.steps.map(s => {
        // A step still open when "Sown on" was typed into the form ran until sowing.
        const end = s.end || (s.state === 'active' ? batch.sownDate : null);
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
    initDatePickers(document.getElementById('modal-body') || document.body);
    document.getElementById('pt-action-cancel')?.addEventListener('click', hideModal);
    document.getElementById('pt-action-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        const date = document.getElementById('pt-action-date')?.value.trim() || '';
        if (!isValidDateStr(date))     { showToast('Please enter a valid date as YYYY-MM-DD', 'error'); return; }
        if (minDate && date < minDate) { showToast(`The date can't be before ${fmtDate(minDate)}`, 'error'); return; }
        const note    = document.getElementById('pt-action-note')?.value.trim() || '';
        const saveBtn = document.getElementById('pt-action-save');
        saveBtn.disabled = true;
        try {
            await onSubmit(date, note);
            hideModal();
        } catch (err) {
            console.error(err);
            showToast('Could not save', 'error');
            saveBtn.disabled = false;
        }
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

    container.querySelector('#pt-next-btn')?.addEventListener('click', () => {
        const next = st.steps[st.nextIndex];
        showDateNoteModal({
            title:       `Start ${stepLabel(next)}`,
            intro:       `Ends ${escHtml(stepLabel(active))}, which began ${fmtDate(active.start)}.`,
            submitLabel: 'Start step',
            minDate:     active.start,
            onSubmit: async (date, note) => {
                const n = daysBetween(active.start, date);
                await updateNurseryBatch(batch.id, nextStepUpdates(batch, date));
                await logFor(batch, date, withNote(`${stepLabel(active)} finished after ${n} days. Started ${stepLabel(next)}.`, note));
                showToast(`Started ${stepLabel(next)}`, 'success');
                await reload();
            },
        });
    });

    container.querySelector('#pt-sow-btn')?.addEventListener('click', () => {
        const early = todayStr() < st.sowFrom;
        showDateNoteModal({
            title:       'Sow seeds',
            intro:       early
                ? `This is before the planned sow-from date of ${fmtDate(st.sowFrom)} — fine if they have started to germinate.`
                : 'Moves the batch to Propagating.',
            submitLabel: '🌱 Sow',
            minDate:     batch.startDate,
            onSubmit: async (date, note) => {
                const n = daysBetween(batch.startDate, date);
                await updateNurseryBatch(batch.id, sowUpdates(batch, date));
                await logFor(batch, date, withNote(`Sown after ${n} days of pre-sowing treatment.`, note), 'propagating');
                showToast('Sown — moved to Propagating', 'success');
                await reload();
            },
        });
    });
}
