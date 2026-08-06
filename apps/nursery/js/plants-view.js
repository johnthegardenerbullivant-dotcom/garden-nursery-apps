// =============================================================
//  plants-view.js — Propagated plants list & history per plant
// =============================================================

import { getNurseryBatches, escHtml, fmtDate, METHOD_LABELS, STAGE_LABELS, formatBatchQty, formatBotanicalName } from './db.js';
import { navigate, goBack } from './ui-utils.js';

export async function renderPropagatedPlants(container, headerActionEl, backBtn) {
    backBtn.classList.remove('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading…</p></div>`;

    let batches = [];
    try {
        batches = await getNurseryBatches();
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading data.</p></div>`;
        return;
    }

    if (batches.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div style="font-size:2.5rem;margin-bottom:12px;">🌸</div>
                <h2 style="font-size:1rem;color:var(--green-800);margin-bottom:8px;">No plants yet</h2>
                <p style="color:var(--grey-600);max-width:260px;margin:0 auto;">
                    Once you start propagation batches, each plant species will appear here with its history and success rate.
                </p>
            </div>`;
        return;
    }

    // Group batches by plant name (keyed on plantId if set, else plantName)
    const plantMap = {};
    for (const b of batches) {
        const key = b.plantId || b.plantName || 'Unknown';
        if (!plantMap[key]) {
            plantMap[key] = {
                plantId:      b.plantId || null,
                plantName:    b.plantName || 'Unknown',
                botanicalName: b.botanicalName || '',
                // Carry botanical parts so the display name can be recomputed
                // with correct hybrid × placement.
                genus: b.genus, species: b.species, subspecies: b.subspecies,
                variety: b.variety, cultivar: b.cultivar, authority: b.authority,
                hybrid: b.hybrid, hybridType: b.hybridType, commonName: b.commonName,
                batches:      []
            };
        }
        plantMap[key].batches.push(b);
    }

    // Sort plant groups by name
    const plants = Object.values(plantMap).sort((a, b) =>
        a.plantName.localeCompare(b.plantName)
    );

    container.innerHTML = `
        <div class="view-content">
            <div class="search-bar">
                <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input class="search-input" id="plant-search" placeholder="Search plants…" autocomplete="off">
                <button class="search-clear" id="plant-search-clear" title="Clear search" style="display:none;">✕</button>
            </div>
            <div id="plants-list">
                ${plants.map(p => plantCard(p)).join('')}
            </div>
        </div>
    `;

    // Search
    const searchInput = container.querySelector('#plant-search');
    const plantClearBtn = container.querySelector('#plant-search-clear');
    const listEl      = container.querySelector('#plants-list');

    function doPlantSearch() {
        const q = searchInput.value.toLowerCase().trim();
        if (plantClearBtn) plantClearBtn.style.display = q ? 'flex' : 'none';
        const filtered = q ? plants.filter(p =>
            p.plantName.toLowerCase().includes(q) ||
            p.botanicalName.toLowerCase().includes(q)
        ) : plants;
        listEl.innerHTML = filtered.length
            ? filtered.map(p => plantCard(p)).join('')
            : `<div class="empty-state"><p>No plants matching "${escHtml(q)}"</p></div>`;
        attachPlantClicks(listEl);
    }

    searchInput?.addEventListener('input', doPlantSearch);
    plantClearBtn?.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        plantClearBtn.style.display = 'none';
        searchInput?.focus();
        doPlantSearch();
    });

    attachPlantClicks(container.querySelector('#plants-list'));
}

function plantCard(p) {
    const total     = p.batches.length;
    const completed = p.batches.filter(b => b.stage === 'completed');
    const active    = p.batches.filter(b => b.stage !== 'completed');
    const succeeded = completed.filter(b => b.outcome && b.outcome !== 'lost');
    const rate      = completed.length > 0
        ? Math.round(succeeded.length / completed.length * 100) : null;

    // Most used method
    const methodCounts = {};
    for (const b of p.batches) methodCounts[b.method] = (methodCounts[b.method] || 0) + 1;
    const topMethod = Object.entries(methodCounts).sort(([,a],[,b]) => b-a)[0]?.[0];

    return `
        <div class="plant-card card-item" data-key="${escHtml(p.plantId || p.plantName)}">
            <div class="plant-card-main">
                <div>
                    <div class="plant-card-name">${escHtml(formatBotanicalName(p) || p.plantName)}</div>
                    ${p.commonName && p.commonName !== (formatBotanicalName(p) || p.plantName) ? `<div class="plant-card-botanical">${escHtml(p.commonName)}</div>` : ''}
                </div>
                <div class="plant-card-rate ${rate !== null ? (rate >= 70 ? 'good' : rate >= 40 ? 'ok' : 'poor') : ''}">${rate !== null ? rate + '%' : '—'}</div>
            </div>
            <div class="plant-card-meta">
                ${total} batch${total !== 1 ? 'es' : ''}
                · ${active.length} active
                ${topMethod ? `· <span class="method-badge">${escHtml(METHOD_LABELS[topMethod] || topMethod)}</span>` : ''}
            </div>
        </div>
    `;
}

function attachPlantClicks(listEl) {
    listEl?.querySelectorAll('.plant-card[data-key]').forEach(card => {
        card.addEventListener('click', () => navigate('plant-prop-history', card.dataset.key));
    });
}

// =============================================
//  Plant propagation history detail
// =============================================

export async function renderPlantPropHistory(container, headerActionEl, backBtn, key) {
    backBtn.classList.add('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading…</p></div>`;

    let batches = [];
    try {
        const all = await getNurseryBatches();
        batches = all.filter(b => (b.plantId || b.plantName) === key);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading data.</p></div>`;
        return;
    }

    if (batches.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No batches found for this plant.</p></div>`;
        return;
    }

    // Display name computed from parts (correct hybrid × placement); common name as subtitle.
    const plantName    = formatBotanicalName(batches[0]) || batches[0].plantName || 'Unknown';
    const botanicalName = (batches[0].commonName && batches[0].commonName !== plantName) ? batches[0].commonName : '';
    const active       = batches.filter(b => b.stage !== 'completed');
    const completed    = batches.filter(b => b.stage === 'completed');
    const succeeded    = completed.filter(b => b.outcome && b.outcome !== 'lost');
    const rate         = completed.length > 0
        ? Math.round(succeeded.length / completed.length * 100) : null;

    // Best method
    const succMethodCounts = {};
    for (const b of succeeded) succMethodCounts[b.method] = (succMethodCounts[b.method] || 0) + 1;
    const bestMethod = Object.entries(succMethodCounts).sort(([,a],[,b]) => b-a)[0]?.[0];

    backBtn.classList.add('visible');
    headerActionEl.innerHTML = '';

    container.innerHTML = `
        <div class="view-content">
            <div class="detail-header-card">
                <h2 class="detail-plant-name">${escHtml(plantName)}</h2>
                ${botanicalName && botanicalName !== plantName ? `<p class="detail-botanical">${escHtml(botanicalName)}</p>` : ''}
                <div class="detail-stats-row">
                    <div class="detail-stat"><span class="detail-stat-num">${batches.length}</span><span class="detail-stat-label">Batches</span></div>
                    <div class="detail-stat"><span class="detail-stat-num">${active.length}</span><span class="detail-stat-label">Active</span></div>
                    <div class="detail-stat"><span class="detail-stat-num ${rate !== null ? (rate >= 70 ? 'good' : rate >= 40 ? 'ok' : 'poor') : ''}">${rate !== null ? rate + '%' : '—'}</span><span class="detail-stat-label">Success rate</span></div>
                </div>
                ${bestMethod ? `<p class="detail-best-method">Best method: <span class="method-badge">${escHtml(METHOD_LABELS[bestMethod] || bestMethod)}</span></p>` : ''}
            </div>

            <h3 class="section-heading" style="margin-top:20px;">All batches</h3>
            <div class="batch-list">
                ${batches.sort((a,b) => (b.startDate||'').localeCompare(a.startDate||'')).map(b => `
                    <div class="batch-row card-item" data-id="${escHtml(b.id)}">
                        <div class="batch-row-main">
                            <span class="method-badge">${escHtml(METHOD_LABELS[b.method] || b.method || '—')}</span>
                            <span class="stage-badge stage-${escHtml(b.stage || 'propagating')}">${STAGE_LABELS[b.stage] || b.stage || '—'}</span>
                        </div>
                        <div class="batch-row-meta">
                            <span class="batch-row-date">Started ${fmtDate(b.startDate)}</span>
                            <span class="batch-row-qty">${formatBatchQty(b, { noun: true })}</span>
                            ${b.stage === 'completed' && b.outcome ? `<span class="outcome-chip outcome-${b.outcome}">${outcomeLabel(b.outcome)}</span>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    container.querySelectorAll('.batch-row[data-id]').forEach(row => {
        row.addEventListener('click', () => navigate('batch-detail', row.dataset.id));
    });
}

function outcomeLabel(outcome) {
    const map = { 'planted-out': '🏡 Planted out', 'given-away': '🎁 Given away', 'lost': '💀 Lost', 'mixed': '↗️ Mixed' };
    return map[outcome] || outcome;
}
