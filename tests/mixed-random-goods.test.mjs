import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {applyMixedGoodsPolicy, MIXED_GOODS_POLICY_ID} from '../scripts/apply-mixed-goods-policy.mjs';
import {classifyProduct, classifyCatalogProduct, CATEGORY_RULES} from '../dist/categories.mjs';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

const read = async relative => JSON.parse(await fs.readFile(new URL('../' + relative, import.meta.url), 'utf8'));
const [registry, general, catalog] = await Promise.all(['dist/product-classifications.json', 'dist/general-config.json', 'dist/catalog.json'].map(read));
const byCode = (data, code) => data.reviewedProducts.find(record => record.identity.code === code);

test('CS-0298 gets reviewed broad suggestions from actual canonical forwarder codebooks', () => {
  const data = structuredClone(registry);
  applyMixedGoodsPolicy(data, general, catalog);
  const record = byCode(data, 'CS-0298');
  assert.equal(record.jimpass.code, '205');
  assert.equal(record.jimpass.label, registry.codeSources.jimpass.categories.find(entry => entry.code === '205').label);
  assert.equal(record.jimpass.source, 'https://www.jimpass.com/tool/agencyCategory.php?category=204');
  assert.equal(record.general.code, '127');
  assert.equal(record.general.label, general.categories.find(entry => entry.code === '127').item);
  assert.deepEqual(record.general.source, {file: 'General_Excel_Upload.xlsx', sheet: '카테고리 품목 코드', range: 'A129:C129'});
  assert.equal(record.status, 'needs_review');
  assert.equal(record.requiresReview, true);
  assert.match(record.label, /기타 완구 제안/); assert.match(record.reason, /랜덤 캡슐/);
  assert.equal(record.mappingPolicy.id, MIXED_GOODS_POLICY_ID);
  assert.equal(record.mappingPolicy.officialDetermination, false);
});

test('the policy preserves every original identity and all source facts/hashes, and is idempotent', () => {
  const data = structuredClone(registry);
  const target = byCode(data, 'CS-0298');
  target.jimpass = null; target.general = null;
  target.reviewReason = target.policyOriginalReviewReason ?? target.reviewReason;
  const originalReviewReason = target.reviewReason;
  delete target.mappingPolicy; delete target.policyOriginalReviewReason;
  const original = data.reviewedProducts.map(record => ({identity: structuredClone(record.identity), evidence: structuredClone(record.evidence)}));
  const first = applyMixedGoodsPolicy(data, general, catalog);
  const after = JSON.stringify(data);
  const second = applyMixedGoodsPolicy(data, general, catalog);
  assert.ok(first.applied.includes('CS-0298'));
  assert.ok(first.changed >= 1);
  assert.equal(target.policyOriginalReviewReason, originalReviewReason);
  assert.equal(second.changed, 0); assert.equal(JSON.stringify(data), after);
  for (const [index, record] of data.reviewedProducts.entries()) {
    assert.deepEqual(record.identity, original[index].identity);
    assert.deepEqual(record.evidence, original[index].evidence);
  }
});

test('known all-stand products, unknown contents, other mixed kinds and digital services stay unchanged', () => {
  const data = structuredClone(registry);
  const untouched = data.reviewedProducts.filter(record => record.kind !== 'mixed_random_goods' || record.status !== 'needs_review');
  const before = untouched.map(record => JSON.stringify(record));
  applyMixedGoodsPolicy(data, general, catalog);
  assert.deepEqual(untouched.map(record => JSON.stringify(record)), before);
  assert.equal(byCode(data, 'KL-0024').jimpass.code, '135');
  assert.equal(byCode(data, 'KL-0024').general.code, '151');
  assert.equal(classifyProduct('UNKNOWN RANDOM GOODS').jimpassCode, '');
  assert.equal(classifyProduct('UNKNOWN RANDOM GOODS').generalCode, '');
});

test('medical bandages and ranked lottery goods are explicitly excluded even if their facts name goods', () => {
  const data = structuredClone(registry);
  const codes = ['FZ-00308', 'CT-00034'];
  const before = codes.map(code => JSON.stringify(byCode(data, code)));
  const result = applyMixedGoodsPolicy(data, general, catalog);
  assert.deepEqual(codes.map(code => JSON.stringify(byCode(data, code))), before);
  for (const code of codes) {
    assert.ok(result.skipped.some(entry => entry.code === code && entry.reason === 'explicit-exclusion'));
    assert.ok(!byCode(data, code).jimpass?.code); assert.ok(!byCode(data, code).general?.code);
  }
});

test('missing composition evidence and stale catalog identities cannot acquire the suggestion', () => {
  for (const change of [record => { record.evidence.facts = []; }, record => { record.identity.id++; }, record => { record.identity.name += ' revised'; }, record => { record.identity.productUrl += '/revised'; }]) {
    const data = structuredClone(registry), record = byCode(data, 'CS-0298');
    record.jimpass = null; record.general = null; delete record.mappingPolicy;
    change(record);
    const before = JSON.stringify(record);
    applyMixedGoodsPolicy(data, general, catalog);
    assert.equal(JSON.stringify(record), before);
  }
});

test('runtime classification still requires the complete reviewed product identity', () => {
  const data = structuredClone(registry);
  applyMixedGoodsPolicy(data, general, catalog);
  const record = byCode(data, 'CS-0298'), product = catalog.products.find(entry => entry.code === 'CS-0298');
  const rules = {...CATEGORY_RULES, productOverrides: [record]};
  const resolved = classifyCatalogProduct(product, product.name, rules);
  assert.equal(resolved.jimpassCode, '205'); assert.equal(resolved.generalCode, '127'); assert.equal(resolved.requiresReview, true);
  for (const wrong of [{...product, id: product.id + 1}, {...product, code: 'CS-0298-other'}, {...product, name: product.name + ' revised'}, {...product, productUrl: product.productUrl + '/revised'}]) {
    const classification = classifyCatalogProduct(wrong, 'UNKNOWN RANDOM GOODS', rules);
    assert.equal(classification.jimpassCode, ''); assert.equal(classification.generalCode, '');
  }
});

test('reviewed capsules use other toys and other mixed household goods use stationery without generic ETC', () => {
  const data = structuredClone(registry), result = applyMixedGoodsPolicy(data, general, catalog);
  let capsules = 0, household = 0;
  for (const code of result.applied) {
    const record = byCode(data, code), capsule = /ランダムカプセル|\bRANDOM\s+CAPSULE\b/i.test(record.identity.name);
    assert.equal(record.general.code, capsule ? '127' : '105', code);
    assert.equal(record.requiresReview, true);
    assert.equal(record.jimpass.code, '205');
    assert.ok(!['290', '291'].includes(record.general.code));
    capsule ? capsules++ : household++;
  }
  assert.equal(capsules, 24); assert.equal(household, 9);
  assert.equal(byCode(data, 'CS-0305').general.code, '127');
  assert.equal(byCode(data, 'AGL-00041').general.code, '105');
  assert.equal(byCode(data, 'KL-0024').general.code, '151');
});

test('current generic ETC labels distinguish steel and plastic while the original formula table labels stay unchanged', async () => {
  for (const relative of ['dist/general-config.json', 'dist/fast-config.json']) {
    const config = await read(relative);
    const steel = config.categories.find(entry => entry.code === '291');
    const plastic = config.categories.find(entry => entry.code === '290');
    assert.equal(steel.item, '[목록통관] 기타(ETC) 품목');
    assert.equal(steel.latestItemLabel, '[목록통관] 기타 철강제 (ETC) 품목');
    assert.equal(plastic.latestItemLabel, '[일반통관] 기타 플라스틱 (ETC) 품목');
    assert.equal(steel.itemCode, 2000291); assert.equal(plastic.itemCode, 2000290);
    assert.equal(steel.latestItemLabelSourceUrl, 'https://api.hoottown.com/api/v1.0/delivery/commodity?comodityCatAutoSn=10020');
  }
});

test('the two reported capsules export toy category and item codes in both Hoottown templates', async () => {
  const products = ['CS-0298', 'CS-0305'].map(code => catalog.products.find(product => product.code === code));
  const rows = products.map(product => ({orderNo: 'SAMPLE-CAPSULE', name: product.enName, category: classifyCatalogProduct(product).generalCode, quantity: 10, unitPrice: 500, tracking: '', carrier: '[일본]기타 운송사(ETC)'}));
  const before = structuredClone(rows);
  for (const template of ['general', 'hoottown-fast']) {
    const config = template === 'general' ? general : await read('dist/fast-config.json');
    const templateBytes = new Uint8Array(await fs.readFile(new URL(`../dist/templates/${template}.xlsx`, import.meta.url)));
    const files = unzipSync(exportWorkbook({template, templateBytes, items: rows, profile: {center: '일본'}, config}));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
    const cell = address => xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';
    for (const row of [11, 12]) {
      assert.match(cell(`Y${row}`), />127<\/t>/);
      assert.match(cell(`Z${row}`), /완구\/피규어<\/v>/);
      assert.match(cell(`AA${row}`), /기타 완구<\/v>/);
      assert.match(cell(`AB${row}`), /<v>10005<\/v>/);
      assert.match(cell(`AC${row}`), /<v>2000127<\/v>/);
      assert.doesNotMatch(cell(`AC${row}`), /2000291/);
      assert.match(cell(`G${row}`), /<v>35<\/v>/);
    }
  }
  assert.deepEqual(rows, before);
});
