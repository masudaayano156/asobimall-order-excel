import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {classifyProduct, classifyCatalogProduct, CATEGORY_RULES} from '../dist/categories.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const publicProduct = code => {
  const product = catalog.products.find(item => item.code === code);
  assert.ok(product, `Public product ${code} is required.`);
  return product;
};

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

test('the five public card/Instax stands classify as holders rather than the cards displayed in them', () => {
  for (const code of ['LARME-010', 'LARME-011', 'LARME-042', 'LARME-041', 'FZ-00200']) {
    const product = publicProduct(code), original = JSON.stringify(product);
    for (const name of [product.name, product.enName]) {
      const item = classifyProduct(name);
      assert.equal(item.kind, 'card_holder', code + ': ' + name);
      assert.equal(item.jimpassCode, '205'); assert.equal(item.generalCode, '105'); assert.equal(item.requiresReview, true);
    }
    assert.equal(classifyCatalogProduct(product).kind, 'card_holder');
    assert.equal(JSON.stringify(product), original);
  }
  assert.equal(classifyProduct('MEMBER PORTRAIT ACRYLIC STAND').jimpassCode, '135');
  assert.equal(classifyProduct('アクリルスタンド').generalCode, '151');
  assert.equal(classifyProduct('TRADING CARD').jimpassCode, '107');
  assert.equal(classifyProduct('チェキ').jimpassCode, '239');
});

test('clear and explicitly nonpaper stickers never acquire the paper-print category just from the word sticker', () => {
  for (const code of ['TA-0016', 'sn-00076', 'MIO-00009', 'MIO-00010', 'MIO-00011']) {
    const product = publicProduct(code);
    for (const name of [product.name, product.enName]) {
      const item = classifyProduct(name);
      assert.equal(item.kind, 'sticker_material_unknown', code + ': ' + name);
      assert.equal(item.jimpassCode, '205'); assert.equal(item.generalCode, '105'); assert.equal(item.requiresReview, true);
      assert.match(item.reviewReason, /소재/);
    }
  }
  for (const name of ['TRANSPARENT PHOTO STICKER', 'PVC STICKER', 'STICKER ACRYLIC', 'ビニールシール']) assert.equal(classifyProduct(name).jimpassCode, '205', name);
  assert.equal(classifyProduct('PAPER STICKER').jimpassCode, '239');
  assert.equal(classifyProduct('CLEAR STICKER KEYCHAIN').jimpassCode, '240', 'The actual keychain still takes precedence.');
  assert.equal(classifyProduct('CLEAR PHOTO CARD').jimpassCode, '107', 'A card is not automatically reclassified as a sticker.');
});

test('the public plushie costume is doll clothing, while dolls, human clothing and decorative designs retain their own categories', () => {
  const product = publicProduct('FZ-00305');
  for (const name of [product.name, product.enName, 'DOLL CLOTHES', 'PLUSHIE COSTUME', 'ぬいぐるみ用衣装', 'ドール用お洋服']) {
    const item = classifyProduct(name);
    assert.equal(item.kind, 'doll_clothes', name);
    assert.equal(item.jimpassCode, '176'); assert.equal(item.generalCode, '127'); assert.equal(item.requiresReview, true);
    assert.match(item.codeSources.jimpass, /category=170$/);
    assert.equal(item.codeSources.general.range, 'A129:C129');
  }
  assert.equal(classifyCatalogProduct(product).kind, 'doll_clothes');
  for (const name of ['PLUSHIE', 'DOLL', '生誕祭ぬいぐるみ']) assert.equal(classifyProduct(name).jimpassCode, '174', name);
  for (const name of ['T-SHIRT', 'OSHI API UNIFORM']) assert.equal(classifyProduct(name).jimpassCode, '4', name);
  assert.equal(classifyProduct('DOLL OUTFIT KEYCHAIN').kind, 'keychain');
  assert.equal(classifyProduct('DOLL ACRYLIC STAND').kind, 'acrylic_stand');
});

test('photobook and ZINE outfit descriptions do not turn the four actual goods into books', () => {
  for (const [code,kind,jimpass,general] of [
    ['FZ-00542','acrylic_stand','135','151'], ['FZ-00543','acrylic_stand','135','151'],
    ['FZ-00342','acrylic_stand','135','151'], ['FZ-00226','sticker','239','105'],
  ]) {
    const product=publicProduct(code);
    for (const name of [product.name,product.enName]) {
      const result=classifyProduct(name);assert.equal(result.kind,kind,code+': '+name);
      assert.equal(result.jimpassCode,jimpass);assert.equal(result.generalCode,general);
    }
    assert.equal(classifyCatalogProduct(product).kind,kind);
  }
  for (const name of ['ARTIST PHOTOBOOK','ZINE Costume Edition','PHOTOBOOK Costume Edition WITH BONUS ACRYLIC STAND','【アクリルスタンド特典付】フォトブック costume edition','PHOTOBOOK WITH BONUS STICKERS']) {
    assert.equal(classifyProduct(name).kind,'book',name);
  }
  assert.equal(classifyProduct('【特典ポストカード付】 FRUITS ZIPPER シングルCD 通常盤').kind,'music_disc');
});

test('the four physical-photo prize titles remain mixed proposals rather than a guaranteed acrylic prize', () => {
  for (const code of ['CT-00033','FZ-00078','CT-00032','CT-00030']) {
    const product=publicProduct(code);
    for (const name of [product.name,product.enName]) {
      const item=classifyProduct(name);assert.equal(item.kind,'mixed_photo_prize',code+': '+name);
      assert.equal(item.jimpassCode,'176');assert.equal(item.generalCode,'127');assert.equal(item.requiresReview,true);
      assert.match(item.reviewReason,/당첨·수령/);
    }
    assert.equal(classifyCatalogProduct(product).kind,'mixed_photo_prize');
  }
  assert.equal(classifyProduct('ランダム生写真 新衣装ver.').kind,'photo');
  assert.equal(classifyProduct('RANDOM PHOTO SET').kind,'photo');
  assert.equal(classifyProduct('ACRYLIC PANEL NEW OUTFIT VERSION').kind,'acrylic_stand');
  assert.equal(classifyProduct('アクリルスタンド').kind,'acrylic_stand');
  assert.equal(classifyProduct('PHOTOBOOK WITH BONUS RANDOM PHOTO AND A CHANCE TO WIN AN ACRYLIC PANEL').kind,'book');
  assert.notEqual(classifyProduct('ACRYLIC PANEL WITH A PHOTO PRINT').kind,'mixed_photo_prize');
});

test('the actual PVC-rubber towel holder is not classified as its towel contents', () => {
  const product=publicProduct('CS-0099');
  for (const name of [product.name,product.enName,'FACE TOWEL HOLDER','タオル用ホルダー']) {
    const item=classifyProduct(name);assert.equal(item.kind,'towel_holder',name);
    assert.equal(item.jimpassCode,'205');assert.equal(item.generalCode,'105');assert.equal(item.requiresReview,true);
  }
  assert.equal(classifyCatalogProduct(product).kind,'towel_holder');
  for (const name of ['FACE TOWEL','タオル','マフラータオル']) {
    const item=classifyProduct(name);assert.equal(item.kind,'towel',name);assert.equal(item.jimpassCode,'22');assert.equal(item.generalCode,'069');
  }
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
  assert.ok(isDeepStrictEqual(mirror, CATEGORY_RULES), 'The JSON provenance mirror must exactly match the browser rules.');
  const general = JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8'));
  for (const rule of CATEGORY_RULES.rules) {
    if (!rule.general?.code) continue;
    const actual = general.categories.find(category => category.code === rule.general?.code);
    assert.ok(actual, `Unknown template code ${rule.general?.code}`);
    assert.equal(actual.item, rule.general.label);
    assert.equal(rule.general.source.range, `A${actual.row}:C${actual.row}`);
  }
});
