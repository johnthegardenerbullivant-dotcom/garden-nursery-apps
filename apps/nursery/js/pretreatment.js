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
//      steps: [{ type, days, maxDays, notes, startDate, endDate }],
//      checkEveryDays: 14,
//      sowNotBefore:   'YYYY-MM-DD' | null,
//      lastCheckDate:  'YYYY-MM-DD' | null,
//    }
//    sownDate: 'YYYY-MM-DD' | null        (top level on the batch)
//
//  Saving the batch saves a PLAN: nothing has started. Each step is marked
//  by hand, in order, on the day it is done —
//    • a one-off step (no minimum `days`: cleaning, scarifying, soaking) is
//      "Mark done": startDate = endDate = that day
//    • a timed step (stratification) is "Start": startDate set, and it runs
//      until the next step is marked, "Finish" is pressed, or the seed is sown
//  Nothing about a reminder is stored. Every date below is derived, so a
//  step started late, finished early or sown early leaves nothing stale.
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
const minDate = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));

export function hasPretreatment(batch) {
    return !!(batch?.pretreatment?.steps?.length);
}

/** A step with a minimum number of days runs over time; one without is done on the day. */
export function isTimed(step) {
    return step?.days > 0;
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
 *   activeIndex   the timed step now running, or -1
 *   nextIndex     the first step not yet done or started, or -1
 *   started       any step has been marked
 *   firstStart    the date the first step was marked
 *   lastDate      the latest date on any step — nothing new can be marked before it
 *   pendingTimed  a timed step has still to be started
 *   dayOfStep     days into the active step
 *   sowFrom       the earliest sowing date, or null while a timed step has not started
 *   sowFromDays / sowFromAfter   "N days after <step> starts", when sowFrom is null for that reason
 *   sowBy         the running last timed step's maximum, if it has one
 *   nextCheck     when the next check falls due — only while a timed step is running
 *   checkDue      today >= nextCheck
 *   state         not-started | in-progress | step-due | between-steps | waiting | ready-to-sow | overdue
 * }
 */
export function pretreatmentStatus(batch, today) {
    if (!hasPretreatment(batch)) return null;
    const pt = batch.pretreatment;

    const steps = pt.steps.map((s, index) => {
        let start = s.startDate || s.endDate || null;
        let end   = s.endDate || null;
        if (start && !end && !isTimed(s)) end = start;      // a one-off is done the day it is marked
        const state  = end ? 'done' : start ? 'active' : 'pending';
        const minEnd = start && isTimed(s) ? addDays(start, s.days) : null;
        const maxEnd = start && s.maxDays > 0 ? addDays(start, s.maxDays) : null;
        return { ...s, index, start, end, minEnd, maxEnd, state };
    });

    const activeIndex = steps.findIndex(s => s.state === 'active');
    const active      = activeIndex !== -1 ? steps[activeIndex] : null;
    const nextIndex   = steps.findIndex(s => s.state === 'pending');
    const started     = steps.some(s => s.start);
    const firstStart  = steps.reduce((d, s) => minDate(d, s.start), null);
    const lastDate    = steps.reduce((d, s) => maxDate(d, maxDate(s.start, s.end)), null);
    const pendingSteps = steps.filter(s => s.state === 'pending' && isTimed(s));
    const pendingTimed = pendingSteps.length > 0;

    // Sowing can only be dated once every timed step has at least started.
    let sowFrom = null, sowFromDays = null, sowFromAfter = null;
    if (pendingTimed) {
        sowFromDays  = pendingSteps.reduce((n, s) => n + s.days, 0);
        sowFromAfter = stepLabel(pendingSteps[0]);
    } else {
        const lastTimedDone = [...steps].reverse().find(s => isTimed(s) && s.end);
        const base = active ? active.minEnd
                   : lastTimedDone ? lastTimedDone.end
                   : started ? lastDate : null;
        sowFrom = maxDate(base, pt.sowNotBefore || null);
    }
    const sowBy = active && !pendingTimed ? active.maxEnd : null;

    const nextCheck = active
        ? addDays(maxDate(pt.lastCheckDate || null, active.start), pt.checkEveryDays > 0 ? pt.checkEveryDays : DEFAULT_CHECK_EVERY_DAYS)
        : null;

    let state;
    if (!started)                                        state = 'not-started';
    else if (active && active.maxEnd && today > active.maxEnd) state = 'overdue';
    else if (active && today < active.minEnd)            state = 'in-progress';
    else if (pendingTimed)                               state = active ? 'step-due' : 'between-steps';
    else if (!sowFrom || today >= sowFrom)               state = 'ready-to-sow';
    else                                                 state = 'waiting';

    return {
        steps,
        activeIndex,
        nextIndex,
        started,
        firstStart,
        lastDate,
        pendingTimed,
        dayOfStep: active ? Math.max(0, daysBetween(active.start, today)) : null,
        sowFrom,
        sowFromDays,
        sowFromAfter,
        sowBy,
        nextCheck,
        checkDue: !!nextCheck && today >= nextCheck,
        state,
    };
}

/**
 * True when a pre-sowing batch wants attention today. A plan that has not
 * been started, or a gap between steps, never asks — only a running timed
 * step can fall due.
 */
export function pretreatmentNeedsAttention(batch, today) {
    if (batch?.stage !== 'pre-sowing') return false;
    const st = pretreatmentStatus(batch, today);
    return !!st && (st.checkDue || ['step-due', 'ready-to-sow', 'overdue'].includes(st.state));
}

/**
 * The dates a step's own dates must stay between, so the steps stay in order:
 * no earlier than anything on an earlier step, no later than the start of a later one.
 */
export function stepDateBounds(st, index) {
    let min = null, max = null;
    for (const s of st.steps) {
        if (s.index < index) min = maxDate(min, maxDate(s.start, s.end));
        if (s.index > index) max = minDate(max, s.start);
    }
    return { min, max };
}

// ---------- Batch updates (partial documents for updateNurseryBatch) ----------

function updateSteps(batch, fn, extra = {}) {
    const pt = batch.pretreatment;
    return { pretreatment: { ...pt, ...extra, steps: pt.steps.map(fn) } };
}

/** Record a check on `date`. Never moves the clock backwards. */
export function checkUpdates(batch, date) {
    const pt = batch.pretreatment;
    return { pretreatment: { ...pt, lastCheckDate: maxDate(pt.lastCheckDate || null, date) } };
}

/**
 * Mark step `index` on `date`: a one-off is done, a timed step starts.
 * A timed step still running before it ends the same day.
 */
export function advanceStepUpdates(batch, index, date) {
    const st = pretreatmentStatus(batch, date);
    return updateSteps(batch, (s, i) => {
        if (i === index)          return { ...s, startDate: date, endDate: isTimed(s) ? null : date };
        if (i === st.activeIndex) return { ...s, endDate: date };
        return s;
    }, { lastCheckDate: date });
}

/** End the running timed step on `date` without starting another. */
export function finishStepUpdates(batch, date) {
    const st = pretreatmentStatus(batch, date);
    return updateSteps(batch, (s, i) => (i === st.activeIndex ? { ...s, endDate: date } : s));
}

/** Correct a marked step's dates. */
export function setStepDatesUpdates(batch, index, { startDate, endDate }) {
    return updateSteps(batch, (s, i) => (i === index ? { ...s, startDate, endDate } : s));
}

/** Put a step back to not done. */
export function undoStepUpdates(batch, index) {
    return updateSteps(batch, (s, i) => (i === index ? { ...s, startDate: null, endDate: null } : s));
}

/** Sow on `date`: end the running step, record the sowing, move to Propagating. */
export function sowUpdates(batch, date) {
    if (!batch.pretreatment) return { stage: 'propagating', sownDate: date };
    const st = pretreatmentStatus(batch, date);
    return {
        stage: 'propagating',
        sownDate: date,
        ...updateSteps(batch, (s, i) => (i === st?.activeIndex ? { ...s, endDate: date } : s)),
    };
}
