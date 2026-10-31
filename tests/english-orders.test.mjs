import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { parseOrders } from '../dist/parser.mjs';
import { findMatches } from '../dist/catalog-match.mjs';
import { classifyProduct } from '../dist/categories.mjs';
import { exportWorkbook } from '../dist/exporter.mjs';
import { unzipSync, strFromU8 } from '../dist/fflate.mjs';

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const configs = {
  general: JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8')),
  'hoottown-fast': JSON.parse(await fs.readFile(new URL('../dist/fast-config.json', import.meta.url), 'utf8')),
};
const templateNames = ['jimpass', 'general', 'hoottown-fast'];
const templates = Object.fromEntries(await Promise.all(templateNames.map(async (name) => [
  name, new Uint8Array(await fs.readFile(new URL(`../dist/templates/${name}.xlsx`, import.meta.url))),
])));

const expectedProducts = [
  {
    name: 'CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)',
    jimpassName: 'CUTIE STREET OFFICIAL FAN LIGHT AAA batteries included',
    code: 'CS-0084', amount: 5700, kind: 'fanlight', jimpassCategory: '217', generalCategory: '012',
    productUrl: 'https://asobisystem.shop/products/CS-0084',
    imageUrl: 'https://images.groobee.com/images/asobisystem/fCyUk9HXzu5poGTsjxdR4pKQFEhPDQr1vNdZjSVO.jpg',
  },
  {
    name: 'CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -',
    jimpassName: 'CUTIE STREET Member Specific Acrylic Stands Tweed Outfit Version',
    code: 'CS-0293', amount: 1500, kind: 'acrylic_stand', jimpassCategory: '135', generalCategory: '151',
    productUrl: 'https://asobisystem.shop/products/CS-0293',
    imageUrl: 'https://images.groobee.com/images/asobisystem/Q8N79uj2CPuleC36wIbnr1SXY7MJOIFtTZIhyb3m.jpg',
  },
];

// Synthetic order identifier and no shipping address, phone or image links in source.
const englishOrder = `Order No. SAMPLE-EN-1001
Order date
October 30, 2026 12:00
Payment amount
subtotal
¥7,200
postage
¥880
Amount due
¥8,080
Ordered items
Shipping status: Preparing for shipment
merchandise
${expectedProducts[0].name}
Members(CUTIE STREET):
Ayano Masuda
Product amount:
¥5,700
quantity:
1
${expectedProducts[1].name}
Members(CUTIE STREET):
Ayano Masuda
Product amount:
¥1,500
quantity:
1`;

const syntheticProfile = {
  recipient: '샘플', phone: '01000000000', postal: '00000', address: '샘플 주소', customs: 'P000000000000',
  shopUrl: 'https://asobisystem.shop', brand: 'ASOBISYSTEM', tracking: '',
  carrier: '[일본]JAPAN POST(日本郵便)', localCarrier: '우체국', center: '일본',
};

function parsedOrder() {
  const parsed = parseOrders(englishOrder);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.orders.length, 1);
  const order = parsed.orders[0];
  assert.equal(order.orderNo, 'SAMPLE-EN-1001');
  assert.equal(order.currency, 'JPY');
  assert.equal(order.subtotal, 7200);
  assert.equal(order.postage, 880);
  assert.equal(order.total, 8080);
  assert.equal(order.items.length, 2);
  return order;
}

function matchedItems(order) {
  return order.items.map((item, index) => {
    const expected = expectedProducts[index];
    assert.equal(item.name, expected.name);
    assert.equal(item.imageUrl, '', 'The real catalog must resolve an English name without a pasted image URL.');
    const matches = findMatches(item, catalog.products);
    const exact = matches.filter((match) => match.exact);
    assert.equal(exact.length, 1, `${expected.code} must have one unique, evidence-backed English name match.`);
    assert.equal(matches[0].product.code, expected.code);
    assert.equal(exact[0].product.code, expected.code);
    assert.equal(exact[0].product.productUrl, expected.productUrl);
    assert.equal(exact[0].product.imageUrl, expected.imageUrl);
    const classification = classifyProduct(item.name);
    assert.equal(classification.kind, expected.kind);
    assert.equal(classification.jimpassCode, expected.jimpassCategory);
    assert.equal(classification.generalCode, expected.generalCategory);
    return {
      ...item,
      // Selecting a catalog match supplies URLs; it must not replace the pasted name with Japanese.
      name: item.name,
      unitPrice: item.amount,
      productUrl: exact[0].product.productUrl,
      imageUrl: exact[0].product.imageUrl,
      carrier: syntheticProfile.carrier,
      localCarrier: syntheticProfile.localCarrier,
      tracking: '',
      classification,
    };
  });
}

function cellXml(xml, address) {
  return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';
}

function textValue(xml, address) {
  const cell = cellXml(xml, address);
  const text = [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join('');
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function numericValue(xml, address) {
  const cell = cellXml(xml, address);
  assert.doesNotMatch(cell, /t="(?:inlineStr|s|str)"/, `${address} must be stored as a number.`);
  return Number(cell.match(/<v>([^<]+)<\/v>/)?.[1]);
}

test('real catalog uniquely resolves both English source names without image evidence', () => {
  const order = parsedOrder();
  const resolved = matchedItems(order);
  assert.deepEqual(resolved.map((item) => item.name), expectedProducts.map((item) => item.name));
  assert.deepEqual(resolved.map((item) => item.unitPrice), [5700, 1500]);
  assert.equal(resolved.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0), 7200);
});

for (const template of templateNames) {
  test(`English order → real catalog → classifier → ${template} keeps names, prices and exact template fields`, () => {
    const order = parsedOrder();
    const resolved = matchedItems(order);
    const normalizedItems = resolved.map(({ classification, ...item }) => ({
      ...item,
      category: template === 'jimpass' ? classification.jimpassCode : classification.generalCode,
    }));
    const bytes = exportWorkbook({ template, templateBytes: templates[template], items: normalizedItems, profile: syntheticProfile, config: configs[template] });
    const files = unzipSync(bytes);
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
    const firstRow = template === 'jimpass' ? 2 : 11;
    const nameColumn = template === 'jimpass' ? 'A' : 'AE';
    const priceColumn = template === 'jimpass' ? 'F' : 'AF';
    const quantityColumn = template === 'jimpass' ? 'E' : template === 'general' ? 'AJ' : 'AH';
    let exportedSubtotal = 0;
    for (const [index, expected] of expectedProducts.entries()) {
      const row = firstRow + index;
      assert.equal(textValue(xml, `${nameColumn}${row}`), template === 'jimpass' ? expected.jimpassName : expected.name);
      assert.equal(numericValue(xml, `${priceColumn}${row}`), expected.amount);
      assert.equal(numericValue(xml, `${quantityColumn}${row}`), 1);
      exportedSubtotal += numericValue(xml, `${priceColumn}${row}`) * numericValue(xml, `${quantityColumn}${row}`);
      assert.equal(textValue(xml, `${template === 'jimpass' ? 'B' : 'Y'}${row}`), template === 'jimpass' ? expected.jimpassCategory : expected.generalCategory);
      const trackingCell = cellXml(xml, `${template === 'jimpass' ? 'K' : 'E'}${row}`);
      assert.doesNotMatch(trackingCell, /<v>|<is>/, 'Unknown tracking numbers must remain blank drafts.');
      if (template === 'jimpass') {
        assert.equal(textValue(xml, `H${row}`), expected.productUrl);
        assert.equal(textValue(xml, `I${row}`), expected.imageUrl);
        assert.equal(textValue(xml, `Y${row}`), '우체국');
      } else if (template === 'general') {
        assert.equal(textValue(xml, `AP${row}`), expected.productUrl);
        assert.equal(textValue(xml, `AQ${row}`), expected.imageUrl);
        assert.equal(numericValue(xml, `G${row}`), 31);
      } else {
        // QUICK's AP/AQ are gift-phone fields, so URLs must never be put there.
        for (const column of ['AN', 'AO', 'AP', 'AR', 'AS']) assert.doesNotMatch(cellXml(xml, `${column}${row}`), /<v>|<is>/);
        assert.match(cellXml(xml, `AQ${row}`), /t="str"><f>.*<\/f><v><\/v>/);
        assert.equal(numericValue(xml, `G${row}`), 31);
        const generatedRow = xml.match(new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*>[\\s\\S]*?<\\/row>`))?.[0] ?? '';
        assert.ok(generatedRow);
        assert.ok(!cellXml(xml, `AU${row}`));
        for (const product of expectedProducts) {
          assert.ok(!generatedRow.includes(product.productUrl));
          assert.ok(!generatedRow.includes(product.imageUrl));
        }
      }
    }
    assert.equal(exportedSubtotal, order.subtotal);
    assert.equal(exportedSubtotal + order.postage, order.total);
    assert.notEqual(exportedSubtotal, order.total, 'Postage must not be distributed into product unit prices.');
    assert.equal(textValue(xml, `${template === 'jimpass' ? 'N' : 'J'}${firstRow}`), '샘플');
    assert.equal(textValue(xml, `${template === 'jimpass' ? 'P' : 'U'}${firstRow}`), '00000');
  });
}

// Public product-page title/og:image checked against the source catalog on
// 2026-10-30. The single-Cute English wording is the user's order-page capture;
// the translation widget currently renders the same CS-0292 with two Cutes.
const latestVariantProducts = [
  {
    name: 'CUTIE STREET Member-Specific Acrylic Stands -Street Outfit Ver.-',
    jimpassName: 'CUTIE STREET Member Specific Acrylic Stands Street Outfit Ver',
    id: 203294, code: 'CS-02770',
    japaneseName: 'CUTIE STREET メンバー別アクスタ-すとりーと衣装ver.-',
    productUrl: 'https://asobisystem.shop/products/CS-02770',
    imageUrl: 'https://images.groobee.com/images/asobisystem/X1l3A6bvetTx7sXipk7qtVVBQ37YcqfTiUOB6GHk.jpg',
  },
  {
    name: 'CUTIE STREET Member-Specific Acrylic Stands -Cute Taiko Outfit Version-',
    jimpassName: 'CUTIE STREET Member Specific Acrylic Stands Cute Taiko Outfit Version',
    id: 198469, code: 'CS-0292',
    japaneseName: 'CUTIE STREET メンバー別アクスタ-キュートなキューたい衣装ver.-',
    productUrl: 'https://asobisystem.shop/products/CS-0292',
    imageUrl: 'https://images.groobee.com/images/asobisystem/p9BYdqyLiCy1wAam8H0ILLiqprjKe7JqMCy1SJ48.jpg',
  },
];

function resolveLatestVariants() {
  const source = `Order No. SAMPLE-EN-VARIANTS\nOrdered items\nmerchandise\n${latestVariantProducts.map((product) => `${product.name}\nMembers (CUTIE STREET):\nAyano Masuda\nProduct amount:\n¥1,500\nquantity:\n1`).join('\n')}`;
  const parsed = parseOrders(source);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.orders[0].items.length, 2);
  return parsed.orders[0].items.map((item, index) => {
    const expected = latestVariantProducts[index];
    assert.equal(item.name, expected.name);
    assert.equal(item.imageUrl, '');
    const matches = findMatches(item, catalog.products);
    const exact = matches.filter((candidate) => candidate.exact);
    assert.equal(exact.length, 1, `${expected.code} must resolve through one verified full English alias.`);
    const product = exact[0].product;
    assert.equal(matches[0].product.id, expected.id);
    assert.equal(product.id, expected.id);
    assert.equal(product.code, expected.code);
    assert.equal(product.name, expected.japaneseName);
    assert.equal(product.productUrl, expected.productUrl);
    assert.equal(product.imageUrl, expected.imageUrl);
    const classification = classifyProduct(item.name);
    assert.equal(classification.kind, 'acrylic_stand');
    assert.equal(classification.jimpassCode, '135');
    assert.equal(classification.generalCode, '151');
    return {...item, unitPrice: item.amount, productUrl: product.productUrl, imageUrl: product.imageUrl, classification};
  });
}

test('Street and captured Cute Taiko variants resolve to their verified products without image evidence', () => {
  assert.deepEqual(resolveLatestVariants().map((item) => item.name), latestVariantProducts.map((product) => product.name));
  const unrelatedVersion = findMatches({name: 'CUTIE STREET Member-Specific Acrylic Stands - Unverified Outfit Version -'}, catalog.products);
  assert.ok(unrelatedVersion.every((candidate) => !candidate.exact), 'An unknown outfit must not become an automatic Prima or other version selection.');
});

test('all template exports format the two captured variant names for their forwarder and preserve their URLs', () => {
  const resolved = resolveLatestVariants();
  for (const template of templateNames) {
    const items = resolved.map(({classification, ...item}) => ({...item, category: template === 'jimpass' ? classification.jimpassCode : classification.generalCode}));
    const files = unzipSync(exportWorkbook({template, templateBytes: templates[template], items, profile: syntheticProfile, config: configs[template]}));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
    for (const [index, expected] of latestVariantProducts.entries()) {
      const row = (template === 'jimpass' ? 2 : 11) + index;
      assert.equal(textValue(xml, `${template === 'jimpass' ? 'A' : 'AE'}${row}`), template === 'jimpass' ? expected.jimpassName : expected.name);
      assert.equal(numericValue(xml, `${template === 'jimpass' ? 'F' : 'AF'}${row}`), 1500);
      assert.equal(textValue(xml, `${template === 'jimpass' ? 'B' : 'Y'}${row}`), template === 'jimpass' ? '135' : '151');
      if (template === 'jimpass') {
        assert.equal(textValue(xml, `H${row}`), expected.productUrl);
        assert.equal(textValue(xml, `I${row}`), expected.imageUrl);
      } else if (template === 'general') {
        assert.equal(textValue(xml, `AP${row}`), expected.productUrl);
        assert.equal(textValue(xml, `AQ${row}`), expected.imageUrl);
      } else {
        // QUICK has no item URL/image fields at AP/AQ.
        assert.doesNotMatch(cellXml(xml, `AP${row}`), /<v>|<is>/);
        assert.match(cellXml(xml, `AQ${row}`), /t="str"><f>.*<\/f><v><\/v>/);
      }
    }
  }
});
