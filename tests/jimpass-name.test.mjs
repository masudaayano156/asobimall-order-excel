import test from 'node:test';
import assert from 'node:assert/strict';
import {formatJimpassName, jimpassNameLength, isValidJimpassName} from '../dist/jimpass-name.mjs';
import {parseOrders} from '../dist/parser.mjs';

const publicNames = [
  'CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)',
  'CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -',
  'CUTIE STREET Member-Specific Acrylic Stands -Cute Cute Taiko Outfit Version-',
  'Ayano Masuda Birthday Celebration 2026 Acrylic Keychain (Birthday Outfit Ver.)',
  'Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Birthday Outfit Ver.)',
  'Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Revealed Outfit Version)',
  'Ayano Masuda Birthday Celebration 2026: Ayano Only ChooseMe Set',
  'CUTIE STREET Member-Specific Acrylic Stands -Rose Ribbon Outfit Ver.- (8 types in total)',
  'CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)',
  'CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)',
  'CUTIE STREET Member-Specific Acrylic Stands -KL Summer Festival 2026 Outfit Edition- (8 types in total)',
  'CUTIE STREET Member-Specific Acrylic Stands -Street Outfit Ver.-',
];

test('real twelve-product Markdown names become Jimpass-safe without mutating their original titles', () => {
  const source = '## Order No. SAMPLE-JIMPASS-NAMES\n## Ordered items\n## merchandise\n' + publicNames.map(name => `* **${name}**\nProduct amount: **¥1,000**\nquantity: **1**`).join('\n');
  const parsed = parseOrders(source);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.orders[0].items.length, 12);
  const original = parsed.orders[0].items.map(item => item.name);
  const formatted = original.map(formatJimpassName);
  assert.equal(formatted[0], 'CUTIE STREET OFFICIAL FAN LIGHT AAA batteries included');
  assert.equal(formatted[1], 'CUTIE STREET Member Specific Acrylic Stands Tweed Outfit Version');
  for (const name of formatted) {
    assert.match(name, /^[A-Za-z0-9 ]+$/);
    assert.ok(jimpassNameLength(name) >= 10 && jimpassNameLength(name) <= 100);
    assert.equal(isValidJimpassName(name), true);
  }
  assert.deepEqual(parsed.orders[0].items.map(item => item.name), original);
  assert.deepEqual(original, publicNames);
});

test('separators become spaces while ampersands, apostrophes and Latin accents preserve words', () => {
  assert.equal(formatJimpassName("ARTIST'S R&B - Déjà-Vu [2026] / Photo Set #2"), 'ARTISTS R and B Deja Vu 2026 Photo Set 2');
  assert.equal(formatJimpassName('O’Connor Birthday: Café (2026)'), 'OConnor Birthday Cafe 2026');
  assert.equal(formatJimpassName('ＣＵＴＩＥ　ＳＴＲＥＥＴ（２０２６）'), 'CUTIE STREET 2026');
});

test('the length metric counts only ASCII letters and digits, not spaces or punctuation', () => {
  assert.equal(jimpassNameLength('AB cd 12-34 (56)'), 10);
  assert.equal(jimpassNameLength('日本語 한글'), 0);
  assert.equal(jimpassNameLength(''), 0);
  assert.equal(jimpassNameLength(null), 0);
  assert.equal(isValidJimpassName('ABC 123456'), false);
  assert.equal(isValidJimpassName('ABCD 123456'), true);
  assert.equal(formatJimpassName('A'.repeat(100)), 'A'.repeat(100));
});

test('whole character length above one hundred does not abbreviate a permitted alphanumeric count', () => {
  const source = publicNames[10];
  assert.ok(source.length > 100);
  const result = formatJimpassName(source);
  assert.equal(jimpassNameLength(result), jimpassNameLength(source));
  for (const phrase of ['Member Specific', 'Acrylic Stands', 'KL Summer Festival 2026', 'Outfit Edition', '8 types in total']) assert.ok(result.includes(phrase));
  assert.equal(isValidJimpassName(result), true);
});

test('photo pack counts, members and different outfit versions remain distinguishable', () => {
  const aika = formatJimpassName('CUTIE STREET Aika Sano Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition-');
  const ayano = formatJimpassName('CUTIE STREET Ayano Masuda Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition-');
  const four = formatJimpassName('CUTIE STREET Ayano Masuda Photo Set (4 L-size photos) -KL Summer Festival 2026 Costume Edition-');
  assert.match(aika, /Aika Sano/); assert.match(ayano, /Ayano Masuda/);
  assert.match(aika, /2 L size photos/); assert.match(four, /4 L size photos/);
  assert.match(ayano, /KL Summer Festival 2026 Costume Edition/);
  assert.notEqual(aika, ayano); assert.notEqual(ayano, four);
  assert.notEqual(formatJimpassName(publicNames[1]), formatJimpassName(publicNames[1].replace('Tweed', 'Prima')));
});

test('unsupported Korean and Japanese stay visible and invalid instead of being silently discarded', () => {
  for (const source of ['キュートなキューたい衣装', '한글 상품명', 'CUTIE STREET 日本語 PHOTO SET', 'A'.repeat(140) + ' 日本語 Acrylic Stand']) {
    const result = formatJimpassName(source);
    assert.match(result, /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Hangul}]/u);
    assert.equal(isValidJimpassName(source), false);
    assert.equal(isValidJimpassName(result), false);
  }
  assert.equal(isValidJimpassName('CUTIE STREET\u0000PHOTO SET'), false);
});

test('overlength English names retain their product type, year and version within the alphanumeric cap', () => {
  const source = 'CUTIE STREET Ayano Masuda ' + 'Special Limited Anniversary Collection '.repeat(10) + 'Acrylic Stand -Tweed Outfit Version 2026-';
  const result = formatJimpassName(source);
  assert.ok(jimpassNameLength(result) <= 100);
  assert.match(result, /CUTIE STREET Ayano Masuda/);
  assert.match(result, /Acrylic Stand/);
  assert.match(result, /Tweed Outfit Ver 2026/);
  assert.match(result, /^[A-Za-z0-9 ]+$/);
  assert.equal(isValidJimpassName(result), true);
  const ampersands = formatJimpassName('R&B '.repeat(60) + 'Acrylic Stand 2026');
  assert.ok(jimpassNameLength(ampersands) <= 100);
  assert.match(ampersands, /Acrylic Stand 2026/);
});

test('formatting is idempotent and empty or too-short names remain invalid', () => {
  for (const source of [...publicNames, "Café & O’Connor's Photo Set", 'A'.repeat(250), '日本語 PHOTO SET']) {
    const once = formatJimpassName(source);
    assert.equal(formatJimpassName(once), once);
  }
  for (const value of ['', '  ', null, undefined]) {
    assert.equal(formatJimpassName(value), '');
    assert.equal(isValidJimpassName(value), false);
  }
});
