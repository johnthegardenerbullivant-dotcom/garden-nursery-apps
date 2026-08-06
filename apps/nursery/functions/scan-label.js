// =============================================================
//  scan-label.js — Netlify serverless function
//  Reads a nursery plant label (front + back images) with Google
//  Gemini and returns structured fields for the New Batch form.
//
//  The Gemini API key is read from the GEMINI_API_KEY environment
//  variable and NEVER sent to the browser.
//
//  Request  (POST JSON):
//    { images: [ { mimeType: "image/jpeg", data: "<base64, no prefix>" }, ... ] }
//  Response (200 JSON):
//    { fields: { commonName, genus, species, ... } }
// =============================================================

// Google retires Gemini models quickly: 2.0-flash shut down 2026-06-01, and
// 2.5-flash is now closed to new users. gemini-3.5-flash is the current GA,
// free-tier, multimodal model. To avoid future 404s when this one is retired,
// set GEMINI_MODEL=gemini-flash-latest in Netlify to always track the newest Flash.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const ENDPOINT =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT = `You are reading the printed label of a plant from a garden nursery.
You are given one or more photos of the same label (usually the front and the back).

Extract ONLY the information that is actually printed on the label. Do not use any
outside knowledge about the plant. If a piece of information is not shown on the label,
return an empty string for it (or false for the hybrid flag). Never guess or invent a
botanical name, size, or supplier.

Fill these fields:
- commonName: the everyday name (e.g. "Dog rose", "Lavender").
- genus: the botanical genus, capitalised (e.g. "Rosa", "Lavandula").
- species: the species epithet, lowercase (e.g. "canina", "angustifolia").
- subspecies: subspecies epithet only, if printed (lowercase), else "".
- variety: botanical variety (var.) epithet only, if printed, else "".
- cultivar: the cultivar name WITHOUT quotation marks (e.g. New Dawn, Hidcote), else "".
- authority: the naming authority if shown (e.g. "L.", "Mill."), else "".
- hybrid: true only if the name contains a hybrid mark (×), otherwise false.
- description: a short description of the plant as printed — flower colour, habit,
  season of interest, etc. Keep it to what the label says.
- careNotes: combine any care guidance printed on the label into one readable note —
  aspect / sun or shade, watering, soil type, hardiness, feeding, pruning, position.
- ultimateHeight: mature height as printed, keeping units and ranges (e.g. "1.5m",
  "40-60cm"), else "".
- ultimateWidth: mature spread / width as printed (e.g. "1m", "30cm"), else "".
- supplier: the nursery or brand name printed on the label, else "".

Return the result as JSON matching the provided schema.`;

const RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        commonName:     { type: 'STRING' },
        genus:          { type: 'STRING' },
        species:        { type: 'STRING' },
        subspecies:     { type: 'STRING' },
        variety:        { type: 'STRING' },
        cultivar:       { type: 'STRING' },
        authority:      { type: 'STRING' },
        hybrid:         { type: 'BOOLEAN' },
        description:    { type: 'STRING' },
        careNotes:      { type: 'STRING' },
        ultimateHeight: { type: 'STRING' },
        ultimateWidth:  { type: 'STRING' },
        supplier:       { type: 'STRING' },
    },
};

const CORS = {
    'Content-Type':                 'application/json',
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

    const images = Array.isArray(payload.images) ? payload.images : [];
    if (images.length === 0) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No images supplied' }) };
    }

    // Build the Gemini request: prompt text followed by each image.
    const parts = [{ text: PROMPT }];
    for (const img of images) {
        if (img && typeof img.data === 'string' && img.data.length) {
            parts.push({
                inline_data: {
                    mime_type: img.mimeType || 'image/jpeg',
                    data:      img.data,
                },
            });
        }
    }
    if (parts.length === 1) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'No valid image data supplied' }) };
    }

    const requestBody = {
        contents: [{ parts }],
        generationConfig: {
            temperature:      0,
            responseMimeType: 'application/json',
            responseSchema:   RESPONSE_SCHEMA,
        },
    };

    try {
        const resp = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(requestBody),
        });

        if (!resp.ok) {
            const detail = (await resp.text()).slice(0, 600);
            console.error('Gemini API error — HTTP', resp.status, 'model:', GEMINI_MODEL, 'detail:', detail);
            return {
                statusCode: 502,
                headers: CORS,
                body: JSON.stringify({ error: 'Vision service error', status: resp.status, model: GEMINI_MODEL, detail }),
            };
        }

        const json = await resp.json();
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        let fields;
        try {
            fields = JSON.parse(text);
        } catch {
            return {
                statusCode: 502,
                headers: CORS,
                body: JSON.stringify({ error: 'Could not read the label. Try clearer, well-lit photos.', raw: text.slice(0, 400) }),
            };
        }

        return { statusCode: 200, headers: CORS, body: JSON.stringify({ fields }) };
    } catch (e) {
        return {
            statusCode: 500,
            headers: CORS,
            body: JSON.stringify({ error: 'Request to vision service failed', detail: String(e).slice(0, 300) }),
        };
    }
};
