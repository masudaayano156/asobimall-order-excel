import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parseOrders} from '../dist/parser.mjs';
import {findMatches} from '../dist/catalog-match.mjs';
import {classifyCatalogProduct} from '../dist/categories.mjs';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

// Reproducible copy of the anonymized 12-product markdown order, without any
// runtime dependency on ignored verification captures or real recipient data.
const markdownOrder12 = "## Order No. SAMPLE-MARKDOWN-12\n- Order date\n**October 30, 2026 12:00**\\\n- Amount due\n**¥21,080**\n## Payment amount\nsubtotal\n**¥20,200**\npostage\n**¥880**\nAmount due\n**¥21,080**\n## Ordered items\n### Shipping status: Preparing for shipment\n1.\n1. 1.\n## Delivery address\n**SAMPLE RECIPIENT**\n- SAMPLE ADDRESS BLOCK\nPhone number: 0000000000\n## merchandise\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/fCyUk9HXzu5poGTsjxdR4pKQFEhPDQr1vNdZjSVO.jpg)\n* **CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)**\n\nProduct amount:\n**¥5,700**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/Q8N79uj2CPuleC36wIbnr1SXY7MJOIFtTZIhyb3m.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/p9BYdqyLiCy1wAam8H0ILLiqprjKe7JqMCy1SJ48.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -Cute Cute Taiko Outfit Version-**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/hi39lIlzWlayif2qo7x8BMYW370yjo8i1SKlcAD5.jpg)\n* **Ayano Masuda Birthday Celebration 2026 Acrylic Keychain (Birthday Outfit Ver.)**\n\nProduct amount:\n**¥1,200**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/cQiEsVqzyObVOCpxv0iB8bNId9xIeHciL6luYoAB.jpg)\n* **Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Birthday Outfit Ver.)**\n\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/Aye8bMXJbexVhz0mJXrRI3a5bApWYtlbpEO9mAtv.jpg)\n* **Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Revealed Outfit Version)**\n\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/rbpolF3ZI9WyJhRXBnlgydfGVom9UT2T4m7qHi0v.jpg)\n* **Ayano Masuda Birthday Celebration 2026: Ayano Only ChooseMe Set**\n\nProduct amount:\n**¥2,000**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/8HpBduX0CA4tyxF86ZDKBfNx4vzkDihATznFlXyM.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -Rose Ribbon Outfit Ver.- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/OPjy6FUiCHRdUxkwDBUSvFhuRNoAPKr0RBIZWyrp.jpg)\n* **CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Aika Sano**\nProduct amount:\n**¥400**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/OPjy6FUiCHRdUxkwDBUSvFhuRNoAPKr0RBIZWyrp.jpg)\n* **CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥400**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/iNSCEDgijM6iGad5dofB0sR5LlrbZU2Zg4xAtJA2.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -KL Summer Festival 2026 Outfit Edition- (8 types in total)**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n-\n\n* [**image**](https://images.groobee.com/images/asobisystem/X1l3A6bvetTx7sXipk7qtVVBQ37YcqfTiUOB6GHk.jpg)\n* **CUTIE STREET Member-Specific Acrylic Stands -Street Outfit Ver.-**\n\nMembers (CUTIE STREET):\n**Ayano Masuda**\nProduct amount:\n**¥1,500**\nquantity:\n**1**\n";

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const configs = {
  general: JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8')),
  'hoottown-fast': JSON.parse(await fs.readFile(new URL('../dist/fast-config.json', import.meta.url), 'utf8')),
};
const templates = Object.fromEntries(await Promise.all(['jimpass', 'general', 'hoottown-fast'].map(async template => [
  template, new Uint8Array(await fs.readFile(new URL(`../dist/templates/${template}.xlsx`, import.meta.url))),
])));
const profile = Object.freeze({
  recipient: '샘플', phone: '01012345678', postal: '00000', address: '샘플 주소', customs: 'P000000000000',
  shopUrl: 'https://asobisystem.shop', brand: 'ASOBISYSTEM', tracking: '', center: '일본',
  carrier: '[일본]JAPAN POST(日本郵便)', localCarrier: '우체국',
});
const amounts = [5700, 1500, 1500, 1200, 1500, 1500, 2000, 1500, 400, 400, 1500, 1500];

function cellXml(xml, address) {
  return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';
}

function textAt(xml, address) {
  const text = [...cellXml(xml, address).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join('');
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function numberAt(xml, address) {
  const cell = cellXml(xml, address);
  assert.ok(cell);
  assert.doesNotMatch(cell, /t="(?:s|str|inlineStr)"/);
  return Number(cell.match(/<v>([^<]+)<\/v>/)?.[1]);
}

test('real twelve-product XLSX export cleans Jimpass names only, preserving catalog identity and all other item data', async t => {
  const parsed = parseOrders(markdownOrder12);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.orders.length, 1);
  const order = parsed.orders[0];
  assert.equal(order.orderNo, 'SAMPLE-MARKDOWN-12');
  assert.equal(order.items.length, 12);
  const original = structuredClone(parsed);
  const profileBefore = structuredClone(profile);
  const resolved = order.items.map(item => {
    const matches = findMatches(item, catalog.products);
    assert.equal(matches.filter(match => match.exact).length, 1);
    assert.equal(matches[0].exact, true);
    const product = matches[0].product;
    const classification = classifyCatalogProduct(product, item.name);
    assert.ok(classification.jimpassCode);
    assert.ok(classification.generalCode);
    return {item, product, classification};
  });
  assert.deepEqual(resolved.slice(0, 2).map(entry => entry.product.code), ['CS-0084', 'CS-0293']);

  for (const template of ['jimpass', 'general', 'hoottown-fast']) {
    await t.test(template, () => {
      const rows = resolved.map(({item, product, classification}) => ({
        ...item, name: item.name, orderNo: order.orderNo, unitPrice: item.amount,
        category: template === 'jimpass' ? classification.jimpassCode : classification.generalCode,
        color: item.color ?? item.option.replace(/^[^:：]+[:：]\s*/, ''), size: item.size ?? '',
        productUrl: product.productUrl, imageUrl: item.imageUrl || product.imageUrl,
        tracking: '', carrier: profile.carrier, localCarrier: profile.localCarrier,
      }));
      const before = structuredClone(rows);
      const bytes = exportWorkbook({template, templateBytes: templates[template], items: rows, profile, config: configs[template]});
      const xml = strFromU8(unzipSync(bytes)['xl/worksheets/sheet1.xml']);
      const first = template === 'jimpass' ? 2 : 11;
      const nameColumn = template === 'jimpass' ? 'A' : 'AE';
      const names = rows.map((_, index) => textAt(xml, `${nameColumn}${first + index}`));

      if (template === 'jimpass') {
        assert.equal(names[0], 'CUTIE STREET OFFICIAL FAN LIGHT AAA batteries included');
        assert.equal(names[1], 'CUTIE STREET Member Specific Acrylic Stands Tweed Outfit Version');
        assert.equal(names[3], 'Ayano Masuda Birthday Celebration 2026 Acrylic Keychain Birthday Outfit Ver');
        assert.equal(names[6], 'Ayano Masuda Birthday Celebration 2026 Ayano Only ChooseMe Set');
        for (const name of names) assert.match(name, /^[A-Za-z0-9 ]+$/);
      } else {
        assert.equal(names[0], 'CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)');
        assert.equal(names[1], 'CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -');
        assert.equal(names[6], 'Ayano Masuda Birthday Celebration 2026: Ayano Only ChooseMe Set');
        for (const [index, name] of names.entries()) {
          assert.ok(name.length <= 80);
          if (before[index].name.length <= 80) assert.equal(name, before[index].name);
        }
      }

      let subtotal = 0;
      for (const [index, item] of before.entries()) {
        const row = first + index;
        const price = numberAt(xml, `${template === 'jimpass' ? 'F' : 'AF'}${row}`);
        const quantity = numberAt(xml, `${template === 'jimpass' ? 'E' : template === 'general' ? 'AJ' : 'AH'}${row}`);
        assert.equal(price, amounts[index]);
        assert.equal(quantity, 1);
        assert.equal(textAt(xml, `${template === 'jimpass' ? 'B' : 'Y'}${row}`), item.category);
        if (template === 'jimpass') {
          assert.equal(textAt(xml, `C${row}`), item.color);
          assert.equal(textAt(xml, `H${row}`), item.productUrl);
          assert.equal(textAt(xml, `I${row}`), item.imageUrl);
        } else if (template === 'general') {
          assert.equal(textAt(xml, `AN${row}`), item.color);
          assert.equal(textAt(xml, `AP${row}`), item.productUrl);
          assert.equal(textAt(xml, `AQ${row}`), item.imageUrl);
        }
        subtotal += price * quantity;
      }
      assert.equal(subtotal, 20200);
      assert.equal(subtotal + order.postage, 21080);
      if (template !== 'hoottown-fast') {
        const optionColumn = template === 'jimpass' ? 'C' : 'AN';
        assert.deepEqual([8, 9].map(index => textAt(xml, `${optionColumn}${first + index}`)), ['Aika Sano', 'Ayano Masuda']);
      } else {
        for (const index of [8, 9]) {
          for (const column of ['AN', 'AO', 'AP', 'AR', 'AS']) assert.doesNotMatch(cellXml(xml, `${column}${first + index}`), /<v>|<is>/);
          assert.match(cellXml(xml, `AQ${first + index}`), /t="str"><f>.*<\/f><v><\/v>/);
        }
      }
      assert.deepEqual(rows, before);
      assert.deepEqual(parsed, original);
      assert.deepEqual(profile, profileBefore);
    });
  }
  const matchesAfter = order.items.map(item => {
    const exact = findMatches(item, catalog.products).filter(match => match.exact);
    assert.equal(exact.length, 1);
    return exact[0].product.code;
  });
  assert.deepEqual(matchesAfter, resolved.map(entry => entry.product.code));
});
