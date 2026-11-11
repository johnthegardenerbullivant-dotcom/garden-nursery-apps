// Nursery's pure logic: pre-sowing treatment, germination counts, and
// matching a batch to Garden plants at plant-out.
// Run every test file with:   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    addDays, daysBetween, stepDurationText, initialStage,
    pretreatmentStatus, pretreatmentNeedsAttention,
    advanceStepUpdates, checkUpdates, sowUpdates,
} from '../apps/nursery/js/pretreatment.js';
import {
    isUncounted, seedsOf, germinationRate, germinationText, uncountedQtyText,
    germinationUpdates, sownSeedUpdates,
} from '../apps/nursery/js/germination.js';
import { matchGardenPlants } from '../apps/nursery/js/plant-match.js';

// ---------------------------------------------------------- pre-sowing treatment

test('date arithmetic on YYYY-MM-DD, across month ends and DST', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-03-07', 1), '2026-03-08', 'the day US clocks go forward');
    assert.equal(addDays('2026-01-02', 90), '2026-04-02');
    assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59);
    assert.equal(daysBetween('2026-03-01', '2026-01-01'), -59);
});

test('step durations as text', () => {
    assert.equal(stepDurationText({ days: 90, maxDays: 120 }), '90–120 days');
    assert.equal(stepDurationText({ days: 1 }), '1 day');
    assert.equal(stepDurationText({ maxDays: 30 }), 'up to 30 days');
    assert.equal(stepDurationText({}), '');
});

// Clean the seed, then 90 to 120 days of cold stratification.
const plan = (steps, extra = {}) => ({
    stage: 'pre-sowing', method: 'seed',
    pretreatment: { steps, checkEveryDays: 14, ...extra },
});
const clean = (d) => ({ type: 'clean', startDate: d ?? null, endDate: d ?? null });
const cold  = (start = null, end = null) => ({ type: 'cold-moist', days: 90, maxDays: 120, startDate: start, endDate: end });

test('a plan nobody has started', () => {
    const st = pretreatmentStatus(plan([clean(), cold()]), '2026-01-01');
    assert.equal(st.state, 'not-started');
    assert.equal(st.nextIndex, 0);
    assert.equal(st.sowFrom, null);
    assert.equal(st.sowFromDays, 90);
    assert.equal(st.sowFromAfter, 'Cold moist stratification');
    assert.equal(initialStage(plan([clean()])), 'pre-sowing');
    assert.equal(initialStage({}), 'propagating');
});

test('stratification running: in progress, then ready, then overdue', () => {
    const batch = plan([clean('2026-01-01'), cold('2026-01-02')]);
    const mid = pretreatmentStatus(batch, '2026-02-01');
    assert.equal(mid.state, 'in-progress');
    assert.equal(mid.activeIndex, 1);
    assert.equal(mid.dayOfStep, 30);
    assert.equal(mid.sowFrom, '2026-04-02');
    assert.equal(mid.sowBy, '2026-05-02');
    assert.equal(mid.nextCheck, '2026-01-16', 'two weeks after the step started');
    assert.equal(mid.checkDue, true);

    assert.equal(pretreatmentStatus(batch, '2026-04-10').state, 'ready-to-sow');
    assert.equal(pretreatmentStatus(batch, '2026-05-03').state, 'overdue');
});

test('a check moves the next one two weeks on, and never backwards', () => {
    const batch = plan([cold('2026-01-02')]);
    const checked = { ...batch, ...checkUpdates(batch, '2026-01-20') };
    assert.equal(pretreatmentStatus(checked, '2026-01-25').nextCheck, '2026-02-03');
    assert.equal(pretreatmentStatus(checked, '2026-01-25').checkDue, false);
    const again = { ...checked, ...checkUpdates(checked, '2026-01-10') };
    assert.equal(again.pretreatment.lastCheckDate, '2026-01-20');
});

test('needs attention only while pre-sowing and something is due', () => {
    const batch = plan([clean('2026-01-01'), cold('2026-01-02')]);
    assert.equal(pretreatmentNeedsAttention(batch, '2026-04-10'), true);
    assert.equal(pretreatmentNeedsAttention({ ...batch, stage: 'propagating' }, '2026-04-10'), false);
    assert.equal(pretreatmentNeedsAttention(plan([clean(), cold()]), '2026-04-10'), false, 'not started never asks');
});

test('marking, then sowing', () => {
    const batch = plan([clean('2026-01-01'), cold()]);
    const started = { ...batch, ...advanceStepUpdates(batch, 1, '2026-01-05') };
    assert.equal(started.pretreatment.steps[1].startDate, '2026-01-05');
    assert.equal(started.pretreatment.steps[1].endDate, null, 'a timed step runs until it is ended');
    assert.equal(started.pretreatment.lastCheckDate, '2026-01-05');

    const sown = sowUpdates(started, '2026-04-20');
    assert.equal(sown.stage, 'propagating');
    assert.equal(sown.sownDate, '2026-04-20');
    assert.equal(sown.pretreatment.steps[1].endDate, '2026-04-20', 'sowing ends the running step');
    assert.deepEqual(sowUpdates({}, '2026-04-20'), { stage: 'propagating', sownDate: '2026-04-20' });
});

// ---------------------------------------------------------- germination

test('a seed batch has no plant count until germination is recorded', () => {
    assert.equal(isUncounted({ method: 'seed', stage: 'pre-sowing', startQty: 40 }), true);
    assert.equal(isUncounted({ method: 'seed', stage: 'propagating', startQty: null }), true);
    assert.equal(isUncounted({ method: 'seed', stage: 'propagating', startQty: 12 }), false);
    assert.equal(isUncounted({ method: 'cutting', startQty: null }), false);
});

test('seeds sown, including the older pre-sowing records', () => {
    assert.equal(seedsOf({ seedCount: 40 }), 40);
    assert.equal(seedsOf({ method: 'seed', stage: 'pre-sowing', startQty: 25 }), 25);
    assert.equal(seedsOf({ method: 'seed', stage: 'propagating', startQty: 25 }), null);
    assert.equal(uncountedQtyText({ method: 'seed', stage: 'pre-sowing', seedCount: 1 }), '1 seed');
    assert.equal(uncountedQtyText({ method: 'seed', stage: 'propagating' }), 'Sown · not counted');
});

test('germination rate and text', () => {
    const b = { method: 'seed', stage: 'rooted', seedCount: 40, startQty: 12 };
    assert.equal(germinationRate(b), 30);
    assert.equal(germinationText(b), '12 of 40 seeds (30%)');
    assert.equal(germinationText({ method: 'seed', stage: 'rooted', startQty: 1 }), '1 seedling');
    assert.equal(germinationText({ method: 'seed', stage: 'propagating', startQty: null }), '');
});

test('recording germination counts seedlings already lost or planted out', () => {
    const u = germinationUpdates({ stage: 'propagating' }, { count: 10, lost: 2, allocated: 3, date: '2026-05-01' });
    assert.deepEqual(u, { startQty: 15, currentQty: 10, qtyAdjustment: 0, germinatedDate: '2026-05-01', stage: 'rooted' });
    const again = germinationUpdates({ stage: 'rooted', germinatedDate: '2026-04-20' }, { count: 14, date: '2026-05-01' });
    assert.equal(again.germinatedDate, '2026-04-20', 'the first date is kept');
    assert.equal(again.stage, undefined, 'only moves on from propagating');
    assert.equal(germinationUpdates({ stage: 'propagating' }, { count: 0, date: '2026-05-01' }).stage, undefined,
        'nothing came up: the stage is left for recomputeBatchState');
});

test('sowing clears any plant count', () => {
    assert.deepEqual(sownSeedUpdates({ method: 'seed', stage: 'pre-sowing', startQty: 30 }, 0),
        { seedCount: 30, startQty: null, currentQty: null, qtyAdjustment: 0 });
    assert.deepEqual(sownSeedUpdates({ method: 'cutting' }, 10), {});
});

// ---------------------------------------------------------- plant-out matching

const garden = [
    { id: 'a', genus: 'Acer', species: 'palmatum' },
    { id: 'b', genus: 'Acer', species: 'palmatum', cultivar: 'Bloodgood', authority: 'Thunb.' },
    { id: 'c', genus: 'Syringa', species: 'prestoniae', cultivar: 'Jeftini' },
    { id: 'd', commonName: 'Pinktini Lilac' },
];
const ids = list => list.map(p => p.id);

test('a batch matches the same plant, ignoring case, quotes, × and authority', () => {
    assert.deepEqual(ids(matchGardenPlants({ genus: 'acer', species: 'Palmatum', cultivar: "'Bloodgood'" }, garden)), ['b']);
    assert.deepEqual(ids(matchGardenPlants({ genus: 'Syringa', species: '× prestoniae', cultivar: '"Jeftini"' }, garden)), ['c']);
    assert.deepEqual(ids(matchGardenPlants({ genus: 'Acer', species: 'palmatum' }, garden)), ['a'], 'a species is not its cultivar');
});

test('with no genus, the common name decides; with nothing, no match', () => {
    assert.deepEqual(ids(matchGardenPlants({ commonName: 'pinktini  lilac' }, garden)), ['d']);
    assert.deepEqual(matchGardenPlants({}, garden), []);
    assert.deepEqual(matchGardenPlants(null, garden), []);
});
