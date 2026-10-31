import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classifyCatalogProduct, classifyProduct, CATEGORY_RULES} from '../dist/categories.mjs';

const read = async name => JSON.parse(await fs.readFile(new URL(`../dist/${name}`, import.meta.url), 'utf8'));
const dataset = await read('product-classifications.json');
const catalog = await read('catalog.json');
const general = await read('general-config.json');
const normal = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

test('every requested unclassified product has one identity-guarded review with source evidence', () => {
  const ids = dataset.reviewedProducts.map(record => String(record.identity.id));
  assert.equal(ids.length, dataset.reviewScope.requestedProducts);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), dataset.reviewScope.productIds.map(String).sort());
  for (const record of dataset.reviewedProducts) {
    const actual = catalog.products.find(product => String(product.id) === String(record.identity.id));
    assert.ok(actual, record.identity.code);
    assert.equal(record.identity.code, actual.code);
    assert.equal(record.identity.productUrl, actual.productUrl);
    assert.equal(normal(record.identity.name), normal(actual.name));
    assert.equal(record.evidence.sourceUrl, actual.productUrl);
    assert.match(record.evidence.descriptionSha256, /^[a-f0-9]{64}$/);
    assert.ok(record.evidence.checkedAt);
  }
});

test('all proposed forwarder codes exist in their actual source tables and apply to the Japanese origin', () => {
  const jimpass = new Map(dataset.codeSources.jimpass.categories.map(row => [row.code, row]));
  for (const record of dataset.reviewedProducts) {
    if (record.jimpass?.code) {
      const actual = jimpass.get(record.jimpass.code);
      assert.ok(actual, record.identity.code);
      assert.equal(record.jimpass.label, actual.label);
      assert.equal(record.jimpass.source, actual.source);
    }
    if (record.general?.code) {
      const actual = general.categories.find(row => row.code === record.general.code);
      assert.ok(actual, record.identity.code);
      assert.equal(record.general.label, actual.item);
      assert.equal(record.general.source.range, `A${actual.row}:C${actual.row}`);
      assert.doesNotMatch(actual.category, /미국센터만/);
    }
    if (record.status === 'mapped') assert.ok(record.jimpass?.code && record.general?.code, record.identity.code);
    if (record.status === 'non_physical') assert.ok(!record.jimpass?.code && !record.general?.code, record.identity.code);
  }
});

test('runtime uses the reviewed product facts while rejecting changed identities and generic set guesses', () => {
  for (const record of dataset.reviewedProducts) {
    const product = catalog.products.find(row => String(row.id) === String(record.identity.id));
    const classified = classifyCatalogProduct(product);
    assert.equal(classified.kind, record.kind, record.identity.code);
    assert.equal(classified.jimpassCode, record.jimpass?.code ?? '');
    assert.equal(classified.generalCode, record.general?.code ?? '');
    assert.equal(classified.nonPhysical, record.status === 'non_physical');
    const wrongIdentity = classifyCatalogProduct({...product, id: `changed-${product.id}`});
    assert.equal(wrongIdentity.source, 'name-rule', record.identity.code);
  }
  assert.equal(classifyProduct('UNREVIEWED SPECIAL GOODS SET').kind, 'unknown');
  const mirror = CATEGORY_RULES.productOverrides.filter(row => dataset.reviewScope.productIds.map(String).includes(String(row.identity.id)));
  assert.equal(mirror.length, dataset.reviewedProducts.length);
});

test('detail evidence distinguishes same-type random goods, physical download cards, and electronic tickets', () => {
  const check = code => classifyCatalogProduct(catalog.products.find(product => product.code === code));
  assert.equal(check('KL-0024').jimpassCode, '135');
  assert.equal(check('KL-0024').generalCode, '151');
  assert.equal(check('AGL-00106').jimpassCode, '217');
  assert.equal(check('AGL-00106').generalCode, '012');
  assert.equal(check('FZ-00437').jimpassCode, '107');
  assert.equal(check('FZ-00437').generalCode, '105');
  assert.equal(check('FZ-00437').nonPhysical, false);
  assert.equal(check('AGL-00204').jimpassCode, '205');
  assert.equal(check('AGL-00204').generalCode, '105');
  assert.equal(check('CS-0298').generalCode, '127');
  assert.equal(check('CS-0305').generalCode, '127');
  assert.equal(check('AGL-00204').requiresReview, true);
  const ticket = dataset.reviewedProducts.find(record => record.status === 'non_physical');
  assert.ok(ticket);
  assert.equal(check(ticket.identity.code).nonPhysical, true);
});
