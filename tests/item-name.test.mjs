import test from 'node:test';
import assert from 'node:assert/strict';
import {shortenHoottownName, shortenPostmallName} from '../dist/item-name.mjs';

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

test('Postmall preserves names through 100 units instead of applying the Hoottown 80-unit limit', () => {
  const exact = 'A'.repeat(100), betweenLimits = longClipboardNames[0];
  assert.ok(betweenLimits.length > 80 && betweenLimits.length <= 100);
  for (const name of [exact, betweenLimits, '😀'.repeat(50), 'Member-Specific  Acrylic Stands (8 types in total)']) {
    assert.equal(shortenPostmallName(name), name);
  }
  assert.equal(shortenPostmallName('  CUTIE\u00a0STREET  Photo Set  '), 'CUTIE\u00a0STREET  Photo Set');
  assert.ok(shortenHoottownName(betweenLimits).length <= 80);
  assert.notEqual(shortenHoottownName(betweenLimits), betweenLimits);
  for (const value of ['', null, undefined]) assert.equal(shortenPostmallName(value), '');
});

test('long Postmall catalog and member-photo names retain their physical kind, edition, year and pack size', () => {
  const publicNames = [
    'SWEET STEADY Member-Specific Acrylic Stands - STEADY→ REVOLUTION Costume Edition - (7 types in total)',
    '[Online Exclusive] FRUITS ZIPPER Member-Specific Acrylic Stand - Sensation Styling Costume Edition - (7 types in total)',
    'CUTIE STREET Member-Specific Acrylic Stands -KAWAII LAB. BEST ALBUM White Coat Outfit Edition- (8 types in total)',
  ];
  const results = publicNames.map(shortenPostmallName);
  publicNames.forEach(name => assert.ok(name.length > 100));
  for (const name of results) { assert.ok(name.length <= 100); assert.match(name, /Acrylic Stand/); }
  assert.match(results[0], /^SWEET STEADY .*STEADY→ REVOLUTION Costume Ed\./);
  assert.match(results[1], /FRUITS ZIPPER .*Sensation Styling Costume Ed\./);
  assert.match(results[2], /CUTIE STREET .*White Coat Outfit Ed\./);
  const photo = (member, count) => `CUTIE STREET ${member} Photo Set (${count} L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)`;
  const aika = shortenPostmallName(photo('Aika Sano', 2)), ayano = shortenPostmallName(photo('Ayano Masuda', 2)), four = shortenPostmallName(photo('Ayano Masuda', 4));
  assert.notEqual(aika, ayano); assert.notEqual(ayano, four);
  assert.match(aika, /Aika Sano .*Photo Set \(2 L-size photos\).*2026/);
  assert.match(ayano, /Ayano Masuda .*Photo Set \(2 L-size photos\).*2026/);
  assert.match(four, /Photo Set \(4 L-size photos\).*2026/);
  for (const name of [aika, ayano, four]) assert.ok(name.length <= 100);
});

test('Postmall keeps all mixed birthday-set components using narrow equivalent abbreviations', () => {
  const original = 'Taniya Kyoka Birthday Package (1 signed instant photo, 2 types of acrylic stands, 5 random trading cards)';
  assert.ok(original.length > 100);
  const result = shortenPostmallName(original);
  assert.ok(result.length <= 100); assert.match(result, /^Taniya Kyoka Birthday Set/);
  assert.match(result, /1 signed instant photo/); assert.match(result, /2 Acrylic Stands/); assert.match(result, /5 random trading cards/);
  assert.equal(shortenPostmallName(result), result);
  const shorter = 'Birthday Package (2 types of acrylic stands)';
  assert.equal(shortenPostmallName(shorter), shorter, 'Names within the limit do not receive these substitutions.');
});

test('Postmall fixed-budget fallbacks stay nonempty, surrogate-safe, distinct and idempotent', () => {
  const source = version => 'CUTIE STREET Ayano Masuda Acrylic Stand ' + 'Special Limited Collection '.repeat(10) + `2026 ${version} Outfit Version`;
  const tweed = shortenPostmallName(source('Tweed')), prima = shortenPostmallName(source('Prima'));
  assert.notEqual(tweed, prima); assert.match(tweed, /2026 Tweed Outfit Ver\.$/); assert.match(prima, /2026 Prima Outfit Ver\.$/);
  for (const name of [source('Tweed'), source('Prima'), 'A'.repeat(140) + ' ' + 'B'.repeat(140), '😀'.repeat(120), 'X'.repeat(300)]) {
    const once = shortenPostmallName(name);
    assert.ok(once.length > 0 && once.length <= 100);
    assert.equal(shortenPostmallName(once), once);
    for (const point of once) assert.ok(point.length === 2 || !/[\uD800-\uDFFF]/.test(point));
  }
  assert.ok(shortenPostmallName('X'.repeat(150), 200).length <= 100, 'A caller cannot raise the fixed provider limit.');
});
