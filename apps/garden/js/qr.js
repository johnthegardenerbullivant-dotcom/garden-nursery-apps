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
export function openTapeLabels(tags, tapeWidthMm) {
    if (!tags || !tags.length) {
        showToast('Nothing to print', 'error');
        return;
    }

    // Every label in one job shares a page size, so the geometry is measured
    // once off the first code. They are all the same width: the URL is a fixed
    // host plus a fixed-length code, so every tag is the same QR version.
    const modules = qrModulesAcross(plantQrSvg(tags[0].plant.tagCode));
    const plan    = modules ? tapeQrPlan(tapeWidthMm, modules) : null;

    if (!plan) {
        showToast(`No geometry for ${tapeWidthMm} mm tape`, 'error');
        return;
    }
    if (!plan.ok) {
        showToast(`${tapeWidthMm} mm tape is too narrow for this code — use 18 mm or wider`, 'error');
        return;
    }

    // The label is as long as its longest name needs, because every label in
    // one print job shares a page size and the tape is a continuous roll —
    // length is the cheap dimension here, and a truncated botanical name on a
    // plant label defeats the point of printing the name at all.
    //
    // Names still wrap to a second line if they must (see .label-name below);
    // this only tries to make that the exception. The width estimate is rough
    // on purpose: Arial's average advance is around 0.5 em and guessing high
    // costs a few millimetres of tape, while guessing low costs a reprint.
    const pad      = 1.2;
    const nameEm   = 0.26;                       // .label-name, as a share of the height
    const longest  = Math.max(...tags.map(t => plainTagName(t.plant).length));
    const textMm   = longest * plan.printableMm * nameEm * 0.5;
    const labelLengthMm = Math.max(55, Math.min(110,
        Math.round(plan.sideMm + pad * 3 + textMm)));

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
  /* Two lines, then ellipsis. A name long enough to overrun two lines at this
     size is past what a tape label can usefully carry, and the code beside it
     still resolves to the full record. */
  .label-name { font-size: ${(plan.printableMm * nameEm).toFixed(2)}mm; font-weight: 700;
                display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
                overflow: hidden; overflow-wrap: anywhere; }
  .label-name em { font-style: italic; }
  .label-common { font-size: ${(plan.printableMm * 0.19).toFixed(2)}mm; margin-top: 0.4mm;
                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .label-code { font-family: ui-monospace, Consolas, monospace;
                font-size: ${(plan.printableMm * 0.16).toFixed(1)}mm; letter-spacing: 0.08em;
                margin-top: 0.5mm; }
  .screen-only { font-family: Arial, Helvetica, sans-serif; padding: 16px; max-width: 620px;
                 line-height: 1.5; font-size: 13px; color: #222; }
  .screen-only h2 { font-size: 15px; color: #2d6a4f; margin-bottom: 6px; }
  .screen-only ol { margin: 8px 0 12px 20px; }
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

    const body = tags.map(t => {
        const p = t.plant;
        const common = p.commonName ? `<div class="label-common">${escHtml(p.commonName)}</div>` : '';
        return `<div class="label">
        <div class="label-qr">${plantQrSvg(p.tagCode)}</div>
        <div class="label-text">
            <div class="label-name">${tagBotanicalHTML(p)}</div>
            ${common}
            <div class="label-code">${escHtml(p.tagCode)}</div>
        </div>
    </div>`;
    }).join('');

    openPrintDocument(`Plant Tape Labels — ${tapeWidthMm} mm`, css, `
  <div class="screen-only">
    <h2>&#127991;&#65039; ${tags.length} label${tags.length !== 1 ? 's' : ''} for ${tapeWidthMm} mm tape</h2>
    <p>The code is ${modules} modules across including its quiet zone, printed at
       ${plan.sideMm.toFixed(1)} mm on ${plan.printableMm.toFixed(1)} mm of usable tape:
       ${quality}</p>
    <div class="rule"></div>
    <ol>
      <li>Load <strong>${tapeWidthMm} mm</strong> tape and connect the printer over <strong>USB</strong>.</li>
      <li>Press Print, then choose the <strong>Brother PT-P710BT</strong> as the destination.</li>
      <li>Set the paper size to the <strong>${tapeWidthMm} mm</strong> tape, margins <strong>None</strong>,
          and scale <strong>100%</strong> — <em>not</em> "Fit to page", which resizes the code and
          breaks the whole-dot module sizing this layout depends on.</li>
      <li>Turn <strong>off</strong> headers and footers.</li>
    </ol>
    <p>Codes point at ${escHtml(tagBaseUrl())}</p>
    <button class="print-btn" onclick="window.print()">&#128438; Print</button>
    <div class="rule"></div>
  </div>
  ${body}`);
}
