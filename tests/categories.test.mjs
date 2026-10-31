import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classifyProduct, CATEGORY_RULES} from '../dist/categories.mjs';

test('uniform maps to independent verified forwarder codes', () => {
  const item = classifyProduct('CUTIE STREET OSHI API UNIFORM');
  assert.equal(item.kind, 'clothing');
  assert.equal(item.jimpassCode, '4');
  assert.equal(item.generalCode, '053');
  assert.equal(item.requiresReview, false);
  assert.match(item.codeSources.jimpass, /category=3$/);
  assert.deepEqual(item.codeSources.general, {file: 'General_Excel_Upload.xlsx', sheet: '카테고리 품목 코드', range: 'A55:C55'});
});

test('narrow physical object wins over uniform design keywords', () => {
  for (const name of ['UNIFORM KEYCHAIN', 'ユニフォームアクリルキーホルダー', 'T-SHIRT KEY RING']) {
    const item = classifyProduct(name);
    assert.equal(item.kind, 'keychain', name);
    assert.equal(item.jimpassCode, '240');
    assert.equal(item.generalCode, '076');
    assert.equal(item.requiresReview, true);
  }
  assert.equal(classifyProduct('UNIFORM ACRYLIC STAND').kind, 'acrylic_stand');
  assert.equal(classifyProduct('T SHIRT BADGE').kind, 'badge');
});

test('penlight decoration and case do not become electrical fanlight', () => {
  assert.equal(classifyProduct('CUTIE STREET OFFICIAL FAN LIGHT CUSTOM CHARM').kind, 'charm');
  assert.equal(classifyProduct('OFFICIAL PENLIGHT CASE').kind, 'pouch');
  const light = classifyProduct('OFFICIAL PEN LIGHT');
  assert.equal(light.kind, 'fanlight');
  assert.equal(light.jimpassCode, '217');
  assert.equal(light.generalCode, '012');
  assert.equal(light.requiresReview, true);
  const parts = classifyProduct('CUTIE STREET OFFICIAL FAN LIGHT CUSTOM PARTS');
  assert.equal(parts.kind, 'fanlight_parts');
  assert.equal(parts.jimpassCode, '');
  assert.equal(parts.generalCode, '');
  assert.equal(parts.requiresReview, true);
});

test('cards and card holders are distinct, Japanese and English supported', () => {
  assert.equal(classifyProduct('TRADING CARD HOLDER').kind, 'card_holder');
  assert.equal(classifyProduct('トレカケース').kind, 'card_holder');
  assert.equal(classifyProduct('トレーディングカード 全8種').kind, 'photo_card');
  const cards = classifyProduct('PHOTO CARD SET');
  assert.equal(cards.jimpassCode, '107');
  assert.equal(cards.generalCode, '105');
  assert.equal(cards.requiresReview, true);
});

test('obvious cloth, doll and decorative goods have mapped codes', () => {
  const checks = [
    ['マフラータオル', 'towel', '22', '069'],
    ['ACRYLIC STAND', 'acrylic_stand', '135', '151'],
    ['生誕祭ぬいぐるみ', 'plush', '174', '124'],
    ['Tシャツ', 'clothing', '4', '053'],
    ['パーカー', 'clothing', '4', '053'],
    ['缶バッジ', 'badge', '258', '076'],
    ['クリアファイル', 'clear_file', '205', '105'],
  ];
  for (const [name, kind, jimpass, general] of checks) {
    const result = classifyProduct(name);
    assert.equal(result.kind, kind, name);
    assert.equal(result.jimpassCode, jimpass, name);
    assert.equal(result.generalCode, general, name);
  }
});

test('material uncertainty remains visible instead of authoritative classification', () => {
  assert.equal(classifyProduct('TOTE BAG').requiresReview, true);
  assert.equal(classifyProduct('CAP').requiresReview, true);
  assert.equal(classifyProduct('METAL CHARM').requiresReview, true);
  assert.equal(classifyProduct('STICKER').requiresReview, true);
  const unknown = classifyProduct('SPECIAL ANNIVERSARY GOODS SET');
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.jimpassCode, '');
  assert.equal(unknown.generalCode, '');
  assert.equal(unknown.requiresReview, true);
});

test('custom rules are accepted without assuming global source codes', () => {
  const result = classifyProduct('CUSTOM ITEM', [{kind: 'custom', label: '맞춤 품목', patterns: ['CUSTOM ITEM'], jimpass: {code: '999', label: '사용자확인'}, requiresReview: false}]);
  assert.equal(result.kind, 'custom');
  assert.equal(result.jimpassCode, '999');
  assert.equal(result.generalCode, '');
  assert.equal(result.requiresReview, true);
});

test('main disc product takes precedence over its bonus postcard', () => {
  assert.equal(classifyProduct('【特典ポストカード付】 FRUITS ZIPPER シングルCD 通常盤').kind, 'music_disc');
  assert.equal(classifyProduct('FRUITS ZIPPER LIVE FILM Blu-ray').kind, 'video_disc');
  assert.equal(classifyProduct('ポストカード5枚セット').generalCode, '140');
  assert.equal(classifyProduct('FRUITS ZIPPER フォトブック').generalCode, '139');
});

test('digital photo books and event rights do not receive invented freight codes', () => {
  const digital = classifyProduct('デジタル写真集 - A -');
  assert.equal(digital.kind, 'digital');
  assert.equal(digital.jimpassCode, '');
  assert.equal(digital.generalCode, '');
  assert.equal(digital.requiresReview, true);
});

test('JSON provenance mirror matches embedded browser rules and all General codes exist', async () => {
  const mirror = JSON.parse(await fs.readFile(new URL('../dist/category-rules.json', import.meta.url), 'utf8'));
  assert.deepEqual(mirror, CATEGORY_RULES);
  const general = JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8'));
  for (const rule of CATEGORY_RULES.rules) {
    if (!rule.general?.code) continue;
    const actual = general.categories.find(category => category.code === rule.general?.code);
    assert.ok(actual, `Unknown template code ${rule.general?.code}`);
    assert.equal(actual.item, rule.general.label);
    assert.equal(rule.general.source.range, `A${actual.row}:C${actual.row}`);
  }
});
