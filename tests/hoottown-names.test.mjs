import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseOrders} from '../dist/parser.mjs';
import {findMatches} from '../dist/catalog-match.mjs';
import {classifyCatalogProduct} from '../dist/categories.mjs';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

// Exact copy of the anonymized markdown-order-12 fixture. Embedded so a fresh
// source checkout does not depend on an ignored .verification directory.
const markdownOrder12 = "## Order No. SAMPLE-MARKDOWN-12\n- Order date\n**October 30, 2026 12:00**\\\n- Amount due\n**¥21,080**\n## Payment amount\nsubtotal\n**¥20,200**\npostage\n**¥880**\nAmount due\n**¥21,080**\n## Ordered items\n### Shipping status: Preparing for shipment\n1.\n1. 1.\n## Delivery address\n**SAMPLE RECIPIENT**\n- SAMPLE ADDRESS BLOCK\nPhone number: 0000000000\n## merchandise\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/fCyUk9HXzu5poGTsjxdR4pKQFEhPDQr1vNdZjSVO.jpg)\n* **CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)**\n\nProduct amount:\n**¥5,700**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/Q8N79uj2CPuleC36wIbnr1SXY7MJOIFtTZIhyb3m.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/p9BYdqyLiCy1wAam8H0ILLiqprjKe7JqMCy1SJ48.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -Cute Cute Taiko Outfit Version-**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/hi39lIlzWlayif2qo7x8BMYW370yjo8i1SKlcAD5.jpg)\n* **Ayano Masuda Birthday Celebration 2026 Acrylic Keychain (Birthday Outfit Ver.)**\n\nProduct amount:\n**¥1,200**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/cQiEsVqzyObVOCpxv0iB8bNId9xIeHciL6luYoAB.jpg)\n* **Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Birthday Outfit Ver.)**\n\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/Aye8bMXJbexVhz0mJXrRI3a5bApWYtlbpEO9mAtv.jpg)\n* **Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Revealed Outfit Version)**\n\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/rbpolF3ZI9WyJhRXBnlgydfGVom9UT2T4m7qHi0v.jpg)\n* **Ayano Masuda Birthday Celebration 2026: Ayano Only ChooseMe Set**\n\nProduct amount:\n**¥2,000**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/8HpBduX0CA4tyxF86ZDKBfNx4vzkDihATznFlXyM.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -Rose Ribbon Outfit Ver.- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/OPjy6FUiCHRdUxkwDBUSvFhuRNoAPKr0RBIZWyrp.jpg)\n* **CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Aika Sano**\nProduct amount:\n**¥400**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/OPjy6FUiCHRdUxkwDBUSvFhuRNoAPKr0RBIZWyrp.jpg)\n* **CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥400**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/iNSCEDgijM6iGad5dofB0sR5LlrbZU2Zg4xAtJA2.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -KL Summer Festival 2026 Outfit Edition- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/X1l3A6bvetTx7sXipk7qtVVBQ37YcqfTiUOB6GHk.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -Street Outfit Ver.-**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n";

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const configs = {
  general: JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8')),
  'hoottown-fast': JSON.parse(await fs.readFile(new URL('../dist/fast-config.json', import.meta.url), 'utf8')),
};
const templates = Object.fromEntries(await Promise.all(['jimpass', 'general', 'hoottown-fast'].map(async template => [
  template, new Uint8Array(await fs.readFile(new URL(`../dist/templates/${template}.xlsx`, import.meta.url))),
])));
const profile = {
  recipient: '샘플', phone: '01000000000', postal: '00000', address: '샘플 주소', customs: 'P000000000000',
  shopUrl: 'https://asobisystem.shop', brand: 'ASOBISYSTEM', tracking: '',
  carrier: '[일본]JAPAN POST(日本郵便)', localCarrier: '우체국', center: '일본',
};
const expectedAmounts = [5700, 1500, 1500, 1200, 1500, 1500, 2000, 1500, 400, 400, 1500, 1500];

function parsedFixture() {
  const result = parseOrders(markdownOrder12);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.orders.length, 1);
  const order = result.orders[0];
  assert.equal(order.orderNo, 'SAMPLE-MARKDOWN-12');
  assert.equal(order.items.length, 12);
  assert.equal(order.subtotal, 20200);
  assert.equal(order.postage, 880);
  assert.equal(order.total, 21080);
  assert.deepEqual(order.items.map(item => item.amount), expectedAmounts);
  assert.deepEqual(order.items.map(item => item.quantity), Array(12).fill(1));
  assert.deepEqual(order.items.flatMap((item, index) => item.name.length > 80 ? [index + 1] : []), [8, 9, 10, 11]);
  return result;
}

function resolveItems(parsed, template) {
  return parsed.orders.flatMap(order => order.items.map(item => {
    const matches = findMatches(item, catalog.products);
    assert.equal(matches.filter(match => match.exact).length, 1, `Expected a unique match for ${item.name}`);
    assert.equal(matches[0].exact, true);
    const product = matches[0].product;
    const classification = classifyCatalogProduct(product, item.name);
    const category = template === 'jimpass' ? classification.jimpassCode : classification.generalCode;
    assert.ok(category, `Missing ${template} category for ${product.code}`);
    assert.equal(classification.nonPhysical, false);
    return {
      ...item,
      // Full source names are passed into the real exporter; no test-side shortening.
      name: item.name,
      orderNo: order.orderNo, unitPrice: item.amount, category,
      color: item.color ?? item.option.replace(/^[^:：]+[:：]\s*/, ''), size: item.size ?? '',
      productUrl: product.productUrl, imageUrl: product.imageUrl,
      tracking: '', carrier: profile.carrier, localCarrier: profile.localCarrier,
      catalogCode: product.code,
    };
  }));
}

function cellXml(xml, address) {
  return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';
}

function textValue(xml, address) {
  const text = [...cellXml(xml, address).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join('');
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function numericValue(xml, address) {
  const cell = cellXml(xml, address);
  assert.ok(cell, `Missing numeric cell ${address}`);
  assert.doesNotMatch(cell, /t="(?:inlineStr|s|str)"/);
  return Number(cell.match(/<v>([^<]+)<\/v>/)?.[1]);
}

test('twelve raw markdown names still match exact products before any export', () => {
  const parsed = parsedFixture();
  const baseline = structuredClone(parsed);
  const resolved = resolveItems(parsed, 'general');
  assert.equal(resolved.length, 12);
  assert.equal(resolved[8].name, resolved[9].name);
  assert.equal(resolved[8].catalogCode, resolved[9].catalogCode);
  assert.deepEqual(resolved.slice(8, 10).map(item => item.color), ['Aika Sano', 'Ayano Masuda']);
  assert.deepEqual(parsed, baseline);
});

for (const template of ['general', 'hoottown-fast', 'jimpass']) {
  test(`${template} exports long names without changing source identity, variants, options or prices`, () => {
    const parsed = parsedFixture();
    const baseline = structuredClone(parsed);
    const rawNames = parsed.orders[0].items.map(item => item.name);
    const inputItems = resolveItems(parsed, template);
    const inputBaseline = structuredClone(inputItems);
    const files = unzipSync(exportWorkbook({template, templateBytes: templates[template], items: inputItems, profile, config: configs[template]}));
    const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
    const firstRow = template === 'jimpass' ? 2 : 11;
    const nameColumn = template === 'jimpass' ? 'A' : 'AE';
    const priceColumn = template === 'jimpass' ? 'F' : 'AF';
    const quantityColumn = template === 'jimpass' ? 'E' : template === 'general' ? 'AJ' : 'AH';
    const names = inputItems.map((item, index) => textValue(xml, `${nameColumn}${firstRow + index}`));
    let subtotal = 0;
    for (let index = 0; index < inputItems.length; index++) {
      const row = firstRow + index;
      assert.ok(names[index], `Missing exported name for product ${index + 1}`);
      if (template === 'jimpass') assert.match(names[index], /^[A-Za-z0-9 ]+$/);
      else {
        assert.ok(names[index].length <= 80, `Product ${index + 1} exceeds 80 characters: ${names[index]}`);
        if (rawNames[index].length > 80) assert.notEqual(names[index], rawNames[index]);
        else assert.equal(names[index], rawNames[index], 'Already valid names should not be rewritten.');
      }
      assert.equal(numericValue(xml, `${priceColumn}${row}`), expectedAmounts[index]);
      assert.equal(numericValue(xml, `${quantityColumn}${row}`), 1);
      subtotal += numericValue(xml, `${priceColumn}${row}`) * numericValue(xml, `${quantityColumn}${row}`);
    }
    assert.equal(subtotal, 20200);
    assert.equal(subtotal + parsed.orders[0].postage, parsed.orders[0].total);

    if (template === 'jimpass') {
      assert.equal(names[0], 'CUTIE STREET OFFICIAL FAN LIGHT AAA batteries included');
      assert.equal(names[1], 'CUTIE STREET Member Specific Acrylic Stands Tweed Outfit Version');
      assert.equal(names[6], 'Ayano Masuda Birthday Celebration 2026 Ayano Only ChooseMe Set');
    } else {
      assert.match(names[7], /Rose\s*Ribbon/i);
      assert.match(names[7], /Acrylic\s+Stands?/i);
      for (const index of [8, 9, 10]) assert.match(names[index], /KL\s+Summer\s+Festival\s+2026/i);
      for (const index of [8, 9]) {
        assert.match(names[index], /Photo\s+Set/i);
        assert.match(names[index], /\b2\s*L\b/i);
      }
      assert.match(names[10], /Acrylic\s+Stands?/i);
    }
    const photoRows = [firstRow + 8, firstRow + 9];
    if (template === 'jimpass' || template === 'general') {
      const optionColumn = template === 'jimpass' ? 'C' : 'AN';
      assert.deepEqual(photoRows.map(row => textValue(xml, `${optionColumn}${row}`)), ['Aika Sano', 'Ayano Masuda']);
    } else {
      // QUICK's AN:AS are gift-recipient fields, not member or product option columns.
      for (const row of photoRows) {
        for (const column of ['AN', 'AO', 'AP', 'AR', 'AS']) assert.doesNotMatch(cellXml(xml, `${column}${row}`), /<v>|<is>/);
        assert.match(cellXml(xml, `AQ${row}`), /t="str"><f>.*<\/f><v><\/v>/);
      }
    }
    assert.deepEqual(parsed, baseline, 'Raw parser output must remain unchanged.');
    assert.deepEqual(inputItems, inputBaseline, 'Export must not overwrite its input product records.');
    const after = resolveItems(parsed, template);
    assert.deepEqual(after.map(item => item.catalogCode), inputBaseline.map(item => item.catalogCode), 'All twelve full source names must still resolve to the same exact products.');
  });
}
