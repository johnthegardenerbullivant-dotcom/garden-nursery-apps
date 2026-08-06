// =============================================================
//  batches-view.js — Re-exports public API for main.js
//  Implementation split across batch-list.js / batch-detail.js
//  and their sub-modules (batch-form, batch-log-*, batch-photos,
//  batch-outcomes).
// =============================================================

export { renderBatchesList } from './batch-list.js';
export { renderBatchDetail  } from './batch-detail.js';
