// =============================================================
//  germination.js — Seed counts and germination
//
//  Pure logic, deliberately free of imports (no Firebase, no DOM), so it
//  can be loaded by Node to test the arithmetic. db.js imports it for
//  formatBatchQty() and recomputeBatchState().
//
//  Seed is often too fine to count, so a seed batch has no plant count
//  until seedlings come up:
//
//    seedCount:      number | null   seeds sown, if they were counted
//    startQty:       number | null   null until germination is recorded
//    germinatedDate: 'YYYY-MM-DD' | null   the first time seedlings were counted
//
//  Once counted, a seed batch is an ordinary batch: startQty is every
//  seedling that has come up, and currentQty is derived from it as usual
//  (see "Batch quantities" in apps/nursery/CLAUDE.md). Recording
//  germination again as more appear replaces the count.
// =============================================================

export function isSeedBatch(batch) {
    return batch?.method === 'seed';
}

/**
 * True while a seed batch has no plant count: before sowing, or sown but
 * not yet counted. Such a batch cannot lose plants, record outcomes, or
 * complete itself by reaching zero.
 */
export function isUncounted(batch) {
    return isSeedBatch(batch) && (batch.stage === 'pre-sowing' || batch.startQty == null);
}

/**
 * Seeds sown, or null if they weren't counted. A pre-sowing batch created
 * before seed counts existed had its seed count typed into "starting
 * quantity", so that stands in for it.
 */
export function seedsOf(batch) {
    if (batch?.seedCount > 0) return batch.seedCount;
    if (isSeedBatch(batch) && batch.stage === 'pre-sowing' && batch.startQty > 0) return batch.startQty;
    return null;
}

/** Seedlings as a percentage of seeds sown, or null without both counts. */
export function germinationRate(batch) {
    if (!(batch?.seedCount > 0) || isUncounted(batch)) return null;
    return Math.round((batch.startQty / batch.seedCount) * 100);
}

/** "12 of 40 seeds (30%)", "12 seedlings", or '' before germination. */
export function germinationText(batch) {
    if (isUncounted(batch) || batch?.startQty == null) return '';
    const n    = batch.startQty;
    const rate = germinationRate(batch);
    return rate == null
        ? `${n} seedling${n === 1 ? '' : 's'}`
        : `${n} of ${batch.seedCount} seed${batch.seedCount === 1 ? '' : 's'} (${rate}%)`;
}

/** Quantity text for a seed batch with no plant count. */
export function uncountedQtyText(batch) {
    const seeds  = seedsOf(batch);
    const plural = seeds === 1 ? '' : 's';
    if (batch?.stage === 'pre-sowing') return seeds ? `${seeds} seed${plural}` : '—';
    return seeds ? `${seeds} seed${plural} sown · not counted` : 'Sown · not counted';
}

// ---------- Batch updates (partial documents for updateNurseryBatch) ----------

/**
 * Record `count` seedlings in the tray on `date`.
 *
 * `lost` and `allocated` are the batch's totals so far (log losses, outcome
 * quantities). A seedling that came up and was later thinned, lost or
 * planted out still germinated, so startQty is the tray count plus those —
 * which keeps currentQty equal to `count`, and keeps the germination rate
 * honest. The count replaces any earlier hand correction.
 */
export function germinationUpdates(batch, { count, lost = 0, allocated = 0, date }) {
    const updates = {
        startQty:       count + lost + allocated,
        currentQty:     count,
        qtyAdjustment:  0,
        germinatedDate: batch.germinatedDate && batch.germinatedDate < date ? batch.germinatedDate : date,
    };
    // Nothing came up at all: leave the stage, and let recomputeBatchState close it as lost.
    if (updates.startQty > 0 && (!batch.stage || batch.stage === 'propagating')) updates.stage = 'rooted';
    return updates;
}

/**
 * Sowing a seed batch: record the seeds sown (typed, or carried over) and
 * clear any plant count, which a batch cannot have before it germinates.
 */
export function sownSeedUpdates(batch, seedCount) {
    if (!isSeedBatch(batch)) return {};
    return {
        seedCount:     seedCount > 0 ? seedCount : seedsOf(batch),
        startQty:      null,
        currentQty:    null,
        qtyAdjustment: 0,
    };
}
