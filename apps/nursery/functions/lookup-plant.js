// =============================================================
//  lookup-plant.js — Netlify serverless function
//  Looks up reference information about a plant from its botanical
//  name (and optional cultivar) using Google Gemini WITH Google
//  Search grounding, and returns prose for the Notes field plus a
//  few discrete form fields.
//
//  This is the mirror image of scan-label.js. That function is
//  forbidden from using outside knowledge — it reads only what is
//  printed on the label. This one is nothing BUT outside knowledge,
//  so the whole design is about not making things up.
//
//  TWO PHASES, one call each. A single grounded call that both
//  searched and wrote several paragraphs could not finish inside a
//  Netlify function's timeout (10s by default, 26s on Pro), so the
//  work is split and the browser makes both calls:
//
//    phase "research" — searches the web and returns a list of short
//                       facts, each tagged with the source it came
//                       from. Slow because of the searching, but the
//                       output is tiny.
//    phase "write"    — is handed that fact list and turns it into
//                       prose. NO search tool, so no round trips, and
//                       the output is short. Fast.
//
//  The split is not only about latency. The writer never touches the
//  web and is given nothing but the researcher's facts, so it has
//  nothing to invent from — "don't fabricate" stops being an
//  instruction we hope the model follows and becomes a property of
//  the arrangement.
//
//  The Gemini API key is read from the GEMINI_API_KEY environment
//  variable and NEVER sent to the browser.
//
//  TWO TRACKS, requested independently. "details" covers what the
//  plant is and how to grow it; "origins" covers the name's meaning
//  and how the plant reached cultivation. Most plants only need the
//  first. Asking for both fires two concurrent lookups.
//
//  Request  (POST JSON):
//    { phase: "research", track: "details"|"origins",
//      genus, species, subspecies, variety, cultivar, commonName }
//                                    — or { phase, track, name: "…" }
//    { phase: "write", track, research: <the research result> }
//  Response (200 JSON):
//    { result: {…}, grounded, track, mode, model, elapsedMs, budgetMs }
// =============================================================

// Kept in step with scan-label.js. Google retires Gemini models quickly, so
// set GEMINI_MODEL=gemini-flash-latest in Netlify to always track the newest
// Flash. Search grounding needs a model that supports the google_search tool.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// The two phases have opposite needs, so each can use its own model.
//
// Research is latency-critical and is really extraction — read search results,
// pull out facts, cite them. A Flash-Lite tier is built for exactly that and is
// markedly quicker, which is the difference between fitting in a function
// timeout and not. Set GEMINI_MODEL_RESEARCH=gemini-3.5-flash-lite to try it.
//
// Write is the quality-critical half — it turns facts into prose someone will
// read — and it is already fast because it does no searching, so there is
// nothing to gain by economising there.
const MODEL_RESEARCH = process.env.GEMINI_MODEL_RESEARCH || GEMINI_MODEL;
const MODEL_WRITE    = process.env.GEMINI_MODEL_WRITE    || GEMINI_MODEL;

const endpointFor = (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// Our own deadline, set just inside the platform's, so a timeout returns a
// diagnostic instead of the empty 504 Netlify sends when it kills a function.
// Raise it with LOOKUP_BUDGET_MS if this site's function timeout allows.
const BUDGET_MS = Number(process.env.LOOKUP_BUDGET_MS || 8500);

// Output tokens dominate latency, so thinking is off by default. Raise with
// GEMINI_THINKING_BUDGET to trade speed back for quality.
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET || 0);

const CATEGORIES = ['description', 'cultivation', 'etymology', 'history'];

// -------------------------------------------------------------
//  Two independent lookups, requested separately.
//
//  "details" is the everyday one: what the plant is and how to grow
//  it. "origins" is the one worth running on a rarer or more
//  interesting plant: where the name came from and how the plant
//  reached cultivation.
//
//  Keeping them apart is a product decision — most plants only need
//  the first — but it also halves the searching in any one call,
//  which is what makes each fit inside a Netlify function's timeout.
//  Ask for both and the browser fires them concurrently, so the wait
//  is the slower of the two rather than the sum.
// -------------------------------------------------------------
const TRACKS = {
    details: {
        categories: ['description', 'cultivation'],
        fields:     true,
        label:      'plant details',
        careNotes:  true,
    },
    origins: {
        categories: ['etymology', 'history'],
        fields:     false,
        label:      'origins and history',
        careNotes:  false,
    },
};

const CATEGORY_GUIDE = {
    description:
        '  - description: habit, eventual size, foliage, flower color and form, season of\n' +
        '    interest, scent, fruit, fall color, evergreen or deciduous.',
    cultivation:
        '  - cultivation: aspect, soil, drainage, watering, hardiness (USDA zone, or the RHS\n' +
        '    rating where that is what the source gives), pruning, feeding, pests and diseases.\n' +
        '    Also whether it is invasive, self-seeds, is toxic, or spreads by runners.',
    etymology:
        '  - etymology: the meaning and derivation of the genus and the specific epithet, who\n' +
        '    the genus honors if a source says so, and the origin of the common name where it\n' +
        '    is recorded.',
    history:
        '  - history: native range and habitat, when and by whom it was collected or introduced,\n' +
        '    and recorded historical, medicinal, culinary or cultural use. For a cultivar: how it\n' +
        '    arose (a seedling, a sport, a deliberate cross, and of what), who found or bred it,\n' +
        '    where and when, when it was released and by whom, and any patent or award.',
};

// -------------------------------------------------------------
//  PHASE 1 — research. This is where the anti-fabrication rules
//  live, because this is the only phase that can see the web.
// -------------------------------------------------------------
const PROMPT_RESEARCH_HEAD = `You are researching a single plant for a private horticultural
collection database. You are the fact-gathering half of a two-step process: you find and
record facts, and a second step turns your facts into prose. You do not write prose.

Search the web and return a list of short, separate, individually-sourced facts.

=== ABSOLUTE RULES ===
These override everything else. When a rule conflicts with producing a full-looking
answer, the rule wins.

1. SEARCH FIRST, ALWAYS. Every fact must come from something you actually found. Do not
   write from memory. If you did not find it, you do not know it.

2. RECORD ONLY WHAT YOU CAN VERIFY. If you cannot point a fact at a source you retrieved,
   leave it out. Do not soften it, do not hedge it, do not write "possibly" or "is thought
   to be" as a way of smuggling in a guess. Returning few facts is a correct and welcome
   outcome. There is no minimum.

3. NEVER INVENT A SPECIFIC. Each of the following must come from a source you found, or be
   omitted entirely:
     - a person's name (botanist, breeder, collector, nurseryman, or someone honored)
     - a nursery, garden, botanic institution, university or company
     - a place or country
     - any year or date
     - a plant patent, trademark, or plant breeders' rights number
     - an award (RHS Award of Garden Merit, gold medals, and so on)
   These are the details most likely to be wrong and least likely to be questioned,
   because an invented one reads exactly like a real one. Hold them to the highest
   standard here. If you find such a claim but cannot tell where it came from, drop it.

4. DO NOT GUESS AN ETYMOLOGY FROM THE SHAPE OF A WORD. Record a derivation only where you
   found it stated. A genus ending in -ia is NOT necessarily named after a person, and you
   must not invent a person for it. Do not reason from Latin or Greek roots to a meaning
   no source states. Cultivar names are often arbitrary and have no recorded meaning — record
   nothing rather than construct something.

5. KEEP CULTIVAR, SPECIES AND GENUS FACTS SEPARATE. This is the most common way these notes
   go wrong. If you were given a cultivar, a claim about that cultivar needs a source about
   that cultivar. Where you only found information about the species or the genus, you may
   still record it, but the fact's text must say so ("the species is native to …") and
   "level" must be set to species or genus. Never present a species fact as though it were
   specific to the cultivar. Sizes are the usual casualty: a named cultivar is frequently
   chosen for being more compact than the species, so an unsourced species height is
   actively misleading.

6. DO NOT SILENTLY RESEARCH A DIFFERENT PLANT. If the name appears to be a misspelling, a
   synonym, or a name you cannot find at all, do not quietly research the nearest plant you
   can think of. Set "identified" to false, explain what you did and did not find in
   "identityNote", and return no facts. If the name is a recognized synonym of an accepted
   name you may research the accepted plant, but say so in "identityNote".

7. PRESERVE DISAGREEMENT. Where sources conflict — commonly on ultimate size, hardiness, or
   who raised a cultivar — do not average them and do not pick a favorite. Record the range,
   or note the disagreement in "caveats".

8. REPORT YOUR GAPS. Use "notFound" to say briefly what you looked for and could not verify,
   so the reader can tell "nothing is recorded" from "this lookup did not cover it".

=== HOW TO RECORD A FACT ===
Each entry in "facts" is one self-contained statement, at most about 25 words, written
plainly in AMERICAN English. No markdown. Each carries:
  - text:        the fact itself.
  - category:    see the scope below.
  - level:       cultivar, species, or genus — what the fact is actually about (rule 5).
  - sourceIndex: the 0-based position in your "sources" array of the page it came from.

Prefer the specific and the interesting over the generic. Return fewer facts rather than
padding: there is no minimum, and an empty list is a valid answer.`;

const PROMPT_RESEARCH_TAIL = `=== SOURCES ===
List in "sources" the pages you actually used, with title and URL, in the order your facts
refer to them. Prefer botanic gardens, university extension services, the RHS, national plant
societies, monographs, plant patent records, and established nurseries' own catalog entries.
Do not list a source you did not use. Do not invent a URL: if you cannot give a real one, give
the title alone.

Return the result as JSON matching the provided schema.`;

// The scope block is the only part that varies by track. Narrowing it is what
// keeps a single call's searching inside the function timeout.
function researchPrompt(trackKey) {
    const t = TRACKS[trackKey];
    const guide = t.categories.map((c) => CATEGORY_GUIDE[c]).join('\n');

    const scope = [
        '=== THE SCOPE OF THIS LOOKUP ===',
        `You are gathering ONLY ${t.label}. Use these categories and no others:`,
        `  ${t.categories.join(', ')}`,
        '',
        'A separate lookup covers the rest, so do not stray outside these categories even if',
        'you come across something interesting. A fact in any other category will be discarded,',
        'and the search it cost is time this lookup does not have.',
        '',
        'What belongs in each category:',
        guide,
        '',
        `Return at most ${t.categories.length * 6} facts.`,
    ].join('\n');

    const fields = t.fields
        ? [
            '=== THE DISCRETE FIELDS ===',
            '  - height / width: ultimate size in the source\'s own units, keeping ranges ("3-4 ft",',
            '    "24-30 in", "60 cm"). Do not convert — a conversion you perform is one more chance to',
            '    put an error into a number. If the only sizes you found are for the species and you',
            '    were asked about a cultivar, leave these EMPTY and record the species size as a fact',
            '    instead (rule 5).',
            '  - family, commonNames: if found. commonNames comma separated.',
          ].join('\n')
        : [
            '=== THE DISCRETE FIELDS ===',
            'Leave height, width, family and commonNames EMPTY. The other lookup covers them, and',
            'searching for them here would cost time this one does not have.',
          ].join('\n');

    return [PROMPT_RESEARCH_HEAD, scope, fields, PROMPT_RESEARCH_TAIL].join('\n\n');
}

const SCHEMA_RESEARCH = {
    type: 'OBJECT',
    properties: {
        resolvedName: { type: 'STRING' },
        identified:   { type: 'BOOLEAN' },
        identityNote: { type: 'STRING' },
        scope:        { type: 'STRING' },
        family:       { type: 'STRING' },
        commonNames:  { type: 'STRING' },
        height:       { type: 'STRING' },
        width:        { type: 'STRING' },
        caveats:      { type: 'STRING' },
        notFound:     { type: 'STRING' },
        facts: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    text:        { type: 'STRING' },
                    category:    { type: 'STRING' },
                    level:       { type: 'STRING' },
                    sourceIndex: { type: 'INTEGER' },
                },
            },
        },
        sources: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    title: { type: 'STRING' },
                    url:   { type: 'STRING' },
                },
            },
        },
    },
    required: ['resolvedName', 'identified', 'scope'],
};

// -------------------------------------------------------------
//  PHASE 2 — write. No search tool. Nothing but the facts above.
// -------------------------------------------------------------
const PROMPT_WRITE_HEAD = `You are writing reference notes about a plant for a private
horticultural collection database, in the style of a good nursery catalog: accurate,
specific, and interesting about where a plant came from.

You will be given a list of facts that a previous step verified against sources. That list
is the ONLY material you may use.

=== ABSOLUTE RULES ===
1. ADD NOTHING. Every statement you write must be traceable to a supplied fact. You have no
   web access and no licence to fill gaps from memory. Do not add context, background,
   comparisons to other plants, or general horticultural advice, however safe it seems.
   Adding a true fact that was not supplied is still a failure, because nothing verified it.

2. DO NOT PROMOTE A FACT'S LEVEL. Each fact is marked cultivar, species or genus. A fact
   marked species or genus must stay marked in the prose — write "the species is native to …",
   not "it is native to …", when the fact is about the species and the subject is a cultivar.

3. AN EMPTY SECTION IS CORRECT. If no facts were supplied for a section, return an empty
   string for it. Never write "no information found" — say nothing.

4. DO NOT EMBELLISH A NUMBER OR A NAME. Sizes, dates, people and places appear exactly as
   supplied. Do not convert units, round figures, or expand an initial into a full name.

=== STYLE ===
Plain prose. No markdown, no bullet points, no headings — the application adds its own.
Full sentences, AMERICAN English spelling and usage throughout (color, gray, fertilize).
Combine related facts into flowing sentences rather than listing them one per sentence, but
do not invent connective claims to join them.

This is a reference note, not an essay. Hold description, cultivation and etymology to 2-4
sentences each; history may run to 6 where the supplied facts support it. Never pad.`;

const WRITE_CARE_NOTES =
    '  - careNotes: one or two sentences of the most practical guidance, drawn from the\n' +
    '    cultivation facts. A condensed version for a small form field, not a repeat of the\n' +
    '    whole paragraph. Empty if there are no cultivation facts.';

// Only ask for the sections this track gathered facts for. Naming the others
// would invite the model to fill them from memory, which is the one thing the
// two-phase split exists to prevent.
function writePrompt(trackKey) {
    const t = TRACKS[trackKey];
    const lines = [
        '=== WHAT TO WRITE ===',
        'Write ONLY these sections, from the facts of the matching category:',
        `  - ${t.categories.join(', ')}`,
        '',
        'Return an empty string for every other section in the schema. Another lookup covers',
        'them; writing anything there would mean inventing it.',
    ];
    if (t.careNotes) lines.push('', 'Also fill this one extra field:', WRITE_CARE_NOTES);
    else lines.push('', 'Return careNotes as an empty string.');

    return [PROMPT_WRITE_HEAD, lines.join('\n'),
            'Return the result as JSON matching the provided schema.'].join('\n\n');
}

const SCHEMA_WRITE = {
    type: 'OBJECT',
    properties: {
        description: { type: 'STRING' },
        cultivation: { type: 'STRING' },
        etymology:   { type: 'STRING' },
        history:     { type: 'STRING' },
        careNotes:   { type: 'STRING' },
    },
};

const CORS = {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Build the botanical name from whatever parts the form supplied.
function buildName(p) {
    if (typeof p.name === 'string' && p.name.trim()) return p.name.trim();

    const bits = [];
    if (p.genus)      bits.push(String(p.genus).trim());
    if (p.hybrid && p.species) bits.push('×');
    if (p.species)    bits.push(String(p.species).trim());
    if (p.subspecies) bits.push(`subsp. ${String(p.subspecies).trim()}`);
    if (p.variety)    bits.push(`var. ${String(p.variety).trim()}`);
    if (p.cultivar)   bits.push(`'${String(p.cultivar).trim().replace(/^['"]|['"]$/g, '')}'`);

    const botanical = bits.join(' ').trim();
    if (botanical) return botanical;
    return typeof p.commonName === 'string' ? p.commonName.trim() : '';
}

// Tell the researcher how much of this is a cultivar question (rule 5).
function buildQuery(p, name) {
    const lines = [`The plant to research is: ${name}`];

    if (p.cultivar) {
        lines.push(
            `This is a named CULTIVAR ('${String(p.cultivar).trim().replace(/^['"]|['"]$/g, '')}'). ` +
            'Cultivar-level claims need cultivar-level sources — see rule 5. How it arose, and who ' +
            'raised or found it and when, is the most valuable thing you can find.',
        );
    } else if (p.species) {
        lines.push('This is a species, not a cultivar. Do not attribute cultivar traits to it.');
    } else if (p.genus) {
        lines.push(
            'Only a genus was supplied. Work at genus level, set scope to "genus", and do not ' +
            'invent a species. Say in identityNote that a species would give a better answer.',
        );
    }

    if (p.commonName && p.genus) {
        lines.push(`The collection records its common name as "${String(p.commonName).trim()}". ` +
                   'Ignore it if it conflicts with the botanical name — the botanical name wins.');
    }

    return lines.join('\n');
}

// Render the researcher's output as the writer's input.
function buildWriterInput(research) {
    const facts   = Array.isArray(research.facts) ? research.facts : [];
    const sources = Array.isArray(research.sources) ? research.sources : [];

    const lines = [`The plant is: ${research.resolvedName || 'unnamed'}`];
    if (research.scope)  lines.push(`The subject is at ${research.scope} level.`);
    if (research.family) lines.push(`Family: ${research.family}`);
    if (research.commonNames) lines.push(`Common names: ${research.commonNames}`);

    lines.push('', 'VERIFIED FACTS — the only material you may use:');
    if (!facts.length) {
        lines.push('  (none were verified — return empty strings for every section)');
    }
    for (const f of facts) {
        const cat   = CATEGORIES.includes(str(f.category)) ? str(f.category) : 'description';
        const level = str(f.level) || 'unspecified';
        const src   = sources[f.sourceIndex];
        const where = src ? ` [source: ${src.title || src.url || '?'}]` : '';
        lines.push(`  - (${cat}, ${level}) ${str(f.text)}${where}`);
    }
    return lines.join('\n');
}

// Pull sources out of Gemini's grounding metadata. These are the real citations
// when present; when structured output is combined with the search tool they
// have been reported to come back empty, which is why the schema also asks the
// model for its own source list. We merge both and dedupe.
function sourcesFromGrounding(candidate) {
    const chunks = candidate?.groundingMetadata?.groundingChunks;
    if (!Array.isArray(chunks)) return [];
    return chunks
        .map((c) => ({ title: c?.web?.title || '', url: c?.web?.uri || '' }))
        .filter((s) => s.url || s.title);
}

function mergeSources(modelSources, groundedSources) {
    const out = [];
    const seen = new Set();
    const all = [
        ...(Array.isArray(modelSources) ? modelSources : []),
        ...(Array.isArray(groundedSources) ? groundedSources : []),
    ];
    for (const s of all) {
        if (!s || typeof s !== 'object') continue;
        const title = typeof s.title === 'string' ? s.title.trim() : '';
        let url = typeof s.url === 'string' ? s.url.trim() : '';
        // Drop anything that is not a real http(s) URL rather than showing a
        // fabricated-looking one. A bare title is honest; an invented URL is not.
        if (url && !/^https?:\/\//i.test(url)) url = '';
        if (!title && !url) continue;
        const key = (url || title).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ title, url });
    }
    return out;
}

// The model may return bare JSON, or JSON inside a ``` fence, when it is not
// being held to a response schema. Handle both.
function parseJsonLoosely(text) {
    if (!text) return null;
    const trimmed = text.trim();

    try { return JSON.parse(trimmed); } catch { /* try harder */ }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
        try { return JSON.parse(fenced[1].trim()); } catch { /* try harder */ }
    }

    const first = trimmed.indexOf('{');
    const last  = trimmed.lastIndexOf('}');
    if (first !== -1 && last > first) {
        try { return JSON.parse(trimmed.slice(first, last + 1)); } catch { /* give up */ }
    }
    return null;
}

function str(v) { return typeof v === 'string' ? v.trim() : ''; }

async function callGemini(apiKey, model, body, remainingMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, remainingMs));
    try {
        const resp = await fetch(`${endpointFor(model)}?key=${encodeURIComponent(apiKey)}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
            signal:  controller.signal,
        });
        const text = await resp.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* non-JSON error body */ }
        return { ok: resp.ok, status: resp.status, json, text };
    } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, status: 0, aborted: true, json: null, text: '' };
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

const JSON_ONLY = '\n\nReturn ONLY a JSON object, no other text.';

// Models differ in which optional generationConfig fields they accept, and a
// rejection says only "Request contains an invalid argument" without naming the
// field. Matching on the error text therefore does not work — Flash-Lite
// rejected a request whose message mentioned nothing at all.
//
// So instead of guessing, try progressively plainer request shapes and take the
// first that is accepted. Ordered best-to-plainest, and every variant keeps the
// search tool: grounding is the guarantee this whole feature rests on, so it is
// never what gets dropped. If nothing is accepted we fail loudly rather than
// quietly returning an answer written from memory.
function requestVariants({ text, schema, useSearch }) {
    const shapes = [
        { label: 'schema+thinking', thinking: true,  structured: true  },
        { label: 'schema',          thinking: false, structured: true  },
        { label: 'freeform',        thinking: false, structured: false },
    ];

    return shapes.map(({ label, thinking, structured }) => {
        const generationConfig = { temperature: 0 };
        if (thinking) generationConfig.thinkingConfig = { thinkingBudget: THINKING_BUDGET };
        if (structured) {
            generationConfig.responseMimeType = 'application/json';
            generationConfig.responseSchema   = schema;
        }
        const body = {
            contents: [{ parts: [{ text: structured ? text : text + JSON_ONLY }] }],
            generationConfig,
        };
        if (useSearch) body.tools = [{ google_search: {} }];
        return { label: (useSearch ? 'grounded+' : '') + label, body };
    });
}

async function runPhase({ apiKey, model, prompt, input, schema, useSearch, remaining }) {
    const text = `${prompt}\n\n=== THE REQUEST ===\n${input}`;
    const variants = requestVariants({ text, schema, useSearch });
    const tried = [];

    let attempt = null;
    let mode = variants[0].label;

    for (const variant of variants) {
        attempt = await callGemini(apiKey, model, variant.body, remaining());
        mode = variant.label;
        tried.push(variant.label);

        if (attempt.ok || attempt.aborted) break;

        // Only a 400 means "this request shape is wrong for this model". Any
        // other failure (429, 500, network) will not be fixed by simplifying,
        // so stop and report it rather than burning the budget on retries.
        if (attempt.status !== 400) break;

        console.warn(
            'lookup-plant:', model, 'rejected', variant.label, '(HTTP 400) —',
            attempt.text.slice(0, 200).replace(/\s+/g, ' '),
        );
    }

    return { attempt, mode, tried };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers: CORS, body: '' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ error: 'Server missing API key. Set GEMINI_API_KEY in Netlify environment variables.' }),
        };
    }

    let payload;
    try {
        payload = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }

    const started   = Date.now();
    const elapsed   = () => Date.now() - started;
    const remaining = () => BUDGET_MS - elapsed();
    const phase     = str(payload.phase) || 'research';
    const track     = str(payload.track) || 'details';

    const fail = (statusCode, body) => ({
        statusCode,
        headers: CORS,
        body: JSON.stringify({
            ...body, phase, track,
            elapsedMs: elapsed(), budgetMs: BUDGET_MS,
            model: phase === 'write' ? MODEL_WRITE : MODEL_RESEARCH,
        }),
    });

    if (!TRACKS[track]) {
        return fail(400, {
            error: `Unknown track "${track}" — expected ${Object.keys(TRACKS).join(' or ')}.`,
        });
    }

    const timedOut = (mode) => fail(504, {
        error: `The ${phase} step ran past its ${BUDGET_MS} ms budget and was stopped. Raise ` +
               `LOOKUP_BUDGET_MS if this site's function timeout permits it.`,
        mode,
    });

    if (phase !== 'research' && phase !== 'write') {
        return fail(400, { error: `Unknown phase "${phase}" — expected "research" or "write".` });
    }

    // ----- phase 2: write -------------------------------------
    if (phase === 'write') {
        const research = payload.research;
        if (!research || typeof research !== 'object') {
            return fail(400, { error: 'The write phase needs the research phase result in "research".' });
        }

        try {
            const { attempt, mode, tried } = await runPhase({
                apiKey, model: MODEL_WRITE, prompt: writePrompt(track), input: buildWriterInput(research),
                schema: SCHEMA_WRITE, useSearch: false, remaining,
            });

            if (attempt.aborted) {
                console.error('lookup-plant write: aborted at', elapsed(), 'ms');
                return timedOut(mode);
            }
            if (!attempt.ok) {
                const detail = attempt.text.slice(0, 600);
                console.error('lookup-plant write: HTTP', attempt.status, 'detail:', detail);
                return fail(502, { error: 'Lookup service error', status: attempt.status, tried, detail });
            }

            const candidate = attempt.json?.candidates?.[0];
            const raw = parseJsonLoosely(candidate?.content?.parts?.map((p) => p?.text || '').join('') || '');
            if (!raw || typeof raw !== 'object') {
                return fail(502, { error: 'The write step came back in a form we could not read. Try again.', mode });
            }

            console.log('lookup-plant write:', track, 'ok in', elapsed(), 'ms —', research.resolvedName);

            // Belt and braces: keep only the sections this track was asked for,
            // so a section filled from memory despite the instruction cannot
            // reach the note.
            const allowed = TRACKS[track].categories;
            const section = (key) => (allowed.includes(key) ? str(raw[key]) : '');

            return {
                statusCode: 200,
                headers: CORS,
                body: JSON.stringify({
                    result: {
                        description: section('description'),
                        cultivation: section('cultivation'),
                        etymology:   section('etymology'),
                        history:     section('history'),
                        careNotes:   TRACKS[track].careNotes ? str(raw.careNotes) : '',
                    },
                    phase, track, mode, model: MODEL_WRITE,
                    elapsedMs: elapsed(), budgetMs: BUDGET_MS,
                }),
            };
        } catch (e) {
            return fail(500, { error: 'Request to lookup service failed', detail: String(e).slice(0, 300) });
        }
    }

    // ----- phase 1: research ----------------------------------
    const name = buildName(payload);
    if (!name) {
        return fail(400, { error: 'Give at least a genus, or a plant name, to look up.' });
    }

    try {
        const { attempt, mode, tried } = await runPhase({
            apiKey, model: MODEL_RESEARCH, prompt: researchPrompt(track), input: buildQuery(payload, name),
            schema: SCHEMA_RESEARCH, useSearch: true, remaining,
        });

        if (attempt.aborted) {
            console.error('lookup-plant research: aborted at', elapsed(), 'ms — budget', BUDGET_MS, 'ms');
            return timedOut(mode);
        }
        if (!attempt.ok) {
            const detail = attempt.text.slice(0, 600);
            console.error('lookup-plant research: HTTP', attempt.status, 'detail:', detail);
            return fail(502, { error: 'Lookup service error', status: attempt.status, tried, detail });
        }

        const candidate = attempt.json?.candidates?.[0];
        const raw = parseJsonLoosely(candidate?.content?.parts?.map((p) => p?.text || '').join('') || '');
        if (!raw || typeof raw !== 'object') {
            return fail(502, { error: 'The research step came back in a form we could not read. Try again.', mode });
        }

        const scope   = str(raw.scope).toLowerCase();
        const sources = mergeSources(raw.sources, sourcesFromGrounding(candidate));
        const allowed = TRACKS[track].categories;

        // Drop anything outside this track's categories. The prompt says not to
        // stray, but a fact in the wrong category would otherwise reach a writer
        // that has been told to ignore that section, and vanish silently.
        const facts = (Array.isArray(raw.facts) ? raw.facts : [])
            .map((f) => ({
                text:        str(f?.text),
                category:    str(f?.category),
                level:       str(f?.level).toLowerCase(),
                sourceIndex: Number.isInteger(f?.sourceIndex) ? f.sourceIndex : -1,
            }))
            .filter((f) => f.text && allowed.includes(f.category));

        const dropped = (Array.isArray(raw.facts) ? raw.facts.length : 0) - facts.length;
        if (dropped > 0) {
            console.warn('lookup-plant research:', track, 'dropped', dropped, 'out-of-scope facts.');
        }

        const queries   = candidate?.groundingMetadata?.webSearchQueries;
        const didSearch = Array.isArray(queries) && queries.length > 0;

        console.log(
            'lookup-plant research:', track, 'ok in', elapsed(), 'ms —', name,
            '—', facts.length, 'facts,', sources.length, 'sources, grounded:', didSearch,
        );

        return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({
                result: {
                    resolvedName: str(raw.resolvedName) || name,
                    identified:   raw.identified !== false,
                    identityNote: str(raw.identityNote),
                    scope:        ['cultivar', 'species', 'genus', 'mixed'].includes(scope) ? scope : '',
                    family:       str(raw.family),
                    commonNames:  str(raw.commonNames),
                    height:       str(raw.height),
                    width:        str(raw.width),
                    caveats:      str(raw.caveats),
                    notFound:     str(raw.notFound),
                    facts,
                    sources,
                },
                grounded:      didSearch || sources.length > 0,
                searchQueries: Array.isArray(queries) ? queries : [],
                droppedFacts:  dropped > 0 ? dropped : 0,
                phase, track, mode, model: MODEL_RESEARCH,
                elapsedMs: elapsed(), budgetMs: BUDGET_MS,
            }),
        };
    } catch (e) {
        return fail(500, { error: 'Request to lookup service failed', detail: String(e).slice(0, 300) });
    }
};
