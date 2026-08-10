// =============================================================
//  tasks-view.js — Garden Tasks page + task management UI
// =============================================================

import {
    getTasks, getTask, addTask, updateTask, deleteTask,
    getTaskAssignments, getTaskAssignmentsForTask, getTaskAssignmentsForArea,
    addTaskAssignment, updateTaskAssignment, deleteTaskAssignment,
    getAreas, getInstances, getPlants,
    createNextRecurringOccurrence, firstOccurrenceFromToday,
    formatBotanicalName, escHtml, fmtDate, todayStr, isOverdue
} from './db.js';
import { showModal, hideModal, showToast, setLoading, navigate } from './ui-utils.js';
import { isAtLeast } from './auth.js';

// ---- Sentinel value for general (non-area) tasks ----
export const GENERAL_AREA_ID = '__general__';

// ---- Display constants ----
const STATUS_LABEL = {
    'todo':        'To-Do',
    'in-progress': 'In Progress',
    'completed':   'Completed'
};
const STATUS_ORDER   = { 'todo': 0, 'in-progress': 1, 'completed': 2 };
const PRIORITY_LABEL = { 'high': 'High', 'normal': 'Normal', 'low': 'Low' };
const PRIORITY_ORDER = { 'high': 0, 'normal': 1, 'low': 2 };

// ---- Session-persistent filter state (Tasks page only) ----
let activeFilters = new Set(['todo', 'in-progress']);

// ---- Session-persistent overdue-only filter ----
let overdueOnly = false;

// ---- Session-persistent view mode ----
let activeView = 'by-status'; // 'by-area' | 'by-status'

// ---- Session-persistent expand-all state ----
let allExpanded = false;

// ---- Session-persistent per-section expanded state ----
// Holds the data-area-id of every section the user has explicitly expanded.
// This survives re-renders (filter changes, Back navigation) so sections stay open.
let expandedSectionIds = new Set();

// Date helpers now come from db.js — see the import above.

// =============================================
//  MAIN TASKS PAGE
// =============================================

export async function renderTasksView(container, headerActionEl, backBtn, restoredExpanded = null) {
    // If Back navigation supplied a saved list of expanded section IDs, restore them.
    // An empty array is valid — it means "collapse everything" (user had nothing open).
    if (Array.isArray(restoredExpanded)) {
        expandedSectionIds = new Set(restoredExpanded);
    }
    setLoading(container, true);
    backBtn.classList.remove('visible');
    document.querySelector('.fab')?.remove();
    headerActionEl.innerHTML = '';

    let areas, tasks, allAssignments, instances, plants;
    try {
        [areas, tasks, allAssignments, instances, plants] = await Promise.all([
            getAreas(), getTasks(), getTaskAssignments(), getInstances(), getPlants()
        ]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading tasks.</p></div>`;
        return;
    }

    const taskMap  = Object.fromEntries(tasks.map(t => [t.id, t]));
    const plantMap = Object.fromEntries(plants.map(p => [p.id, p]));

    // Group instances by area
    const instancesByArea = {};
    for (const inst of instances) {
        if (!instancesByArea[inst.areaId]) instancesByArea[inst.areaId] = [];
        instancesByArea[inst.areaId].push(inst);
    }

    // Enrich assignments with their task data; skip orphans
    const enriched = allAssignments
        .map(a => ({ ...a, task: taskMap[a.taskId] }))
        .filter(a => a.task);

    // Group by areaId
    const assignmentsByArea = {};
    for (const a of enriched) {
        if (!assignmentsByArea[a.areaId]) assignmentsByArea[a.areaId] = [];
        assignmentsByArea[a.areaId].push(a);
    }

    const activeCount = enriched.filter(a =>
        a.status === 'todo' || a.status === 'in-progress').length;

    // Header holds page actions only. The By Area / By Status switch and Expand
    // all used to live here too — a filter, a bulk action and an icon button
    // sharing one 60px bar, which read as cluttered and squeezed the page title.
    // Both have moved into the content area below, next to the filter chips they
    // belong with. Print stays: it acts on the page, matching Area detail.
    headerActionEl.innerHTML = `
        <button class="btn-icon" id="print-tasks-btn" title="Print tasks list">🖨️</button>
    `;

    // Per-area plant map (plants planted in that area)
    function areaPlantMap(areaId) {
        const pm = {};
        for (const inst of (instancesByArea[areaId] || [])) {
            if (plantMap[inst.plantId]) pm[inst.plantId] = plantMap[inst.plantId];
        }
        return pm;
    }

    const generalAssignments = assignmentsByArea[GENERAL_AREA_ID] || [];

    const hasMatchingTasks = (assignments) =>
        assignments.some(a => a.task && activeFilters.has(a.status));

    const byAreaContent = `
        ${hasMatchingTasks(generalAssignments)
            ? buildAreaSection(GENERAL_AREA_ID, '🌿 General Tasks', generalAssignments, {}, activeFilters)
            : ''}
        ${areas
            .filter(area => hasMatchingTasks(assignmentsByArea[area.id] || []))
            .map(area =>
                buildAreaSection(area.id, area.name,
                    assignmentsByArea[area.id] || [],
                    areaPlantMap(area.id),
                    activeFilters)
            ).join('')}
    `;

    const byStatusContent = buildStatusView(enriched, areas, areaPlantMap, activeFilters);

    container.innerHTML = `
        <div class="tasks-controls">
            <div class="view-toggle">
                <button class="view-toggle-btn${activeView === 'by-area' ? ' active' : ''}"
                        id="view-area-btn" title="Group tasks by garden area">By Area</button>
                <button class="view-toggle-btn${activeView === 'by-status' ? ' active' : ''}"
                        id="view-status-btn" title="Group tasks by status">By Status</button>
            </div>
            <button class="btn btn-sm btn-secondary" id="expand-all-btn">Expand all</button>
        </div>

        ${activeCount > 0 ? `
        <div style="margin-bottom:12px;font-size:0.85rem;color:var(--green-700);font-weight:600;
             padding:8px 12px;background:var(--green-50);border-radius:var(--radius-sm);
             border-left:3px solid var(--green-500);">
            ${activeCount} active task${activeCount !== 1 ? 's' : ''} across all areas
        </div>` : ''}

        <div class="filter-chips">
            <button class="filter-chip filter-chip--overdue${overdueOnly ? ' active' : ''}" data-overdue="1">
                ⚠️ Overdue
            </button>
            ${['todo', 'in-progress', 'completed'].map(s => `
                <button class="filter-chip${activeFilters.has(s) ? ' active' : ''}" data-status="${s}">
                    ${STATUS_LABEL[s]}
                </button>`).join('')}
        </div>

        ${activeView === 'by-area' ? byAreaContent : byStatusContent}

        ${tasks.length === 0 ? `
            <div class="empty-state" style="padding:48px 24px">
                <div class="empty-state-icon">📋</div>
                <h3>No tasks yet</h3>
                <p>Tap + to create your first garden task.</p>
            </div>` : ''}
    `;

    // Filter chip toggle
    container.querySelectorAll('.filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            if (chip.dataset.overdue) {
                overdueOnly = !overdueOnly;
            } else {
                const s = chip.dataset.status;
                if (activeFilters.has(s)) {
                    if (activeFilters.size > 1) activeFilters.delete(s);
                } else {
                    activeFilters.add(s);
                }
            }
            renderTasksView(container, headerActionEl, backBtn);
        });
    });

    // Accordion headers — toggle and persist which sections are open
    container.querySelectorAll('.area-section-header').forEach(header => {
        header.addEventListener('click', e => {
            if (e.target.closest('.area-open-btn')) return;
            const section = header.closest('.area-section');
            section.classList.toggle('expanded');
            const areaId = section.dataset.areaId;
            if (areaId) {
                if (section.classList.contains('expanded')) expandedSectionIds.add(areaId);
                else expandedSectionIds.delete(areaId);
            }
        });
    });

    // Navigate to area detail
    container.querySelectorAll('.area-open-btn[data-area-id]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            navigate('area-detail', btn.dataset.areaId);
        });
    });

    // All task-row interactions (expand, status, note, edit, delete)
    attachTaskHandlers(container, () => renderTasksView(container, headerActionEl, backBtn));

    // View toggle (By Area / By Status) — now in the content area, not the header
    container.querySelector('#view-area-btn')?.addEventListener('click', () => {
        if (activeView !== 'by-area') {
            activeView = 'by-area';
            renderTasksView(container, headerActionEl, backBtn);
        }
    });
    container.querySelector('#view-status-btn')?.addEventListener('click', () => {
        if (activeView !== 'by-status') {
            activeView = 'by-status';
            renderTasksView(container, headerActionEl, backBtn);
        }
    });

    // Apply initial expanded state — honour both allExpanded and individual section tracking
    container.querySelectorAll('.area-section').forEach(s => {
        const shouldExpand = allExpanded || expandedSectionIds.has(s.dataset.areaId);
        s.classList.toggle('expanded', shouldExpand);
    });
    const expandBtn = container.querySelector('#expand-all-btn');
    if (expandBtn) expandBtn.textContent = allExpanded ? 'Collapse all' : 'Expand all';

    expandBtn?.addEventListener('click', () => {
        allExpanded = !allExpanded;
        container.querySelectorAll('.area-section').forEach(s => {
            s.classList.toggle('expanded', allExpanded);
            const areaId = s.dataset.areaId;
            if (areaId) {
                if (allExpanded) expandedSectionIds.add(areaId);
                else expandedSectionIds.delete(areaId);
            }
        });
        expandBtn.textContent = allExpanded ? 'Collapse all' : 'Expand all';
    });

    // Print button — opens a print-friendly window of the current task list
    headerActionEl.querySelector('#print-tasks-btn')?.addEventListener('click', () => {
        openTasksPrintWindow(enriched, areas, activeFilters, overdueOnly);
    });

    // FAB — admin only (creating tasks is an admin responsibility)
    if (isAtLeast('admin')) {
        const fab = document.createElement('button');
        fab.className = 'fab';
        fab.title = 'Add task';
        fab.innerHTML = '+';
        fab.addEventListener('click', async () => {
            const [freshAreas, freshInstances, freshPlants] = await Promise.all([
                getAreas(), getInstances(), getPlants()
            ]);
            const freshPlantMap = Object.fromEntries(freshPlants.map(p => [p.id, p]));
            showTaskForm(null, null, freshAreas, freshInstances, freshPlantMap,
                () => renderTasksView(container, headerActionEl, backBtn));
        });
        document.body.appendChild(fab);
    }

    updateNavBadge(activeCount);
    setLoading(container, false);
}

// =============================================
//  AREA TASKS TAB  (called from areas-view.js)
// =============================================

export async function renderAreaTasksSection(container, areaId, instances, plantMap) {
    let tabFilters = new Set(['todo', 'in-progress']);

    async function renderContent() {
        const sectionEl = container.querySelector('#area-tasks-section');
        if (!sectionEl) return;

        let areaAssignments, allTasks;
        try {
            [areaAssignments, allTasks] = await Promise.all([
                getTaskAssignmentsForArea(areaId),
                getTasks()
            ]);
        } catch (e) {
            sectionEl.innerHTML = `<div class="empty-state"><p>Error loading tasks.</p></div>`;
            return;
        }

        const taskMap = Object.fromEntries(allTasks.map(t => [t.id, t]));
        const enriched = areaAssignments
            .map(a => ({ ...a, task: taskMap[a.taskId] }))
            .filter(a => a.task);

        // Plant map scoped to this area's instances (for display in task rows)
        const areaPlantMap = {};
        for (const inst of instances) {
            if (plantMap[inst.plantId]) areaPlantMap[inst.plantId] = plantMap[inst.plantId];
        }

        sectionEl.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;
                        margin-bottom:12px;gap:12px;flex-wrap:wrap;">
                <div class="filter-chips" style="margin-bottom:0;">
                    ${['todo', 'in-progress', 'completed'].map(s => `
                        <button class="filter-chip${tabFilters.has(s) ? ' active' : ''}"
                                data-status="${s}">${STATUS_LABEL[s]}</button>`).join('')}
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button class="btn btn-sm btn-primary" id="add-new-area-task-btn">+ New task</button>
                    <button class="btn btn-sm btn-secondary" id="assign-existing-task-btn">+ Existing</button>
                </div>
            </div>
            ${enriched.length === 0
                ? `<div class="empty-state" style="padding:32px 16px">
                       <div class="empty-state-icon" style="font-size:2rem;">📋</div>
                       <h3 style="font-size:1rem;">No tasks yet</h3>
                       <p style="font-size:0.85rem;">Use + Add task to create one for this area.</p>
                   </div>`
                : buildTaskList(enriched, areaPlantMap, tabFilters)}
        `;

        // Filter chips
        sectionEl.querySelectorAll('.filter-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const s = chip.dataset.status;
                if (tabFilters.has(s)) {
                    if (tabFilters.size > 1) tabFilters.delete(s);
                } else {
                    tabFilters.add(s);
                }
                renderContent();
            });
        });

        // New task — pre-selects this area in the task form
        sectionEl.querySelector('#add-new-area-task-btn')?.addEventListener('click', async () => {
            try {
                const [areas, allInstances, allPlants] = await Promise.all([
                    getAreas(), getInstances(), getPlants()
                ]);
                const allPlantMap = Object.fromEntries(allPlants.map(p => [p.id, p]));
                await showTaskForm(null, null, areas, allInstances, allPlantMap,
                    renderContent, areaId);
            } catch (err) {
                showToast('Error loading data', 'error');
                console.error(err);
            }
        });

        // Existing task — pick an already-created task and assign it to this area
        sectionEl.querySelector('#assign-existing-task-btn')?.addEventListener('click', async () => {
            // Fetch area name for the modal header
            let areaName = areaId;
            try {
                const areas = await getAreas();
                areaName = areas.find(a => a.id === areaId)?.name || areaId;
            } catch (_) {}
            await showAssignExistingTaskModal(areaId, areaName, renderContent);
        });

        // Task-row interactions (expand, status, note, edit, delete)
        attachTaskHandlers(sectionEl, renderContent);
    }

    await renderContent();
}

// =============================================
//  SECTION & ROW BUILDERS
// =============================================

function buildAreaSection(areaId, areaName, assignments, localPlantMap, filterSet) {
    const total       = assignments.filter(a => a.task).length;
    const activeCount = assignments.filter(a => a.task &&
        (a.status === 'todo' || a.status === 'in-progress')).length;

    return `
        <div class="area-section" data-area-id="${escHtml(areaId)}">
            <div class="area-section-header">
                <div class="area-header-left">
                    <span class="area-chevron">&#9654;</span>
                    <div class="area-name-block">
                        <h3>${escHtml(areaName)}</h3>
                        <span class="area-plant-count">
                            ${total} task${total !== 1 ? 's' : ''}${activeCount > 0
                                ? ` &middot; ${activeCount} active` : ''}
                        </span>
                    </div>
                </div>
                ${areaId !== GENERAL_AREA_ID ? `
                <div class="area-header-right">
                    <button class="area-open-btn" data-area-id="${escHtml(areaId)}"
                            title="Open area detail">&#8594;</button>
                </div>` : ''}
            </div>
            <div class="area-plants-list">
                ${buildTaskList(assignments, localPlantMap, filterSet)}
            </div>
        </div>
    `;
}

// =============================================
//  BY-STATUS VIEW  (global tasks grouped by status)
// =============================================

function buildStatusView(enriched, areas, areaPlantMapFn, filterSet) {
    const areaNameMap = Object.fromEntries(areas.map(a => [a.id, a.name]));
    areaNameMap[GENERAL_AREA_ID] = 'General';

    const dueSortFn = (a, b) => {
        const da = a.dueDate || '9999-99-99';
        const db = b.dueDate || '9999-99-99';
        if (da !== db) return da.localeCompare(db);
        const po = (PRIORITY_ORDER[a.task?.priority || 'normal'] ?? 1)
                 - (PRIORITY_ORDER[b.task?.priority || 'normal'] ?? 1);
        if (po !== 0) return po;
        return (a.task?.title || '').localeCompare(b.task?.title || '');
    };

    // Compute overdue set — tasks from active-status groups with a past due date
    const overdueAssignments = enriched.filter(a =>
        a.task &&
        filterSet.has(a.status) &&
        isOverdue(a.dueDate, a.status)
    ).sort(dueSortFn);

    const overdueIds = new Set(overdueAssignments.map(a => a.id));

    // When overdueOnly is on, only overdue tasks are shown
    const statusGroups = [
        {
            status:  'in-progress',
            label:   'In Progress',
            icon:    '⚙️',
            sortFn:  dueSortFn,
        },
        {
            status:  'todo',
            label:   'To-Do',
            icon:    '📝',
            sortFn:  dueSortFn,
        },
        {
            status:  'completed',
            label:   'Completed',
            icon:    '✅',
            sortFn:  (a, b) => (b.completedDate || '').localeCompare(a.completedDate || ''),
        },
    ].filter(g => filterSet.has(g.status));

    const hasAnyMatch = overdueOnly
        ? overdueAssignments.length > 0
        : statusGroups.some(g => enriched.some(a => a.task && a.status === g.status));

    if (!hasAnyMatch) {
        const hasAny = enriched.some(a => a.task);
        return `<div style="padding:12px 16px;font-size:0.85rem;color:var(--grey-400);">
            ${hasAny ? 'No tasks match the current filter.' : 'No tasks assigned yet.'}
        </div>`;
    }

    function buildSection(assignments, status, icon, label, isOverdueSection = false) {
        if (assignments.length === 0) return '';

        // Group by taskId so a task assigned to multiple areas shows as one row
        const byTask = {};
        for (const a of assignments) {
            if (!byTask[a.taskId]) byTask[a.taskId] = [];
            byTask[a.taskId].push(a);
        }

        const rows = Object.values(byTask).map(group => {
            const rep      = group[0]; // first is already the most urgent (sorted above)
            const areaLabel = group.length === 1
                ? (areaNameMap[rep.areaId] || 'Unknown area')
                : `${group.length} areas`;
            const areaNames = group.length > 1
                ? group.map(a => areaNameMap[a.areaId] || 'Unknown area')
                : null;
            const multiAreaData = group.length > 1
                ? group.map(a => ({ id: a.id, areaId: a.areaId, areaName: areaNameMap[a.areaId] || 'Unknown area' }))
                : null;
            return buildTaskRow(rep, areaPlantMapFn(rep.areaId), areaLabel, false, areaNames, multiAreaData);
        }).join('');

        const uniqueCount = Object.keys(byTask).length;
        return `
            <div class="area-section status-section${isOverdueSection ? ' overdue-section' : ''}"
                 data-status="${status}">
                <div class="area-section-header">
                    <div class="area-header-left">
                        <span class="area-chevron">&#9654;</span>
                        <div class="area-name-block">
                            <h3>${icon} ${label}</h3>
                            <span class="area-plant-count">
                                ${uniqueCount} task${uniqueCount !== 1 ? 's' : ''}
                            </span>
                        </div>
                    </div>
                </div>
                <div class="area-plants-list">${rows}</div>
            </div>
        `;
    }

    // When overdueOnly is active, show just the overdue section
    if (overdueOnly) {
        return buildSection(overdueAssignments, 'overdue', '⚠️', 'Overdue', true);
    }

    // Normal view: auto overdue section at top (if any), then status sections
    // (overdue tasks are extracted from their status sections to avoid duplication)
    const overdueSection = overdueAssignments.length > 0
        ? buildSection(overdueAssignments, 'overdue', '⚠️', 'Overdue', true)
        : '';

    const statusSections = statusGroups.map(g => {
        // Exclude overdue tasks from their status section (shown in overdue section above)
        const assignments = enriched
            .filter(a => a.task && a.status === g.status && !overdueIds.has(a.id))
            .sort(g.sortFn);
        return buildSection(assignments, g.status, g.icon, g.label);
    }).join('');

    return overdueSection + statusSections;
}

function buildTaskList(assignments, plantMap, filterSet) {
    const filtered = assignments
        .filter(a => {
            if (!a.task || !filterSet.has(a.status)) return false;
            if (overdueOnly) return isOverdue(a.dueDate, a.status);
            return true;
        })
        .sort((a, b) => {
            const so = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
            if (so !== 0) return so;
            const da = a.dueDate || '9999-99-99';
            const db = b.dueDate || '9999-99-99';
            if (da !== db) return da.localeCompare(db);
            const po = (PRIORITY_ORDER[a.task?.priority || 'normal'] ?? 1)
                     - (PRIORITY_ORDER[b.task?.priority || 'normal'] ?? 1);
            if (po !== 0) return po;
            return (a.task?.title || '').localeCompare(b.task?.title || '');
        });

    if (filtered.length === 0) {
        const hasAny = assignments.some(a => a.task);
        return `<div style="padding:12px 16px;font-size:0.85rem;color:var(--grey-400);">
            ${hasAny ? overdueOnly ? 'No overdue tasks here.' : 'No tasks match the current filter.'
                     : 'No tasks assigned here yet.'}
        </div>`;
    }

    return filtered.map(a => buildTaskRow(a, plantMap)).join('');
}

export function buildTaskRow(assignment, plantMap, areaLabel = null, showStatusBadge = true, areaNames = null, multiAreaData = null) {
    const task = assignment.task;
    if (!task) return '';

    const priority     = task.priority || 'normal';
    const isRecurring  = !!assignment.isRecurring;
    const isSkipped    = !!assignment.isSkipped;
    const overdueFlag  = isOverdue(assignment.dueDate, assignment.status);
    const dueDateStr   = assignment.dueDate ? fmtDate(assignment.dueDate) : null;

    // Skipped assignments display as a distinct visual state
    const displayStatus = isSkipped ? 'skipped' : assignment.status;
    const statusLabel   = isSkipped ? 'Skipped' : STATUS_LABEL[assignment.status];
    const statusClass   = isSkipped ? 'status-skipped' : `status-${assignment.status}`;

    const plants = (assignment.plantIds || [])
        .map(id => {
            const p = plantMap[id];
            return p ? (formatBotanicalName(p) || escHtml(p.commonName || '')) : '';
        })
        .filter(Boolean);

    const showCompletedInfo = assignment.status === 'completed' &&
        (assignment.completedDate || assignment.completionNote);

    return `
        <div class="task-row"
             data-assignment-id="${assignment.id}"
             data-task-id="${task.id}"
             data-status="${assignment.status}"
             data-is-recurring="${isRecurring}"
             data-is-skipped="${isSkipped}"
             data-completed-date="${assignment.completedDate || ''}"
             data-occurrence-date="${assignment.occurrenceDate || ''}"
             ${multiAreaData ? `data-multi-areas="${escHtml(JSON.stringify(multiAreaData))}"` : ''}>
            <div class="task-row-header">
                <div class="task-row-left">
                    <span class="priority-dot priority-${priority}"
                          title="${PRIORITY_LABEL[priority]} priority"></span>
                    ${isRecurring ? `<span class="recurring-badge" title="Recurring task">🔁</span>` : ''}
                    <span class="task-title-text">${escHtml(task.title)}</span>
                </div>
                <div class="task-row-right">
                    ${areaLabel
                        ? `<span class="task-area-tag">${escHtml(areaLabel)}</span>`
                        : ''}
                    ${showStatusBadge || isSkipped ? `<span class="status-badge ${statusClass}">${statusLabel}</span>` : ''}
                    ${dueDateStr
                        ? `<span class="task-due${overdueFlag ? ' overdue' : ''}">${dueDateStr}</span>`
                        : ''}
                </div>
            </div>
            <div class="task-row-body">
                ${task.description
                    ? `<p class="task-description">${escHtml(task.description)}</p>` : ''}
                ${areaNames && areaNames.length > 1 ? `
                    <div class="task-plants">
                        <span class="task-plants-label">📍 Areas:</span>
                        ${areaNames.map(n => `<span class="task-plant-tag">${escHtml(n)}</span>`).join('')}
                    </div>` : ''}
                ${plants.length > 0 ? `
                    <div class="task-plants">
                        <span class="task-plants-label">🌱 Plants:</span>
                        ${plants.map(n => `<span class="task-plant-tag">${n}</span>`).join('')}
                    </div>` : ''}
                ${showCompletedInfo ? `
                    <div class="task-completed-info">
                        ${assignment.completedDate ? `
                            <span>${isSkipped ? '⏭ Skipped' : '&#10003; Completed'}
                            ${fmtDate(assignment.completedDate)}</span>` : ''}
                        ${assignment.completionNote
                            ? `<span class="task-completion-note-text">${escHtml(assignment.completionNote)}</span>`
                            : ''}
                    </div>` : ''}
                ${isAtLeast('editor') ? `
                <div class="task-status-btns">
                    ${['todo', 'in-progress', 'completed'].map(s => `
                        <button class="task-status-btn${assignment.status === s && !isSkipped ? ' active' : ''}"
                                data-assignment-id="${assignment.id}"
                                data-status="${s}">
                            ${STATUS_LABEL[s]}
                        </button>`).join('')}
                    ${isRecurring && assignment.status !== 'completed' ? `
                        <button class="task-status-btn task-skip-btn${isSkipped ? ' active' : ''}"
                                data-assignment-id="${assignment.id}"
                                title="Mark as skipped and schedule the next occurrence">
                            ⏭ Skip
                        </button>` : ''}
                </div>
                <div class="task-completion-note-wrap"
                     style="display:${assignment.status === 'completed' ? 'block' : 'none'};margin-top:8px;">
                    <input type="text" class="form-input task-note-field"
                           value="${escHtml(assignment.completionNote || '')}"
                           placeholder="Completion note (optional)&#8230;"
                           data-assignment-id="${assignment.id}">
                </div>
                ` : ''}
                ${isAtLeast('admin') ? `
                <div class="task-row-actions">
                    <button class="btn btn-sm btn-secondary task-edit-btn"
                            data-task-id="${task.id}">Edit task</button>
                    <button class="btn btn-sm btn-danger task-delete-btn"
                            data-task-id="${task.id}"
                            data-task-title="${escHtml(task.title)}">Delete</button>
                </div>
                ` : ''}
            </div>
        </div>
    `;
}

// =============================================
//  MULTI-AREA STATUS DIALOG
//  Called when a status button is clicked on a task that spans multiple areas.
//  Shows a modal letting the user choose: all areas, or just one specific area.
// =============================================

async function _handleMultiAreaStatusChange(multiAreas, newStatus, taskId, isRecurring, onRefresh) {
    const statusLabel = STATUS_LABEL[newStatus];

    const areaListHtml = multiAreas.map(a => `
        <button class="btn btn-secondary multi-area-single-btn"
                data-assignment-id="${escHtml(a.id)}"
                style="width:100%;text-align:left;margin-bottom:6px;justify-content:flex-start;">
            ${escHtml(a.areaName)}
        </button>`).join('');

    showModal(`Mark as "${statusLabel}"`, `
        <p style="margin-bottom:12px;font-size:0.9rem;color:var(--grey-600);">
            This task is assigned to <strong>${multiAreas.length} areas</strong>.
            Apply the status change to:
        </p>
        <button class="btn btn-primary" id="multi-area-all-btn"
                style="width:100%;margin-bottom:12px;">
            ✓ All ${multiAreas.length} areas
        </button>
        <div style="border-top:1px solid var(--grey-200);padding-top:10px;margin-bottom:10px;">
            <p style="font-size:0.8rem;color:var(--grey-500);margin-bottom:8px;">
                Or just one area:
            </p>
            ${areaListHtml}
        </div>
        <button class="btn btn-secondary" id="multi-area-cancel-btn"
                style="width:100%;">Cancel</button>
    `);

    document.getElementById('multi-area-cancel-btn')?.addEventListener('click', hideModal);

    async function applyChange(assignmentIds) {
        hideModal();
        try {
            for (const assignmentId of assignmentIds) {
                const updateData = { status: newStatus, isSkipped: false };
                if (newStatus === 'completed') {
                    updateData.completedDate = todayStr();
                }
                await updateTaskAssignment(assignmentId, updateData);

                if (newStatus === 'completed' && isRecurring) {
                    const task = await getTask(taskId);
                    const allA = await getTaskAssignmentsForTask(taskId);
                    const full = allA.find(a => a.id === assignmentId);
                    if (full) await createNextRecurringOccurrence(full, task);
                }
            }
            showToast(`Marked as ${statusLabel}`, 'success');
            await onRefresh();
        } catch (err) {
            showToast('Error updating status', 'error');
            console.error(err);
        }
    }

    document.getElementById('multi-area-all-btn')?.addEventListener('click', () => {
        applyChange(multiAreas.map(a => a.id));
    });

    document.querySelectorAll('.multi-area-single-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            applyChange([btn.dataset.assignmentId]);
        });
    });
}

// =============================================
//  SHARED TASK ROW EVENT HANDLERS
//  root     — the DOM element to search within
//  onRefresh — async callback to re-render after changes
// =============================================

export function attachTaskHandlers(root, onRefresh) {
    // ---- Row expand / collapse ----
    root.querySelectorAll('.task-row-header').forEach(header => {
        header.addEventListener('click', () =>
            header.closest('.task-row').classList.toggle('expanded'));
    });

    // ---- Quick status change ----
    root.querySelectorAll('.task-status-btn:not(.task-skip-btn)').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const assignmentId = btn.dataset.assignmentId;
            const newStatus    = btn.dataset.status;
            const row          = btn.closest('.task-row');
            if (!row || newStatus === row.dataset.status) return;

            // If this row represents a task assigned to multiple areas, ask which to update
            const multiAreasRaw = row.dataset.multiAreas;
            if (multiAreasRaw) {
                let multiAreas = null;
                try { multiAreas = JSON.parse(multiAreasRaw); } catch (_) {}
                if (multiAreas && multiAreas.length > 1) {
                    await _handleMultiAreaStatusChange(
                        multiAreas, newStatus,
                        row.dataset.taskId,
                        row.dataset.isRecurring === 'true',
                        onRefresh
                    );
                    return;
                }
            }

            const updateData = { status: newStatus, isSkipped: false };
            if (newStatus === 'completed' && !row.dataset.completedDate) {
                updateData.completedDate = todayStr();
            }
            try {
                await updateTaskAssignment(assignmentId, updateData);
                // Auto-create next occurrence for recurring tasks
                if (newStatus === 'completed' && row.dataset.isRecurring === 'true') {
                    const task = await getTask(row.dataset.taskId);
                    const assignment = { id: assignmentId, taskId: row.dataset.taskId,
                        areaId: null, occurrenceDate: row.dataset.occurrenceDate || null,
                        dueDate: null, plantIds: [] };
                    // Fetch full assignment for plantIds / areaId
                    const [allA] = await Promise.all([getTaskAssignmentsForTask(row.dataset.taskId)]);
                    const full = allA.find(a => a.id === assignmentId);
                    if (full) await createNextRecurringOccurrence(full, task);
                }
                showToast(`Marked as ${STATUS_LABEL[newStatus]}`, 'success');
                await onRefresh();
            } catch (err) {
                showToast('Error updating status', 'error');
                console.error(err);
            }
        });
    });

    // ---- Skip recurring occurrence ----
    root.querySelectorAll('.task-skip-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const assignmentId = btn.dataset.assignmentId;
            const row          = btn.closest('.task-row');
            if (!row) return;
            try {
                await updateTaskAssignment(assignmentId, {
                    status: 'completed', isSkipped: true, completedDate: todayStr() });
                const task = await getTask(row.dataset.taskId);
                const allA = await getTaskAssignmentsForTask(row.dataset.taskId);
                const full = allA.find(a => a.id === assignmentId);
                if (full) await createNextRecurringOccurrence(full, task);
                showToast('Skipped — next occurrence scheduled', 'success');
                await onRefresh();
            } catch (err) {
                showToast('Error skipping task', 'error');
                console.error(err);
            }
        });
    });

    // ---- Completion note — save on blur ----
    root.querySelectorAll('.task-note-field').forEach(input => {
        input.addEventListener('blur', async () => {
            try {
                await updateTaskAssignment(input.dataset.assignmentId,
                    { completionNote: input.value.trim() || null });
            } catch (_) {}
        });
        // Prevent row toggle from firing on input click
        input.addEventListener('click', e => e.stopPropagation());
    });

    // ---- Edit task — always fetches fresh data ----
    root.querySelectorAll('.task-edit-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const taskId = btn.dataset.taskId;
            try {
                const [task, existingAssignments, areas, instances, plants] = await Promise.all([
                    getTask(taskId),
                    getTaskAssignmentsForTask(taskId),
                    getAreas(),
                    getInstances(),
                    getPlants()
                ]);
                const freshPlantMap = Object.fromEntries(plants.map(p => [p.id, p]));
                await showTaskForm(task, existingAssignments, areas,
                    instances, freshPlantMap, onRefresh);
            } catch (err) {
                showToast('Error loading task', 'error');
                console.error(err);
            }
        });
    });

    // ---- Delete task ----
    root.querySelectorAll('.task-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            e.stopPropagation();
            const taskId = btn.dataset.taskId;
            const title  = btn.dataset.taskTitle;
            if (!confirm(`Delete "${title}" and all its area assignments?`)) return;
            try {
                await deleteTask(taskId);
                showToast('Task deleted', 'success');
                await onRefresh();
            } catch (err) {
                showToast('Error deleting task', 'error');
                console.error(err);
            }
        });
    });
}

// =============================================
//  ASSIGN EXISTING TASK TO AREA  (from area detail)
// =============================================

export async function showAssignExistingTaskModal(areaId, areaName, onSave) {
    let allTasks, existingAssignments;
    try {
        [allTasks, existingAssignments] = await Promise.all([
            getTasks(),
            getTaskAssignmentsForArea(areaId)
        ]);
    } catch (e) {
        showToast('Error loading tasks', 'error');
        return;
    }

    const alreadyAssigned = new Set(existingAssignments.map(a => a.taskId));
    const available = allTasks
        .filter(t => !alreadyAssigned.has(t.id))
        .sort((a, b) => a.title.localeCompare(b.title));

    if (available.length === 0) {
        showModal('Assign Existing Task', `
            <div class="empty-state" style="padding:24px 0;">
                <div class="empty-state-icon" style="font-size:2rem;">📋</div>
                <h3 style="font-size:1rem;">No unassigned tasks</h3>
                <p style="font-size:0.85rem;">All existing tasks are already assigned to
                    <strong>${escHtml(areaName)}</strong>, or there are no tasks yet.</p>
            </div>
            <div class="form-actions">
                <button class="btn btn-secondary" id="cancel-assign-btn">Close</button>
            </div>
        `);
        document.getElementById('cancel-assign-btn')?.addEventListener('click', hideModal);
        return;
    }

    const taskOptions = available.map(t => {
        const priority = t.priority && t.priority !== 'normal'
            ? ` (${PRIORITY_LABEL[t.priority]})` : '';
        return `<option value="${t.id}">${escHtml(t.title)}${priority}</option>`;
    }).join('');

    const html = `
        <form id="assign-task-form">
            <div class="form-group">
                <label class="form-label">Area</label>
                <div class="form-input" style="background:var(--grey-50);color:var(--grey-500);
                     cursor:default;pointer-events:none;">${escHtml(areaName)}</div>
            </div>
            <div class="form-group">
                <label class="form-label" for="assign-task-select">Task</label>
                <select class="form-input" id="assign-task-select" name="taskId" required>
                    <option value="">— select a task —</option>
                    ${taskOptions}
                </select>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="assign-task-status">Status</label>
                    <select class="form-select" id="assign-task-status" name="status">
                        <option value="todo" selected>To-Do</option>
                        <option value="in-progress">In Progress</option>
                        <option value="completed">Completed</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label" for="assign-task-due">
                        Due date <span class="optional">optional</span>
                    </label>
                    <input type="date" class="form-input" id="assign-task-due" name="dueDate">
                </div>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="cancel-assign-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="save-assign-btn">Assign task</button>
            </div>
        </form>
    `;

    showModal('Assign Existing Task', html);
    document.getElementById('cancel-assign-btn')?.addEventListener('click', hideModal);

    document.getElementById('assign-task-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const taskId = fd.get('taskId');
        if (!taskId) { showToast('Please select a task', 'error'); return; }

        const saveBtn = e.target.querySelector('#save-assign-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        const status = fd.get('status') || 'todo';
        const dueDate = fd.get('dueDate') || null;
        let completedDate = null;
        if (status === 'completed') completedDate = todayStr();

        try {
            await addTaskAssignment({
                taskId,
                areaId,
                status,
                dueDate:        dueDate || null,
                completedDate:  completedDate || null,
                completionNote: null,
                plantIds:       [],
            });
            showToast('Task assigned!', 'success');
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error assigning task', 'error');
            console.error(err);
            saveBtn.disabled = false;
            saveBtn.textContent = 'Assign task';
        }
    });
}

// =============================================
//  NAV BADGE  (active task count)
// =============================================

export function updateNavBadge(count) {
    const btn = document.querySelector('[data-view="tasks"]');
    if (!btn) return;
    const existing = btn.querySelector('.nav-badge');
    if (existing) existing.remove();
    if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'nav-badge';
        badge.textContent = count > 99 ? '99+' : String(count);
        btn.appendChild(badge);
    }
}

// =============================================
//  PRINT TASKS
// =============================================

function openTasksPrintWindow(enriched, areas, filterSet, overdueOnly) {
    const date = new Date().toLocaleDateString('en-GB', {
        day: 'numeric', month: 'long', year: 'numeric'
    });

    const areaNameMap = Object.fromEntries(areas.map(a => [a.id, a.name]));
    areaNameMap[GENERAL_AREA_ID] = 'General';

    const today = todayStr();

    // Apply the same filters currently active in the view
    const filtered = enriched.filter(a => {
        if (!a.task || !filterSet.has(a.status)) return false;
        if (overdueOnly) return isOverdue(a.dueDate, a.status);
        return true;
    });

    const statusLabels = [...filterSet]
        .sort((a, b) => STATUS_ORDER[a] - STATUS_ORDER[b])
        .map(s => STATUS_LABEL[s]).join(', ');

    const PRIORITY_SYMBOL = { high: '▲ High', normal: '–', low: '▼ Low' };

    // Sort helper: by due date, then priority, then title
    const dueSortFn = (a, b) => {
        const da = a.dueDate || '9999-99-99';
        const db = b.dueDate || '9999-99-99';
        if (da !== db) return da.localeCompare(db);
        const po = (PRIORITY_ORDER[a.task?.priority || 'normal'] ?? 1)
                 - (PRIORITY_ORDER[b.task?.priority || 'normal'] ?? 1);
        if (po !== 0) return po;
        return (a.task?.title || '').localeCompare(b.task?.title || '');
    };

    // Group tasks: Overdue → In Progress → To-Do → Completed
    // Overdue tasks are pulled out of their status group to avoid duplication
    const overdueSet = new Set(
        filtered.filter(a => isOverdue(a.dueDate, a.status)).map(a => a.id)
    );
    const printGroups = [
        { label: '⚠ Overdue',      tasks: filtered.filter(a => overdueSet.has(a.id)).sort(dueSortFn) },
        { label: '⚙ In Progress',  tasks: filtered.filter(a => a.status === 'in-progress' && !overdueSet.has(a.id)).sort(dueSortFn) },
        { label: '📝 To-Do',        tasks: filtered.filter(a => a.status === 'todo'        && !overdueSet.has(a.id)).sort(dueSortFn) },
        { label: '✅ Completed',    tasks: filtered.filter(a => a.status === 'completed').sort((a, b) => (b.completedDate || '').localeCompare(a.completedDate || '')) },
    ].filter(g => g.tasks.length > 0);

    // Build task row HTML (rowIdx used for alternating background)
    let rowIdx = 0;
    function buildRow(a) {
        const task      = a.task;
        const areaName  = areaNameMap[a.areaId] || 'Unknown';
        const priority  = task.priority || 'normal';
        const dueDate   = a.dueDate ? fmtDate(a.dueDate) : '—';
        const overdue   = isOverdue(a.dueDate, a.status);
        const rowClass  = rowIdx++ % 2 === 1 ? ' class="alt"' : '';
        const dueCls    = overdue ? ' style="color:#c0392b;font-weight:600;"' : '';
        const recurIcon = a.isRecurring ? ' <span class="rec" title="Recurring">🔁</span>' : '';

        const titleCell = escHtml(task.title) + recurIcon
            + (task.description ? `<br><span class="desc">${escHtml(task.description)}</span>` : '');

        const completionInfo = a.status === 'completed' && (a.completedDate || a.completionNote)
            ? `<br><span class="desc">✓ ${a.completedDate ? fmtDate(a.completedDate) : ''}${a.completionNote ? ` — ${escHtml(a.completionNote)}` : ''}</span>`
            : '';

        return `<tr${rowClass}>
            <td>${titleCell}</td>
            <td>${escHtml(areaName)}</td>
            <td class="c pri-${priority}">${PRIORITY_SYMBOL[priority]}</td>
            <td>${STATUS_LABEL[a.status]}</td>
            <td${dueCls}>${dueDate}${overdue ? ' ⚠' : ''}${completionInfo}</td>
        </tr>`;
    }

    const rows = printGroups.flatMap(g => [
        `<tr class="group-header"><td colspan="5">${g.label}<span class="group-count">${g.tasks.length} task${g.tasks.length !== 1 ? 's' : ''}</span></td></tr>`,
        ...g.tasks.map(a => buildRow(a))
    ]).join('');

    const emptyRow = `<tr><td colspan="5" style="text-align:center;color:#999;padding:20px;">No tasks match the current filter.</td></tr>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Garden Tasks</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #1a1a1a; padding: 24px 32px; max-width: 960px; margin: 0 auto; }
  h1 { font-size: 16pt; color: #2d6a4f; margin-bottom: 2px; }
  .meta { font-size: 9pt; color: #666; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: #2d6a4f; color: #fff; padding: 7px 9px; text-align: left; font-size: 9.5pt; }
  td { padding: 6px 9px; border-bottom: 1px solid #e0e0e0; font-size: 10pt; vertical-align: top; }
  tr.alt td { background: #f5faf7; }
  .c { text-align: center; }
  .desc { font-size: 8.5pt; color: #555; }
  .rec { font-size: 9pt; }
  .pri-high { color: #c0392b; font-weight: 600; }
  .pri-low  { color: #888; }
  tr.group-header td { background: #e8f5ee; color: #1a4731; font-weight: 700; font-size: 9.5pt; padding: 6px 9px; border-bottom: 2px solid #2d6a4f; border-top: 8px solid #fff; letter-spacing: 0.02em; }
  tr.group-header:first-child td { border-top: none; }
  .group-count { font-weight: 400; color: #557a67; font-size: 8.5pt; margin-left: 8px; }
  .print-btn { display: inline-block; margin-bottom: 18px; padding: 8px 20px; background: #2d6a4f; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 10pt; }
  @media print {
    .print-btn { display: none; }
    body { padding: 0; }
    h1 { color: #000; }
    th { background: #444; }
  }
</style>
</head>
<body>
  <button class="print-btn" onclick="window.print()">&#128438; Print / Save as PDF</button>
  <h1>Garden Tasks</h1>
  <div class="meta">${filtered.length} task${filtered.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; Showing: ${statusLabels}${overdueOnly ? ' (overdue only)' : ''} &nbsp;&middot;&nbsp; Printed ${date}</div>
  <table>
    <colgroup>
      <col style="width:35%">
      <col style="width:22%">
      <col style="width:10%">
      <col style="width:13%">
      <col style="width:20%">
    </colgroup>
    <thead>
      <tr><th>Task</th><th>Area</th><th>Priority</th><th>Status</th><th>Due Date</th></tr>
    </thead>
    <tbody>${rows || emptyRow}</tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (!win) {
        showToast('Pop-up blocked — please allow pop-ups for this site', 'error');
        URL.revokeObjectURL(url);
    }
}

// =============================================
//  TASK FORM  (add / edit)
// =============================================

export async function showTaskForm(task, existingAssignments, areas, instances,
                                   plantMap, onSave, preselectedAreaId = null) {
    const isEdit = !!task;

    // Lookup: areaId → existing assignment record
    const existingMap = {};
    for (const a of (existingAssignments || [])) {
        existingMap[a.areaId] = a;
    }

    // Instances grouped by area for the plant selector
    const instancesByArea = {};
    for (const inst of instances) {
        if (!instancesByArea[inst.areaId]) instancesByArea[inst.areaId] = [];
        instancesByArea[inst.areaId].push(inst);
    }

    // Full assignable targets: General first, then each area
    const allTargets = [
        { id: GENERAL_AREA_ID, name: '🌿 General (whole garden)', isGeneral: true },
        ...areas.map(a => ({ ...a, isGeneral: false }))
    ];

    // Which are pre-checked?
    const preChecked = new Set(
        isEdit              ? Object.keys(existingMap)
        : preselectedAreaId ? [preselectedAreaId]
        : []
    );

    // ---- Build one assignment sub-panel ----
    function buildPanel(target) {
        const { id: areaId, name: areaName, isGeneral } = target;
        const existing = existingMap[areaId] || {};
        const areaInstances = isGeneral ? [] : [...(instancesByArea[areaId] || [])].sort((a, b) => {
            const pa = plantMap[a.plantId] || {};
            const pb = plantMap[b.plantId] || {};
            const na = (formatBotanicalName(pa) || pa.commonName || '').toLowerCase();
            const nb = (formatBotanicalName(pb) || pb.commonName || '').toLowerCase();
            return na.localeCompare(nb);
        });
        const existingPlantIds = new Set(existing.plantIds || []);

        const plantsHtml = (!isGeneral && areaInstances.length > 0) ? `
            <div class="form-group" style="margin-top:10px;">
                <label class="form-label">Plants <span class="optional">optional</span></label>
                <div class="area-checkbox-list" style="max-height:130px;">
                    ${areaInstances.map(inst => {
                        const p = plantMap[inst.plantId];
                        if (!p) return '';
                        const name = formatBotanicalName(p) || escHtml(p.commonName || 'Unknown plant');
                        return `
                            <div class="area-checkbox-item">
                                <input type="checkbox"
                                       id="plant-${areaId}-${inst.plantId}"
                                       name="plant-${escHtml(areaId)}"
                                       value="${inst.plantId}"
                                       ${existingPlantIds.has(inst.plantId) ? 'checked' : ''}>
                                <label for="plant-${areaId}-${inst.plantId}"
                                       style="font-size:0.9rem;">${name}</label>
                            </div>`;
                    }).filter(Boolean).join('')}
                </div>
            </div>` : '';

        const isCompleted = (existing.status || '') === 'completed';

        return `
            <div class="task-assignment-block" id="panel-${areaId}"
                 style="display:${preChecked.has(areaId) ? 'block' : 'none'};">
                <div class="form-section-label" style="margin-top:0;font-size:0.73rem;">
                    ${escHtml(areaName)}
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="status-${areaId}">Status</label>
                        <select class="form-select" id="status-${areaId}">
                            <option value="todo"
                                ${(existing.status||'todo')==='todo' ?'selected':''}>To-Do</option>
                            <option value="in-progress"
                                ${(existing.status||'')==='in-progress' ?'selected':''}>In Progress</option>
                            <option value="completed"
                                ${(existing.status||'')==='completed' ?'selected':''}>Completed</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="due-${areaId}">
                            Due date <span class="optional">optional</span>
                        </label>
                        <input type="date" class="form-input"
                               id="due-${areaId}" value="${existing.dueDate || ''}">
                    </div>
                </div>
                <div class="form-group" id="note-group-${areaId}"
                     style="display:${isCompleted ? 'block' : 'none'};">
                    <label class="form-label" for="note-${areaId}">
                        Completion note <span class="optional">optional</span>
                    </label>
                    <input type="text" class="form-input"
                           id="note-${areaId}"
                           value="${escHtml(existing.completionNote || '')}"
                           placeholder="e.g. Used 3 bags of compost&#8230;">
                </div>
                ${plantsHtml}
            </div>
        `;
    }

    const html = `
        <form id="task-form">
            <div class="form-group">
                <label class="form-label" for="task-title">Title</label>
                <input class="form-input" id="task-title" name="title" required
                       value="${escHtml(task?.title || '')}"
                       placeholder="e.g. Deadhead roses, Apply mulch&#8230;"
                       autocapitalize="sentences">
            </div>
            <div class="form-group">
                <label class="form-label" for="task-desc">
                    Description <span class="optional">optional</span>
                </label>
                <textarea class="form-textarea" id="task-desc" name="description"
                          placeholder="Describe what needs to be done&#8230;"
                          >${escHtml(task?.description || '')}</textarea>
            </div>
            <div class="form-group">
                <label class="form-label" for="task-priority">Priority</label>
                <select class="form-select" id="task-priority" name="priority">
                    <option value="normal" ${(task?.priority||'normal')==='normal'?'selected':''}>Normal</option>
                    <option value="high"   ${task?.priority==='high'  ?'selected':''}>High &#9650;</option>
                    <option value="low"    ${task?.priority==='low'   ?'selected':''}>Low &#9660;</option>
                </select>
            </div>

            <div class="form-group">
                <label class="form-label" for="recur-type">Repeat</label>
                <select class="form-select" id="recur-type" name="recurType">
                    <option value="none"    ${!task?.recurrence || task.recurrence.type==='none'   ?'selected':''}>Does not repeat</option>
                    <option value="daily"   ${task?.recurrence?.type==='daily'   ?'selected':''}>Daily</option>
                    <option value="weekly"  ${task?.recurrence?.type==='weekly'  ?'selected':''}>Weekly</option>
                    <option value="monthly" ${task?.recurrence?.type==='monthly' ?'selected':''}>Monthly</option>
                </select>
            </div>
            <div id="recur-weekly-group" class="form-group"
                 style="display:${task?.recurrence?.type==='weekly'?'block':'none'}">
                <label class="form-label" for="recur-dow">Day of week</label>
                <select class="form-select" id="recur-dow" name="recurDow">
                    ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
                        .map((d,i)=>`<option value="${i}"${task?.recurrence?.dayOfWeek===i?' selected':''}>${d}</option>`)
                        .join('')}
                </select>
            </div>
            <div id="recur-monthly-group" class="form-group"
                 style="display:${task?.recurrence?.type==='monthly'?'block':'none'}">
                <label class="form-label" for="recur-dom">Day of month</label>
                <input class="form-input" type="number" id="recur-dom" name="recurDom"
                       min="1" max="31" value="${task?.recurrence?.dayOfMonth ?? 1}">
            </div>

            <div class="form-section-label">Assign to</div>
            <div class="area-checkbox-list" style="margin-bottom:12px;">
                ${allTargets.map(t => `
                    <div class="area-checkbox-item">
                        <input type="checkbox" id="area-check-${t.id}"
                               name="area-assign" value="${t.id}"
                               ${preChecked.has(t.id) ? 'checked' : ''}>
                        <label for="area-check-${t.id}">${escHtml(t.name)}</label>
                    </div>`).join('')}
            </div>

            <div id="assignment-panels">
                ${allTargets.map(t => buildPanel(t)).join('')}
            </div>

            <div class="form-actions">
                ${isEdit ? `
                    <button type="button" class="btn btn-danger btn-sm" id="delete-task-form-btn"
                            style="margin-right:auto;">Delete task</button>` : ''}
                <button type="button" class="btn btn-secondary" id="cancel-task-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="save-task-btn">
                    ${isEdit ? 'Save changes' : 'Add task'}
                </button>
            </div>
        </form>
    `;

    showModal(isEdit ? 'Edit Task' : 'Add Task', html);

    // Recurrence type — show/hide sub-options and auto-fill due dates
    const recurTypeSel    = document.getElementById('recur-type');
    const recurWeeklyGrp  = document.getElementById('recur-weekly-group');
    const recurMonthlyGrp = document.getElementById('recur-monthly-group');

    /** Read the current recurrence settings from the form and return { recurrence, firstDate }.
     *  Returns null when "Does not repeat" is selected. */
    function currentRecurData() {
        const type = recurTypeSel?.value || 'none';
        if (type === 'none') return null;
        const dow = parseInt(document.getElementById('recur-dow')?.value ?? '0');
        const dom = parseInt(document.getElementById('recur-dom')?.value ?? '1');
        const recurrence = {
            type,
            dayOfWeek:  type === 'weekly'  ? dow : null,
            dayOfMonth: type === 'monthly' ? dom : null,
        };
        return { recurrence, firstDate: firstOccurrenceFromToday(recurrence) };
    }

    /** Stamp the first-occurrence date into a single due-date field,
     *  always overwriting (used when a panel is first revealed). */
    function stampDueDate(areaId, dateStr) {
        const dueEl = document.getElementById(`due-${areaId}`);
        if (dueEl) dueEl.value = dateStr;
    }

    function updateRecurUI() {
        const type = recurTypeSel?.value || 'none';
        if (recurWeeklyGrp)  recurWeeklyGrp.style.display  = type === 'weekly'  ? 'block' : 'none';
        if (recurMonthlyGrp) recurMonthlyGrp.style.display = type === 'monthly' ? 'block' : 'none';

        const data = currentRecurData();
        if (data) {
            // Overwrite every visible (checked) panel's due date with the new first occurrence
            allTargets.forEach(({ id: areaId }) => {
                const cb = document.getElementById(`area-check-${areaId}`);
                if (cb?.checked) stampDueDate(areaId, data.firstDate);
            });
        }
    }

    recurTypeSel?.addEventListener('change', updateRecurUI);
    document.getElementById('recur-dow')?.addEventListener('change', updateRecurUI);
    document.getElementById('recur-dom')?.addEventListener('change', updateRecurUI);

    // Show / hide panels as checkboxes change; pre-fill due date for recurring tasks
    document.querySelectorAll('[name="area-assign"]').forEach(cb => {
        cb.addEventListener('change', () => {
            const panel = document.getElementById(`panel-${cb.value}`);
            if (panel) panel.style.display = cb.checked ? 'block' : 'none';
            // When an area is newly checked and recurrence is active, fill in the due date
            if (cb.checked) {
                const data = currentRecurData();
                if (data) stampDueDate(cb.value, data.firstDate);
            }
        });
    });

    // Show / hide completion note when status changes
    allTargets.forEach(({ id: areaId }) => {
        const statusSel = document.getElementById(`status-${areaId}`);
        const noteGroup = document.getElementById(`note-group-${areaId}`);
        if (statusSel && noteGroup) {
            statusSel.addEventListener('change', () => {
                noteGroup.style.display = statusSel.value === 'completed' ? 'block' : 'none';
            });
        }
    });

    // Cancel
    document.getElementById('cancel-task-btn')?.addEventListener('click', hideModal);

    // Delete (edit mode only)
    document.getElementById('delete-task-form-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${task.title}" and all its area assignments?`)) return;
        try {
            await deleteTask(task.id);
            hideModal();
            showToast('Task deleted', 'success');
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error deleting task', 'error');
            console.error(err);
        }
    });

    // Submit
    document.getElementById('task-form').addEventListener('submit', async e => {
        e.preventDefault();
        const fd = new FormData(e.target);

        // Build recurrence object (null when "does not repeat")
        const recurType = fd.get('recurType') || 'none';
        const recurrence = recurType === 'none' ? null : {
            type:       recurType,
            dayOfWeek:  recurType === 'weekly'  ? parseInt(fd.get('recurDow') || '0')  : null,
            dayOfMonth: recurType === 'monthly' ? parseInt(fd.get('recurDom') || '1')  : null,
        };

        const taskData = {
            title:       (fd.get('title')       || '').trim(),
            description: (fd.get('description') || '').trim(),
            priority:    fd.get('priority') || 'normal',
            recurrence:  recurrence,
        };

        const checkedIds = allTargets
            .filter(t => document.getElementById(`area-check-${t.id}`)?.checked)
            .map(t => t.id);

        if (checkedIds.length === 0) {
            showToast('Please assign the task to at least one area or General', 'error');
            return;
        }

        const saveBtn = document.getElementById('save-task-btn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        try {
            let taskId = task?.id;

            if (isEdit) {
                await updateTask(taskId, taskData);
            } else {
                const ref = await addTask(taskData);
                taskId = ref.id;
            }

            // Create / update assignments
            for (const areaId of checkedIds) {
                const status = document.getElementById(`status-${areaId}`)?.value || 'todo';
                const dueDate = document.getElementById(`due-${areaId}`)?.value || null;
                const completionNote =
                    (document.getElementById(`note-${areaId}`)?.value || '').trim() || null;
                const plantCheckboxes =
                    document.querySelectorAll(`[name="plant-${areaId}"]:checked`);
                const plantIds = Array.from(plantCheckboxes).map(cb => cb.value);

                // Auto-set completedDate when first marking completed
                let completedDate = existingMap[areaId]?.completedDate || null;
                if (status === 'completed' && !completedDate) {
                    completedDate = todayStr();
                }

                // For new recurring assignments, set occurrenceDate = dueDate
                const existingAssign = existingMap[areaId];
                const occurrenceDate = recurrence
                    ? (existingAssign?.occurrenceDate || dueDate || null)
                    : null;

                const assignmentData = {
                    taskId,
                    areaId,
                    status,
                    dueDate:         dueDate || null,
                    completedDate:   completedDate || null,
                    completionNote:  completionNote || null,
                    plantIds,
                    isRecurring:     !!recurrence,
                    occurrenceDate:  occurrenceDate,
                    isSkipped:       existingAssign?.isSkipped || false,
                };

                if (existingMap[areaId]) {
                    await updateTaskAssignment(existingMap[areaId].id, assignmentData);
                } else {
                    await addTaskAssignment(assignmentData);
                }
            }

            // Remove assignments for unchecked targets (edit mode)
            if (isEdit) {
                for (const areaId of Object.keys(existingMap)) {
                    if (!checkedIds.includes(areaId)) {
                        await deleteTaskAssignment(existingMap[areaId].id);
                    }
                }
            }

            hideModal();
            showToast(isEdit ? 'Task updated!' : 'Task added!', 'success');
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error saving task', 'error');
            console.error(err);
            saveBtn.disabled = false;
            saveBtn.textContent = isEdit ? 'Save changes' : 'Add task';
        }
    });
}
