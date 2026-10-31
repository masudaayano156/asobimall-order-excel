import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {applyMixedGoodsPolicy, MIXED_GOODS_POLICY_ID} from '../scripts/apply-mixed-goods-policy.mjs';
import {classifyProduct, classifyCatalogProduct, CATEGORY_RULES} from '../dist/categories.mjs';

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
  assert.equal(record.general.code, '291');
  assert.equal(record.general.label, general.categories.find(entry => entry.code === '291').item);
  assert.deepEqual(record.general.source, {file: 'General_Excel_Upload.xlsx', sheet: '카테고리 품목 코드', range: 'A293:C293'});
  assert.equal(record.status, 'needs_review');
  assert.equal(record.requiresReview, true);
  assert.match(record.label, /제안/); assert.match(record.reason, /자동 제안/);
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
  assert.equal(resolved.jimpassCode, '205'); assert.equal(resolved.generalCode, '291'); assert.equal(resolved.requiresReview, true);
  for (const wrong of [{...product, id: product.id + 1}, {...product, code: 'CS-0298-other'}, {...product, name: product.name + ' revised'}, {...product, productUrl: product.productUrl + '/revised'}]) {
    const classification = classifyCatalogProduct(wrong, 'UNKNOWN RANDOM GOODS', rules);
    assert.equal(classification.jimpassCode, ''); assert.equal(classification.generalCode, '');
  }
});
