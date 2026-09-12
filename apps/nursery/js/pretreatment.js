// =============================================================
//  pretreatment.js — Pre-sowing seed treatment: steps, dates, status
//
//  Pure logic, deliberately free of imports (no Firebase, no DOM), so it
//  can be loaded by Node to test the date arithmetic. The UI lives in
//  batch-pretreatment.js.
//
//  A seed batch may carry `pretreatment`:
//
//    pretreatment: {
//      steps: [{ type, days, maxDays, notes, endDate }],
//      checkEveryDays: 14,
//      sowNotBefore:   'YYYY-MM-DD' | null,
//      lastCheckDate:  'YYYY-MM-DD' | null,
//    }
//    sownDate: 'YYYY-MM-DD' | null        (top level on the batch)
//
//  Steps run in order from the batch's startDate. A step with no minimum
//  `days` is a one-off done on the day (cleaning, soaking) and is never
//  "active". A step with days stays active until its endDate is recorded —
//  by "Start next step", or by sowing if it is the last. Nothing about a
//  reminder is stored: every date below is derived, so extending a step or
//  sowing early can never leave a stale reminder behind.
// =============================================================

export const PRETREATMENT_TYPES = {
    'clean':       { label: 'Clean seed',                 icon: '🧽', days: null, hint: 'Remove pulp, flesh or arils' },
    'scarify':     { label: 'Scarify',                    icon: '🪨', days: null, hint: 'Nick or sand the seed coat' },
    'soak':        { label: 'Soak',                       icon: '💧', days: null, hint: 'e.g. 24 hours in warm water' },
    'smoke':       { label: 'Smoke water',                icon: '🔥', days: null, hint: '' },
    'ga3':         { label: 'Gibberellic acid (GA3)',     icon: '🧪', days: null, hint: '' },
    'warm-moist':  { label: 'Warm moist stratification',  icon: '☀️', days: 60,   hint: 'e.g. 20°C in damp vermiculite' },
    'cold-moist':  { label: 'Cold moist stratification',  icon: '❄️', days: 90,   hint: 'e.g. fridge, damp vermiculite in a bag' },
    'after-ripen': { label: 'Dry after-ripening',         icon: '🌾', days: 30,   hint: 'Dry storage before sowing' },
    'other':       { label: 'Other',                      icon: '🌰', days: null, hint: '' },
};

export const DEFAULT_CHECK_EVERY_DAYS = 14;

// ---------- Date arithmetic on YYYY-MM-DD strings (UTC, so no DST drift) ----------

function toUTC(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
}

export function addDays(dateStr, n) {
    return new Date(toUTC(dateStr) + n * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(fromStr, toStr) {
    return Math.round((toUTC(toStr) - toUTC(fromStr)) / 86400000);
}

const maxDate = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

export function hasPretreatment(batch) {
    return !!(batch?.pretreatment?.steps?.length);
}

/** The stage a batch starts in, or falls back to when stage logs are deleted. */
export function initialStage(batch) {
    return hasPretreatment(batch) && !batch.sownDate ? 'pre-sowing' : 'propagating';
}

export function stepLabel(step) {
    return PRETREATMENT_TYPES[step?.type]?.label || 'Step';
}

/** "90 days", "90–120 days", "up to 120 days" or "" for a one-off step. */
export function stepDurationText(step) {
    const min = step?.days > 0 ? step.days : 0;
    const max = step?.maxDays > 0 ? step.maxDays : 0;
    if (min && max && max !== min) return `${min}–${max} days`;
    if (min) return `${min} day${min === 1 ? '' : 's'}`;
    if (max) return `up to ${max} days`;
    return '';
}

/**
 * Where a batch's pre-sowing treatment stands on `today`.
 * Returns null for a batch without treatment steps.
 *
 * {
 *   steps: [{ ...step, index, start, end, minEnd, maxEnd, state }]   state: done | active | pending
 *   activeIndex    index of the active step, or -1
 *   isLastActive   the active step is the last step with a duration (sowing comes next)
 *   nextIndex      the step "Start next step" would begin, or -1
 *   dayOfStep      days into the active step
 *   treatmentEnd   when the treatment ends at the earliest (projected)
 *   sowFrom        max(treatmentEnd, sowNotBefore)
 *   sowBy          the last step's maximum, if it has one
 *   nextCheck      date the next check falls due
 *   checkDue       today >= nextCheck
 *   state          in-progress | step-due | waiting | ready-to-sow | overdue
 * }
 */
export function pretreatmentStatus(batch, today) {
    if (!hasPretreatment(batch)) return null;
    const pt = batch.pretreatment;

    let cursor      = batch.startDate || today;
    let activeIndex = -1;
    const steps = pt.steps.map((s, index) => {
        const start  = cursor;
        const days   = s.days > 0 ? s.days : 0;
        const minEnd = addDays(start, days);
        const maxEnd = s.maxDays > 0 ? addDays(start, s.maxDays) : null;
        let state, end;
        if (activeIndex !== -1) {
            state = 'pending';
            end   = null;
            cursor = minEnd;
        } else if (s.endDate) {
            state = 'done';
            end   = s.endDate;
            cursor = end;
        } else if (days === 0) {
            state = 'done';
            end   = start;
            cursor = end;
        } else {
            state = 'active';
            end   = null;
            activeIndex = index;
            // If the minimum has already passed, what follows starts today at the earliest.
            cursor = maxDate(minEnd, today);
        }
        return { ...s, index, start, end, minEnd, maxEnd, state };
    });

    const active       = activeIndex !== -1 ? steps[activeIndex] : null;
    const laterTimed   = active ? steps.slice(activeIndex + 1).some(s => s.days > 0) : false;
    const isLastActive = !!active && !laterTimed;
    const nextIndex    = active && activeIndex + 1 < steps.length ? activeIndex + 1 : -1;

    const treatmentEnd = cursor;
    const sowFrom      = maxDate(treatmentEnd, pt.sowNotBefore || null);
    const lastTimed    = [...steps].reverse().find(s => s.days > 0 || s.maxDays > 0);
    const sowBy        = lastTimed?.maxEnd || null;

    // The check clock restarts on every check and whenever a step begins.
    const clockFrom = maxDate(pt.lastCheckDate || null, active ? active.start : treatmentEnd);
    const nextCheck = addDays(clockFrom, pt.checkEveryDays > 0 ? pt.checkEveryDays : DEFAULT_CHECK_EVERY_DAYS);

    let state;
    if (active && active.maxEnd && today > active.maxEnd) state = 'overdue';
    else if (active && !isLastActive)                    state = today >= active.minEnd ? 'step-due' : 'in-progress';
    else if (today >= sowFrom)                           state = 'ready-to-sow';
    else if (!active || today >= active.minEnd)          state = 'waiting';
    else                                                 state = 'in-progress';

    return {
        steps,
        activeIndex,
        isLastActive,
        nextIndex,
        dayOfStep: active ? Math.max(0, daysBetween(active.start, today)) : null,
        treatmentEnd,
        sowFrom,
        sowBy,
        nextCheck,
        checkDue: today >= nextCheck,
        state,
    };
}

/** True when a pre-sowing batch wants attention today. */
export function pretreatmentNeedsAttention(batch, today) {
    if (batch?.stage !== 'pre-sowing') return false;
    const st = pretreatmentStatus(batch, today);
    return !!st && (st.checkDue || (st.state !== 'in-progress' && st.state !== 'waiting'));
}

// ---------- Batch updates (partial documents for updateNurseryBatch) ----------

/** Record a check on `date`. Never moves the clock backwards. */
export function checkUpdates(batch, date) {
    const pt = batch.pretreatment;
    return { pretreatment: { ...pt, lastCheckDate: maxDate(pt.lastCheckDate || null, date) } };
}

/** End the active step on `date`; the next step begins the same day. */
export function nextStepUpdates(batch, date) {
    const st = pretreatmentStatus(batch, date);
    const pt = batch.pretreatment;
    const steps = pt.steps.map((s, i) => (i === st?.activeIndex ? { ...s, endDate: date } : s));
    return { pretreatment: { ...pt, steps, lastCheckDate: date } };
}

/** Sow on `date`: close the active step, record the sowing, move to Propagating. */
export function sowUpdates(batch, date) {
    const pt = batch.pretreatment;
    if (!pt) return { stage: 'propagating', sownDate: date };
    const st = pretreatmentStatus(batch, date);
    const steps = pt.steps.map((s, i) => (i === st?.activeIndex && !s.endDate ? { ...s, endDate: date } : s));
    return { stage: 'propagating', sownDate: date, pretreatment: { ...pt, steps } };
}
