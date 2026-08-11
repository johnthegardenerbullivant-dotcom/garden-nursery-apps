// =============================================================
//  plans-view.js — Propagation Planning Tool
// =============================================================

import {
    getNurseryPlans, addNurseryPlan, updateNurseryPlan, deleteNurseryPlan,
    getGardenPlants, getGardenAreas,
    PLAN_METHOD_LABELS, PLAN_TIMING_OPTIONS, PLAN_STATUS_LABELS,
    escHtml
} from './db.js';
import { showModal, hideModal, showToast, navigate } from './ui-utils.js';
import { isAtLeast } from './auth.js';

// =============================================
//  Status config
// =============================================

const STATUS_CONFIG = {
    idea:    { label: 'Idea',    emoji: '💡', colour: 'var(--grey-600)',  bg: 'var(--grey-100)' },
    planned: { label: 'Planned', emoji: '📅', colour: '#c47500',         bg: '#fff4ec' },
    done:    { label: 'Done',    emoji: '✅', colour: 'var(--green-700)', bg: 'var(--green-100)' }
};

const SEASON_EMOJI = { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Winter: '❄️' };

// =============================================
//  Plans List View
// =============================================

export async function renderPlansView(container, headerActionEl, backBtn) {
    backBtn.classList.remove('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();
    container.innerHTML = `<div class="loading-state"><div class="leaf-spinner">🌱</div><p>Loading plans…</p></div>`;

    let plans = [];
    try {
        plans = await getNurseryPlans();
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading plans.</p></div>`;
        return;
    }

    // Filter state
    let filterStatus = 'all';
    let filterSeason = 'all';

    function render() {
        let visible = plans.filter(p => {
            if (filterStatus !== 'all' && p.status !== filterStatus) return false;
            if (filterSeason !== 'all') {
                const timings = p.timing || [];
                const matchesSeason = timings.some(t => {
                    const opt = PLAN_TIMING_OPTIONS.find(o => o.value === t);
                    return opt && opt.season.toLowerCase() === filterSeason;
                });
                if (!matchesSeason) return false;
            }
            return true;
        });

        const seasons = ['spring', 'summer', 'autumn', 'winter'];
        const statusGroups = [
            { key: 'idea',    items: visible.filter(p => p.status === 'idea') },
            { key: 'planned', items: visible.filter(p => p.status === 'planned') },
            { key: 'done',    items: visible.filter(p => p.status === 'done') }
        ].filter(g => g.items.length > 0);

        container.innerHTML = `
            <div class="view-content">

                <!-- Filter chips -->
                <div class="filter-strip" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${['all','idea','planned','done'].map(s => `
                            <button class="filter-chip${filterStatus===s?' active':''}" data-filter-status="${s}" style="
                                padding:5px 12px;border-radius:99px;border:1px solid ${filterStatus===s?'var(--green-700)':'var(--grey-200)'};
                                background:${filterStatus===s?'var(--green-700)':'var(--white)'};
                                color:${filterStatus===s?'var(--white)':'var(--grey-600)'};
                                font-size:0.78rem;font-weight:500;cursor:pointer;">
                                ${s === 'all' ? 'All' : (STATUS_CONFIG[s]?.emoji + ' ' + STATUS_CONFIG[s]?.label)}
                            </button>`).join('')}
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                        ${['all',...seasons].map(s => `
                            <button class="filter-chip${filterSeason===s?' active':''}" data-filter-season="${s}" style="
                                padding:5px 12px;border-radius:99px;border:1px solid ${filterSeason===s?'var(--green-700)':'var(--grey-200)'};
                                background:${filterSeason===s?'var(--green-700)':'var(--white)'};
                                color:${filterSeason===s?'var(--white)':'var(--grey-600)'};
                                font-size:0.78rem;font-weight:500;cursor:pointer;">
                                ${s === 'all' ? '🗓️ Any time' : (SEASON_EMOJI[s.charAt(0).toUpperCase()+s.slice(1)] + ' ' + s.charAt(0).toUpperCase()+s.slice(1))}
                            </button>`).join('')}
                    </div>
                </div>

                ${visible.length === 0 ? `
                    <div class="empty-state" style="padding-top:48px;">
                        <div style="font-size:2.5rem;margin-bottom:12px;">🌿</div>
                        <p style="color:var(--grey-600);">${plans.length === 0 ? 'No plans yet — tap + to add your first propagation idea.' : 'No plans match your filters.'}</p>
                    </div>
                ` : statusGroups.map(g => `
                    <section style="margin-bottom:24px;">
                        <h2 style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--grey-400);margin-bottom:10px;padding:0 2px;">
                            ${STATUS_CONFIG[g.key]?.emoji} ${STATUS_CONFIG[g.key]?.label} (${g.items.length})
                        </h2>
                        <div class="card-list">
                            ${g.items.map(p => planCard(p)).join('')}
                        </div>
                    </section>
                `).join('')}

            </div>
        `;

        // FAB
        if (isAtLeast('editor')) {
            const fab = document.createElement('button');
            fab.className = 'fab';
            fab.setAttribute('aria-label', 'Add propagation plan');
            fab.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
            document.body.appendChild(fab);
            fab.addEventListener('click', () => showPlanForm(null, plans, () => {
                document.querySelector('.fab')?.remove();
                reloadPlans();
            }));
        }

        // Filter chip events
        container.querySelectorAll('[data-filter-status]').forEach(btn => {
            btn.addEventListener('click', () => {
                filterStatus = btn.dataset.filterStatus;
                render();
            });
        });
        container.querySelectorAll('[data-filter-season]').forEach(btn => {
            btn.addEventListener('click', () => {
                filterSeason = btn.dataset.filterSeason;
                render();
            });
        });

        // Card click -> edit; action buttons
        container.querySelectorAll('.plan-card').forEach(card => {
            card.addEventListener('click', e => {
                if (e.target.closest('button')) return;
                const id = card.dataset.id;
                const plan = plans.find(p => p.id === id);
                if (plan) showPlanForm(plan, plans, () => {
                    document.querySelector('.fab')?.remove();
                    reloadPlans();
                });
            });
        });

        container.querySelectorAll('.plan-status-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const id = btn.closest('[data-id]')?.dataset.id;
                const plan = plans.find(p => p.id === id);
                if (!plan) return;
                const cycle = { idea: 'planned', planned: 'done', done: 'idea' };
                const newStatus = cycle[plan.status] || 'idea';
                try {
                    await updateNurseryPlan(id, { status: newStatus });
                    plan.status = newStatus;
                    render();
                } catch (err) {
                    console.error(err);
                    showToast('Could not update status', 'error');
                }
            });
        });

        container.querySelectorAll('.plan-delete-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const id = btn.closest('[data-id]')?.dataset.id;
                const plan = plans.find(p => p.id === id);
                if (!plan) return;
                if (!confirm(`Delete plan for "${plan.plantName}"?`)) return;
                try {
                    await deleteNurseryPlan(id);
                    showToast('Plan deleted', 'success');
                    plans = plans.filter(p => p.id !== id);
                    render();
                } catch (err) {
                    console.error(err);
                    showToast('Could not delete plan', 'error');
                }
            });
        });

        container.querySelectorAll('.plan-start-batch-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.closest('[data-id]')?.dataset.id;
                const plan = plans.find(p => p.id === id);
                if (!plan) return;
                // Navigate to batches with prefilled state stored in sessionStorage
                const prefill = {
                    plantName:  plan.plantName,
                    plantId:    plan.plantId || '',
                    method:     methodToBatchMethod(plan.method),
                    notes:      plan.notes || ''
                };
                sessionStorage.setItem('nursery_batch_prefill', JSON.stringify(prefill));
                navigate('batches');
            });
        });
    }

    async function reloadPlans() {
        plans = await getNurseryPlans();
        render();
    }

    render();
}

// =============================================
//  Plan card
// =============================================

function planCard(plan) {
    const sc = STATUS_CONFIG[plan.status] || STATUS_CONFIG.idea;
    const timingLabels = (plan.timing || [])
        .map(t => PLAN_TIMING_OPTIONS.find(o => o.value === t)?.label || t)
        .join(' · ');
    const methodLabel = PLAN_METHOD_LABELS[plan.method] || plan.method || '—';
    const sourceText = planSourceText(plan);

    return `
        <div class="card plan-card" data-id="${escHtml(plan.id)}" style="padding:14px 16px;margin-bottom:10px;">
            <div style="display:flex;align-items:flex-start;gap:12px;">
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
                        <span style="font-weight:600;font-size:1rem;color:var(--grey-800);">${escHtml(plan.plantName)}</span>
                        <button class="plan-status-btn" title="Click to cycle status" style="
                            background:${sc.bg};color:${sc.colour};
                            border:none;cursor:pointer;padding:2px 8px;border-radius:99px;
                            font-size:0.72rem;font-weight:600;flex-shrink:0;">
                            ${sc.label}
                        </button>
                    </div>
                    <div style="font-size:0.82rem;color:var(--grey-600);display:flex;flex-wrap:wrap;gap:6px;margin-bottom:${plan.notes || sourceText ? '8px' : '0'};">
                        <span title="Method">✂️ ${escHtml(methodLabel)}</span>
                        ${timingLabels ? `<span title="Timing">🗓️ ${escHtml(timingLabels)}</span>` : ''}
                    </div>
                    ${sourceText ? `<div style="font-size:0.82rem;color:var(--green-700);margin-bottom:${plan.notes?'6px':'0'};">📍 ${escHtml(sourceText)}</div>` : ''}
                    ${plan.notes ? `<div style="font-size:0.82rem;color:var(--grey-600);font-style:italic;">${escHtml(plan.notes)}</div>` : ''}
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                    ${isAtLeast('editor') ? `
                        <button class="btn-icon plan-start-batch-btn" title="Start a batch from this plan" style="color:var(--green-700);">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V12M12 12C12 12 7 9 7 4a5 5 0 0 1 10 0c0 5-5 8-5 8z"/><line x1="12" y1="12" x2="12" y2="22"/></svg>
                        </button>
                        <button class="btn-icon danger plan-delete-btn" title="Delete">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

function planSourceText(plan) {
    if (plan.sourceType === 'garden') {
        let txt = plan.sourcePlantName || '';
        if (plan.sourceArea) txt += ` (${plan.sourceArea})`;
        return txt || 'My garden';
    }
    if (plan.sourceType === 'friend') {
        return plan.sourceFriendName ? `From ${plan.sourceFriendName}` : 'From a friend';
    }
    return plan.sourceNotes || '';
}

// Map plan methods to batch methods where possible
function methodToBatchMethod(m) {
    const map = {
        'softwood-cutting':  'stem-cutting',
        'semi-ripe-cutting': 'stem-cutting',
        'ripe-cutting':      'stem-cutting',
        'hardwood-cutting':  'hardwood-cutting',
        'leaf-cutting':      'leaf-cutting',
        'root-cutting':      'root-cutting',
        'division':          'division',
        'layering':          'layering-offset',
        'seed':              'seed',
        'grafting':          'grafting'
    };
    return map[m] || 'stem-cutting';
}

// =============================================
//  Plan form (add / edit)
// =============================================

async function showPlanForm(existing, allPlans, onSaved) {
    const isEdit = !!existing;

    // Load garden plants for source picker
    let gardenPlants = [];
    try { gardenPlants = await getGardenPlants(); } catch(e) { /* not critical */ }

    const selectedTimings = existing?.timing || [];
    const sourceType = existing?.sourceType || 'garden';

    showModal(isEdit ? 'Edit Plan' : 'New Propagation Plan', buildPlanFormHtml(existing, gardenPlants, selectedTimings, sourceType));

    wireSourceToggle();

    document.getElementById('plan-cancel-btn')?.addEventListener('click', hideModal);

    document.getElementById('plan-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const plantName = document.getElementById('plan-plant-name')?.value.trim();
        if (!plantName) { showToast('Please enter a plant name', 'error'); return; }

        const timing = Array.from(document.querySelectorAll('.timing-chip input:checked')).map(cb => cb.value);
        const sourceTypeVal = document.querySelector('input[name="source-type"]:checked')?.value || 'garden';

        let sourceData = {};
        if (sourceTypeVal === 'garden') {
            const sel = document.getElementById('plan-source-plant');
            const selectedOpt = sel?.options[sel?.selectedIndex];
            sourceData = {
                sourcePlantId:   sel?.value || '',
                sourcePlantName: selectedOpt?.text || '',
                sourceArea:      document.getElementById('plan-source-area')?.value.trim() || '',
                sourceFriendName: ''
            };
        } else {
            sourceData = {
                sourcePlantId:    '',
                sourcePlantName:  '',
                sourceArea:       '',
                sourceFriendName: document.getElementById('plan-source-friend')?.value.trim() || ''
            };
        }

        const data = {
            plantName,
            method:     document.getElementById('plan-method')?.value || 'softwood-cutting',
            timing,
            sourceType: sourceTypeVal,
            ...sourceData,
            sourceNotes: document.getElementById('plan-source-notes')?.value.trim() || '',
            notes:       document.getElementById('plan-notes')?.value.trim() || '',
            status:      document.getElementById('plan-status')?.value || 'idea'
        };

        const saveBtn = document.getElementById('plan-save-btn');
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Saving…';

        try {
            if (isEdit) {
                await updateNurseryPlan(existing.id, data);
                showToast('Plan updated', 'success');
            } else {
                await addNurseryPlan(data);
                showToast('Plan added!', 'success');
            }
            hideModal();
            await onSaved();
        } catch (err) {
            console.error(err);
            showToast('Could not save plan', 'error');
            saveBtn.disabled    = false;
            saveBtn.textContent = isEdit ? 'Save changes' : 'Add plan';
        }
    });
}

function buildPlanFormHtml(existing, gardenPlants, selectedTimings, sourceType) {
    const seasons = ['Spring', 'Summer', 'Autumn', 'Winter'];
    const timingBySeasonHtml = seasons.map(season => {
        const opts = PLAN_TIMING_OPTIONS.filter(o => o.season === season);
        return `
            <div style="margin-bottom:10px;">
                <div style="font-size:0.75rem;font-weight:600;color:var(--grey-400);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">
                    ${SEASON_EMOJI[season]} ${season}
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;">
                    ${opts.map(o => `
                        <label class="timing-chip" style="
                            display:inline-flex;align-items:center;gap:5px;
                            padding:5px 10px;border-radius:99px;cursor:pointer;
                            border:1px solid var(--grey-200);background:var(--white);
                            font-size:0.8rem;color:var(--grey-700);
                            transition:all 0.15s;">
                            <input type="checkbox" name="timing" value="${o.value}"
                                ${selectedTimings.includes(o.value) ? 'checked' : ''}
                                style="display:none;">
                            ${o.label}
                        </label>`).join('')}
                </div>
            </div>
        `;
    }).join('');

    const gardenPlantOptions = gardenPlants.map(p => {
        const name = [p.genus, p.species, p.cultivar].filter(Boolean).join(' ');
        const sel = existing?.sourcePlantId === p.id ? 'selected' : '';
        return `<option value="${escHtml(p.id)}" ${sel}>${escHtml(name)}</option>`;
    }).join('');

    return `
        <form id="plan-form" novalidate>

            <!-- Plant name -->
            <div class="form-group">
                <label class="form-label" for="plan-plant-name">Plant name <span class="required">*</span></label>
                <input class="form-input" type="text" id="plan-plant-name"
                       value="${escHtml(existing?.plantName || '')}"
                       placeholder="e.g. Salvia nemorosa 'Caradonna'"
                       required maxlength="120" autocomplete="off" autocapitalize="words">
            </div>

            <!-- Method + Status row -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div class="form-group">
                    <label class="form-label" for="plan-method">Method <span class="required">*</span></label>
                    <select class="form-input" id="plan-method">
                        ${Object.entries(PLAN_METHOD_LABELS).map(([v,l]) =>
                            `<option value="${v}" ${(existing?.method||'softwood-cutting')===v?'selected':''}>${l}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="plan-status">Status</label>
                    <select class="form-input" id="plan-status">
                        <option value="idea"    ${(existing?.status||'idea')==='idea'   ?'selected':''}>💡 Idea</option>
                        <option value="planned" ${(existing?.status||'idea')==='planned'?'selected':''}>📅 Planned</option>
                        <option value="done"    ${(existing?.status||'idea')==='done'   ?'selected':''}>✅ Done</option>
                    </select>
                </div>
            </div>

            <!-- Timing -->
            <div class="form-group">
                <label class="form-label">When to do it</label>
                <div id="timing-grid" style="background:var(--grey-50);border-radius:var(--radius-sm);padding:12px;">
                    ${timingBySeasonHtml}
                </div>
            </div>

            <!-- Source -->
            <div class="form-group">
                <label class="form-label">Source material</label>
                <div style="display:flex;gap:16px;margin-bottom:12px;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;">
                        <input type="radio" name="source-type" value="garden" ${sourceType==='garden'?'checked':''}>
                        🌳 My garden
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;">
                        <input type="radio" name="source-type" value="friend" ${sourceType==='friend'?'checked':''}>
                        👤 A friend
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;">
                        <input type="radio" name="source-type" value="other" ${sourceType==='other'?'checked':''}>
                        Other
                    </label>
                </div>

                <div id="source-garden" style="display:${sourceType==='garden'?'block':'none'};">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                        <div class="form-group" style="margin:0;">
                            <label class="form-label" for="plan-source-plant">Plant in garden</label>
                            <select class="form-input" id="plan-source-plant">
                                <option value="">— not specified —</option>
                                ${gardenPlantOptions}
                            </select>
                        </div>
                        <div class="form-group" style="margin:0;">
                            <label class="form-label" for="plan-source-area">Area / location</label>
                            <input class="form-input" type="text" id="plan-source-area"
                                   value="${escHtml(existing?.sourceArea||'')}"
                                   placeholder="e.g. Back border, Pots">
                        </div>
                    </div>
                </div>

                <div id="source-friend" style="display:${sourceType==='friend'?'block':'none'};">
                    <div class="form-group" style="margin:0;">
                        <label class="form-label" for="plan-source-friend">Friend's name</label>
                        <input class="form-input" type="text" id="plan-source-friend"
                               value="${escHtml(existing?.sourceFriendName||'')}"
                               placeholder="e.g. Sarah, Mum, Local garden club">
                    </div>
                </div>

                <div id="source-other" style="display:${sourceType==='other'?'block':'none'};">
                </div>

                <div class="form-group" style="margin-top:10px;margin-bottom:0;">
                    <label class="form-label" for="plan-source-notes">Source notes (optional)</label>
                    <input class="form-input" type="text" id="plan-source-notes"
                           value="${escHtml(existing?.sourceNotes||'')}"
                           placeholder="Any extra detail about where to get material…">
                </div>
            </div>

            <!-- General notes -->
            <div class="form-group">
                <label class="form-label" for="plan-notes">Notes (optional)</label>
                <textarea class="form-input" id="plan-notes" rows="3"
                          placeholder="Tips, reminders, what to watch out for…">${escHtml(existing?.notes||'')}</textarea>
            </div>

            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="plan-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="plan-save-btn">
                    ${existing ? 'Save changes' : 'Add plan'}
                </button>
            </div>
        </form>

        <style>
            .timing-chip input:checked + * { display:none; }
            .timing-chip:has(input:checked) {
                background: var(--green-700) !important;
                color: var(--white) !important;
                border-color: var(--green-700) !important;
            }
        </style>
    `;
}

function wireSourceToggle() {
    document.querySelectorAll('input[name="source-type"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const val = radio.value;
            document.getElementById('source-garden').style.display = val === 'garden' ? 'block' : 'none';
            document.getElementById('source-friend').style.display = val === 'friend' ? 'block' : 'none';
            document.getElementById('source-other').style.display  = val === 'other'  ? 'block' : 'none';
        });
    });
}
