// =============================================================
//  irrigation-view.js — Irrigation calendar & reminders
// =============================================================

import {
    getIrrigationZones, addIrrigationZone, updateIrrigationZone, deleteIrrigationZone,
    getIrrigationLogsForZone, getIrrigationLogsForDateRange,
    addIrrigationLog, updateIrrigationLog, deleteIrrigationLog,
    getAreas, escHtml
} from './db.js';
import { showModal, hideModal, showToast, navigate } from './ui-utils.js';
import { isAtLeast } from './auth.js';

// =============================================
//  CONSTANTS
// =============================================

const DAY_SHORT  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_FULL   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_FULL  = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Colour palette for zone dots — cycles if more zones than colours
const ZONE_COLOURS = [
    '#3b82f6','#10b981','#f59e0b','#8b5cf6','#ef4444','#06b6d4',
    '#84cc16','#f97316','#ec4899','#14b8a6','#a855f7','#eab308'
];

// =============================================
//  MODULE STATE
// =============================================

let _currentDate    = '';   // YYYY-MM-DD — persists across tab switches
let _currentTab     = 'today';
let _zones          = [];
let _areas          = [];
let _container      = null;
let _headerEl       = null;
let _backBtn        = null;
let _historyOffset  = 0;    // 0 = most-recent 4 weeks; increments going further back

// =============================================
//  AREA HELPERS
// =============================================

/** Normalise zone area fields — returns an array of areaIds (may be empty).
 *  Supports both legacy single-area zones (areaId string) and multi-area
 *  ad-hoc zones (areaIds array). */
function getZoneAreaIds(zone) {
    if (Array.isArray(zone.areaIds) && zone.areaIds.length > 0) return zone.areaIds;
    if (zone.areaId) return [zone.areaId];
    return [];
}

// =============================================
//  DATE HELPERS
// =============================================

function todayStr() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
}

/** Monday-anchored week start for the given date */
function weekStart(dateStr) {
    const d   = new Date(dateStr + 'T12:00:00');
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
}

function fmtDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTH_SHORT[m - 1]} ${y}`;
}

function fmtDayDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return `${DAY_FULL[d.getDay()]}, ${fmtDate(dateStr)}`;
}

function dowOf(dateStr) { return new Date(dateStr + 'T12:00:00').getDay(); }

function timeToMins(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + (m || 0);
}

function minsToTime(mins) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

function fmtTime(t) {
    const [h, m] = (t || '00:00').split(':').map(Number);
    const ap   = h < 12 ? 'am' : 'pm';
    const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${hour}:${String(m).padStart(2,'0')} ${ap}`;
}

// =============================================
//  SCHEDULE HELPERS
// =============================================

function isSeasonallyActive(zone, dateStr) {
    if (!zone.seasonStart || !zone.seasonEnd) return true;
    const date = new Date(dateStr + 'T12:00:00');
    const mo   = date.getMonth() + 1;
    const day  = date.getDate();
    const [sm, sd] = zone.seasonStart.split('-').map(Number);
    const [em, ed] = zone.seasonEnd.split('-').map(Number);
    if (sm <= em) {
        // Normal season e.g. Apr–Oct
        return (mo > sm || (mo === sm && day >= sd)) && (mo < em || (mo === em && day <= ed));
    } else {
        // Wrap-around e.g. Oct–Mar
        return (mo > sm || (mo === sm && day >= sd)) || (mo < em || (mo === em && day <= ed));
    }
}

/** Returns true if zone is due to run on the given date */
function isZoneDueOnDate(zone, dateStr) {
    if (!zone.active) return false;
    if (!isSeasonallyActive(zone, dateStr)) return false;

    const dow  = dowOf(dateStr);
    const days = zone.scheduleDays || [];

    if (zone.type === 'auto') return days.includes(dow);

    // Manual recurrence
    if (zone.recurrence === 'none') return false;
    switch (zone.recurrence) {
        case 'daily':        return true;
        case 'weekly':
        case 'twice-weekly': return days.includes(dow);
        case 'fortnightly': {
            if (!days.includes(dow)) return false;
            if (!zone.firstRunDate)  return true;
            const ref     = new Date(zone.firstRunDate + 'T12:00:00');
            const cur     = new Date(dateStr + 'T12:00:00');
            const diffMs  = cur - ref;
            const diffWks = Math.round(diffMs / (7 * 24 * 3600 * 1000));
            return diffWks % 2 === 0;
        }
        default: return false;
    }
}

function getAutoZonesOnDate(zones, dateStr) {
    return zones
        .filter(z => z.type === 'auto' && isZoneDueOnDate(z, dateStr))
        .sort((a, b) => timeToMins(a.startTime) - timeToMins(b.startTime));
}

function getManualZonesDueOnDate(zones, dateStr) {
    return zones.filter(z => z.type === 'manual' && isZoneDueOnDate(z, dateStr));
}

/**
 * Returns every date in [fromDate, toDate] (inclusive, YYYY-MM-DD) on which
 * the given zone was scheduled to run.  Caps the scan at 60 days for safety.
 */
function getPastScheduledDates(zone, fromDate, toDate) {
    const dates = [];
    let d = fromDate;
    let guard = 0;
    while (d <= toDate && guard++ < 60) {
        if (isZoneDueOnDate(zone, d)) dates.push(d);
        d = addDays(d, 1);
    }
    return dates;
}

function zoneColour(zone) {
    const idx = _zones.indexOf(zone);
    return ZONE_COLOURS[(idx < 0 ? 0 : idx) % ZONE_COLOURS.length];
}

/** Human-readable one-liner of a zone's schedule */
function scheduleDesc(zone) {
    if (!zone.active) return 'Inactive';
    const days = (zone.scheduleDays || []).map(d => DAY_SHORT[d]);
    const dur  = zone.duration || 0;

    if (zone.type === 'auto') {
        const t = fmtTime(zone.startTime || '00:00');
        return days.length ? `${days.join(', ')} at ${t} · ${dur} min` : 'No days set';
    }
    switch (zone.recurrence) {
        case 'none':         return `Ad-hoc · ${dur} min`;
        case 'daily':        return `Daily · ${dur} min`;
        case 'weekly':       return `Weekly (${days.join(', ')}) · ${dur} min`;
        case 'twice-weekly': return `Twice weekly (${days.join(', ')}) · ${dur} min`;
        case 'fortnightly':  return `Fortnightly (${days.join(', ')}) · ${dur} min`;
        default:             return 'No schedule set';
    }
}

// =============================================
//  OVERDUE / AUTO-SKIP HELPERS
// =============================================

/**
 * For each manual zone, finds all scheduled dates in the past 42 days that
 * have no log.  If a zone has MORE THAN ONE such pending date (i.e. multiple
 * missed cycles), it auto-creates "skipped" log entries for all but the most
 * recent one — because a new scheduled cycle has now arrived, making the
 * earlier ones stale.
 *
 * This is idempotent: it only creates a log where none exists, so running it
 * multiple times on the same day is safe.
 */
async function autoSkipStaleOccurrences(today) {
    const lookbackStart = addDays(today, -42);
    const yesterday     = addDays(today, -1);

    let recentLogs = [];
    try {
        recentLogs = await getIrrigationLogsForDateRange(lookbackStart, yesterday);
    } catch (_) { return; }

    const logSet = new Set(recentLogs.map(l => `${l.zoneId}_${l.scheduledDate}`));

    const toSkip = [];
    for (const zone of _zones) {
        if (zone.type !== 'manual') continue;
        const scheduled   = getPastScheduledDates(zone, lookbackStart, yesterday);
        const pendingDates = scheduled.filter(d => !logSet.has(`${zone.id}_${d}`));

        // Keep the most recent pending date as genuinely overdue;
        // auto-skip everything older (a newer cycle has superseded them).
        if (pendingDates.length > 1) {
            for (const date of pendingDates.slice(0, -1)) {
                toSkip.push({ zone, date });
            }
        }
    }

    if (toSkip.length === 0) return;

    await Promise.all(toSkip.map(({ zone, date }) =>
        addIrrigationLog({
            zoneId:        zone.id,
            scheduledDate: date,
            status:        'skipped',
            notes:         'Auto-skipped: next scheduled date arrived',
            autoSkipped:   true,
        }).catch(() => {}) // ignore individual failures silently
    ));
}

// =============================================
//  EXPORTED BANNER INFO  (used by garden-view.js)
// =============================================

export async function getIrrigationBannerInfo() {
    const today = todayStr();
    let zones, logs;
    try {
        [zones, logs] = await Promise.all([
            getIrrigationZones(),
            getIrrigationLogsForDateRange(today, today)
        ]);
    } catch (_) { return null; }

    const manualDue = getManualZonesDueOnDate(zones, today);
    if (!manualDue.length) return { due: 0, pending: 0, done: 0, pendingNames: [] };

    const logMap = {};
    for (const log of logs) logMap[log.zoneId] = log;

    const pending = manualDue.filter(z => !logMap[z.id] || logMap[z.id].status === 'pending');
    const done    = manualDue.filter(z =>  logMap[z.id] && logMap[z.id].status !== 'pending');

    return {
        due:          manualDue.length,
        pending:      pending.length,
        done:         done.length,
        pendingNames: pending.map(z => z.name)
    };
}

// =============================================
//  MAIN RENDER
// =============================================

export async function renderIrrigationView(container, headerActionEl, backBtn) {
    _container = container;
    _headerEl  = headerActionEl;
    _backBtn   = backBtn;

    if (!_currentDate) _currentDate = todayStr();

    // Show the header back button so users can return to the Admin page they
    // came from (Irrigation is opened via the Admin panel shortcut). The shared
    // back button is wired to goBack() in main.js, which restores Admin.
    backBtn.classList.add('visible');
    headerActionEl.innerHTML = '';
    document.querySelector('.fab')?.remove();

    try {
        [_zones, _areas] = await Promise.all([getIrrigationZones(), getAreas()]);
    } catch (e) {
        container.innerHTML = `<div class="empty-state"><p>Error loading irrigation data.</p></div>`;
        return;
    }

    renderShell();
    await switchTab(_currentTab);
}

function renderShell() {
    _container.innerHTML = `
        <div class="irr-tab-bar">
            <button class="irr-tab-btn${_currentTab==='today'   ?' active':''}" data-tab="today">💧 Today</button>
            <button class="irr-tab-btn${_currentTab==='week'    ?' active':''}" data-tab="week">📅 Week</button>
            <button class="irr-tab-btn${_currentTab==='history' ?' active':''}" data-tab="history">📋 History</button>
            <button class="irr-tab-btn${_currentTab==='zones'   ?' active':''}" data-tab="zones">⚙️ Zones</button>
        </div>
        <div id="irr-content"></div>
    `;
    _container.querySelectorAll('.irr-tab-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            _currentTab = btn.dataset.tab;
            if (_currentTab === 'today') _currentDate = todayStr();
            _container.querySelectorAll('.irr-tab-btn')
                .forEach(b => b.classList.toggle('active', b.dataset.tab === _currentTab));
            await switchTab(_currentTab);
        });
    });
}

async function switchTab(tab) {
    const el = document.getElementById('irr-content');
    if (!el) return;
    el.innerHTML = '<div class="empty-state" style="padding-top:48px"><p>Loading…</p></div>';
    try {
        if      (tab === 'today')   await renderTodayTab(el);
        else if (tab === 'week')    await renderWeekTab(el);
        else if (tab === 'history') await renderHistoryTab(el);
        else if (tab === 'zones')   await renderZonesTab(el);
    } catch (e) {
        el.innerHTML = `<div class="empty-state"><p>Error loading view.</p></div>`;
        console.error(e);
    }
}

// =============================================
//  MANUAL CARD BUILDER  (shared by Today & overdue)
// =============================================

/**
 * Renders a single manual-zone card.
 * @param {object}  zone       Zone document
 * @param {string}  cardDate   Scheduled date (YYYY-MM-DD) — may differ from
 *                             today when showing overdue cards
 * @param {object|null} log    Existing log for this zone+date (or null)
 * @param {string}  areaName   Display name of the linked area (or '')
 * @param {string}  colour     CSS colour string for the zone dot
 * @param {boolean} isOverdue  If true, renders in the overdue style with a
 *                             "Scheduled for …" sub-label
 */
function buildManualCard(zone, cardDate, log, areaName, colour, isOverdue) {
    const status = log ? log.status : 'pending';

    let html = `<div class="irr-manual-card ${status}${isOverdue ? ' overdue' : ''}" data-zone-id="${zone.id}">
        <div class="irr-manual-header">
            <div class="irr-dot" style="background:${colour}"></div>
            <div class="irr-manual-info">
                <div class="irr-manual-name">${escHtml(zone.name)}</div>
                ${isOverdue
                    ? `<div class="irr-overdue-tag">Scheduled for ${fmtDate(cardDate)}</div>`
                    : ''}
                ${areaName ? `<div class="irr-area-chip">${escHtml(areaName)}</div>` : ''}
            </div>
            ${status === 'pending'
                ? `<div class="irr-manual-dur">${zone.duration || 0} min</div>`
                : `<span class="irr-status-chip ${status}">${status === 'completed' ? '✓ Done' : '✗ Skipped'}</span>`
            }
        </div>`;

    if (status === 'pending' && isAtLeast('editor')) {
        html += `<div class="irr-action-row">
            <button class="irr-action-chip irr-action-chip--done irr-done-btn"
                    data-zone-id="${zone.id}" data-date="${cardDate}">✓ Done</button>
            <button class="irr-action-chip irr-action-chip--skip irr-skip-btn"
                    data-zone-id="${zone.id}" data-date="${cardDate}">✗ Skip</button>
        </div>`;
    } else if (status !== 'pending' && log) {
        const dur        = (status === 'completed' && log.actualDuration) ? `${log.actualDuration} min` : '';
        const hasDetails = dur || log.notes || isAtLeast('editor');
        if (hasDetails) {
            html += `<div class="irr-log-details">
                ${dur        ? `<span class="irr-log-dur">${dur}</span>` : ''}
                ${log.notes  ? `<span class="irr-log-note">${escHtml(log.notes)}</span>` : ''}
                ${isAtLeast('editor')
                    ? `<button class="btn btn-sm irr-btn-outline irr-edit-log-btn"
                               data-zone-id="${zone.id}" data-date="${cardDate}">Edit</button>`
                    : ''}
            </div>`;
        }
    }

    html += `</div>`;
    return html;
}

// =============================================
//  TODAY TAB
// =============================================

async function renderTodayTab(el) {
    const date  = _currentDate;
    const today = todayStr();
    const isToday = date === today;
    const isPast  = date < today;

    // Logs for the displayed date (needed for today's manual & auto zones)
    let logs = [];
    try { logs = await getIrrigationLogsForDateRange(date, date); } catch (_) {}
    const logByZone     = {};
    const logByZoneArea = {};   // 'zoneId_areaId' → log (for multi-area ad-hoc zones)
    for (const l of logs) {
        logByZone[l.zoneId] = l;
        if (l.areaId) logByZoneArea[`${l.zoneId}_${l.areaId}`] = l;
    }

    // ── Overdue detection (only when viewing today) ─────────────
    let overdueDisplay = [];
    if (isToday) {
        // 1. Auto-skip any stale missed cycles first
        try { await autoSkipStaleOccurrences(today); } catch (_) {}

        // 2. Find the most-recent still-pending date for each manual zone
        const lookbackStart = addDays(today, -42);
        const yesterday     = addDays(today, -1);
        let pastLogs = [];
        try { pastLogs = await getIrrigationLogsForDateRange(lookbackStart, yesterday); } catch (_) {}
        const pastLogSet = new Set(pastLogs.map(l => `${l.zoneId}_${l.scheduledDate}`));

        for (const zone of _zones) {
            if (zone.type !== 'manual') continue;
            const scheduled    = getPastScheduledDates(zone, lookbackStart, yesterday);
            const pendingDates = scheduled.filter(d => !pastLogSet.has(`${zone.id}_${d}`));
            if (pendingDates.length > 0) {
                // Only the most recent unpaired date is still genuinely overdue
                overdueDisplay.push({ zone, dueDate: pendingDates[pendingDates.length - 1] });
            }
        }
    }

    const autoZones      = getAutoZonesOnDate(_zones, date);
    const manualZones    = getManualZonesDueOnDate(_zones, date);
    const adhocZones     = _zones.filter(z => z.type === 'manual' && z.recurrence === 'none');
    const hasConflict    = autoZones.length > 0 && manualZones.length > 0;
    const areaMap        = Object.fromEntries(_areas.map(a => [a.id, a.name]));

    // Don't double-show a zone that's both overdue AND scheduled for today
    const manualTodayIds = new Set(manualZones.map(z => z.id));
    overdueDisplay       = overdueDisplay.filter(({ zone }) => !manualTodayIds.has(zone.id));

    const pendingTodayCount  = manualZones.filter(z => { const l = logByZone[z.id]; return !l || l.status === 'pending'; }).length;
    const totalPendingCount  = pendingTodayCount + overdueDisplay.length;
    const hasSomeManual      = manualZones.length > 0 || overdueDisplay.length > 0;

    let html = `
        <div class="irr-date-nav">
            <button class="irr-nav-arrow" id="irr-prev-day" aria-label="Previous day">&#8249;</button>
            <div class="irr-date-label">
                <div class="irr-date-chip">${isToday ? 'Today' : isPast ? 'Past' : 'Upcoming'}</div>
                <div class="irr-date-full">${fmtDayDate(date)}</div>
            </div>
            <button class="irr-nav-arrow" id="irr-next-day" aria-label="Next day">&#8250;</button>
        </div>
    `;

    // ── Automated zones ──────────────────────────────
    if (autoZones.length > 0) {
        html += `<div class="irr-section">
            <div class="irr-section-title">Automated zones</div>`;

        for (const zone of autoZones) {
            const colour   = zoneColour(zone);
            const startM   = timeToMins(zone.startTime || '00:00');
            const endM     = startM + (zone.duration || 0);
            const areaName = areaMap[zone.areaId] || '';
            const log      = logByZone[zone.id];

            html += `
                <div class="irr-auto-row">
                    <div class="irr-dot" style="background:${colour}"></div>
                    <div class="irr-auto-info">
                        <div class="irr-auto-name">${escHtml(zone.name)}</div>
                        <div class="irr-auto-meta">
                            ${fmtTime(zone.startTime || '00:00')} → ${fmtTime(minsToTime(endM))} · ${zone.duration || 0} min
                            ${areaName ? `· <span class="irr-area-chip">${escHtml(areaName)}</span>` : ''}
                        </div>
                        ${log ? `<div class="irr-auto-logged ${log.status}">
                            ${log.status === 'completed' ? '✓ Logged' : '✗ Skipped'}
                            ${log.notes ? ` · ${escHtml(log.notes)}` : ''}
                        </div>` : ''}
                    </div>
                    ${isAtLeast('editor') ? `
                    <button class="btn btn-sm ${log ? 'btn-secondary' : 'irr-btn-outline'} irr-log-auto-btn"
                            data-zone-id="${zone.id}" data-date="${date}">
                        ${log ? 'Edit log' : 'Log'}
                    </button>` : ''}
                </div>`;
        }
        html += `</div>`;
    }

    // ── Manual zones (overdue + today's scheduled) ───
    if (hasSomeManual) {
        html += `<div class="irr-section">
            <div class="irr-section-title">
                Manual zones
                ${totalPendingCount > 0
                    ? `<span class="irr-badge irr-badge--pending">${totalPendingCount} pending</span>`
                    : `<span class="irr-badge irr-badge--done">✓ All done</span>`}
            </div>
            ${hasConflict ? `<div class="irr-conflict-note">
                💡 Auto zones are scheduled today — plan your manual runs around them above
            </div>` : ''}`;

        // Overdue entries from previous days
        if (overdueDisplay.length > 0) {
            html += `<div class="irr-overdue-section-hdr">⚠️ Carried over from earlier</div>`;
            for (const { zone, dueDate } of overdueDisplay) {
                html += buildManualCard(zone, dueDate, null,
                    areaMap[zone.areaId] || '', zoneColour(zone), true);
            }
            if (manualZones.length > 0) {
                html += `<div class="irr-today-divider">Today's schedule</div>`;
            }
        }

        // Today's scheduled manual zones
        for (const zone of manualZones) {
            const log = logByZone[zone.id] || null;
            html += buildManualCard(zone, date, log,
                areaMap[zone.areaId] || '', zoneColour(zone), false);
        }

        html += `</div>`;
    }

    // ── Ad-hoc zones (no fixed schedule) ─────────────
    if (adhocZones.length > 0) {
        html += `<div class="irr-section">
            <div class="irr-section-title">Ad-hoc zones</div>
            <p class="form-hint" style="margin:0 0 10px">No fixed schedule — log a watering any time you do it.</p>`;
        for (const zone of adhocZones) {
            const colour   = zoneColour(zone);
            const zAreaIds = getZoneAreaIds(zone);

            if (zAreaIds.length > 1) {
                // Multi-area zone — show one loggable row per area inside the card
                const allDone = zAreaIds.every(aid => logByZoneArea[`${zone.id}_${aid}`]);
                html += `<div class="irr-manual-card${allDone ? ' completed' : ''}">
                    <div class="irr-manual-header">
                        <div class="irr-dot" style="background:${colour}"></div>
                        <div class="irr-manual-info">
                            <div class="irr-manual-name">${escHtml(zone.name)}</div>
                        </div>
                        ${allDone
                            ? `<span class="irr-status-chip completed">✓ All done</span>`
                            : `<div class="irr-manual-dur">${zone.duration || 0} min</div>`}
                    </div>`;
                for (const areaId of zAreaIds) {
                    const aName  = areaMap[areaId] || 'Unknown area';
                    const aLog   = logByZoneArea[`${zone.id}_${areaId}`];
                    html += `<div class="irr-adhoc-area-row${aLog ? ' done' : ''}">
                        <span class="irr-area-chip" style="flex:1">${escHtml(aName)}</span>
                        ${aLog
                            ? `<span class="irr-status-chip completed" style="font-size:0.78rem">✓ Done</span>`
                            : (isAtLeast('editor')
                                ? `<button class="irr-action-chip irr-action-chip--done irr-adhoc-log-btn"
                                           data-zone-id="${zone.id}" data-area-id="${areaId}"
                                           style="padding:3px 12px;font-size:0.8rem">💧 Log</button>`
                                : '')}
                    </div>`;
                }
                html += `</div>`;
            } else {
                // Single-area (or no-area) zone — original card
                const areaName = areaMap[zAreaIds[0]] || '';
                const todayLog = logByZone[zone.id];
                html += `<div class="irr-manual-card${todayLog ? ' completed' : ''}">
                    <div class="irr-manual-header">
                        <div class="irr-dot" style="background:${colour}"></div>
                        <div class="irr-manual-info">
                            <div class="irr-manual-name">${escHtml(zone.name)}</div>
                            ${areaName ? `<div class="irr-area-chip">${escHtml(areaName)}</div>` : ''}
                        </div>
                        ${todayLog
                            ? `<span class="irr-status-chip completed">✓ Done today</span>`
                            : `<div class="irr-manual-dur">${zone.duration || 0} min</div>`}
                    </div>
                    ${isAtLeast('editor') ? `
                    <div class="irr-action-row">
                        <button class="irr-action-chip irr-action-chip--done irr-adhoc-log-btn"
                                data-zone-id="${zone.id}">💧 Log watering</button>
                    </div>` : ''}
                </div>`;
            }
        }
        html += `</div>`;
    }

    // ── Empty state ───────────────────────────────────
    if (autoZones.length === 0 && !hasSomeManual && adhocZones.length === 0) {
        html += `<div class="empty-state" style="margin-top:40px">
            <div class="empty-state-icon">💧</div>
            <h3>No irrigation ${isToday ? 'today' : 'on this day'}</h3>
            <p>${isToday ? 'Nothing scheduled for today.' : `Nothing scheduled for ${fmtDate(date)}.`}</p>
        </div>`;
    }

    el.innerHTML = html;

    // ── Events ────────────────────────────────────────
    el.querySelector('#irr-prev-day')?.addEventListener('click', async () => {
        _currentDate = addDays(_currentDate, -1);
        await renderTodayTab(el);
    });
    el.querySelector('#irr-next-day')?.addEventListener('click', async () => {
        _currentDate = addDays(_currentDate, 1);
        await renderTodayTab(el);
    });

    // Auto zone log
    el.querySelectorAll('.irr-log-auto-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone = _zones.find(z => z.id === btn.dataset.zoneId);
            if (zone) showLogModal(zone, btn.dataset.date,
                logByZone[zone.id] || null,
                async () => { await renderTodayTab(el); });
        });
    });

    // Manual done — btn.dataset.date may be today or an overdue date
    el.querySelectorAll('.irr-done-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone = _zones.find(z => z.id === btn.dataset.zoneId);
            if (zone) showLogModal(zone, btn.dataset.date, null,
                async () => { await renderTodayTab(el); }, 'completed');
        });
    });

    // Manual skip
    el.querySelectorAll('.irr-skip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone = _zones.find(z => z.id === btn.dataset.zoneId);
            if (zone) showLogModal(zone, btn.dataset.date, null,
                async () => { await renderTodayTab(el); }, 'skipped');
        });
    });

    // Edit existing log — only appears on today's logged cards
    el.querySelectorAll('.irr-edit-log-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone = _zones.find(z => z.id === btn.dataset.zoneId);
            if (zone) showLogModal(zone, btn.dataset.date,
                logByZone[zone.id] || null,
                async () => { await renderTodayTab(el); });
        });
    });

    // Ad-hoc log button — for zones with no fixed schedule
    el.querySelectorAll('.irr-adhoc-log-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone   = _zones.find(z => z.id === btn.dataset.zoneId);
            const areaId = btn.dataset.areaId || null;
            if (zone) showAdhocLogModal(zone, areaId, async () => { await renderTodayTab(el); });
        });
    });
}

// =============================================
//  WEEK TAB
// =============================================

async function renderWeekTab(el) {
    const ws   = weekStart(_currentDate);
    const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    const today = todayStr();

    let logs = [];
    try { logs = await getIrrigationLogsForDateRange(ws, days[6]); } catch (_) {}

    // Build a nested map: date → zoneId → log
    const logMap = {};
    for (const log of logs) {
        if (!logMap[log.scheduledDate]) logMap[log.scheduledDate] = {};
        logMap[log.scheduledDate][log.zoneId] = log;
    }

    const areaMap = Object.fromEntries(_areas.map(a => [a.id, a.name]));

    let html = `
        <div class="irr-date-nav">
            <button class="irr-nav-arrow" id="irr-prev-week" aria-label="Previous week">&#8249;</button>
            <div class="irr-date-label">
                <div class="irr-date-chip">Week</div>
                <div class="irr-date-full">${fmtDate(ws)} – ${fmtDate(days[6])}</div>
            </div>
            <button class="irr-nav-arrow" id="irr-next-week" aria-label="Next week">&#8250;</button>
        </div>
        <div class="irr-week-grid">`;

    for (const day of days) {
        const autoZ     = getAutoZonesOnDate(_zones, day);
        const manualDue = getManualZonesDueOnDate(_zones, day);
        const dayLogs   = logMap[day] || {};
        const pending   = manualDue.filter(z => !dayLogs[z.id] || dayLogs[z.id].status === 'pending');
        const done      = manualDue.filter(z =>  dayLogs[z.id] && dayLogs[z.id].status !== 'pending');
        const isToday   = day === today;
        const isPast    = day < today;
        const d         = new Date(day + 'T12:00:00');

        html += `
            <div class="irr-week-col${isToday ? ' today' : ''}${isPast ? ' past' : ''}" data-date="${day}">
                <div class="irr-week-dow">${DAY_SHORT[d.getDay()]}</div>
                <div class="irr-week-num">${d.getDate()}</div>
                <div class="irr-week-dots">
                    ${autoZ.map(z => {
                        const colour = zoneColour(z);
                        const zLog   = dayLogs[z.id];
                        const op     = zLog ? (zLog.status === 'skipped' ? 0.25 : 0.5) : 1;
                        return `<div class="irr-week-dot" style="background:${colour};opacity:${op}"
                                     title="${escHtml(z.name)}"></div>`;
                    }).join('')}
                </div>
                <div class="irr-week-manual">
                    ${pending.length > 0
                        ? `<div class="irr-week-badge pending">${pending.length}💧</div>`
                        : done.length > 0
                            ? `<div class="irr-week-badge done">✓</div>`
                            : ''}
                </div>
            </div>`;
    }

    html += `</div>`;

    // Colour legend for auto zones
    const activeAutoZones = _zones.filter(z => z.type === 'auto' && z.active);
    if (activeAutoZones.length > 0) {
        html += `<div class="irr-legend">
            <div class="irr-legend-title">Auto zone key</div>
            <div class="irr-legend-grid">
                ${activeAutoZones.map(z => `
                    <div class="irr-legend-item">
                        <div class="irr-legend-dot" style="background:${zoneColour(z)}"></div>
                        <span>${escHtml(z.name)}${z.areaId && areaMap[z.areaId] ? ` <span class="irr-area-chip">${escHtml(areaMap[z.areaId])}</span>` : ''}</span>
                    </div>`).join('')}
            </div>
        </div>`;
    }

    el.innerHTML = html;

    el.querySelector('#irr-prev-week')?.addEventListener('click', async () => {
        _currentDate = addDays(weekStart(_currentDate), -1);
        await renderWeekTab(el);
    });
    el.querySelector('#irr-next-week')?.addEventListener('click', async () => {
        _currentDate = addDays(weekStart(_currentDate), 7);
        await renderWeekTab(el);
    });

    el.querySelectorAll('.irr-week-col').forEach(col => {
        col.addEventListener('click', () => {
            _currentDate = col.dataset.date;
            _currentTab  = 'today';
            _container.querySelectorAll('.irr-tab-btn')
                .forEach(b => b.classList.toggle('active', b.dataset.tab === 'today'));
            const content = document.getElementById('irr-content');
            if (content) renderTodayTab(content);
        });
    });
}

// =============================================
//  HISTORY TAB
// =============================================

async function renderHistoryTab(el) {
    const today       = todayStr();
    const daysInView  = 28;   // 4 weeks

    // Most-recent period ends yesterday; older periods step back daysInView at a time
    const toDate   = addDays(today, -1 - _historyOffset * daysInView);
    const fromDate = addDays(toDate, -(daysInView - 1));

    let logs = [];
    try { logs = await getIrrigationLogsForDateRange(fromDate, toDate); } catch (_) {}

    const logMap = {};
    for (const log of logs) {
        logMap[`${log.zoneId}_${log.scheduledDate}`] = log;
    }

    const areaMap = Object.fromEntries(_areas.map(a => [a.id, a.name]));

    // Build the full set of events: every scheduled manual occurrence in the window
    const events = [];
    for (const zone of _zones) {
        if (zone.type !== 'manual') continue;
        for (const date of getPastScheduledDates(zone, fromDate, toDate)) {
            events.push({ zone, date, log: logMap[`${zone.id}_${date}`] || null });
        }
    }
    // Add logs from ad-hoc (no-schedule) zones
    for (const log of logs) {
        const zone = _zones.find(z => z.id === log.zoneId && z.type === 'manual' && z.recurrence === 'none');
        if (zone) events.push({ zone, date: log.scheduledDate, log, isAdhoc: true });
    }

    // Newest first, then by zone name
    events.sort((a, b) =>
        b.date !== a.date ? b.date.localeCompare(a.date) : a.zone.name.localeCompare(b.zone.name)
    );

    // ── Summary stats ────────────────────────────────
    const completedEvts  = events.filter(e => e.log?.status === 'completed');
    const skippedEvts    = events.filter(e => e.log?.status === 'skipped');
    const missedEvts     = events.filter(e => !e.log);
    const totalMins      = completedEvts.reduce((s, e) => s + (e.log.actualDuration || e.zone.duration || 0), 0);
    const completionPct  = events.length > 0 ? Math.round(completedEvts.length / events.length * 100) : 0;

    // ── Nav header ───────────────────────────────────
    let html = `
        <div class="irr-date-nav">
            <button class="irr-nav-arrow" id="irr-hist-newer"
                    aria-label="Newer period" ${_historyOffset === 0 ? 'disabled style="opacity:0.3"' : ''}>&#8249;</button>
            <div class="irr-date-label">
                <div class="irr-date-chip">History</div>
                <div class="irr-date-full">${fmtDate(fromDate)} – ${fmtDate(toDate)}</div>
            </div>
            <button class="irr-nav-arrow" id="irr-hist-older" aria-label="Older period">&#8250;</button>
        </div>`;

    if (events.length === 0) {
        html += `<div class="empty-state" style="margin-top:40px">
            <div class="empty-state-icon">📋</div>
            <h3>No manual zones scheduled</h3>
            <p>No manual irrigation was scheduled in this period.</p>
        </div>`;
        el.innerHTML = html;
    } else {
        // Stats bar
        const hrs = (Math.round(totalMins / 6) / 10).toFixed(1);
        html += `<div class="irr-hist-tab-stats">
            <div class="irr-hist-stat">
                <div class="irr-hist-val">${completedEvts.length}</div>
                <div class="irr-hist-lbl">Done</div>
            </div>
            <div class="irr-hist-stat">
                <div class="irr-hist-val">${skippedEvts.length}</div>
                <div class="irr-hist-lbl">Skipped</div>
            </div>
            <div class="irr-hist-stat">
                <div class="irr-hist-val">${missedEvts.length}</div>
                <div class="irr-hist-lbl">Missed</div>
            </div>
            <div class="irr-hist-stat">
                <div class="irr-hist-val">${completionPct}%</div>
                <div class="irr-hist-lbl">Rate · ${hrs} h</div>
            </div>
        </div>`;

        // Group events by ISO week start (Monday)
        const weekGroups = {};
        for (const evt of events) {
            const ws = weekStart(evt.date);
            if (!weekGroups[ws]) weekGroups[ws] = [];
            weekGroups[ws].push(evt);
        }
        const weekKeys = Object.keys(weekGroups).sort((a, b) => b.localeCompare(a));

        for (const ws of weekKeys) {
            html += `<div class="irr-hist-week-group">
                <div class="irr-hist-week-hdr">Week of ${fmtDate(ws)}</div>`;

            for (const { zone, date, log } of weekGroups[ws]) {
                const colour   = zoneColour(zone);
                // Prefer the log's areaId (set for multi-area ad-hoc logs) over zone's primary areaId
                const areaName = areaMap[log?.areaId] || areaMap[zone.areaId] || '';
                const d        = new Date(date + 'T12:00:00');
                const dayLabel = `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;

                let statusChip;
                if (!log) {
                    statusChip = `<span class="irr-status-chip missed">— Missed</span>`;
                } else if (log.status === 'completed') {
                    const dur = log.actualDuration ? ` · ${log.actualDuration} min` : '';
                    statusChip = `<span class="irr-status-chip completed">✓ Done${dur}</span>`;
                } else {
                    const auto = log.autoSkipped ? ' (auto)' : '';
                    statusChip = `<span class="irr-status-chip skipped">✗ Skip${auto}</span>`;
                }

                const rowClass = log ? log.status : 'missed';
                html += `<div class="irr-hist-event-row ${rowClass}">
                    <div class="irr-hist-event-date">${dayLabel}</div>
                    <div class="irr-dot" style="background:${colour};flex-shrink:0"></div>
                    <div class="irr-hist-event-info">
                        <span class="irr-hist-event-name">${escHtml(zone.name)}</span>
                        ${areaName ? `<span class="irr-area-chip" style="margin-left:5px">${escHtml(areaName)}</span>` : ''}
                        ${log?.notes && !log.autoSkipped ? `<div class="irr-hist-event-note">${escHtml(log.notes)}</div>` : ''}
                    </div>
                    ${statusChip}
                </div>`;
            }
            html += `</div>`;
        }

        el.innerHTML = html;
    }

    el.querySelector('#irr-hist-newer')?.addEventListener('click', async () => {
        if (_historyOffset > 0) { _historyOffset--; await renderHistoryTab(el); }
    });
    el.querySelector('#irr-hist-older')?.addEventListener('click', async () => {
        _historyOffset++;
        await renderHistoryTab(el);
    });
}

// =============================================
//  ZONES TAB
// =============================================

async function renderZonesTab(el) {
    const areaMap = Object.fromEntries(_areas.map(a => [a.id, a.name]));

    // Group zones by area
    const byArea = {};
    for (const zone of _zones) {
        const key = zone.areaId || '_none';
        if (!byArea[key]) byArea[key] = [];
        byArea[key].push(zone);
    }

    let html = '';

    if (isAtLeast('editor')) {
        html += `<div style="padding:14px 16px 4px">
            <button class="btn btn-primary btn-sm" id="irr-add-zone-btn">+ Add Zone</button>
        </div>`;
    }

    const areaKeys = Object.keys(byArea).sort((a, b) => {
        const na = areaMap[a] || 'Unassigned';
        const nb = areaMap[b] || 'Unassigned';
        return na.localeCompare(nb);
    });

    if (areaKeys.length === 0) {
        html += `<div class="empty-state" style="margin-top:40px">
            <div class="empty-state-icon">💧</div>
            <h3>No zones yet</h3>
            <p>Add your first irrigation zone to get started.</p>
        </div>`;
    }

    for (const key of areaKeys) {
        const areaName = areaMap[key] || 'Unassigned area';
        html += `<div class="irr-area-group">
            <div class="irr-area-group-hdr">${escHtml(areaName)}</div>
            ${byArea[key].map(zone => `
                <div class="irr-zone-card${zone.active ? '' : ' inactive'}" data-zone-id="${zone.id}">
                    <div class="irr-zone-card-body">
                        <div>
                            <div class="irr-zone-card-name">
                                <div class="irr-dot" style="background:${zoneColour(zone)}"></div>
                                ${escHtml(zone.name)}
                                ${!zone.active ? '<span class="irr-inactive-tag">Inactive</span>' : ''}
                            </div>
                            <div class="irr-zone-card-meta">
                                <span class="irr-type-badge ${zone.type}">${zone.type === 'auto' ? 'Auto' : 'Manual'}</span>
                                <span class="irr-zone-sched">${escHtml(scheduleDesc(zone))}</span>
                            </div>
                        </div>
                        ${getZoneAreaIds(zone).length > 1 ? `
                        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;padding-top:6px;border-top:1px solid var(--grey-100)">
                            ${getZoneAreaIds(zone).map(id => areaMap[id] ? `<span class="irr-area-chip">${escHtml(areaMap[id])}</span>` : '').join('')}
                        </div>` : ''}
                        <div class="irr-zone-card-btns" style="margin-top:${getZoneAreaIds(zone).length > 1 ? '6px' : ''}">
                            ${zone.type === 'manual' && zone.recurrence === 'none' && isAtLeast('editor')
                                ? `<button class="btn btn-sm irr-btn-outline irr-adhoc-zone-btn" data-zone-id="${zone.id}">💧 Log</button>`
                                : ''}
                            <button class="btn-icon irr-history-btn" data-zone-id="${zone.id}" title="View history">📊</button>
                            ${isAtLeast('editor')
                                ? `<button class="btn-icon irr-edit-zone-btn" data-zone-id="${zone.id}" title="Edit zone">✏️</button>`
                                : ''}
                        </div>
                    </div>
                </div>`).join('')}
        </div>`;
    }

    el.innerHTML = html;

    el.querySelector('#irr-add-zone-btn')?.addEventListener('click', () => {
        showZoneForm(null, async () => {
            _zones = await getIrrigationZones();
            await renderZonesTab(el);
        });
    });

    el.querySelectorAll('.irr-edit-zone-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone = _zones.find(z => z.id === btn.dataset.zoneId);
            if (zone) showZoneForm(zone, async () => {
                _zones = await getIrrigationZones();
                await renderZonesTab(el);
            });
        });
    });

    el.querySelectorAll('.irr-history-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const zone = _zones.find(z => z.id === btn.dataset.zoneId);
            if (!zone) return;
            let logs = [];
            try { logs = await getIrrigationLogsForZone(zone.id); } catch (_) {}
            showZoneHistory(zone, logs);
        });
    });

    el.querySelectorAll('.irr-adhoc-zone-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const zone = _zones.find(z => z.id === btn.dataset.zoneId);
            // Pass null areaId — the modal will show an area picker if the zone has multiple areas
            if (zone) showAdhocLogModal(zone, null, async () => {
                _zones = await getIrrigationZones();
                await renderZonesTab(el);
            });
        });
    });
}

// =============================================
//  ZONE FORM MODAL
// =============================================

function showZoneForm(zone, onSave) {
    const isEdit   = !!zone;
    const z        = zone || {};
    const v        = (k, def = '') => escHtml(String(z[k] ?? def));
    const zType    = z.type || 'manual';
    const zDays    = z.scheduleDays || [];
    const zRec     = z.recurrence || 'weekly';

    const areaOpts = _areas.map(a =>
        `<option value="${a.id}"${z.areaId === a.id ? ' selected' : ''}>${escHtml(a.name)}</option>`
    ).join('');

    // Multi-area dropdown options (ad-hoc zones only)
    // Use getZoneAreaIds so both areaIds[] and legacy single areaId are handled
    const existingAreaIds    = getZoneAreaIds(z);
    const areaDropdownOptions = _areas.map(a =>
        `<label class="irr-area-ms-option">
            <input type="checkbox" name="areaIds" value="${a.id}">
            ${escHtml(a.name)}
        </label>`
    ).join('');

    const isInitiallyAdhoc = zType === 'manual' && zRec === 'none';

    const dayBoxes = DAY_SHORT.map((name, i) => `
        <label class="irr-day-check">
            <input type="checkbox" name="scheduleDays" value="${i}" ${zDays.includes(i) ? 'checked' : ''}>
            ${name}
        </label>`).join('');

    const html = `
        <form id="zone-form" autocomplete="off">
            <div class="form-group">
                <label class="form-label" for="zn-name">Zone name</label>
                <input class="form-input" id="zn-name" name="name" value="${v('name')}"
                       placeholder="e.g. Shed Terrace — Front Drip" required autocapitalize="words">
            </div>
            <!-- Single-area selector (auto zones and scheduled manual zones) -->
            <div class="form-group" id="area-single-grp" style="display:${isInitiallyAdhoc ? 'none' : ''}">
                <label class="form-label" for="zn-area">Garden area</label>
                <select class="form-input" id="zn-area" name="areaId">
                    <option value="">— select area —</option>
                    ${areaOpts}
                </select>
            </div>
            <!-- Multi-area dropdown (ad-hoc manual zones only) -->
            <div class="form-group" id="area-multi-grp" style="display:${isInitiallyAdhoc ? '' : 'none'}">
                <label class="form-label">Garden areas <span class="optional">select all that apply</span></label>
                <div class="irr-area-ms" id="area-ms">
                    <button type="button" class="form-input irr-area-ms-trigger" id="area-ms-trigger"
                            style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;text-align:left;">
                        <span id="area-ms-label">Select areas…</span>
                        <span style="font-size:0.75rem;color:var(--grey-400);margin-left:8px">▾</span>
                    </button>
                    <div class="irr-area-ms-dropdown" id="area-ms-dropdown" style="display:none">
                        ${areaDropdownOptions}
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Zone type</label>
                <div class="irr-type-toggle">
                    <label class="irr-type-opt">
                        <input type="radio" name="type" value="auto"   ${zType==='auto'   ? 'checked':''}>
                        Automated (controller-run)
                    </label>
                    <label class="irr-type-opt">
                        <input type="radio" name="type" value="manual" ${zType==='manual' ? 'checked':''}>
                        Manual (you run it)
                    </label>
                </div>
            </div>

            <!-- Auto-zone fields -->
            <div id="auto-fields" style="display:${zType==='auto' ? '':'none'}">
                <div class="form-group">
                    <label class="form-label">Run days</label>
                    <div class="irr-day-checks">${dayBoxes}</div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label" for="zn-time">Start time</label>
                        <input class="form-input" type="time" id="zn-time" name="startTime"
                               value="${v('startTime','06:00')}">
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="zn-dur-auto">Duration (min)</label>
                        <input class="form-input" type="number" id="zn-dur-auto" name="durationAuto"
                               min="1" max="480" value="${v('duration','20')}">
                    </div>
                </div>
            </div>

            <!-- Manual-zone fields -->
            <div id="manual-fields" style="display:${zType==='manual' ? '':'none'}">
                <div class="form-group">
                    <label class="form-label" for="zn-rec">Schedule</label>
                    <select class="form-input" id="zn-rec" name="recurrence">
                        <option value="none"         ${zRec==='none'         ?'selected':''}>No schedule — log ad-hoc</option>
                        <option value="daily"        ${zRec==='daily'        ?'selected':''}>Daily</option>
                        <option value="weekly"       ${zRec==='weekly'       ?'selected':''}>Weekly</option>
                        <option value="twice-weekly" ${zRec==='twice-weekly' ?'selected':''}>Twice weekly</option>
                        <option value="fortnightly"  ${zRec==='fortnightly'  ?'selected':''}>Fortnightly (every two weeks)</option>
                    </select>
                </div>
                <div class="form-group" id="manual-days-grp"
                     style="display:${(zRec==='daily' || zRec==='none') ? 'none':''}">
                    <label class="form-label">Run day(s)</label>
                    <div class="irr-day-checks" id="manual-day-checks">${dayBoxes}</div>
                </div>
                <div class="form-group" id="first-run-grp"
                     style="display:${zRec==='fortnightly' ? '':'none'}">
                    <label class="form-label" for="zn-first-run">
                        First run date <span class="optional">(anchors the fortnightly cycle)</span>
                    </label>
                    <input class="form-input" type="date" id="zn-first-run" name="firstRunDate"
                           value="${v('firstRunDate', todayStr())}">
                </div>
                <div class="form-group">
                    <label class="form-label" for="zn-dur-manual">Default duration (min)</label>
                    <input class="form-input" type="number" id="zn-dur-manual" name="durationManual"
                           min="1" max="480" value="${v('duration','30')}">
                </div>
            </div>

            <!-- Seasonal window (shared) -->
            <div class="form-section-label">
                Season <span class="optional">optional — leave blank for year-round</span>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label" for="zn-ss">Active from (MM-DD)</label>
                    <input class="form-input" id="zn-ss" name="seasonStart"
                           value="${v('seasonStart')}" placeholder="04-01" maxlength="5">
                </div>
                <div class="form-group">
                    <label class="form-label" for="zn-se">Active to (MM-DD)</label>
                    <input class="form-input" id="zn-se" name="seasonEnd"
                           value="${v('seasonEnd')}" placeholder="10-31" maxlength="5">
                </div>
            </div>

            <div class="form-group">
                <label class="form-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="checkbox" name="active" ${z.active !== false ? 'checked':''} style="width:16px;height:16px;accent-color:var(--green-700)">
                    Zone is active
                </label>
            </div>
            <div class="form-group">
                <label class="form-label" for="zn-notes">Notes <span class="optional">optional</span></label>
                <textarea class="form-textarea" id="zn-notes" name="notes"
                          placeholder="Any notes about this zone…">${v('notes')}</textarea>
            </div>
            <div class="form-actions">
                ${isEdit && isAtLeast('admin')
                    ? `<button type="button" class="btn btn-danger btn-sm" id="del-zone-btn"
                               style="margin-right:auto">Delete zone</button>`
                    : ''}
                <button type="button" class="btn btn-secondary" id="cancel-zone-btn">Cancel</button>
                <button type="submit"  class="btn btn-primary"   id="save-zone-btn">Save</button>
            </div>
        </form>`;

    showModal(isEdit ? 'Edit Zone' : 'Add Zone', html);

    const form           = document.getElementById('zone-form');
    const autoFields     = document.getElementById('auto-fields');
    const manualFields   = document.getElementById('manual-fields');
    const manualDaysGrp  = document.getElementById('manual-days-grp');
    const firstRunGrp    = document.getElementById('first-run-grp');
    const recSelect      = document.getElementById('zn-rec');

    // ---- Multi-area dropdown widget ----
    const msTrigger  = document.getElementById('area-ms-trigger');
    const msDropdown = document.getElementById('area-ms-dropdown');
    const msLabelEl  = document.getElementById('area-ms-label');

    function updateMsLabel() {
        const checked = [...form.querySelectorAll('input[name="areaIds"]:checked')];
        if (checked.length === 0) {
            msLabelEl.textContent = 'Select areas…';
        } else if (checked.length === 1) {
            msLabelEl.textContent = _areas.find(a => a.id === checked[0].value)?.name || 'Area selected';
        } else {
            msLabelEl.textContent = `${checked.length} areas selected`;
        }
    }
    // Explicitly pre-select areas for edit mode (more reliable than HTML 'checked' attribute)
    existingAreaIds.forEach(areaId => {
        const cb = form.querySelector(`input[name="areaIds"][value="${areaId}"]`);
        if (cb) cb.checked = true;
    });
    updateMsLabel();   // reflect existing selections when editing a zone

    msTrigger?.addEventListener('click', e => {
        e.stopPropagation();
        const open = msDropdown.style.display !== 'none';
        msDropdown.style.display = open ? 'none' : '';
    });
    msDropdown?.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', updateMsLabel);
    });
    // Close dropdown when user clicks outside it
    function handleOutsideClick(e) {
        if (!document.getElementById('area-ms')?.contains(e.target)) {
            if (msDropdown) msDropdown.style.display = 'none';
            document.removeEventListener('click', handleOutsideClick);
        }
    }
    document.addEventListener('click', handleOutsideClick);

    // ---- Run-days toggle highlighting ----
    // Mirror each day checkbox's state onto a .checked class on its label, so the
    // green highlight works reliably even on browsers without :has() support
    // (e.g. older Android WebViews). Covers both auto and manual day pickers.
    form.querySelectorAll('.irr-day-check').forEach(label => {
        const cb = label.querySelector('input[type="checkbox"]');
        if (!cb) return;
        const sync = () => label.classList.toggle('checked', cb.checked);
        sync();
        cb.addEventListener('change', sync);
    });

    // Toggle between single-area dropdown and multi-area checkboxes
    function syncAreaSelector() {
        const typeVal = form.querySelector('input[name="type"]:checked')?.value;
        const recVal  = recSelect?.value;
        const adhoc   = typeVal === 'manual' && recVal === 'none';
        document.getElementById('area-single-grp').style.display = adhoc ? 'none' : '';
        document.getElementById('area-multi-grp').style.display  = adhoc ? '' : 'none';
    }

    // Type radio → show/hide field groups
    form.querySelectorAll('input[name="type"]').forEach(r => {
        r.addEventListener('change', () => {
            autoFields.style.display   = r.value === 'auto'   ? '' : 'none';
            manualFields.style.display = r.value === 'manual' ? '' : 'none';
            syncAreaSelector();
        });
    });

    // Recurrence → show/hide day picker and first-run date
    recSelect?.addEventListener('change', () => {
        const rec = recSelect.value;
        manualDaysGrp.style.display = (rec === 'daily' || rec === 'none') ? 'none' : '';
        firstRunGrp.style.display   = rec === 'fortnightly'  ? ''     : 'none';
        syncAreaSelector();
    });

    document.getElementById('cancel-zone-btn')?.addEventListener('click', hideModal);

    document.getElementById('del-zone-btn')?.addEventListener('click', async () => {
        if (!confirm(`Delete "${zone.name}"? All history logs will also be removed. This cannot be undone.`)) return;
        try {
            await deleteIrrigationZone(zone.id);
            showToast('Zone deleted', 'success');
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error deleting zone', 'error');
            console.error(err);
        }
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd   = new FormData(form);
        const type = fd.get('type');

        // Collect checked day indices from the relevant fieldset
        const dayInputs = type === 'auto'
            ? [...document.querySelectorAll('#auto-fields   input[name="scheduleDays"]:checked')]
            : [...document.querySelectorAll('#manual-fields input[name="scheduleDays"]:checked')];
        const days = dayInputs.map(cb => parseInt(cb.value));

        const data = {
            name:         (fd.get('name') || '').trim(),
            areaId:       fd.get('areaId') || '',
            type,
            active:       fd.get('active') === 'on',
            scheduleDays: days,
            notes:        (fd.get('notes') || '').trim(),
            seasonStart:  (fd.get('seasonStart') || '').trim(),
            seasonEnd:    (fd.get('seasonEnd') || '').trim(),
        };

        if (type === 'auto') {
            data.startTime = fd.get('startTime') || '06:00';
            data.duration  = parseInt(fd.get('durationAuto')) || 20;
        } else {
            data.recurrence = fd.get('recurrence') || 'weekly';
            data.duration   = parseInt(fd.get('durationManual')) || 30;
            if (data.recurrence === 'fortnightly') {
                data.firstRunDate = fd.get('firstRunDate') || todayStr();
            }
            if (data.recurrence === 'none') {
                // Multi-area ad-hoc zone: collect all checked area boxes
                data.areaIds = [...form.querySelectorAll('input[name="areaIds"]:checked')].map(cb => cb.value);
                data.areaId  = data.areaIds[0] || '';  // keep first as primary for grouping
            }
        }

        if (!data.name) { showToast('Please enter a zone name', 'error'); return; }

        const saveBtn = document.getElementById('save-zone-btn');
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

        try {
            if (isEdit) {
                await updateIrrigationZone(zone.id, data);
                showToast('Zone updated!', 'success');
            } else {
                await addIrrigationZone(data);
                showToast('Zone added!', 'success');
            }
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error saving zone', 'error');
            console.error(err);
            saveBtn.disabled = false; saveBtn.textContent = 'Save';
        }
    });
}

// =============================================
//  LOG MODAL  (complete / skip)
// =============================================

function showLogModal(zone, dateStr, existingLog, onSave, defaultStatus = null) {
    const log       = existingLog || {};
    const initStat  = defaultStatus || log.status || 'completed';
    const isEdit    = !!existingLog && !defaultStatus;

    const html = `
        <form id="log-form" autocomplete="off">
            <div class="irr-log-header">
                <strong>${escHtml(zone.name)}</strong>
                <span>${fmtDate(dateStr)}</span>
            </div>
            <div class="form-group">
                <label class="form-label">Status</label>
                <div class="irr-type-toggle">
                    <label class="irr-type-opt">
                        <input type="radio" name="status" value="completed"
                               ${initStat==='completed' ? 'checked':''}>
                        ✓ Done
                    </label>
                    <label class="irr-type-opt">
                        <input type="radio" name="status" value="skipped"
                               ${initStat==='skipped' ? 'checked':''}>
                        ✗ Skipped
                    </label>
                </div>
            </div>
            <div id="log-dur-grp" style="display:${initStat==='completed' ? '':'none'}">
                <div class="form-group">
                    <label class="form-label" for="log-duration">Duration run (min)</label>
                    <input class="form-input" type="number" id="log-duration" name="actualDuration"
                           min="1" max="480" value="${log.actualDuration || zone.duration || ''}">
                    <div class="form-hint">Default for this zone: ${zone.duration || '—'} min</div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label" for="log-notes">
                    Notes <span class="optional">optional</span>
                </label>
                <textarea class="form-textarea" id="log-notes" name="notes"
                          placeholder="${initStat==='skipped' ? 'e.g. Rained 15 mm' : 'e.g. Extended — very dry week'}"
                          >${escHtml(log.notes || '')}</textarea>
            </div>
            <div class="form-actions">
                ${isEdit
                    ? `<button type="button" class="btn btn-danger btn-sm" id="del-log-btn"
                               style="margin-right:auto">Remove log</button>`
                    : ''}
                <button type="button" class="btn btn-secondary" id="cancel-log-btn">Cancel</button>
                <button type="submit"  class="btn btn-primary"   id="save-log-btn">Save</button>
            </div>
        </form>`;

    const title = isEdit ? 'Edit Log'
                : initStat === 'completed' ? 'Mark Done' : 'Skip Zone';
    showModal(title, html);

    const form       = document.getElementById('log-form');
    const durGrp     = document.getElementById('log-dur-grp');
    const notesInput = document.getElementById('log-notes');

    form.querySelectorAll('input[name="status"]').forEach(r => {
        r.addEventListener('change', () => {
            durGrp.style.display = r.value === 'completed' ? '' : 'none';
            notesInput.placeholder = r.value === 'skipped'
                ? 'e.g. Rained 15 mm' : 'e.g. Extended — very dry week';
        });
    });

    document.getElementById('cancel-log-btn')?.addEventListener('click', hideModal);

    document.getElementById('del-log-btn')?.addEventListener('click', async () => {
        if (!confirm('Remove this log entry?')) return;
        try {
            await deleteIrrigationLog(log.id);
            showToast('Log removed');
            hideModal();
            if (onSave) await onSave();
        } catch (err) { showToast('Error removing log', 'error'); }
    });

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd        = new FormData(form);
        const newStatus = fd.get('status');
        const data = {
            zoneId:         zone.id,
            scheduledDate:  dateStr,
            status:         newStatus,
            actualDuration: newStatus === 'completed'
                            ? (parseInt(fd.get('actualDuration')) || null) : null,
            notes: (fd.get('notes') || '').trim(),
        };

        const saveBtn = document.getElementById('save-log-btn');
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';

        try {
            if (isEdit && log.id) {
                await updateIrrigationLog(log.id, data);
                showToast('Log updated!', 'success');
            } else {
                await addIrrigationLog(data);
                showToast('Logged!', 'success');
            }
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error saving log', 'error');
            console.error(err);
            saveBtn.disabled = false; saveBtn.textContent = 'Save';
        }
    });
}

// =============================================
//  AD-HOC LOG MODAL  (unscheduled watering)
// =============================================

function showAdhocLogModal(zone, areaId, onSave) {
    // If no specific area was pre-selected and the zone has multiple areas,
    // show a dropdown so the user can pick which area they're logging.
    const zAreaIds      = getZoneAreaIds(zone);
    const needsAreaPick = !areaId && zAreaIds.length > 1;
    const areaName      = areaId ? (_areas.find(a => a.id === areaId)?.name || '') : '';
    const subtitle      = areaName ? ` · ${escHtml(areaName)}` : '';

    const areaPickerHtml = needsAreaPick ? `
        <div class="form-group">
            <label class="form-label" for="adhoc-area">Area watered</label>
            <select class="form-input" id="adhoc-area" name="areaId" required>
                <option value="">— select area —</option>
                ${zAreaIds.map(id => {
                    const name = _areas.find(a => a.id === id)?.name || id;
                    return `<option value="${id}">${escHtml(name)}</option>`;
                }).join('')}
            </select>
        </div>` : '';

    const html = `
        <form id="adhoc-log-form" autocomplete="off">
            <p class="form-hint" style="margin-bottom:14px">
                Record an unscheduled watering for
                <strong>${escHtml(zone.name)}${subtitle}</strong>.
            </p>
            ${areaPickerHtml}
            <div class="form-group">
                <label class="form-label" for="adhoc-date">Date watered</label>
                <input class="form-input" type="date" id="adhoc-date" name="adhocDate"
                       value="${todayStr()}" max="${todayStr()}">
            </div>
            <div class="form-group">
                <label class="form-label" for="adhoc-dur">Duration (min)</label>
                <input class="form-input" type="number" id="adhoc-dur" name="actualDuration"
                       min="1" max="480" value="${zone.duration || ''}">
                ${zone.duration ? `<div class="form-hint">Default for this zone: ${zone.duration} min</div>` : ''}
            </div>
            <div class="form-group">
                <label class="form-label" for="adhoc-notes">Notes <span class="optional">optional</span></label>
                <textarea class="form-textarea" id="adhoc-notes" name="notes"
                          placeholder="e.g. Extended — very dry week"></textarea>
            </div>
            <div class="form-actions">
                <button type="button" class="btn btn-secondary" id="adhoc-cancel-btn">Cancel</button>
                <button type="submit" class="btn btn-primary" id="adhoc-save-btn">Save</button>
            </div>
        </form>`;

    showModal('Log Watering', html);

    const form = document.getElementById('adhoc-log-form');
    document.getElementById('adhoc-cancel-btn')?.addEventListener('click', hideModal);

    form.addEventListener('submit', async e => {
        e.preventDefault();
        const fd             = new FormData(form);
        const date           = fd.get('adhocDate') || todayStr();
        const resolvedAreaId = areaId || fd.get('areaId') || null;
        const data = {
            zoneId:         zone.id,
            scheduledDate:  date,
            status:         'completed',
            actualDuration: parseInt(fd.get('actualDuration')) || null,
            notes:          (fd.get('notes') || '').trim(),
            adhoc:          true,
        };
        if (resolvedAreaId) data.areaId = resolvedAreaId;
        const saveBtn = document.getElementById('adhoc-save-btn');
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        try {
            await addIrrigationLog(data);
            showToast('Watering logged!', 'success');
            hideModal();
            if (onSave) await onSave();
        } catch (err) {
            showToast('Error saving log', 'error');
            console.error(err);
            saveBtn.disabled = false; saveBtn.textContent = 'Save';
        }
    });
}

// =============================================
//  ZONE HISTORY MODAL
// =============================================

function showZoneHistory(zone, logs) {
    const thisYear  = new Date().getFullYear();
    const yearLogs  = logs.filter(l => l.scheduledDate?.startsWith(String(thisYear)));
    const completed = yearLogs.filter(l => l.status === 'completed');
    const skipped   = yearLogs.filter(l => l.status === 'skipped');
    const totalMins = completed.reduce((s, l) => s + (l.actualDuration || zone.duration || 0), 0);
    const totalHrs  = (Math.round(totalMins / 6) / 10).toFixed(1);   // 1 dp

    const html = `
        <div class="irr-hist-stats">
            <div class="irr-hist-stat">
                <div class="irr-hist-val">${completed.length}</div>
                <div class="irr-hist-lbl">Runs (${thisYear})</div>
            </div>
            <div class="irr-hist-stat">
                <div class="irr-hist-val">${skipped.length}</div>
                <div class="irr-hist-lbl">Skipped</div>
            </div>
            <div class="irr-hist-stat">
                <div class="irr-hist-val">${totalHrs} h</div>
                <div class="irr-hist-lbl">Total watered</div>
            </div>
        </div>
        <div class="irr-hist-sched">Schedule: ${escHtml(scheduleDesc(zone))}</div>
        ${yearLogs.length === 0
            ? `<p class="form-hint" style="padding:8px 0">No logs for ${thisYear} yet.</p>`
            : `<div class="irr-hist-list">
                ${yearLogs.map(l => {
                    const logAreaName = l.areaId ? (_areas.find(a => a.id === l.areaId)?.name || '') : '';
                    return `
                    <div class="irr-hist-row ${l.status}">
                        <div class="irr-hist-icon">${l.status === 'completed' ? '✓' : '✗'}</div>
                        <div class="irr-hist-info">
                            <div class="irr-hist-date">${fmtDate(l.scheduledDate)}</div>
                            ${logAreaName ? `<div style="font-size:0.8rem;color:var(--grey-600);margin-bottom:2px">${escHtml(logAreaName)}</div>` : ''}
                            ${l.actualDuration
                                ? `<div class="irr-hist-dur">${l.actualDuration} min</div>` : ''}
                            ${l.notes
                                ? `<div class="irr-hist-note">${escHtml(l.notes)}</div>` : ''}
                        </div>
                    </div>`;
                }).join('')}
            </div>`}
        <div class="form-actions" style="margin-top:16px">
            <button class="btn btn-secondary" id="close-hist-btn">Close</button>
        </div>`;

    showModal(`History — ${zone.name}`, html);
    document.getElementById('close-hist-btn')?.addEventListener('click', hideModal);
}
