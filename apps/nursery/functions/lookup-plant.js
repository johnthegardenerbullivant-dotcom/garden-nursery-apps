// =============================================================
//  lookup-plant.js — Netlify serverless function
//  Looks up reference information about a plant from its botanical
//  name (and optional cultivar) using Google Gemini WITH Google
//  Search grounding, and returns structured prose for the Notes
//  field plus a few discrete form fields.
//
//  This is the mirror image of scan-label.js. That function is
//  forbidden from using outside knowledge — it reads only what is
//  printed on the label. This one is nothing BUT outside knowledge,
//  so the whole design is about not making things up: every claim
//  must come from a search result, and anything unverified is
//  omitted rather than softened.
//
//  The Gemini API key is read from the GEMINI_API_KEY environment
//  variable and NEVER sent to the browser.
//
//  Request  (POST JSON):
//    { genus, species, subspecies, variety, cultivar, commonName }
//    — or { name: "Abelia x grandiflora 'Kaleidoscope'" }
//  Response (200 JSON):
//    { result: { …sections, fields, sources… }, grounded: bool }
// =============================================================

// Kept in step with scan-label.js. Google retires Gemini models quickly, so
// set GEMINI_MODEL=gemini-flash-latest in Netlify to always track the newest
// Flash. Search grounding needs a model that supports the google_search tool.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const ENDPOINT =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// -------------------------------------------------------------
//  The prompt. This is the feature — read it before changing it.
// -------------------------------------------------------------
const PROMPT = `You are compiling reference notes about a single plant for a private
horticultural collection database. The house style is that of a good nursery catalog:
accurate, specific, and genuinely interesting about where a plant came from — its name,
its discovery, who bred or selected it, and how it reached cultivation.

The reader is an experienced gardener. He does not want padding, marketing language, or
generalities that would be true of any plant. He would far rather have three sourced
sentences than six paragraphs of confident guesswork.

=== ABSOLUTE RULES ===
These override everything else in this prompt. When a rule conflicts with producing a
full-looking answer, the rule wins.

1. SEARCH FIRST, ALWAYS. Use Google Search and base every statement on what you actually
   find. Do not write from memory. If you did not find it, you do not know it.

2. OMIT WHAT YOU CANNOT VERIFY. If a fact is not supported by something you found, leave
   it out completely. Do not soften it, do not hedge it, do not write "possibly",
   "is thought to be", "may have been" as a way of smuggling in a guess. An empty field is
   a correct and welcome answer. A short entry is better than a padded one.

3. NEVER INVENT A SPECIFIC. Every one of the following must come from a source you found,
   or be omitted entirely:
     - a person's name (botanist, breeder, collector, nurseryman, or someone honored)
     - a nursery, garden, botanic institution, university or company
     - a place or country
     - any year or date
     - a plant patent, trademark, or plant breeders' rights number
     - an award (RHS Award of Garden Merit, gold medals, and so on)
   These are the details most likely to be wrong and least likely to be questioned by the
   reader, because an invented one reads exactly like a real one. Hold them to the highest
   standard in this prompt. If you find a claim like this but cannot tell where it came
   from, leave it out.

4. DO NOT GUESS AN ETYMOLOGY FROM THE SHAPE OF A WORD. Give a derivation only where you
   found it stated. In particular: a genus ending in -ia is NOT necessarily named after a
   person, and you must not invent a person for it. Do not reason from Latin or Greek
   roots to a meaning that no source states. Cultivar names in particular are often
   arbitrary and have no recorded meaning — say nothing rather than construct one.

5. KEEP CULTIVAR, SPECIES AND GENUS FACTS SEPARATE. This is the most common way these
   notes go wrong. If you were given a cultivar, a claim about that cultivar needs a
   source about that cultivar. Where you only found information about the species or the
   genus, you may still use it, but you must say so in the text itself (for example
   "the species is native to …") and you must set "scope" accordingly. Never quietly
   present a species fact as though it were specific to the cultivar. Sizes are the
   usual casualty: a named cultivar is frequently chosen for being more compact than the
   species, so an unsourced species height is actively misleading.

6. DO NOT SILENTLY ANSWER ABOUT A DIFFERENT PLANT. If the name you were given appears to
   be a misspelling, a synonym, or a name you cannot find at all, do not quietly answer
   about the nearest plant you can think of. Set "identified" to false, explain what you
   found or did not find in "identityNote", and leave the content sections empty. If the
   name is a recognized synonym of an accepted name, you may answer about the accepted
   plant, but say so in "identityNote".

7. PRESERVE DISAGREEMENT. Where sources conflict — commonly on ultimate size, hardiness,
   or who raised a cultivar — do not average them and do not pick a favourite. Give the
   range or note the disagreement in "caveats".

8. REPORT YOUR GAPS. Use "notFound" to say briefly which things you looked for and could
   not verify, so the reader can tell the difference between "there is nothing recorded"
   and "this lookup did not cover it". This is useful information, not an apology.

=== WHAT TO WRITE ===
Write plain prose. No markdown, no bullet points, no headings inside the fields — the
application adds its own headings. Use full sentences and AMERICAN English spelling and
usage throughout — color, gray, fertilize, favorite, meter. In prose, give sizes in feet
and inches with metric in parentheses, for example "3-4 ft (0.9-1.2 m)".

LENGTH — this is a reference note, not an essay, and a long answer is a slow answer.
Hold description, cultivation and etymology to 2-4 sentences each. History may run to 6
where there is a real story on record. Never pad a section to make it look complete;
under-filling is the intended behavior, not a failure.

- description: what the plant looks like and does through the year — habit, eventual size
  in the text, foliage, flower color and form, season of interest, scent, fruit, fall
  color. Evergreen or deciduous. What it is actually like to have in a garden.

- cultivation: growing requirements — aspect, soil, drainage, watering, hardiness (give
  the USDA zone, or the RHS rating where that is what the source states), pruning, feeding,
  and any pest or
  disease it is particularly prone to. Also note if it is invasive, self-seeds freely, is
  toxic, or spreads by runners, where a source says so.

- etymology: the meaning and derivation of the botanical name. Deal with the genus and the
  specific epithet separately where you found both. Where the genus honors a real person,
  name them and say who they were — but only from a source (see rule 3 and rule 4). Cover
  the common name too where its origin is recorded and interesting; some common names are
  much older than the botanical one and have a story worth having.

- history: where the plant came from and how it got here. For a species: native range and
  habitat, when and by whom it was collected or introduced to cultivation, and any
  historical, medicinal, culinary or cultural use recorded for it. For a cultivar: this is
  the important one — how it arose (a seedling, a sport, a deliberate cross, and of what),
  who found or bred it, where, and when; when it was released and by whom; any patent or
  award. This is the section the reader most wants and the section where invention is most
  tempting. Rule 3 applies with full force.

Leave any section as an empty string if you did not find enough to say. Do not write
"no information found" inside a section — that is what "notFound" is for.

=== THE DISCRETE FIELDS ===
These populate form inputs, so keep them short and literal:

- height / width: ultimate size, as the source gives it, keeping ranges and units
  (for example "3-4 ft", "24-30 in", "60 cm"). Keep whatever unit the source used rather
  than converting it — a conversion you perform yourself is one more chance to introduce
  an error into a number. If the only sizes you found are for the species and you
  were asked about a cultivar, leave these EMPTY and mention the species size in the
  description text instead. See rule 5.
- careNotes: one or two sentences of the most practical guidance — the condensed version
  of "cultivation" for a small form field. Not a duplicate of the whole paragraph.
- family: the botanical family, if found.
- commonNames: the common names in use, comma separated, if found.

=== SOURCES ===
Populate "sources" with the pages you actually used — title and URL. Prefer botanic
gardens, university extension services, the RHS, national plant societies, monographs, plant
patent records, and established nurseries' own catalog entries. Do not list a source you
did not use. Do not invent a URL: if you cannot give a real one, give the title alone.

Return the result as JSON matching the provided schema.`;

const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        resolvedName: { type: 'STRING' },
        identified:   { type: 'BOOLEAN' },
        identityNote: { type: 'STRING' },
        scope:        { type: 'STRING' },   // cultivar | species | genus | mixed
        family:       { type: 'STRING' },
        commonNames:  { type: 'STRING' },
        description:  { type: 'STRING' },
        cultivation:  { type: 'STRING' },
        etymology:    { type: 'STRING' },
        history:      { type: 'STRING' },
        height:       { type: 'STRING' },
        width:        { type: 'STRING' },
        careNotes:    { type: 'STRING' },
        caveats:      { type: 'STRING' },
        notFound:     { type: 'STRING' },
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

// Describe what we were asked about, so the model knows how much is a cultivar
// question and how much is a species question (rule 5).
function buildQuery(p, name) {
    const lines = [`The plant to look up is: ${name}`];

    if (p.cultivar) {
        lines.push(
            `This is a named CULTIVAR ('${String(p.cultivar).trim().replace(/^['"]|['"]$/g, '')}'). ` +
            'Cultivar-level claims need cultivar-level sources — see rule 5. Its origin, who ' +
            'raised or found it and when, is the most valuable thing you can find.',
        );
    } else if (p.species) {
        lines.push('This is a species, not a cultivar. Do not attribute cultivar traits to it.');
    } else if (p.genus) {
        lines.push(
            'Only a genus was supplied. Answer at genus level, set scope to "genus", and do not ' +
            'invent a species. Say in identityNote that a species would give a better answer.',
        );
    }

    if (p.commonName && p.genus) {
        lines.push(`The collection records its common name as "${String(p.commonName).trim()}". ` +
                   'Ignore it if it conflicts with the botanical name — the botanical name wins.');
    }

    return lines.join('\n');
}

// Pull sources out of Gemini's grounding metadata. These are the real citations
// when they are present; when structured output is combined with the search tool
// they have been reported to come back empty, which is why the schema also asks
// the model for its own source list. We merge both and dedupe.
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
        ...(Array.isArray(groundedSources) ? groundedSources : []),
        ...(Array.isArray(modelSources) ? modelSources : []),
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

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// Normalise whatever came back so the client always sees the same shape.
function shapeResult(raw, fallbackName) {
    const scope = str(raw.scope).toLowerCase();
    return {
        resolvedName: str(raw.resolvedName) || fallbackName,
        identified:   raw.identified !== false,
        identityNote: str(raw.identityNote),
        scope:        ['cultivar', 'species', 'genus', 'mixed'].includes(scope) ? scope : '',
        family:       str(raw.family),
        commonNames:  str(raw.commonNames),
        description:  str(raw.description),
        cultivation:  str(raw.cultivation),
        etymology:    str(raw.etymology),
        history:      str(raw.history),
        height:       str(raw.height),
        width:        str(raw.width),
        careNotes:    str(raw.careNotes),
        caveats:      str(raw.caveats),
        notFound:     str(raw.notFound),
        sources:      [],
    };
}

// A grounded lookup is slow: Gemini runs several web searches and then writes
// a few hundred words. Netlify kills a synchronous function at 10s by default
// (26s on Pro, on request), and a kill arrives as an opaque 504 with no clue
// in it. So we impose our own deadline slightly inside the platform's and
// return a diagnostic instead. Raise it with LOOKUP_BUDGET_MS once you know
// what your site's real limit is.
const BUDGET_MS = Number(process.env.LOOKUP_BUDGET_MS || 8500);

async function callGemini(apiKey, body, remainingMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, remainingMs));
    try {
        const resp = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
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

    const name = buildName(payload);
    if (!name) {
        return {
            statusCode: 400,
            headers: CORS,
            body: JSON.stringify({ error: 'Give at least a genus, or a plant name, to look up.' }),
        };
    }

    const started   = Date.now();
    const elapsed   = () => Date.now() - started;
    const remaining = () => BUDGET_MS - elapsed();

    const contents = [{ parts: [{ text: `${PROMPT}\n\n=== THE REQUEST ===\n${buildQuery(payload, name)}` }] }];
    const tools    = [{ google_search: {} }];

    // Latency is the binding constraint, and output tokens dominate it, so the
    // model is told to think as little as possible. Set GEMINI_THINKING_BUDGET
    // above 0 to trade speed back for quality. Not every model accepts this
    // field, so a 400 that mentions it retries without it (see below).
    const thinkingBudget = Number(process.env.GEMINI_THINKING_BUDGET || 0);

    const genConfig = {
        temperature:      0,
        responseMimeType: 'application/json',
        responseSchema:   RESPONSE_SCHEMA,
        thinkingConfig:   { thinkingBudget },
    };

    // Preferred shape: search grounding AND a response schema in one call. This
    // works on the Gemini 3 family through the REST API. If this deployment's
    // model rejects the combination (older models return 400 INVALID_ARGUMENT),
    // fall back to grounded free-form output and parse the JSON ourselves —
    // grounding matters more than the schema, so the schema is what we drop.
    const groundedStructured = { contents, tools, generationConfig: genConfig };

    const freeformInstruction =
        `\n\nReturn ONLY a JSON object with these keys and no other text: resolvedName, ` +
        `identified (boolean), identityNote, scope, family, commonNames, description, ` +
        `cultivation, etymology, history, height, width, careNotes, caveats, notFound, ` +
        `sources (array of {title, url}).`;

    const groundedFreeform = {
        contents: [{ parts: [{ text: contents[0].parts[0].text + freeformInstruction }] }],
        tools,
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget } },
    };

    // Strip a config key the model rejected and try that same shape again.
    const withoutThinking = (body) => {
        const { thinkingConfig, ...rest } = body.generationConfig;
        return { ...body, generationConfig: rest };
    };

    const timedOut = (mode) => ({
        statusCode: 504,
        headers: CORS,
        body: JSON.stringify({
            error: `The lookup ran past its ${BUDGET_MS} ms budget and was stopped. A grounded ` +
                   `search plus several paragraphs often needs longer than a Netlify function is ` +
                   `allowed. Raise LOOKUP_BUDGET_MS if this site's function timeout permits it, ` +
                   `or the lookup needs to move to a background function.`,
            elapsedMs: elapsed(),
            budgetMs:  BUDGET_MS,
            mode,
            model:     GEMINI_MODEL,
        }),
    });

    try {
        let attempt  = await callGemini(apiKey, groundedStructured, remaining());
        let usedMode = 'grounded+schema';

        // Model does not know thinkingConfig — drop it and retry once.
        if (!attempt.ok && attempt.status === 400 && /thinking/i.test(attempt.text)) {
            console.warn('lookup-plant: model rejected thinkingConfig — retrying without it.');
            attempt = await callGemini(apiKey, withoutThinking(groundedStructured), remaining());
        }

        if (!attempt.ok && attempt.status === 400 && !attempt.aborted) {
            console.warn(
                'lookup-plant: grounded+schema rejected (HTTP 400) on model', GEMINI_MODEL,
                '— retrying grounded free-form. Detail:', attempt.text.slice(0, 300),
            );
            attempt  = await callGemini(apiKey, groundedFreeform, remaining());
            usedMode = 'grounded+freeform';
        }

        if (attempt.aborted) {
            console.error('lookup-plant: aborted at', elapsed(), 'ms — budget', BUDGET_MS, 'ms, model', GEMINI_MODEL);
            return timedOut(usedMode);
        }

        if (!attempt.ok) {
            const detail = attempt.text.slice(0, 600);
            console.error('Gemini API error — HTTP', attempt.status, 'model:', GEMINI_MODEL, 'detail:', detail);
            return {
                statusCode: 502,
                headers: CORS,
                body: JSON.stringify({
                    error: 'Lookup service error', status: attempt.status,
                    model: GEMINI_MODEL, elapsedMs: elapsed(), detail,
                }),
            };
        }

        const candidate = attempt.json?.candidates?.[0];
        const text      = candidate?.content?.parts?.map((p) => p?.text || '').join('') || '';
        const raw       = parseJsonLoosely(text);

        if (!raw || typeof raw !== 'object') {
            return {
                statusCode: 502,
                headers: CORS,
                body: JSON.stringify({
                    error: 'The lookup came back in a form we could not read. Try again.',
                    mode:  usedMode,
                    raw:   text.slice(0, 400),
                }),
            };
        }

        const grounded = sourcesFromGrounding(candidate);
        const result   = shapeResult(raw, name);
        result.sources = mergeSources(raw.sources, grounded);

        // Did the search tool actually run? webSearchQueries is populated even
        // when groundingChunks is not, so it is the more reliable signal — and
        // an ungrounded answer is exactly what this feature must not ship
        // silently, so the client is told.
        const queries = candidate?.groundingMetadata?.webSearchQueries;
        const didSearch = Array.isArray(queries) && queries.length > 0;

        console.log('lookup-plant: ok in', elapsed(), 'ms —', name, '— mode', usedMode);

        return {
            statusCode: 200,
            headers: CORS,
            body: JSON.stringify({
                result,
                grounded:       didSearch || grounded.length > 0,
                searchQueries:  Array.isArray(queries) ? queries : [],
                mode:           usedMode,
                model:          GEMINI_MODEL,
                elapsedMs:      elapsed(),
                budgetMs:       BUDGET_MS,
            }),
        };
    } catch (e) {
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({
                error: 'Request to lookup service failed',
                elapsedMs: elapsed(),
                detail: String(e).slice(0, 300),
            }),
        };
    }
};
