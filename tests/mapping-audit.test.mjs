import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classifyCatalogProduct} from '../dist/categories.mjs';
import {suggestPostmallHs} from '../dist/postmall-hs.mjs';

const read = file => fs.readFile(new URL('../dist/' + file, import.meta.url), 'utf8').then(JSON.parse);
const [catalog, registry, general] = await Promise.all(['catalog.json', 'product-classifications.json', 'general-config.json'].map(read));
const jimpass = new Map(registry.codeSources.jimpass.categories.map(c => [c.code, c]));
const hoottown = new Map(general.categories.map(c => [c.code, c]));
const verifiedHs = new Set(['330300','391990','392410','392610','392640','392690','420292','482110','490199','490900','491000','491191','610910','610990','611020','611030','611595','611596','630260','630291','630293','650500','691110','691200','732393','852349','851310','950300','950440','950490','960810','961700','711719']);
const rows = catalog.products.map(product => {
  const classification = classifyCatalogProduct(product);
  return {product, classification, hs: suggestPostmallHs({product, classification})};
});

test('all catalog proposals resolve to the correct provider codebooks and no goods use generic steel/plastic ETC', () => {
  assert.equal(rows.length, 2997);
  for (const {product, classification: c} of rows) {
    if (c.nonPhysical) continue;
    if (c.jimpassCode) {
      const entry = jimpass.get(c.jimpassCode); assert.ok(entry, product.code);
      assert.equal(c.jimpassLabel, entry.label, product.code);
    }
    if (c.generalCode) {
      const entry = hoottown.get(c.generalCode); assert.ok(entry, product.code);
      assert.equal(c.generalLabel, entry.item, product.code);
      assert.ok(!/미국센터만/.test(entry.category), product.code);
      assert.ok(!['290','291'].includes(c.generalCode), product.code);
    }
  }
});

test('all HS proposals have verified headings, explicit review status and public primary-source links', () => {
  for (const {product, classification, hs} of rows) {
    if (classification.nonPhysical) { assert.equal(hs, null, product.code); continue; }
    if (!hs) continue;
    assert.match(hs.code, /^\d{6}$/); assert.ok(verifiedHs.has(hs.code), product.code);
    assert.equal(hs.requiresReview, true); assert.ok(hs.reason); assert.ok(hs.ruleId);
    const url = new URL(hs.sourceUrl); assert.equal(url.protocol, 'https:');
    assert.ok(['www.postmall.net','www.wcoomd.org','www.customs.go.jp'].includes(url.hostname));
    if (/clothing|tshirt|hoodie|sweatshirt|towel|pouch|bag|candy|food|powerbank|perfume|drinkware/.test(classification.kind)) assert.notEqual(hs.ruleId, 'user-requested-other-toy-default-v1', product.code);
  }
});

test('published all-provider coverage counts match live catalog proposals and exclude nonphysical rights', async () => {
  const report = await read('classification-coverage.json');
  for (const [provider, field] of [['jimpass','jimpassCode'],['hoottown','generalCode']]) {
    const proposed = rows.filter(r => !r.classification.nonPhysical && r.classification[field]).length;
    assert.equal(report.providerCoverage[provider].proposed, proposed);
  }
  assert.equal(report.providerCoverage.postmall.proposed, rows.filter(r => !r.classification.nonPhysical && r.hs).length);
  assert.equal(report.providerCoverage.excludedNonPhysical, rows.filter(r => r.classification.nonPhysical).length);
  assert.equal(report.products.length, rows.length);
});
