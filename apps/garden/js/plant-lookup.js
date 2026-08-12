// =============================================================
//  plant-lookup.js — Look up a plant by name and offer the result
//  Companion to label-scan.js. That one reads a printed label;
//  this one researches the name on the web via the lookup-plant
//  Netlify function.
//
//  Two independent lookups, matching the function's two tracks:
//    Plant details    — what it is and how to grow it
//    Origins & history — what the name means, where it came from
//  Most plants only need the first.
//
//  Deliberately NOT like label-scan's applyFields(): a scan quietly
//  drops a genus into an empty box and that is fine, but this
//  produces several paragraphs of researched prose. That gets
//  previewed in an editable box with its sources visible, and goes
//  into Notes only when John presses the button. Nothing is written
//  to the form until then.
//
//  Byte-identical in both apps — the field IDs differ, so they are
//  passed in. See tools/check-drift.mjs.
// =============================================================

import { showToast } from './ui-utils.js';

const ENDPOINT = '/.netlify/functions/lookup-plant';

const TRACK_LABEL = { details: 'plant details', origins: 'origins & history' };

// Gemini returns citations as vertexaisearch redirect links rather than the
// real page. They resolve today and expire later, so they are no use in a note
// somebody reads in three years — keep the title, drop the link.
//
// Matched loosely on purpose. The first version pinned the host to
// vertexaisearch.cloud.google.com and one came through on cloud5.google.com —
// Google shards those hosts with a number. So: anything carrying the
// vertexaisearch name, anything on the grounding-redirect path, and as a
// backstop anything absurdly long, which no citation worth reading ever is.
const OPAQUE_URL = /vertexaisearch|\/grounding-api-redirect\//i;
const MAX_URL_LEN = 180;

const isOpaqueUrl = (url) => !url || OPAQUE_URL.test(url) || url.length > MAX_URL_LEN;

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// -------------------------------------------------------------
//  Markup. Sits under the scan card, and unlike the scan card it
//  is offered when editing too — enriching a plant added years ago
//  is the main thing this is for.
// -------------------------------------------------------------
export function lookupPanelHTML() {
    return `
    <div class="plant-lookup" id="plant-lookup">
        <div class="label-scan-head">
            <span class="label-scan-title">🔎 Look up this plant</span>
            <span class="label-scan-sub">Optional — searches the web from the botanical name below.
                You review the result before anything is added.</span>
        </div>
        <div class="plant-lookup-btns">
            <button type="button" class="btn btn-secondary btn-sm" id="pl-details">Plant details</button>
            <button type="button" class="btn btn-secondary btn-sm" id="pl-origins">Origins &amp; history</button>
        </div>
        <p class="label-scan-status" id="pl-status"></p>

        <div class="plant-lookup-preview" id="pl-preview" hidden>
            <p class="plant-lookup-meta" id="pl-meta"></p>
            <textarea class="form-textarea plant-lookup-text" id="pl-text" rows="12"
                      spellcheck="false" aria-label="Researched notes, editable before inserting"></textarea>
            <p class="plant-lookup-hint" id="pl-hint"></p>
            <div class="plant-lookup-actions">
                <button type="button" class="btn btn-primary btn-sm" id="pl-insert">Add to Notes</button>
                <button type="button" class="btn btn-secondary btn-sm" id="pl-discard">Discard</button>
            </div>
        </div>
    </div>`;
}

// -------------------------------------------------------------
//  The house style. The application composes the note, not the
//  model, so every entry comes out the same shape however chatty
//  the model is feeling.
// -------------------------------------------------------------
function assembleNote(research, prose) {
    const blocks = [];
    const section = (heading, body) => {
        if (body && body.trim()) blocks.push(heading + '\n' + body.trim());
    };

    if (research.identityNote) blocks.push('NOTE ON IDENTITY\n' + research.identityNote.trim());

    section('DESCRIPTION',        prose.description);
    section('CULTIVATION',        prose.cultivation);
    section('NAME AND ETYMOLOGY', prose.etymology);
    section('ORIGIN AND HISTORY', prose.history);

    if (research.caveats)  blocks.push('WHERE SOURCES DISAGREE\n' + research.caveats.trim());
    if (research.notFound) blocks.push('NOT VERIFIED\n' + research.notFound.trim());

    const lines = (research.sources || []).map((s) => {
        const title = (s.title || '').trim();
        const url   = isOpaqueUrl((s.url || '').trim()) ? '' : (s.url || '').trim();
        if (title && url) return `  ${title} — ${url}`;
        return title ? `  ${title}` : (url ? `  ${url}` : '');
    }).filter(Boolean);
    if (lines.length) blocks.push('SOURCES\n' + lines.join('\n'));

    if (!blocks.length) return '';

    const stamp = new Date().toISOString().slice(0, 10);
    const how = research.grounded ? 'AI lookup with web search' : 'AI lookup (NOT web-grounded)';
    blocks.push(`[${how}, ${stamp}. Unverified details were omitted. Please check before relying on it.]`);

    return blocks.join('\n\n');
}

function flash(el) {
    if (!el) return;
    el.classList.add('scan-filled');
    setTimeout(() => el.classList.remove('scan-filled'), 2200);
}

// -------------------------------------------------------------
//  Wiring. Call after the form HTML is in the DOM.
//
//  config.fields  — form inputs holding the NAME, read to build the query
//  config.targets — where results go: notes, careNotes, height, width
// -------------------------------------------------------------
export function initPlantLookup(config) {
    const panel = document.getElementById('plant-lookup');
    if (!panel) return;

    const { fields = {}, targets = {} } = config || {};
    const get = (id) => (id ? document.getElementById(id) : null);
    const val = (key) => {
        const el = get(fields[key]);
        return el && el.value ? el.value.trim() : '';
    };

    const statusEl  = document.getElementById('pl-status');
    const previewEl = document.getElementById('pl-preview');
    const metaEl    = document.getElementById('pl-meta');
    const textEl    = document.getElementById('pl-text');
    const hintEl    = document.getElementById('pl-hint');
    const buttons   = ['pl-details', 'pl-origins', 'pl-insert', 'pl-discard'].map(get);

    // What the pending result would put into the discrete form fields, held
    // until Add to Notes is pressed so nothing touches the form uninvited.
    let pending = null;

    const busy = (on) => buttons.forEach((b) => { if (b) b.disabled = on; });

    function hidePreview() {
        pending = null;
        previewEl.hidden = true;
        textEl.value = '';
        metaEl.textContent = '';
        hintEl.textContent = '';
    }

    async function post(body) {
        const resp = await fetch(ENDPOINT, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        let data = {};
        try { data = await resp.json(); } catch { /* empty or non-JSON body */ }
        return { ok: resp.ok, status: resp.status, data };
    }

    function failureMessage(res) {
        // An empty body on a 502/504 is Netlify killing the function at its
        // timeout, which is indistinguishable from a crash unless we say so.
        if (!res.data.error && (res.status === 502 || res.status === 504)) {
            return 'The lookup took too long and was stopped. Try again — a second attempt is often quicker.';
        }
        return res.data.error || `The lookup failed (${res.status}).`;
    }

    async function run(track) {
        const query = {
            genus:      val('genus'),
            species:    val('species'),
            subspecies: val('subspecies'),
            variety:    val('variety'),
            cultivar:   val('cultivar'),
            commonName: val('commonName'),
        };

        if (!query.genus && !query.commonName) {
            statusEl.textContent = 'Fill in the genus first — the lookup works from the botanical name.';
            showToast('Enter a genus before looking the plant up', 'info');
            return;
        }

        busy(true);
        hidePreview();
        statusEl.textContent = `Searching for ${TRACK_LABEL[track]}…`;

        try {
            const one = await post({ ...query, phase: 'research', track });
            if (!one.ok) {
                statusEl.textContent = failureMessage(one);
                showToast('Lookup failed', 'error');
                return;
            }

            const research = one.data.result || {};
            research.grounded = !!one.data.grounded;

            // No verified facts means nothing to write from, and asking anyway
            // is how a plausible essay gets invented. Stop here and say so.
            if (!research.identified || !(research.facts || []).length) {
                statusEl.textContent = research.identityNote
                    ? research.identityNote
                    : 'Nothing could be verified for this name. Nothing has been added — '
                      + 'check the spelling, or add a species or cultivar.';
                showToast('Nothing verified for that name', 'info');
                return;
            }

            statusEl.textContent = 'Writing the note…';
            const two = await post({ phase: 'write', track, research });
            if (!two.ok) {
                statusEl.textContent = failureMessage(two);
                showToast('Lookup failed', 'error');
                return;
            }

            const prose = two.data.result || {};
            const note  = assembleNote(research, prose);
            if (!note) {
                statusEl.textContent = 'The lookup came back empty. Nothing has been added.';
                return;
            }

            pending = {
                careNotes: prose.careNotes || '',
                height:    research.height || '',
                width:     research.width  || '',
            };

            const nSources = (research.sources || []).length;
            metaEl.textContent =
                `${research.resolvedName || 'Result'} — ${(research.facts || []).length} verified `
                + `fact${research.facts.length === 1 ? '' : 's'} from ${nSources} `
                + `source${nSources === 1 ? '' : 's'}.`
                + (research.grounded ? '' : ' WARNING: this answer was not web-grounded — treat it with suspicion.');
            metaEl.classList.toggle('plant-lookup-warn', !research.grounded);

            // Name the form fields that would be filled, so pressing the button
            // never does anything the label did not warn about.
            const alsoFills = [];
            if (pending.height && !get(targets.height)?.value)       alsoFills.push('height');
            if (pending.width && !get(targets.width)?.value)         alsoFills.push('width');
            if (pending.careNotes && !get(targets.careNotes)?.value) alsoFills.push('care notes');
            hintEl.textContent = 'Edit anything you like before adding. '
                + (alsoFills.length
                    ? `This will also fill ${alsoFills.join(', ')}, which are empty.`
                    : 'Only Notes will change.');

            textEl.value = note;
            previewEl.hidden = false;
            statusEl.textContent = 'Please read it through — it is researched, not verified.';
            previewEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
            console.error('Plant lookup error:', e);
            statusEl.textContent = 'Could not reach the lookup service. Check your connection and try again.';
            showToast('Lookup failed — you can still fill the form manually', 'error');
        } finally {
            busy(false);
        }
    }

    get('pl-details').addEventListener('click', () => run('details'));
    get('pl-origins').addEventListener('click', () => run('origins'));
    get('pl-discard').addEventListener('click', () => {
        hidePreview();
        statusEl.textContent = 'Discarded — nothing was added.';
    });

    get('pl-insert').addEventListener('click', () => {
        const text = textEl.value.trim();
        if (!text) { hidePreview(); return; }

        // Append rather than replace. Enriching a plant that already has notes
        // is the common case, and silently overwriting what John wrote himself
        // would be unforgivable.
        const notesEl = get(targets.notes);
        if (notesEl) {
            const existing = notesEl.value.trim();
            notesEl.value = existing ? `${existing}\n\n${text}` : text;
            flash(notesEl);
        }

        // The discrete fields fill only when empty — same contract as the label
        // scanner, so a value already there is never disturbed.
        let filled = 0;
        [['height', pending && pending.height],
         ['width', pending && pending.width],
         ['careNotes', pending && pending.careNotes]].forEach(([key, value]) => {
            const el = get(targets[key]);
            if (el && value && !el.value.trim()) { el.value = value; flash(el); filled++; }
        });

        hidePreview();
        statusEl.textContent = filled
            ? `Added to Notes, and filled ${filled} empty field${filled === 1 ? '' : 's'}. Nothing is saved until you save the form.`
            : 'Added to Notes. Nothing is saved until you save the form.';
        showToast('Added to Notes — please check it before saving', 'success');
    });
}
