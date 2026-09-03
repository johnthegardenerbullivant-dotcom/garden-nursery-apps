// =============================================================
//  qr.js — QR codes for printed plant tags
//  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
//  A printed tag carries  https://<site>/P/<tagCode>  as a QR
//  code, so scanning it in the garden opens that plant's detail
//  page. `_redirects` rewrites /p/* and /P/* to the app and
//  main.js turns the path into the normal #plant-detail/<id>
//  route.
//
//  Three consumers, one tag design: plants-view.js prints a
//  single paper tag or a run of label-printer tape, and
//  areas-view.js prints a paper sheet for a whole area.
//
//  The URL contract and the print geometry are in
//  docs/plant-tags.md — read that before changing either.
// =============================================================

import { renderSVG } from 'https://cdn.jsdelivr.net/npm/uqr@0.1.3/dist/index.mjs';
import { GARDEN_URL } from '../app-config.js';
import { formatBotanicalName, escHtml } from './db.js';
import { showToast } from './ui-utils.js';

// =============================================
//  The URL a tag carries
// =============================================

/**
 * Base address for printed tags.
 *
 * GARDEN_URL is optional on the Garden site — build.mjs writes an empty string
 * when it is unset, and it exists mainly for Nursery's cross-app links. Worth
 * setting on Garden too before a print run: without it the base is whatever
 * host you happen to be looking at, so tags generated on a Netlify deploy
 * preview would be stamped with that preview's throwaway address and would
 * die with the pull request.
 */
export function tagBaseUrl() {
    const configured = (GARDEN_URL || '').trim();
    if (configured && !configured.startsWith('REPLACE_WITH')) {
        return configured.replace(/\/+$/, '');
    }
    return window.location.origin;
}

/** The tag URL in the form a person reads, on screen or typed off a label. */
export function plantTagUrl(tagCode) {
    return `${tagBaseUrl()}/P/${tagCode}`;
}

/**
 * The exact string encoded into the QR code — the same URL, upper-cased.
 *
 * This is the most consequential line in the file. QR has a compact
 * "alphanumeric" mode covering 0-9, A-Z and a little punctuation including
 * : / . — but NOT lower case, which forces the encoder into byte mode.
 * Upper-casing the whole URL keeps a host + '/P/' + a six-character code
 * inside a 29-module version-3 symbol; leaving it lower case pushes it to 33.
 * With the four-module quiet zone that is 37 modules against 41, and on an
 * 18 mm tape's 112 usable printer pins that is three dots per module against
 * two — the difference between a tag that still scans covered in mud and one
 * that does not.
 *
 * Safe because RFC 3986 makes the scheme and host case-insensitive (browsers
 * normalise them), and the path is served by explicit /p/* AND /P/* rules in
 * `_redirects`. See docs/plant-tags.md.
 */
export function plantTagQrText(tagCode) {
    return plantTagUrl(tagCode).toUpperCase();
}

// =============================================
//  The code itself
// =============================================

/**
 * QR code as an SVG string.
 *
 * Both options are passed explicitly because both defaults are wrong for a
 * label that lives outdoors: uqr defaults to error-correction level 'L' and a
 * ONE-module quiet zone.
 *
 *   ecc 'Q'   — ~25% of the code can be lost and still decode. Measured on a
 *               rendered tag, Q survived roughly twice the contiguous
 *               smearing that M did before it stopped decoding. That is mud,
 *               moss and a scuff from a hoe.
 *   border 4  — the four-module quiet zone the QR spec asks for. A thin one
 *               is the single most common reason a home-printed code refuses
 *               to scan.
 *
 * shape-rendering="crispEdges" turns off antialiasing. On paper it changes
 * little; on 180 dpi thermal tape, where a module is only three printer dots
 * wide, a half-grey edge dot is a real fraction of the module and costs
 * contrast exactly where the scanner looks for an edge.
 *
 * The SVG carries a viewBox but no width/height, so it fills whatever box it
 * is put in — the print CSS below sets the real size in millimetres.
 */
export function qrSvg(text) {
    return renderSVG(text, { ecc: 'Q', border: 4, pixelSize: 8 })
        .replace('<svg ', '<svg shape-rendering="crispEdges" ');
}

/** The QR for a plant whose tag code has already been minted. */
export function plantQrSvg(tagCode) {
    return qrSvg(plantTagQrText(tagCode));
}

// =============================================
//  Label-printer tape geometry
// =============================================
// A Brother P-touch (the PT-P710BT and the rest of the PT series) has a
// 128-pin head at 180 dpi. Narrower tape does not use the whole head: the
// unused pins are a margin at each end, and what is left is all you can
// print on.
//
//   printable dots = 128 - 2 x margin        (Brother's raster reference)
//
// A QR module must be a WHOLE number of printer dots. Ask for 2.49 and the
// modules come out unevenly sized, which is what actually stops a small code
// scanning — not its overall size. So the code is sized to
// floor(printable / modulesAcross) dots per module and may leave a sliver of
// tape unused; that is the correct trade.
export const TAPE_MARGIN_PINS = { 3.5: 52, 6: 48, 9: 39, 12: 29, 18: 8, 24: 0 };
const PRINT_HEAD_PINS = 128;
const DPI             = 180;
const MM_PER_DOT      = 25.4 / DPI;          // 0.1411 mm

/** Printable height in dots for a tape width in mm. */
export function tapePrintableDots(tapeWidthMm) {
    const margin = TAPE_MARGIN_PINS[tapeWidthMm];
    if (margin === undefined) return null;
    return PRINT_HEAD_PINS - margin * 2;
}

/**
 * How a given QR lands on a given tape.
 *
 * Returns the whole-dot module size, the resulting physical size, and whether
 * it clears the two-dots-per-module floor below which a thermal-printed code
 * stops being reliable outdoors.
 */
export function tapeQrPlan(tapeWidthMm, modulesAcross) {
    const dots = tapePrintableDots(tapeWidthMm);
    if (!dots) return null;
    const dotsPerModule = Math.floor(dots / modulesAcross);
    const sideDots      = dotsPerModule * modulesAcross;
    return {
        tapeWidthMm,
        printableDots: dots,
        printableMm:   dots * MM_PER_DOT,
        dotsPerModule,
        sideMm:        sideDots * MM_PER_DOT,
        moduleMm:      dotsPerModule * MM_PER_DOT,
        ok:            dotsPerModule >= 2,
        good:          dotsPerModule >= 3
    };
}

/** Modules across a rendered QR, quiet zone included — read off its viewBox. */
export function qrModulesAcross(svg) {
    const m = /viewBox="0 0 (\d+) \d+"/.exec(svg);
    return m ? Number(m[1]) / 8 : null;       // pixelSize 8, so 8 units per module
}

// =============================================
//  The aluminium tag the tape is stuck to
// =============================================
// Tape is continuous; the tag is not. The tag is therefore the thing that
// really caps a label's length, and knowing which one a label is destined for
// is what lets the layout choose between one long line and two short ones.
//
//   7" x 3/4" strip   long and shallow. The tape all but covers its height,
//                     so one line reads better than two and there is length
//                     to spare for it.
//   4" x 1 1/2" plate short and deep. Two lines are natural here, and the
//                     shorter label is the cheaper one.

export const TAG_STOCK = {
    strip: { id: 'strip', label: '7" x 3/4" strip',   lengthMm: 177.8, heightMm: 19.05, lines: 1 },
    plate: { id: 'plate', label: '4" x 1 1/2" plate', lengthMm: 101.6, heightMm: 38.10, lines: 2 }
};

export const DEFAULT_TAG_STOCK = 'strip';

/** Bare metal left at each end, so the tape is not fighting the tag's edge. */
const TAG_EDGE_MM = 3;

export function tagStock(stockId) {
    return TAG_STOCK[stockId] || TAG_STOCK[DEFAULT_TAG_STOCK];
}

/** The longest label that will sit on a given tag. */
export function tagUsableLengthMm(stockId) {
    return tagStock(stockId).lengthMm - TAG_EDGE_MM * 2;
}

// =============================================
//  Measuring the name, rather than guessing it
// =============================================
// This used to be an estimate — character count times an assumed average
// advance — and it was wrong in the expensive direction. Measured on
// "Weinmannia trichosperma" it reserved 47.7 mm for a name that inked 26.0 mm,
// because the estimate assumed one line while the CSS clamps to two. Every
// millimetre of that over-reservation is thermal tape fed out and thrown away.
// Canvas can measure the same font the label prints in, so ask it.

const LABEL_FONT = 'Arial, Helvetica, sans-serif';

/** A few percent of headroom: a name mixes italic and roman, we measure one. */
const MEASURE_SAFETY = 1.03;

function measureCtx() {
    if (!measureCtx.ctx) {
        measureCtx.ctx = document.createElement('canvas').getContext('2d');
    }
    return measureCtx.ctx;
}

/**
 * Width of `text` in mm, set in the label's own font at `sizeMm`.
 *
 * Measured at a large pixel size and scaled down. At 4 mm the browser rounds
 * glyph advances to whole pixels, and on a short string that rounding is a
 * percent or two of error in the direction that truncates a name.
 */
export function textWidthMm(text, sizeMm, { bold = true, italic = true } = {}) {
    const PX  = 400;
    const ctx = measureCtx();
    ctx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}${PX}px ${LABEL_FONT}`;
    return ctx.measureText(text).width / PX * sizeMm;
}

/**
 * The narrowest box that holds `text` in at most `maxLines` lines.
 *
 * Every break at a space is tried and the split whose longest line is
 * shortest wins — a balanced wrap. That is both tidier than the greedy wrap a
 * browser produces when simply handed a narrow box, and shorter: greedy
 * leaves "Weinmannia" alone on line one and sets the box by "trichosperma"
 * anyway, while balancing can often do better on a three-word name.
 */
export function nameBlockWidthMm(text, sizeMm, maxLines) {
    const full = textWidthMm(text, sizeMm);
    if (maxLines < 2) return full;

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 2) return full;

    let best = full;
    for (let i = 1; i < words.length; i++) {
        const a = textWidthMm(words.slice(0, i).join(' '), sizeMm);
        const b = textWidthMm(words.slice(i).join(' '),    sizeMm);
        best = Math.min(best, Math.max(a, b));
    }
    return best;
}

/**
 * The whole tape-label plan for one print run: type sizes, how many lines the
 * name gets, and the page length that follows from both.
 *
 * Every label in one job shares a page size — that is a print-dialog
 * constraint, not a choice — so the run is sized by its widest name.
 */
export function tapeLabelPlan(tags, tapeWidthMm, stockId, modules) {
    const plan = tapeQrPlan(tapeWidthMm, modules);
    if (!plan) return null;

    const stock    = tagStock(stockId);
    const usableMm = tagUsableLengthMm(stockId);
    const pad      = 1.2;
    const textRoom = usableMm - plan.sideMm - pad * 3;

    const names   = tags.map(t => plainTagName(t.plant));
    const commons = tags.map(t => t.plant.commonName || '');

    const anyCommon    = commons.some(Boolean);
    const commonSizeMm = plan.printableMm * 0.20;
    const commonMm     = Math.max(0, ...commons.map(c =>
        c ? textWidthMm(c, commonSizeMm, { italic: false, bold: false }) : 0));

    // Type is sized to FILL what the tag and the tape between them allow,
    // rather than to a fixed share of the strip. A fixed share is what made
    // the first printed labels legible only up close: it set 7 mm type on a
    // 7" tag that had room for 10, and left an inch of bare aluminium.
    //
    // Two ceilings apply and the lower one wins:
    //   height  the printable strip, split between the lines and any common name
    //   length  what is left beside the code, once the tag's ends are allowed for
    //
    // Text width scales linearly with type size, so the length ceiling is one
    // measurement at 1 mm and a division — no search needed.
    const commonStackMm = anyCommon ? commonSizeMm * 1.15 + 0.4 : 0;

    function candidate(lines) {
        const heightCap = (plan.printableMm - commonStackMm) / (lines * 1.15);
        const unitWidth = Math.max(...names.map(n => nameBlockWidthMm(n, 1, lines)));
        const lengthCap = unitWidth > 0
            ? textRoom / (unitWidth * MEASURE_SAFETY)
            : heightCap;
        const sizeMm = Math.min(heightCap, lengthCap);
        return { lines, sizeMm, nameMm: unitWidth * sizeMm * MEASURE_SAFETY };
    }

    // The tag asks for one line, but only gets it while one line is the more
    // legible answer. A name long enough to drive single-line type below what
    // two lines would give is better set on two — the strip is 3/4" deep, and
    // 5 mm across two lines reads from further away than 3 mm across one.
    const two  = candidate(2);
    const best = stock.lines === 1
        ? [candidate(1), two].reduce((a, b) => (b.sizeMm > a.sizeMm ? b : a))
        : two;

    const needMm = Math.max(best.nameMm, commonMm);
    const textMm = Math.min(needMm, textRoom);

    // The page is the TAG's usable length, not the text's. That looks wasteful
    // and is not: the P-touch driver feeds and cuts to its own fixed Length
    // setting, so the strip that comes out is that length whatever this page
    // says. Measured 2026-09-03 — a 172 mm label and a 96 mm one printed strips
    // of identical length, and before that every label came out at exactly the
    // 3.00" the driver was set to. A shorter page therefore saves no tape at
    // all; it only stops the page matching the driver, which is the mismatch
    // that clipped names mid-word.
    //
    // Pinning it to the tag makes the driver's Length two constants — 6.8" for
    // the strip, 3.8" for the plate — set once per stock instead of retyped for
    // every batch, and leaves the 3 mm of bare metal at each end that
    // TAG_EDGE_MM is there to reserve.

    return {
        ...plan,
        stock, pad, usableMm,
        nameLines:     best.lines,
        nameSizeMm:    best.sizeMm,
        commonSizeMm,
        textMm,
        labelLengthMm: Math.round(usableMm),
        fitsTag:       needMm <= textRoom + 0.01
    };
}
// =============================================
//  Tag markup — paper sheet
// =============================================

/**
 * The name printed on a tag, as HTML.
 *
 * formatBotanicalName is the single source of truth for hybrid nomenclature.
 * The authority is dropped for tags: it is the first thing to overflow and the
 * last thing anyone reads standing in a border.
 */
export function tagBotanicalHTML(plant) {
    return formatBotanicalName({ ...plant, authority: '' })
        || escHtml(plant.commonName || 'Unnamed plant');
}

/** The same name as plain text — for measuring, not for display. */
export function plainTagName(plant) {
    return tagBotanicalHTML(plant).replace(/<[^>]+>/g, '');
}

/**
 * One paper tag. `plant` is a plants document carrying a tagCode; `note` is an
 * optional small line at the foot (the area name, a quantity).
 */
export function tagHTML(plant, note = '') {
    const botanical = tagBotanicalHTML(plant);
    const common = plant.commonName ? `<div class="tag-common">${escHtml(plant.commonName)}</div>` : '';
    const foot   = note ? `<div class="tag-note">${escHtml(note)}</div>` : '';

    return `<div class="tag">
        <div class="tag-qr">${plantQrSvg(plant.tagCode)}</div>
        <div class="tag-name">${botanical}</div>
        ${common}
        ${foot}
        <div class="tag-code">${escHtml(plant.tagCode)}</div>
    </div>`;
}

// Print geometry. 63 x 64 mm at 3 across and 4 down fits US Letter AND A4
// with an 8 mm margin, so the same sheet prints correctly on either without
// anyone having to think about paper size.
const SHEET_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; padding: 8mm; }
  h1 { font-size: 13pt; color: #2d6a4f; margin-bottom: 2px; }
  .meta { font-size: 9pt; color: #666; margin-bottom: 6mm; }
  .sheet { display: flex; flex-wrap: wrap; }
  .tag {
    width: 63mm; height: 64mm; padding: 3mm;
    border: 1px dashed #c8c8c8;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start;
    text-align: center; page-break-inside: avoid; break-inside: avoid; overflow: hidden;
  }
  .tag-qr { width: 37mm; height: 37mm; margin-bottom: 2.5mm; }
  .tag-qr svg { width: 100%; height: 100%; display: block; }
  .tag-name { font-size: 10pt; font-weight: 700; line-height: 1.25; }
  .tag-name em { font-style: italic; }
  .tag-common { font-size: 8.5pt; color: #555; margin-top: 1mm; line-height: 1.2; }
  .tag-note { font-size: 7.5pt; color: #888; margin-top: auto; }
  .tag-code { font-family: ui-monospace, Consolas, monospace; font-size: 7pt; color: #aaa;
              letter-spacing: 0.08em; margin-top: 1mm; }
  .print-btn { display: inline-block; margin-bottom: 5mm; padding: 8px 20px; background: #2d6a4f;
               color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 10pt; }
  @page { margin: 8mm; }
  @media print {
    .print-btn, .screen-only { display: none; }
    body { padding: 0; }
    h1, .meta { display: none; }
    .tag { border-color: #ddd; }
  }
`;

/** Wraps a print window's body and hands it to the browser. */
function openPrintDocument(title, css, bodyHtml) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(title)}</title>
<style>${css}</style>
</head>
<body>${bodyHtml}</body>
</html>`;

    // Blob URL rather than document.write(), which modern browsers restrict.
    const blob = new Blob([html], { type: 'text/html' });
    const url  = URL.createObjectURL(blob);
    const win  = window.open(url, '_blank');
    if (!win) {
        showToast('Pop-up blocked — please allow pop-ups for this site', 'error');
        URL.revokeObjectURL(url);
    }
}

/**
 * Opens a print window containing `tags` (an array of {plant, note}).
 * Returns nothing — a blocked pop-up is reported to the user here.
 */
export function openTagSheet(tags, heading) {
    const date = new Date().toLocaleDateString('en-US', {
        day: 'numeric', month: 'long', year: 'numeric'
    });
    const body = tags.map(t => tagHTML(t.plant, t.note)).join('');

    openPrintDocument(`Plant Tags — ${heading}`, SHEET_CSS, `
  <button class="print-btn" onclick="window.print()">&#128438; Print / Save as PDF</button>
  <h1>${escHtml(heading)}</h1>
  <div class="meta">
    ${tags.length} tag${tags.length !== 1 ? 's' : ''} &nbsp;&middot;&nbsp; 12 per sheet &nbsp;&middot;&nbsp;
    Printed ${date} &nbsp;&middot;&nbsp; codes point at ${escHtml(tagBaseUrl())}
  </div>
  <div class="sheet">${body}</div>`);
}

// =============================================
//  Label-printer tape
// =============================================

/**
 * Opens a print window holding one label per plant, laid out for continuous
 * label tape on a Brother P-touch.
 *
 * This goes out through the ordinary print dialog to the P-touch's own printer
 * driver, NOT over Bluetooth. That is a deliberate choice rather than a
 * shortcut: the PT-P710BT speaks Bluetooth Classic RFCOMM/SPP, and the Web
 * Bluetooth API only speaks BLE, so a browser cannot open a socket to it at
 * all. See docs/plant-tags.md.
 *
 * The layout runs ALONG the tape rather than across it: tape length is
 * unlimited and tape width is not, so the QR is sized by the width and the
 * name sits beside it in as much length as it needs.
 */
export function openTapeLabels(tags, tapeWidthMm, stockId = DEFAULT_TAG_STOCK) {
    if (!tags || !tags.length) {
        showToast('Nothing to print', 'error');
        return;
    }

    // The geometry is measured once off the first code because they are all
    // the same width: the URL is a fixed host plus a fixed-length code, so
    // every tag is the same QR version.
    const modules = qrModulesAcross(plantQrSvg(tags[0].plant.tagCode));
    const plan    = modules ? tapeLabelPlan(tags, tapeWidthMm, stockId, modules) : null;

    if (!plan) {
        showToast(`No geometry for ${tapeWidthMm} mm tape`, 'error');
        return;
    }
    if (!plan.ok) {
        showToast(`${tapeWidthMm} mm tape is too narrow for this code — use 18 mm or wider`, 'error');
        return;
    }

    const { pad, labelLengthMm } = plan;

    const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
  /* The box is the FULL tape width, not just the printable strip, and its
     contents are centred in it. The driver centres its printable window on the
     tape too, so the two agree; sizing the box to the printable height instead
     would pin the code to one edge and let a millimetre of driver margin push
     it off the tape. */
  .label {
    width: ${labelLengthMm}mm; height: ${tapeWidthMm}mm;
    display: flex; align-items: center; justify-content: flex-start;
    gap: ${pad}mm; padding: 0 ${pad}mm;
    overflow: hidden; page-break-after: always; break-after: page;
  }
  .label:last-child { page-break-after: auto; break-after: auto; }
  .label-qr { width: ${plan.sideMm.toFixed(2)}mm; height: ${plan.sideMm.toFixed(2)}mm; flex: none; }
  .label-qr svg { width: 100%; height: 100%; display: block; }
  .label-text { min-width: 0; line-height: 1.15; }
  /* The line count is the tag's, not the name's: a 7" strip is shallow enough
     that one long line reads better, a 4" plate is deep enough for two. */
  .label-name { font-size: ${plan.nameSizeMm.toFixed(2)}mm; font-weight: 700;
                display: -webkit-box; -webkit-line-clamp: ${plan.nameLines}; -webkit-box-orient: vertical;
                overflow: hidden; overflow-wrap: anywhere; }
  .label-name em { font-style: italic; }
  .label-common { font-size: ${plan.commonSizeMm.toFixed(2)}mm; margin-top: 0.4mm;
                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .screen-only { font-family: Arial, Helvetica, sans-serif; padding: 16px; max-width: 640px;
                 line-height: 1.5; font-size: 13px; color: #222; }
  .screen-only h2 { font-size: 15px; color: #2d6a4f; margin-bottom: 6px; }
  .screen-only ol { margin: 8px 0 12px 20px; }
  .screen-only li { margin-bottom: 4px; }
  .screen-only .warn { color: #a33; }
  .print-btn { padding: 8px 20px; background: #2d6a4f; color: #fff; border: none;
               border-radius: 6px; cursor: pointer; font-size: 13px; }
  .rule { border-top: 1px dashed #ccc; margin: 14px 0; }
  @page { size: ${labelLengthMm}mm ${tapeWidthMm}mm; margin: 0; }
  @media print { .screen-only { display: none; } }
`;

    const quality = plan.good
        ? `${plan.dotsPerModule} printer dots per module (${plan.moduleMm.toFixed(2)} mm) — good.`
        : `<span class="warn">only ${plan.dotsPerModule} dots per module (${plan.moduleMm.toFixed(2)} mm)
           — it should scan, but 18 mm or wider tape gives a more forgiving code.</span>`;

    const overrun = plan.fitsTag ? '' :
        `<p class="warn">The longest name here needs more than the
         ${plan.stock.label} will take, so it is clipped. A ${TAG_STOCK.strip.label} holds more.</p>`;

    const body = tags.map(t => {
        const p = t.plant;
        const common = p.commonName ? `<div class="label-common">${escHtml(p.commonName)}</div>` : '';
        return `<div class="label">
        <div class="label-qr">${plantQrSvg(p.tagCode)}</div>
        <div class="label-text">
            <div class="label-name">${tagBotanicalHTML(p)}</div>
            ${common}
        </div>
    </div>`;
    }).join('');

    openPrintDocument(`Plant Tape Labels — ${tapeWidthMm} mm`, css, `
  <div class="screen-only">
    <h2>&#127991;&#65039; ${tags.length} label${tags.length !== 1 ? 's' : ''} for ${tapeWidthMm} mm tape</h2>
    <p>${labelLengthMm} mm long (${(labelLengthMm / 25.4).toFixed(1)}"), for the
       <strong>${plan.stock.label}</strong>, name on
       ${plan.nameLines === 1 ? 'one line' : 'two lines'}.</p>
    <p>The code is ${modules} modules across including its quiet zone, printed at
       ${plan.sideMm.toFixed(1)} mm on ${plan.printableMm.toFixed(1)} mm of usable tape:
       ${quality}</p>
    ${overrun}
    <div class="rule"></div>
    <ol>
      <li>Load <strong>${tapeWidthMm} mm</strong> tape and connect the printer over <strong>USB</strong>.</li>
      <li>Press Print, then choose the <strong>Brother PT-P710BT</strong> as the destination.</li>
      <li>Set the paper size to the <strong>${tapeWidthMm} mm</strong> tape, margins <strong>None</strong>,
          and scale <strong>100%</strong> — <em>not</em> "Fit to page", which resizes the code and
          breaks the whole-dot module sizing this layout depends on.</li>
      <li>Turn <strong>off</strong> headers and footers.</li>
      <li>Check the preview says <strong>1 sheet of paper</strong> per label. More than that means
          the driver's length is shorter than this label, and it will split it across strips.</li>
    </ol>
    <p><strong>Set the driver's <em>Length</em> to ${(labelLengthMm / 25.4).toFixed(1)}" — the same
       for every ${plan.stock.label} run.</strong> The 0.70" paper has a Length box of its own in
       Printing preferences, it is fixed rather than automatic, and it defaults to 3.00". A label
       longer than the Length is <em>clipped</em>, mid-word and without warning; earlier drivers
       scaled it down instead, which is worse, because it shrinks the QR along with the type and a
       QR whose modules are no longer whole printer dots is the one that stops scanning in the rain.</p>
    <p>The length above is the tag's, not this name's, so it does not change between runs on the
       same stock — set it when you switch stock and leave it. <strong>Do not rely on
       <em>Trim tape after data</em></strong>: the strip that comes out is always exactly the
       driver's Length, whatever the label or that setting says. Confirmed 2026-09-03 on a
       PT-P710BT over USB — a 172 mm label and a 96 mm one printed strips of identical length with
       Trim on, and every strip before that came out at exactly the 3.00" the driver was set to.
       Chrome sends a full-page raster, so there is no bare tape for the driver to trim.</p>
    <p>Codes point at ${escHtml(tagBaseUrl())}</p>
    <button class="print-btn" onclick="window.print()">&#128438; Print</button>
    <div class="rule"></div>
  </div>
  ${body}`);
}
