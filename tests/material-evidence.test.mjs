import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {resolveProductMaterial} from '../dist/material-evidence.mjs';
import {PRODUCT_MATERIALS} from '../dist/product-materials.mjs';
import {compactMaterialSections, compactProductFacts} from '../scripts/build-product-materials.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));

test('public material records bind their source and proof to exact catalog identities', () => {
  assert.ok(PRODUCT_MATERIALS.length > 0);
  const seen = new Set();
  for (const record of PRODUCT_MATERIALS) {
    const p = catalog.products.find(product => product.id === record.identity.id);
    assert.ok(p); assert.ok(!seen.has(p.id)); seen.add(p.id);
    assert.equal(p.code, record.identity.code); assert.equal(p.name, record.identity.name); assert.equal(p.productUrl, record.sourceUrl);
    assert.match(record.descriptionSha256, /^[a-f0-9]{64}$/);
    assert.ok(record.material || record.facts.length);
    assert.ok(resolveProductMaterial(p));
  }
});

test('material extraction rejects brand headings and stops before shipping or contact instructions', () => {
  assert.equal(compactMaterialSections([{label: 'Material Stock Design Store', text: 'COTTON'}]), '');
  assert.equal(compactMaterialSections([{label: '素材', text: '綿100%\n発送予定について\nポリエステル100%'}]), '素材: 綿100%');
  assert.equal(compactMaterialSections([{label: '素材', text: '本体：PVC\nhttps://example.test'}]), '素材: 本体:PVC');
  assert.equal(compactMaterialSections([{label: '素材', text: '素材未記載'}]), '');
  assert.deepEqual(compactProductFacts({explicitSections: [{label: 'おすすめ商品', lines: ['OTHER DVD']}]}), []);
  assert.deepEqual(compactProductFacts({explicitSections: [{label: '仕様', lines: ['CD + Blu-ray', 'https://example.test']}]}), ['CD + Blu-ray']);
});

test('changed product identity cannot reuse another material record and returned facts are independent', () => {
  const record = PRODUCT_MATERIALS[0], p = catalog.products.find(product => product.id === record.identity.id);
  for (const changed of [{...p, id: -1}, {...p, code: p.code + '-other'}, {...p, name: p.name + ' altered'}, {...p, productUrl: p.productUrl + '/other'}]) assert.equal(resolveProductMaterial(changed), null);
  assert.equal(resolveProductMaterial(null), null);
  const proof = resolveProductMaterial(p); proof.facts.push('SYNTHETIC MUTATION');
  assert.ok(!resolveProductMaterial(p).facts.includes('SYNTHETIC MUTATION'));
});
