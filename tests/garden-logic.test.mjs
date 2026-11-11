// Garden's pure helpers: apps/garden/js/garden-logic.js
// Run every test file with:   node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isTagCode, nextOccurrenceDate, firstOccurrenceFromToday,
    formatBotanicalName, hybridTypeOf, plainPlantName, escHtml, linkify,
    fmtDate, fmtDateLong, isOverdue,
} from '../apps/garden/js/garden-logic.js';

// A local date at noon, so the tests read the same in any time zone.
const on = (ymd) => { const [y, m, d] = ymd.split('-').map(Number); return new Date(y, m - 1, d, 12); };

test('tag codes: six characters from the tag alphabet, either case', () => {
    assert.equal(isTagCode('7K3QW9'), true);
    assert.equal(isTagCode('7k3qw9'), true);
    assert.equal(isTagCode('7K3QWI'), false, 'I is left out of the alphabet');
    assert.equal(isTagCode('7K3QW'),  false);
    assert.equal(isTagCode('aBcDeFgHiJkLmNoPqRsT'), false, 'a Firestore id is not a tag code');
    assert.equal(isTagCode(null), false);
});

test('repeat daily: the next day, across a month end', () => {
    assert.equal(nextOccurrenceDate({ type: 'daily' }, '2026-02-28'), '2026-03-01');
    assert.equal(nextOccurrenceDate({ type: 'daily' }, '2026-12-31'), '2027-01-01');
});

test('repeat weekly: the next matching weekday, never the same day', () => {
    // 2026-11-10 is a Tuesday; dayOfWeek 1 is Monday
    assert.equal(nextOccurrenceDate({ type: 'weekly', dayOfWeek: 1 }, '2026-11-10'), '2026-11-16');
    assert.equal(nextOccurrenceDate({ type: 'weekly', dayOfWeek: 2 }, '2026-11-10'), '2026-11-17');
    assert.equal(nextOccurrenceDate({ type: 'weekly', dayOfWeek: 3 }, '2026-11-10'), '2026-11-11');
});

test('repeat monthly: same day next month, short months clamp', () => {
    assert.equal(nextOccurrenceDate({ type: 'monthly', dayOfMonth: 15 }, '2026-01-15'), '2026-02-15');
    assert.equal(nextOccurrenceDate({ type: 'monthly', dayOfMonth: 5 },  '2026-12-05'), '2027-01-05');
    assert.equal(nextOccurrenceDate({ type: 'monthly', dayOfMonth: 31 }, '2026-02-28'), '2026-03-31');
    assert.equal(nextOccurrenceDate({ type: 'monthly', dayOfMonth: 29 }, '2028-01-29'), '2028-02-29', 'leap year');
});

test('repeat monthly from the 31st does not skip February (fixed 2026-11-10)', () => {
    assert.equal(nextOccurrenceDate({ type: 'monthly', dayOfMonth: 31 }, '2026-01-31'), '2026-02-28');
    assert.equal(nextOccurrenceDate({ type: 'monthly', dayOfMonth: 31 }, '2026-03-31'), '2026-04-30');
});

test('first occurrence of a new repeating task', () => {
    const tue = on('2026-11-10');
    assert.equal(firstOccurrenceFromToday({ type: 'daily' }, tue), '2026-11-10');
    assert.equal(firstOccurrenceFromToday({ type: 'weekly', dayOfWeek: 2 }, tue), '2026-11-10', 'today counts');
    assert.equal(firstOccurrenceFromToday({ type: 'weekly', dayOfWeek: 1 }, tue), '2026-11-16');
    assert.equal(firstOccurrenceFromToday({ type: 'monthly', dayOfMonth: 20 }, tue), '2026-11-20');
    assert.equal(firstOccurrenceFromToday({ type: 'monthly', dayOfMonth: 10 }, tue), '2026-11-10');
    assert.equal(firstOccurrenceFromToday({ type: 'monthly', dayOfMonth: 1 },  tue), '2026-12-01');
});

test('dates read "4 May 26"; anything not YYYY-MM-DD is shown as entered', () => {
    assert.equal(fmtDate('2026-05-04'), '4 May 26');
    assert.equal(fmtDate('2019'), '2019');
    assert.equal(fmtDate(''), '');
    assert.equal(fmtDate(null), '');
    assert.equal(fmtDateLong('2026-09-14'), '14 September 2026');
});

test('overdue: a past due date on a task not completed', () => {
    assert.equal(isOverdue('2000-01-01', 'todo'), true);
    assert.equal(isOverdue('2000-01-01', 'completed'), false);
    assert.equal(isOverdue('2999-01-01', 'todo'), false);
    assert.equal(isOverdue(null, 'todo'), false);
});

test('escHtml escapes markup and accepts a number', () => {
    assert.equal(escHtml('<a href="x">Tom & Jerry</a>'),
        '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&lt;/a&gt;');
    assert.equal(escHtml(5), '5');
    assert.equal(escHtml(null), '');
});

test('linkify: http(s) only, punctuation stays outside, text escaped', () => {
    const out = linkify('See https://example.com/a. Then <b>');
    assert.match(out, /^See <a class="text-link" href="https:\/\/example.com\/a" /);
    assert.match(out, /<\/a>\. Then &lt;b&gt;$/);
    assert.match(linkify('https://en.wikipedia.org/wiki/Acer_(plant)'), /href="https:\/\/en.wikipedia.org\/wiki\/Acer_\(plant\)"/);
    assert.equal(linkify('javascript:alert(1)'), 'javascript:alert(1)');
    assert.equal(linkify('a "quote"'), 'a &quot;quote&quot;');
});

test('botanical names, including both kinds of hybrid', () => {
    assert.equal(formatBotanicalName({ genus: 'Acer', species: 'palmatum', cultivar: 'Bloodgood' }),
        "<em>Acer</em> <em>palmatum</em> 'Bloodgood'");
    assert.equal(formatBotanicalName({ genus: 'Syringa', species: 'prestoniae', hybridType: 'interspecific' }),
        '<em>Syringa</em> × <em>prestoniae</em>');
    assert.equal(formatBotanicalName({ genus: 'Chitalpa', hybridType: 'intergeneric' }), '×<em>Chitalpa</em>');
    assert.equal(hybridTypeOf({ hybrid: true }), 'interspecific', 'older records stored only a boolean');
    assert.equal(hybridTypeOf({}), null);
});

test('plain-text names undo the escaping and fall back sensibly', () => {
    assert.equal(plainPlantName({ genus: 'Rosa', cultivar: 'Tom & Jerry' }), "Rosa 'Tom & Jerry'");
    assert.equal(plainPlantName({ commonName: 'Mystery fern' }), 'Mystery fern');
    assert.equal(plainPlantName({}), 'Unnamed plant');
    assert.equal(plainPlantName(null), 'Unknown plant');
});
