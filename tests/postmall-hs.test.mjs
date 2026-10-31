import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {suggestPostmallHs} from '../dist/postmall-hs.mjs';
import {classifyCatalogProduct} from '../dist/categories.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const product = code => {
  const result = catalog.products.find(item => item.code === code);
  assert.ok(result, `Public product ${code} is required.`);
  return result;
};
const actual = code => { const p = product(code); return suggestPostmallHs({name: p.enName, classification: classifyCatalogProduct(p), product: p}); };
const proof = material => ({source: 'product-detail', evidence: {sourceUrl: 'https://asobisystem.shop/products/SAMPLE-HS', checkedAt: '2026-10-31', descriptionSha256: 'a'.repeat(64), material, facts: []}});

test('the actual twelve public products receive reviewed suggestions including the specifically verified printed-paper set', () => {
  const rows = [
    ['CS-0084', '851310'], ['CS-0293', '392640'], ['CS-0292', '392640'], ['CS-0332', '392690'],
    ['CS-0331', '392640'], ['CS-0284', '392640'], ['CS-0280', '491191'], ['CS-0345', '392640'],
    ['CS-0304', '491191'], ['CS-0304', '491191'], ['CS-0306', '392640'], ['CS-02770', '392640'],
  ];
  const proposals = rows.map(([code, expected]) => { const result = actual(code); assert.equal(result?.code ?? null, expected, code); return result; });
  assert.equal(proposals.filter(Boolean).length, 12);
  for (const result of proposals.filter(Boolean)) {
    assert.match(result.code, /^\d{6}$/); assert.equal(result.requiresReview, true);
    assert.ok(result.reason); assert.ok(result.ruleId);
    const url = new URL(result.sourceUrl);
    assert.equal(url.origin, 'https://www.postmall.net'); assert.equal(url.pathname, '/api/hscodes');
    assert.equal(url.searchParams.get('tag'), 'true'); assert.ok(url.searchParams.get('q'));
    assert.equal(result.checkedAt, '2026-10-31');
  }
});

test('only battery/electrical fanlight bodies get the portable-light suggestion', () => {
  assert.equal(actual('CS-0084').code, '851310');
  for (const name of [
    'OFFICIAL FAN LIGHT CUSTOM PARTS (AAA batteries included)', 'LED FAN LIGHT CHARM', 'FAN LIGHT STRAP USB',
    'FAN LIGHT CASE (AAA batteries included)', 'CHEMICAL GLOW STICK', 'LED SOFT GRIP BRACELET', 'バングルライト 電池', 'サイリウム 電池',
  ]) assert.equal(suggestPostmallHs({name, classification: {kind: 'fanlight'}}), null, name);
  assert.equal(suggestPostmallHs({name: 'OFFICIAL FAN LIGHT', classification: {kind: 'fanlight'}}), null);
  assert.equal(suggestPostmallHs({name: 'OFFICIAL FAN LIGHT', classification: {...proof('상세 미기재'), kind: 'fanlight', evidence: {...proof('').evidence, facts: ['배터리 정보 미기재']}}}), null);
});

test('explicit current product selection wins over a stale original title', () => {
  const light = product('CS-0084');
  assert.equal(suggestPostmallHs({name: 'OLD FAN LIGHT CHARM', classification: classifyCatalogProduct(light), product: light}).code, '851310');
  const charm = product('CS-0316');
  assert.equal(suggestPostmallHs({name: 'OLD FAN LIGHT (AAA batteries included)', classification: {kind: 'fanlight'}, product: charm}), null);
});

test('acrylic portrait stands are distinct from functional holders, parts and nonplastic stands', () => {
  assert.equal(actual('CS-0293').code, '392640');
  for (const name of ['ACRYLIC PHONE STAND', 'ACRYLIC MONITOR STAND', 'ACRYLIC STAND PARTS', 'ACRYLIC STAND CASE']) {
    assert.equal(suggestPostmallHs({name, classification: {kind: 'acrylic_stand'}}), null, name);
  }
  assert.equal(suggestPostmallHs({name: 'PORTRAIT STAND', classification: {kind: 'acrylic_stand'}}), null);
  assert.equal(suggestPostmallHs({name: 'ACRYLIC STAND', classification: {...proof('금속·철'), kind: 'acrylic_stand'}}), null);
});

test('acrylic accessory bodies do not turn every keychain or mixed-material strap into plastic goods', () => {
  assert.equal(actual('CS-0332').code, '392690');
  for (const [name, classification] of [
    ['METAL KEYCHAIN', {kind: 'keychain'}], ['LEATHER CHARM', {kind: 'charm'}], ['BIRTHDAY KEYCHAIN', {kind: 'keychain'}],
    ['ACRYLIC CHARM', {...proof('실리콘'), kind: 'charm'}], ['ACRYLIC KEYCHAIN', {...proof('본체: 금속'), kind: 'keychain'}],
    ['PHONE STRAP WITH ACRYLIC CHARM', {...proof('나일론·아크릴'), kind: 'phone_strap'}],
  ]) assert.equal(suggestPostmallHs({name, classification}), null, name);
});

test('paper-sticker suggestions require actual paper evidence and reject clear, PET, PVC and acrylic material', () => {
  assert.equal(actual('KN-004').code, '482110', 'The reviewed singular paper_sticker kind is supported.');
  assert.equal(suggestPostmallHs({name: 'STICKER', classification: {...proof('紙'), kind: 'sticker'}}).code, '482110');
  assert.equal(suggestPostmallHs({name: 'STICKER', classification: {kind: 'sticker'}}), null);
  assert.equal(suggestPostmallHs({name: 'STICKER', classification: {kind: 'sticker', evidence: {material: '종이'}}}), null, 'Unverified generic rule metadata is insufficient.');
  for (const material of ['종이·PET', 'PVC', 'アクリル', '폴리에스테르']) assert.equal(suggestPostmallHs({name: 'STICKER', classification: {...proof(material), kind: 'sticker'}}), null);
  assert.equal(suggestPostmallHs({name: 'CLEAR PAPER STICKER', classification: {...proof('종이'), kind: 'sticker'}}), null);
});

test('printed photos exclude digital cards, albums, transparent goods and game cards', () => {
  assert.equal(actual('CS-0304').code, '491191');
  for (const name of ['CLEAR PHOTO SET', 'ACRYLIC PHOTO SET', 'DIGITAL PHOTO SET', 'PHOTO SET DOWNLOAD M-CARD', 'PHOTO SET ALBUM']) {
    assert.equal(suggestPostmallHs({name, classification: {kind: 'photo'}}), null, name);
  }
  assert.equal(suggestPostmallHs({name: 'PHOTO CARD', classification: {...proof('종이'), kind: 'photo_card'}}).code, '491191');
  const titleEstimate = suggestPostmallHs({name: 'PHOTO CARD', classification: {kind: 'photo_card'}});
  assert.equal(titleEstimate.code, '491191'); assert.match(titleEstimate.reason, /추정/); assert.equal(titleEstimate.requiresReview, true);
  assert.equal(suggestPostmallHs({name: 'GAME PHOTO CARD', classification: {...proof('종이'), kind: 'photo_card'}}), null);
});

test('idol trading-card titles are conditional estimates, with clear cards, card stands and games excluded', () => {
  assert.equal(actual('FZ-00692').code, '491191');
  assert.equal(actual('LARME-052'), null, 'A clear card is not inferred to be printed paper.');
  assert.equal(actual('LARME-010'), null, 'A trading-card stand is a physical holder rather than the picture itself.');
  for (const name of ['SPORTS STATISTICS TRADING CARD', 'PLAYING PHOTO CARD', 'BLANK TRADING CARD', 'PET TRADING CARD', 'TRANSPARENT PHOTO CARD', 'TRADING CARD DOWNLOAD', 'NFT PHOTO CARD', 'ONLINE PHOTO CARD', 'トレカ・チェキスタンド', 'トレカホルダー']) {
    assert.equal(suggestPostmallHs({name, classification: {kind: 'photo_card'}}), null, name);
  }
  assert.equal(suggestPostmallHs({name: 'COLLECTIBLE CARD', classification: {kind: 'photo_card'}}), null, 'An unspecified card is insufficient.');
});

test('the ChooseMe estimate requires its exact reviewed identity, paper material and all four verified components', () => {
  const p = product('CS-0280'), classification = classifyCatalogProduct(p);
  assert.equal(classification.evidence.descriptionSha256, undefined, 'The legacy reviewed record lacks a hash by design.');
  const result = suggestPostmallHs({product: p, classification});
  assert.equal(result.code, '491191'); assert.equal(result.requiresReview, true); assert.match(result.reason, /추정/); assert.match(result.reason, /구성품별 HS/);
  for (const altered of [{...p, id: 1}, {...p, code: 'OTHER'}, {...p, name: 'OTHER PAPER SET'}, {...p, productUrl: 'https://asobisystem.shop/products/OTHER'}]) {
    assert.equal(suggestPostmallHs({product: altered, classification}), null);
  }
  for (const change of [
    evidence => { evidence.material = '종이·PVC'; },
    evidence => { evidence.components[1].quantity = 3; },
    evidence => { evidence.components.push({name: '키홀더', quantity: 1}); },
    evidence => { evidence.sourceUrl = 'https://asobisystem.shop/products/OTHER'; },
  ]) {
    const copy = structuredClone(classification); change(copy.evidence);
    assert.equal(suggestPostmallHs({product: p, classification: copy}), null);
  }
  assert.equal(suggestPostmallHs({name: p.enName, classification}), null, 'A selected and identity-guarded catalog product is required.');
  assert.equal(suggestPostmallHs({product: {...p, code: 'OTHER'}, classification: {...classification, ...proof('종이')}}), null, 'Other paper sets do not inherit this product-specific estimate.');
});

test('printed pictures, posters and giclee reproductions do not include handmade originals or textile banners', () => {
  for (const code of ['ASU-040', 'HMC-00010', 'ASB-FM0016', 'TA-0020']) {
    const result = actual(code); assert.equal(result?.code, '491191', code); assert.equal(result.requiresReview, true);
  }
  for (const [name, material] of [['ORIGINAL PAINTING POSTER', '종이'], ['HAND PAINTED PICTURE', '종이'], ['FABRIC POSTER', '직물'], ['ACRYLIC POSTER', '아크릴'], ['DIGITAL POSTER', '종이']]) {
    assert.equal(suggestPostmallHs({name, classification: {...proof(material), kind: 'poster'}}), null, name);
  }
  assert.equal(suggestPostmallHs({name: 'UNKNOWN ARTWORK', classification: {kind: 'art_print'}}), null);
});

test('printed calendars and illustrated postcards use their specific headings rather than the generic picture heading', () => {
  assert.equal(actual('FZ-00348').code, '491000'); assert.equal(actual('YTR_00008').code, '491000');
  const postcard = actual('RF-0011'); assert.equal(postcard.code, '490900'); assert.equal(new URL(postcard.sourceUrl).hostname, 'www.wcoomd.org');
  for (const name of ['DIGITAL CALENDAR', 'FABRIC CALENDAR', 'ACRYLIC CALENDAR']) {
    assert.equal(suggestPostmallHs({name, classification: {kind: 'paper_calendar'}}), null, name);
  }
  for (const name of ['POSTCARD AND GUITAR PICK SET', 'POSTCARD AND STICKER SET', 'HANDWRITTEN POSTCARD', 'PVC POSTCARD']) {
    assert.equal(suggestPostmallHs({name, classification: {kind: 'postcard'}}), null, name);
  }
});

test('printed books and photo books stay separate from digital downloads, blank notebooks and holder books', () => {
  assert.equal(actual('APMG-0038').code, '490199');
  const result = suggestPostmallHs({name: 'ARTIST PHOTOBOOK', classification: {kind: 'book'}});
  assert.equal(result.code, '490199'); assert.equal(result.requiresReview, true); assert.match(result.reason, /추정/);
  for (const name of ['DIGITAL PHOTO BOOK M-CARD', 'BLANK NOTEBOOK', 'PHOTO CARD HOLDER BOOK', 'COLORING BOOK', 'BOOK COVER']) {
    assert.equal(suggestPostmallHs({name, classification: {kind: 'book'}}), null, name);
  }
});

test('real dolls and base-metal can badges remain separate from doll-design accessories and acrylic badges', () => {
  assert.equal(actual('CT-00332').code, '950300', 'The official stuffed-toy category is sufficient physical-kind evidence.');
  assert.equal(actual('FZ-00305'), null, 'The real Chibi Plushie Costume product is clothing for a doll, not the doll body.');
  assert.equal(suggestPostmallHs({name: 'PVC ACTION FIGURE', classification: {kind: 'figure'}}).code, '950300');
  for (const name of ['DOLL CLOTHES', 'DOLL OUTFIT', 'CHIBI PLUSHIE COSTUME', 'ちびぬいコスチューム', 'DOLL ACRYLIC STAND', 'DOLL KEYCHAIN']) assert.equal(suggestPostmallHs({name, classification: {kind: 'doll'}}), null);
  assert.equal(suggestPostmallHs({name: 'CAN BADGE', classification: {...proof('紙・PET・ブリキ'), kind: 'badge'}}).code, '711719');
  for (const [name, material] of [['ACRYLIC BADGE', '아크릴'], ['GOLD BADGE', '금속'], ['CAN BADGE', '종이']]) assert.equal(suggestPostmallHs({name, classification: {...proof(material), kind: 'badge'}}), null);
});

test('mixed/unknown/nonphysical and unavailable sources never acquire a generic HS from list codes', () => {
  for (const kind of ['unknown', 'mixed_random_goods', 'mixed_lottery_goods', 'paper_goods_set', 'download_card', 'event_access', 'clothing']) {
    assert.equal(suggestPostmallHs({name: 'PAPER PHOTO SET AAA batteries ACRYLIC STAND', classification: {kind, jimpassCode: '217', generalCode: '012'}}), null, kind);
  }
  assert.equal(suggestPostmallHs({name: 'PHOTO SET', classification: {kind: 'photo', nonPhysical: true}}), null);
  assert.equal(suggestPostmallHs({name: 'PAPER STICKER', classification: {kind: 'sticker', source: 'detail-unavailable'}}), null);
  assert.equal(suggestPostmallHs({name: 'STICKER', classification: {...proof('종이'), kind: 'sticker'}, product: {name: 'STICKER', productUrl: 'https://asobisystem.shop/products/OTHER-PRODUCT'}}), null);
});

test('suggestions never mutate original names, product identity or classification proof', () => {
  const p = structuredClone(product('CS-0084')), classification = classifyCatalogProduct(p), input = {name: p.enName, product: p, classification};
  const before = JSON.stringify(input);
  function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } }
  freeze(input);
  const result = suggestPostmallHs(input);
  assert.equal(JSON.stringify(input), before); assert.equal(result.code, '851310');
  result.code = '000000';
  assert.equal(suggestPostmallHs(input).code, '851310');
  const paperProduct = structuredClone(product('CS-0280')), paperClassification = classifyCatalogProduct(paperProduct);
  const paperBefore = JSON.stringify({paperProduct, paperClassification}); freeze(paperProduct); freeze(paperClassification);
  assert.equal(suggestPostmallHs({product: paperProduct, classification: paperClassification}).code, '491191');
  assert.equal(JSON.stringify({paperProduct, paperClassification}), paperBefore);
});
