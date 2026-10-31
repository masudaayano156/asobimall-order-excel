import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {classifyProduct, classifyCatalogProduct, CATEGORY_RULES} from '../dist/categories.mjs';
import {parseOrders} from '../dist/parser.mjs';
import {findMatches} from '../dist/catalog-match.mjs';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const chooseMe = catalog.products.find(product => product.code === 'CS-0280');
assert.ok(chooseMe, 'The verified public catalog product must be available.');
const englishName = 'Ayano Masuda Birthday Celebration 2026: Ayano Only ChooseMe Set';
const productUrl = 'https://asobisystem.shop/products/CS-0280';

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

test('a generic Set or the ChooseMe title alone does not imply a goods category', () => {
  for (const name of [englishName, chooseMe.name, 'SPECIAL ANNIVERSARY GOODS SET', 'UNVERIFIED CHOOSEME SET']) {
    const classification = classifyProduct(name);
    assert.equal(classification.kind, 'unknown', name);
    assert.equal(classification.jimpassCode, '', name);
    assert.equal(classification.generalCode, '', name);
  }
});

test('the exact catalog identity uses verified paper components and separate forwarder codes', () => {
  assert.equal(chooseMe.id, 202639);
  assert.equal(chooseMe.name, '増田彩乃生誕祭2026 あやのだけ ChooseMe セット');
  assert.equal(chooseMe.productUrl, productUrl);
  const classification = classifyCatalogProduct(chooseMe, englishName);
  assert.equal(classification.source, 'product-detail');
  assert.equal(classification.kind, 'paper_goods_set');
  assert.equal(classification.label, '종이 굿즈 세트');
  assert.equal(classification.jimpassCode, '239');
  assert.equal(classification.generalCode, '105');
  assert.equal(classification.requiresReview, true);
  assert.equal(classification.evidence.sourceUrl, productUrl);
  assert.match(classification.evidence.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(classification.evidence.material, '종이');
  assert.deepEqual(classification.evidence.components, [
    {name: '스탠드 봉투', quantity: null},
    {name: '트레이딩 카드', quantity: 2},
    {name: '스티커', quantity: 2},
    {name: '엽서', quantity: 3},
  ]);
  assert.equal(classification.codeSources.jimpass, 'https://www.jimpass.com/tool/agencyCategory.php?category=100');
  assert.deepEqual(classification.codeSources.general, {file: 'General_Excel_Upload.xlsx', sheet: '카테고리 품목 코드', range: 'A107:C107'});
});

test('reused IDs, SKUs, URLs or changed source names cannot silently reuse the product override', () => {
  const changed = [
    {...chooseMe, id: 202640},
    {...chooseMe, code: 'CS-0280-OTHER'},
    {...chooseMe, productUrl: 'https://asobisystem.shop/products/CS-0293'},
    {...chooseMe, name: `${chooseMe.name} 改訂版`},
  ];
  for (const product of changed) {
    const classification = classifyCatalogProduct(product, englishName);
    assert.equal(classification.source, 'name-rule');
    assert.equal(classification.kind, 'unknown');
    assert.equal(classification.jimpassCode, '');
    assert.equal(classification.generalCode, '');
  }
  assert.equal(classifyCatalogProduct({...chooseMe, name: chooseMe.name.replaceAll(' ', '\u3000')}).source, 'product-detail');
});

test('classification does not mutate catalog data or the stored proof, and custom keyword rules remain usable', () => {
  const product = freezeDeep(structuredClone(chooseMe));
  const original = JSON.stringify(product);
  const originalRules = JSON.stringify(CATEGORY_RULES);
  const classification = classifyCatalogProduct(product, englishName);
  classification.evidence.components[0].name = 'temporary caller edit';
  assert.equal(JSON.stringify(product), original);
  assert.equal(JSON.stringify(CATEGORY_RULES), originalRules);
  assert.equal(classifyCatalogProduct(product, englishName).evidence.components[0].name, '스탠드 봉투');
  const custom = [{kind: 'custom', label: '사용자 품목', patterns: ['CUSTOM ITEM'], jimpass: {code: '999', label: '사용자 확인'}}];
  const result = classifyCatalogProduct(product, 'CUSTOM ITEM', custom);
  assert.equal(result.source, 'name-rule');
  assert.equal(result.kind, 'custom');
  assert.equal(result.jimpassCode, '999');
  assert.equal(result.generalCode, '');
  assert.equal(classifyCatalogProduct(null, 'UNVERIFIED SET').kind, 'unknown');
});

function cell(xml, address) {
  return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';
}

function textAt(xml, address) {
  return [...cell(xml, address).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join('');
}

function numberAt(xml, address) {
  const value = cell(xml, address);
  assert.doesNotMatch(value, /t="(?:inlineStr|s|str)"/);
  return Number(value.match(/<v>([^<]+)<\/v>/)?.[1]);
}

test('a matched ChooseMe set exports as one paper-goods row with the correct code in all three templates', async () => {
  const parsed = parseOrders(`Order No. SAMPLE-PAPER-SET\nOrdered items\nmerchandise\n${englishName}\nProduct amount: ¥2,000\nquantity: 1`);
  assert.deepEqual(parsed.warnings, []);
  const [item] = parsed.orders[0].items;
  const matches = findMatches(item, catalog.products).filter(match => match.exact);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].product.code, 'CS-0280');
  const classification = classifyCatalogProduct(matches[0].product, item.name);
  const profile = {recipient: '샘플', phone: '01000000000', postal: '00000', address: '샘플 주소', customs: 'P000000000000', shopUrl: 'https://asobisystem.shop', brand: 'ASOBISYSTEM', carrier: '[일본]JAPAN POST(日本郵便)', tracking: '', center: '일본'};
  for (const template of ['jimpass', 'general', 'hoottown-fast']) {
    const templateBytes = new Uint8Array(await fs.readFile(new URL(`../dist/templates/${template}.xlsx`, import.meta.url)));
    const config = template === 'jimpass' ? undefined : JSON.parse(await fs.readFile(new URL(`../dist/${template === 'general' ? 'general' : 'fast'}-config.json`, import.meta.url), 'utf8'));
    const rows = [{...item, unitPrice: item.amount, category: template === 'jimpass' ? classification.jimpassCode : classification.generalCode, productUrl: chooseMe.productUrl, imageUrl: chooseMe.imageUrl}];
    const files = unzipSync(exportWorkbook({template, templateBytes, items: rows, profile, config}));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
    const row = template === 'jimpass' ? 2 : 11;
    assert.equal(textAt(xml, `${template === 'jimpass' ? 'B' : 'Y'}${row}`), template === 'jimpass' ? '239' : '105');
    assert.equal(textAt(xml, `${template === 'jimpass' ? 'A' : 'AE'}${row}`), template === 'jimpass' ? 'Ayano Masuda Birthday Celebration 2026 Ayano Only ChooseMe Set' : englishName);
    assert.equal(numberAt(xml, `${template === 'jimpass' ? 'F' : 'AF'}${row}`), 2000);
    assert.equal(numberAt(xml, `${template === 'jimpass' ? 'E' : template === 'general' ? 'AJ' : 'AH'}${row}`), 1);
    if (template !== 'jimpass') {
      assert.equal(numberAt(xml, 'AB11'), 10003);
      assert.equal(numberAt(xml, 'AC11'), 2000105);
    }
  }
});
