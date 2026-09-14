// =============================================================
//  plant-match.js — Garden plants that are the same plant as a batch
//  No imports, so Node can load it to test the matching.
// =============================================================

// Lower case, with quote marks and the hybrid × dropped and spaces collapsed,
// so 'Sundance', "Sundance" and sundance all compare equal.
function norm(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/['"‘’“”×]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

const PARTS = ['genus', 'species', 'subspecies', 'variety', 'cultivar'];

/**
 * Garden plants that are the same plant as `batch`, offered at plant-out so a
 * second planting doesn't create a second Garden record.
 *
 * A batch with a genus matches on every botanical part — a species and one of
 * its cultivars are different plants — ignoring case, quote marks, the hybrid ×
 * and the authority. A batch with no genus matches its common name (or failing
 * that its name) against the plant's common name. Returns [] when there is
 * nothing to match on.
 */
export function matchGardenPlants(batch, plants) {
    if (!batch || !Array.isArray(plants)) return [];
    if (norm(batch.genus)) {
        return plants.filter(p => PARTS.every(k => norm(p[k]) === norm(batch[k])));
    }
    const name = norm(batch.commonName || batch.plantName);
    if (!name) return [];
    return plants.filter(p => norm(p.commonName) === name);
}
