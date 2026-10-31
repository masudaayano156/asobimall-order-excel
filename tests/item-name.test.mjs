import test from 'node:test';
import assert from 'node:assert/strict';
import {shortenHoottownName} from '../dist/item-name.mjs';

test('names already within 80 UTF-16 units keep their content and spacing', () => {
  const exact = 'A'.repeat(80);
  assert.equal(shortenHoottownName(exact), exact);
  assert.equal(shortenHoottownName('  CUTIE\u00a0STREET  Photo Set (2 L-size photos)  '), 'CUTIE\u00a0STREET  Photo Set (2 L-size photos)');
  assert.equal(shortenHoottownName('Member-Specific Acrylic Stands (8 types in total)'), 'Member-Specific Acrylic Stands (8 types in total)');
  assert.equal(shortenHoottownName(''), '');
  assert.equal(shortenHoottownName(null), '');
  assert.equal(shortenHoottownName(undefined), '');
});

// Public product names from rows 8–11 of the real 12-product clipboard case.
// Two photo purchases share this title; their separate member options stay outside it.
const longClipboardNames = [
  'CUTIE STREET Member-Specific Acrylic Stands -Rose Ribbon Outfit Ver.- (8 types in total)',
  'CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)',
  'CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)',
  'CUTIE STREET Member-Specific Acrylic Stands -KL Summer Festival 2026 Outfit Edition- (8 types in total)',
];

test('the four long clipboard names retain goods, outfit, year and photo-pack information', () => {
  const results = longClipboardNames.map(name => shortenHoottownName(name));
  for (const name of results) {
    assert.ok(name.length <= 80);
    assert.match(name, /^CUTIE STREET /);
    assert.doesNotMatch(name, /Member-Specific|types in total/i);
  }
  assert.match(results[0], /Acrylic Stand\b.*Rose Ribbon Outfit Ver\./);
  for (const name of results.slice(1, 3)) {
    assert.match(name, /Photo Set/);
    assert.match(name, /2 L-size photos/);
    assert.match(name, /KL Summer Festival 2026/);
    assert.match(name, /Costume Ed\./);
  }
  assert.equal(results[1], results[2], 'Identical source names are shortened equally without inventing a member name.');
  assert.match(results[3], /Acrylic Stand\b.*KL Summer Festival 2026 Outfit Ed\./);
});

test('different outfit versions and years stay distinguishable', () => {
  const source = version => `CUTIE STREET Member-Specific Acrylic Stands - ${version} Outfit Version 2026 - (8 types in total)`;
  const tweed = shortenHoottownName(source('Tweed'));
  const prima = shortenHoottownName(source('Prima'));
  assert.notEqual(tweed, prima);
  assert.match(tweed, /Tweed Outfit Ver\. 2026/);
  assert.match(prima, /Prima Outfit Ver\. 2026/);
  assert.notEqual(tweed, shortenHoottownName(source('Tweed').replace('2026', '2025')));
});

test('explicit photo member names and pack counts are retained instead of merged', () => {
  const source = (member, count) => `CUTIE STREET ${member} Photo Set (${count} L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)`;
  const aika = shortenHoottownName(source('Aika Sano', 2));
  const ayano = shortenHoottownName(source('Ayano Masuda', 2));
  const four = shortenHoottownName(source('Ayano Masuda', 4));
  for (const name of [aika, ayano, four]) assert.ok(name.length <= 80);
  assert.match(aika, /Aika Sano/); assert.match(ayano, /Ayano Masuda/);
  assert.match(aika, /2 L-size/); assert.match(four, /4 L-size/);
  assert.match(ayano, /2026/);
  assert.notEqual(aika, ayano); assert.notEqual(ayano, four);
});

test('word-boundary fallback preserves a goods type at the end of a very long name', () => {
  const name = 'CUTIE STREET Ayano Masuda ' + 'Special Limited Anniversary Collection '.repeat(8) + 'Acrylic Stand';
  const result = shortenHoottownName(name);
  assert.ok(result.length <= 80);
  assert.match(result, /^CUTIE STREET Ayano Masuda /);
  assert.match(result, /Acrylic Stand$/);
  assert.doesNotMatch(result, /Collecti$/);
});

test('fallback preserves a photo pack anchor and trailing outfit information', () => {
  const name = 'CUTIE STREET Ayano Masuda Photo Set (2 L-size photos) ' + 'Special Limited Collection '.repeat(6) + '2026 Tweed Outfit Version';
  const result = shortenHoottownName(name);
  assert.ok(result.length <= 80);
  assert.match(result, /^CUTIE STREET Ayano Masuda /);
  assert.match(result, /Photo Set \(2 L-size\)/);
  assert.match(result, /2026 Tweed Outfit Ver\.$/);
});

test('Unicode whitespace and very long single tokens remain bounded and well formed', () => {
  const formatted = 'CUTIE\u2003STREET\u00a0Member‑Specific Acrylic Stands -Rose Ribbon Outfit Version- (8 types in total)';
  const result = shortenHoottownName(formatted);
  assert.ok(result.length <= 80); assert.match(result, /CUTIE STREET/); assert.match(result, /Rose Ribbon/);
  for (const source of ['X'.repeat(400), '😀'.repeat(120), 'A'.repeat(90) + ' ' + 'B'.repeat(90)]) {
    const shortened = shortenHoottownName(source);
    assert.ok(shortened.length > 0 && shortened.length <= 80);
    for (const point of shortened) assert.ok(point.length === 2 || !/[\uD800-\uDFFF]/.test(point), 'Do not split a surrogate pair.');
  }
  assert.equal(shortenHoottownName('a long name', 0), '');
  assert.ok(shortenHoottownName(formatted, 32).length <= 32);
  for (const limit of [1, 8, 32, 80]) {
    const shortened = shortenHoottownName('A'.repeat(90) + ' ' + 'B'.repeat(90), limit);
    assert.ok(shortened.length > 0 && shortened.length <= limit);
  }
  assert.ok(shortenHoottownName('😀'.repeat(120), 1).length > 0);
  assert.doesNotMatch(shortenHoottownName('A'.repeat(90) + ' ' + 'B'.repeat(90)), /…/);
});

test('shortening is idempotent for clipboard names and difficult fallbacks', () => {
  for (const source of [...longClipboardNames, '😀'.repeat(120), 'CUTIE STREET ' + 'Long Collection '.repeat(20) + 'Keychain']) {
    const once = shortenHoottownName(source);
    assert.equal(shortenHoottownName(once), once);
  }
});
