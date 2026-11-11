// =============================================================
//  garden-logic.js — Garden's pure helpers: names, escaping, dates, tag codes
//
//  Deliberately free of imports (no Firebase, no DOM), so Node can load it to
//  test them: see tests/. db.js re-exports everything here, so views keep
//  importing from './db.js' as before. Moved out of db.js 2026-11-10.
// =============================================================

/** A Date as YYYY-MM-DD in local time. */
function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const TAG_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TAG_CODE_LENGTH   = 6;

/** Is this path segment shaped like a tag code rather than a Firestore ID? */
export function isTagCode(value) {
    return new RegExp(`^[${TAG_CODE_ALPHABET}]{${TAG_CODE_LENGTH}}$`).test(String(value || '').toUpperCase());
}

/**
 * Given a recurrence pattern and a YYYY-MM-DD start date, return the next
 * occurrence date as a YYYY-MM-DD string (always at least one unit ahead).
 */
export function nextOccurrenceDate(recurrence, fromDateStr) {
    const d = new Date(fromDateStr + 'T12:00:00');
    if (recurrence.type === 'daily') {
        d.setDate(d.getDate() + 1);
    } else if (recurrence.type === 'weekly') {
        const target = recurrence.dayOfWeek;
        let ahead = target - d.getDay();
        if (ahead <= 0) ahead += 7;
        d.setDate(d.getDate() + ahead);
    } else if (recurrence.type === 'monthly') {
        const dom = recurrence.dayOfMonth || 1;
        // Go to the 1st before moving the month. From 31 January, moving the
        // month alone lands on "31 February", which JavaScript rolls over to
        // 3 March, and the task skipped February entirely. Fixed 2026-11-10.
        d.setDate(1);
        d.setMonth(d.getMonth() + 1);
        d.setDate(Math.min(dom, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    }
    return ymd(d);
}

/**
 * Return the first (upcoming) occurrence date from today for a new recurring task.
 * For weekly tasks, returns today if today matches the target day.
 */
export function firstOccurrenceFromToday(recurrence, now = new Date()) {
    const today = new Date(now);
    today.setHours(12, 0, 0, 0);
    if (recurrence.type === 'daily') {
        return ymd(today);
    } else if (recurrence.type === 'weekly') {
        const target = recurrence.dayOfWeek;
        let ahead = target - today.getDay();
        if (ahead < 0) ahead += 7;
        today.setDate(today.getDate() + ahead);
        return ymd(today);
    } else if (recurrence.type === 'monthly') {
        const dom = recurrence.dayOfMonth || 1;
        const thisMonth = new Date(today.getFullYear(), today.getMonth(), dom, 12);
        if (thisMonth >= today) return ymd(thisMonth);
        const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, dom, 12);
        return ymd(nextMonth);
    }
    return ymd(today);
}

/** Build a display-ready botanical name string (HTML) */
export function formatBotanicalName(plant) {
    const ht = hybridTypeOf(plant);
    let parts = [];
    // Intergeneric hybrids place the × immediately before the genus (×Genus);
    // interspecific hybrids place it before the species epithet (Genus × species).
    if (plant.genus)      parts.push(ht === 'intergeneric' ? `×<em>${escHtml(plant.genus)}</em>` : `<em>${escHtml(plant.genus)}</em>`);
    if (ht === 'interspecific' && plant.species) parts.push('×');
    if (plant.species)    parts.push(`<em>${escHtml(plant.species)}</em>`);
    if (plant.subspecies) parts.push(`subsp. <em>${escHtml(plant.subspecies)}</em>`);
    if (plant.variety)    parts.push(`var. <em>${escHtml(plant.variety)}</em>`);
    if (plant.cultivar)   parts.push(`'${escHtml(plant.cultivar)}'`);
    if (plant.authority)  parts.push(escHtml(plant.authority));
    return parts.join(' ');
}

/**
 * Effective hybrid type for a plant.
 * Returns 'interspecific' | 'intergeneric' | null.
 * Legacy records stored only a boolean `hybrid` — treat those as interspecific
 * (the common case; × before the species), which matches how the app rendered
 * them historically in the garden view.
 */
export function hybridTypeOf(plant) {
    if (plant && plant.hybridType) return plant.hybridType;
    return (plant && plant.hybrid) ? 'interspecific' : null;
}

/** A plant's name as plain text, for a print title or a pre-filled field:
 *  formatBotanicalName() without its <em> tags and with its escaping undone. */
export function plainPlantName(plant) {
    if (!plant) return 'Unknown plant';
    const text = (formatBotanicalName(plant) || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
    return text || plant.commonName || 'Unnamed plant';
}

export function escHtml(str) {
    // String() first: a number used to throw "str.replace is not a function".
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * escHtml, plus http(s) URLs turned into links that open in a new tab.
 * Added 2026-09-14 for task descriptions, notes and area descriptions.
 * The text between URLs and each URL are escaped separately, so the <a>
 * is the only markup that can reach the page, and the pattern only
 * matches http and https — never javascript: or data:.
 */
export function linkify(str) {
    if (!str) return '';
    const re = /\bhttps?:\/\/[^\s<>"']+/gi;
    let out = '', last = 0, m;
    while ((m = re.exec(str))) {
        let url = m[0];
        // Trailing punctuation belongs to the sentence, not the URL — except
        // a ')' that closes a '(' inside it, as Wikipedia URLs have.
        while (/[.,;:!?)\]]$/.test(url)) {
            const opens  = (url.match(/\(/g) || []).length;
            const closes = (url.match(/\)/g) || []).length;
            if (url.endsWith(')') && opens >= closes) break;
            url = url.slice(0, -1);
        }
        out += escHtml(str.slice(last, m.index))
             + `<a class="text-link" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer">${escHtml(url)}</a>`;
        last = m.index + url.length;
        re.lastIndex = last;
    }
    return out + escHtml(str.slice(last));
}

// =============================================
//  DATE HELPERS
//  Added 2026-08-10. These lived as six separate local copies across
//  tasks-view, garden-view, compost-view, irrigation-view and blog-view, and
//  they disagreed: Tasks and Overview rendered "14 May 26" while the Compost
//  Bin, Irrigation and the Blog rendered "14 May 2026". fmtDate is byte-identical
//  to Nursery's in apps/nursery/js/db.js, so both apps now read the same.
// =============================================

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_FULL  = ['January','February','March','April','May','June',
                      'July','August','September','October','November','December'];

/** Format a YYYY-MM-DD string as "14 Sep 26". The default for lists and rows. */
export function fmtDate(dateStr) {
    if (!dateStr) return '';
    // Anything that is not a full YYYY-MM-DD (an imported "2019", say) is
    // shown as it was entered instead of as "undefined undefined".
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return String(dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}

/**
 * Format a YYYY-MM-DD string as "14 September 2026".
 * Only for prominent standalone dates — a blog post header — where the full
 * month and year read better and there is no density pressure. This is what
 * blog-view's formatDisplayDate produced via toLocaleDateString('en-GB'), kept
 * so journal entries look unchanged. Prefer fmtDate everywhere else.
 */
export function fmtDateLong(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-').map(Number);
    return `${d} ${MONTHS_FULL[m - 1]} ${y}`;
}

/** Today as YYYY-MM-DD */
export function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

/** True if a due date has passed and the task is not already completed. */
export function isOverdue(dateStr, status) {
    if (!dateStr || status === 'completed') return false;
    return dateStr < todayStr();
}
