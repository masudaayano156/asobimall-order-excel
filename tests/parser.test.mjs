import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOrders} from '../dist/parser.mjs';

const sample = `Order No. SAMPLE-001
-
Order date
September 18, 2026 20:00
-
Payment methods
credit card
-
Amount due
¥9,180
View details
Payment amount
subtotal
¥8,300
postage
¥880
Amount due
¥9,180
Ordered items
Shipping status: Preparing for shipment Estimated delivery date: November
merchandise
-
  - [image](https://example.test/uniform.jpg)
  -
CUTIE STREET OSHI API UNIFORM
Members (CUTIE STREET):
Ayano Masuda
Product amount:
¥6,500
quantity:
1
-
  - [image](https://example.test/charm.jpg)
  -
CUTIE STREET OFFICIAL FAN LIGHT CUSTOM CHARM
Members (CUTIE STREET):
Ayano Masuda
Product amount:
¥1,800
quantity:
1`;

test('parses two product rows and keeps postage separate', () => {
  const result = parseOrders(sample);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.orders.length, 1);
  const [order] = result.orders;
  assert.equal(order.orderNo, 'SAMPLE-001');
  assert.equal(order.date, 'September 18, 2026 20:00');
  assert.equal(order.currency, 'JPY');
  assert.equal(order.subtotal, 8300);
  assert.equal(order.postage, 880);
  assert.equal(order.total, 9180);
  assert.equal(order.items.length, 2);
  assert.equal(order.items[0].name, 'CUTIE STREET OSHI API UNIFORM');
  assert.equal(order.items[1].name, 'CUTIE STREET OFFICIAL FAN LIGHT CUSTOM CHARM');
  assert.equal(order.items[0].option, 'Members (CUTIE STREET): Ayano Masuda');
  assert.equal(order.items[0].imageUrl, 'https://example.test/uniform.jpg');
  assert.equal(order.items.reduce((sum, item) => sum + item.amount, 0), 8300);
});

test('supports plain clipboard text without image links and wrapped amount label', () => {
  const input = sample.replace(/\[image\]\([^)]*\)/g, '').replace('Product amount:', 'Product amoun\nt:');
  const result = parseOrders(input);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.orders[0].items.length, 2);
  assert.equal(result.orders[0].items[0].name, 'CUTIE STREET OSHI API UNIFORM');
  assert.equal(result.orders[0].items[0].imageUrl, '');
  assert.equal(result.orders[0].items[0].amount, 6500);
});

test('keeps multiple concatenated orders separate and flags duplicate IDs', () => {
  const result = parseOrders(`${sample}\n\n${sample.replace('SAMPLE-001', 'SAMPLE-002')}`);
  assert.equal(result.orders.length, 2);
  assert.deepEqual(result.orders.map(order => order.items.length), [2, 2]);
  assert.equal(result.orders[1].items[0].orderNo, 'SAMPLE-002');
  assert.deepEqual(result.warnings, []);
  assert.match(parseOrders(`${sample}\n${sample}`).warnings.join(' '), /같은 주문번호/);
});

test('quantity greater than one never divides or multiplies the raw amount', () => {
  const result = parseOrders(sample.replace('quantity:\n1', 'quantity: 3'));
  assert.equal(result.orders[0].items[0].quantity, 3);
  assert.equal(result.orders[0].items[0].amount, 6500);
});

test('retains malformed item and warns instead of dropping it', () => {
  const result = parseOrders(sample.replace('quantity:\n1', 'quantity:\nzero').replace('¥6,500', 'unknown'));
  assert.equal(result.orders[0].items.length, 2);
  assert.equal(result.orders[0].items[0].amount, null);
  assert.equal(result.orders[0].items[0].quantity, null);
  assert.equal(result.orders[0].items[1].name, 'CUTIE STREET OFFICIAL FAN LIGHT CUSTOM CHARM');
  assert.ok(result.warnings.some(warning => warning.includes('상품금액')));
  assert.ok(result.warnings.some(warning => warning.includes('수량')));
});

test('missing quantity does not consume the following product', () => {
  const result = parseOrders(sample.replace('quantity:\n1\n-', '-'));
  assert.equal(result.orders[0].items[0].quantity, null);
  assert.equal(result.orders[0].items[1].amount, 1800);
  assert.equal(result.orders[0].items[1].name, 'CUTIE STREET OFFICIAL FAN LIGHT CUSTOM CHARM');
  assert.ok(result.warnings.some(warning => warning.includes('수량')));
});

test('missing Product amount for an item creates an explicit warning', () => {
  const result = parseOrders(sample.replace('Product amount:\n¥6,500\n', ''));
  assert.ok(result.warnings.some(warning => warning.includes('금액이 누락된 상품')));
});

test('rejects missing details and does not invent a valid order', () => {
  assert.equal(parseOrders('').orders.length, 0);
  const result = parseOrders('Order No. EMPTY-001\nOrdered items\nNo products');
  assert.equal(result.orders[0].items.length, 0);
  assert.ok(result.warnings.some(warning => warning.includes('상품을 찾지 못')));
  const withoutId = parseOrders('merchandise\nT SHIRT\nProduct amount: ￥1,234\nquantity: 2');
  assert.equal(withoutId.orders[0].orderNo, '');
  assert.equal(withoutId.orders[0].items[0].amount, 1234);
  assert.ok(withoutId.warnings.some(warning => warning.includes('주문번호를 찾지 못')));
});

test('extracts linked title URL and supports inline amounts and decimal prices', () => {
  const result = parseOrders('Order No. INLINE-001\nOrdered items\nmerchandise\n[PRODUCT NAME](https://example.test/product/1)\nColor: blue\nSize: M\nProduct amount: ¥1,234.50\nquantity: 2');
  const item = result.orders[0].items[0];
  assert.equal(item.name, 'PRODUCT NAME');
  assert.equal(item.productUrl, 'https://example.test/product/1');
  assert.equal(item.option, 'Color: blue Size: M');
  assert.equal(item.color, 'blue');
  assert.equal(item.size, 'M');
  assert.equal(item.amount, 1234.5);
  assert.equal(item.quantity, 2);
});

test('keeps multiline color and size values in separate semantic fields for each product', () => {
  const input = `Order No. OPTIONS-001
Ordered items
merchandise
T SHIRT
Color:
Blue
Size:
XL
Product amount: ¥2,500
quantity: 1
T SHIRT SECOND
カラー：
Red
サイズ：
S
Members (CUTIE STREET):
Ayano Masuda
Product amount: ¥1,800
quantity: 2`;
  const result = parseOrders(input);
  assert.deepEqual(result.warnings, []);
  const [first, second] = result.orders[0].items;
  assert.equal(first.name, 'T SHIRT');
  assert.equal(first.color, 'Blue');
  assert.equal(first.size, 'XL');
  assert.equal(first.option, 'Color: Blue Size: XL');
  assert.equal(second.name, 'T SHIRT SECOND');
  assert.equal(second.color, 'Red');
  assert.equal(second.size, 'S');
  assert.equal(second.option, 'カラー： Red サイズ： S Members (CUTIE STREET): Ayano Masuda');
  assert.equal(second.amount, 1800);
  assert.equal(second.quantity, 2);
});

test('inline color/size labels separate correctly and members-only options allow caller fallback', () => {
  const result = parseOrders('Order No. INLINE-OPTIONS\nOrdered items\nmerchandise\nPRODUCT\nColour: Navy Size: L\nProduct amount: ¥1,000\nquantity: 1');
  assert.equal(result.orders[0].items[0].color, 'Navy');
  assert.equal(result.orders[0].items[0].size, 'L');
  const membersItem = parseOrders(sample).orders[0].items[0];
  assert.equal(membersItem.color, undefined);
  assert.equal(membersItem.size, undefined);
  assert.equal(membersItem.option, 'Members (CUTIE STREET): Ayano Masuda');
});

const markdownImagePrefix = 'https://images.groobee.com/images/asobisystem/';
const markdownProducts12 = [
  ['CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)', 5700, '', 'fCyUk9HXzu5poGTsjxdR4pKQFEhPDQr1vNdZjSVO.jpg'],
  ['CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -', 1500, 'Ayano Masuda', 'Q8N79uj2CPuleC36wIbnr1SXY7MJOIFtTZIhyb3m.jpg'],
  ['CUTIE STREET Member-Specific Acrylic Stands -Cute Cute Taiko Outfit Version-', 1500, 'Ayano Masuda', 'p9BYdqyLiCy1wAam8H0ILLiqprjKe7JqMCy1SJ48.jpg'],
  ['Ayano Masuda Birthday Celebration 2026 Acrylic Keychain (Birthday Outfit Ver.)', 1200, '', 'hi39lIlzWlayif2qo7x8BMYW370yjo8i1SKlcAD5.jpg'],
  ['Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Birthday Outfit Ver.)', 1500, '', 'cQiEsVqzyObVOCpxv0iB8bNId9xIeHciL6luYoAB.jpg'],
  ['Ayano Masuda Birthday Celebration 2026 Acrylic Stand (Revealed Outfit Version)', 1500, '', 'Aye8bMXJbexVhz0mJXrRI3a5bApWYtlbpEO9mAtv.jpg'],
  ['Ayano Masuda Birthday Celebration 2026: Ayano Only ChooseMe Set', 2000, '', 'rbpolF3ZI9WyJhRXBnlgydfGVom9UT2T4m7qHi0v.jpg'],
  ['CUTIE STREET Member-Specific Acrylic Stands -Rose Ribbon Outfit Ver.- (8 types in total)', 1500, 'Ayano Masuda', '8HpBduX0CA4tyxF86ZDKBfNx4vzkDihATznFlXyM.jpg'],
  ['CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)', 400, 'Aika Sano', 'OPjy6FUiCHRdUxkwDBUSvFhuRNoAPKr0RBIZWyrp.jpg'],
  ['CUTIE STREET Photo Set (2 L-size photos) -KL Summer Festival 2026 Costume Edition- (8 types in total)', 400, 'Ayano Masuda', 'OPjy6FUiCHRdUxkwDBUSvFhuRNoAPKr0RBIZWyrp.jpg'],
  ['CUTIE STREET Member-Specific Acrylic Stands -KL Summer Festival 2026 Outfit Edition- (8 types in total)', 1500, 'Ayano Masuda', 'iNSCEDgijM6iGad5dofB0sR5LlrbZU2Zg4xAtJA2.jpg'],
  ['CUTIE STREET Member-Specific Acrylic Stands -Street Outfit Ver.-', 1500, 'Ayano Masuda', 'X1l3A6bvetTx7sXipk7qtVVBQ37YcqfTiUOB6GHk.jpg'],
];

// Only public product data and a deliberately synthetic order/address header.
// Exported so the same fixture can be copied into an ignored local browser QA file.
export const markdownOrder12 = [
  '## Order No. SAMPLE-MARKDOWN-12',
  '- Order date', '**October 30, 2026 12:00**\\',
  '- Amount due', '**¥21,080**',
  '## Payment amount', 'subtotal', '**¥20,200**', 'postage', '**¥880**', 'Amount due', '**¥21,080**',
  '## Ordered items', '### Shipping status: Preparing for shipment', '1.', '1. 1.',
  '## Delivery address', '**SAMPLE RECIPIENT**', '- SAMPLE ADDRESS BLOCK', 'Phone number: 0000000000',
  '## merchandise',
  ...markdownProducts12.flatMap(([name, amount, member, image]) => [
    '-', '', `* [**image**](${markdownImagePrefix}${image})`, `* **${name}**`, '',
    ...(member ? ['Members (CUTIE STREET):', `**${member}**`] : []),
    'Product amount:', `**¥${amount.toLocaleString('en-US')}**`, 'quantity:', '**1**',
  ]),
].join('\n');

test('parses the 12-product Markdown clipboard with typed totals, clean names and distinct members', () => {
  const result = parseOrders(markdownOrder12);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.orders.length, 1);
  const [order] = result.orders;
  assert.equal(order.orderNo, 'SAMPLE-MARKDOWN-12');
  assert.equal(order.date, 'October 30, 2026 12:00');
  assert.equal(order.currency, 'JPY');
  assert.equal(order.subtotal, 20200);
  assert.equal(order.postage, 880);
  assert.equal(order.total, 21080);
  assert.equal(order.items.length, 12);
  assert.equal(order.items.reduce((sum, item) => sum + item.amount * item.quantity, 0), 20200);
  for (const [index, item] of order.items.entries()) {
    const [name, amount, member, image] = markdownProducts12[index];
    assert.equal(item.name, name);
    assert.equal(item.amount, amount);
    assert.equal(typeof item.amount, 'number');
    assert.equal(item.quantity, 1);
    assert.equal(typeof item.quantity, 'number');
    assert.equal(item.imageUrl, markdownImagePrefix + image);
    assert.equal(item.option, member ? `Members (CUTIE STREET): ${member}` : '');
    assert.doesNotMatch(item.name, /\*\*|^#{1,6}\s|SAMPLE ADDRESS|SAMPLE RECIPIENT/);
  }
  assert.equal(order.items[8].name, order.items[9].name);
  assert.equal(order.items[8].imageUrl, order.items[9].imageUrl);
  assert.notEqual(order.items[8].option, order.items[9].option, 'Two purchases with the same image must retain their different member options.');
});

test('cleans headings, paired emphasis, numbered lists, hard breaks and HTML whitespace entities', () => {
  const input = [
    '# **Order No. MARKDOWN-FORMATS**',
    '- **Order date:**', '*October 30, 2026 12:00*\\',
    '## **Payment amount**', '- **subtotal:** **¥1,000**', '- **postage:** _¥80_', '- **Amount due:** **¥1,080**',
    '### **Ordered items**', '### merchandise ###',
    '1. 1. * **FORMATTED PRODUCT**',
    '**Members (CUTIE STREET):**&#x20;', '**Ayano Masuda**&nbsp;',
    '- **Product amount:**&#32;**¥1,000**', '- **quantity:**&#xA0;*1*',
  ].join('\n');
  const result = parseOrders(input);
  assert.deepEqual(result.warnings, []);
  const [order] = result.orders;
  assert.equal(order.date, 'October 30, 2026 12:00');
  assert.equal(order.subtotal, 1000);
  assert.equal(order.postage, 80);
  assert.equal(order.total, 1080);
  assert.equal(order.items[0].name, 'FORMATTED PRODUCT');
  assert.equal(order.items[0].option, 'Members (CUTIE STREET): Ayano Masuda');
  assert.equal(order.items[0].amount, 1000);
  assert.equal(order.items[0].quantity, 1);
});

test('preserves meaningful name asterisks and URL paths/queries while cleaning link label emphasis', () => {
  const imageUrl = 'https://images.groobee.com/images/asobisystem/A*STAR_001(v2).jpg?width=200&member=A_B&tag=**KEEP**';
  const productUrl = 'https://asobisystem.shop/products/A*STAR_01?ref=A_B&literal=**KEEP**';
  const input = `## Order No. URL-MARKDOWN\n## Ordered items\n## merchandise\n* [**image**](${imageUrl})\n* [**A*STAR / MEMBER_SPECIFIC**](${productUrl})\n**Product amount:** **¥1,200**\n**quantity:** **1**`;
  const result = parseOrders(input);
  assert.deepEqual(result.warnings, []);
  const [item] = result.orders[0].items;
  assert.equal(item.name, 'A*STAR / MEMBER_SPECIFIC');
  assert.equal(item.imageUrl, imageUrl);
  assert.equal(item.productUrl, productUrl);
  const escaped = parseOrders('Order No. ESCAPED-STARS\nmerchandise\n**A\\*STAR and \\*LITERAL\\***\nProduct amount: **¥100**\nquantity: **1**');
  assert.equal(escaped.orders[0].items[0].name, 'A*STAR and *LITERAL*');
});

test('keeps Markdown orders separate and accepts bold inline prices and quantities', () => {
  const second = '# *Order No. SECOND-MARKDOWN*\n## **Ordered items**\n### *merchandise*\n2. 3. **SECOND PRODUCT**\n- **Product amount:** **¥1,000**\n- **quantity:** *2*';
  const result = parseOrders(`${markdownOrder12}\n\n${second}`);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.orders.length, 2);
  assert.deepEqual(result.orders.map(order => order.items.length), [12, 1]);
  assert.equal(result.orders[1].orderNo, 'SECOND-MARKDOWN');
  assert.equal(result.orders[1].items[0].name, 'SECOND PRODUCT');
  assert.equal(result.orders[1].items[0].amount, 1000);
  assert.equal(result.orders[1].items[0].quantity, 2);
});

test('malformed digit grouping is flagged instead of silently changing a product price', () => {
  for (const price of ['¥1,2,3', '¥1,,500', '¥12,34', '¥1,000,', '¥1 500']) {
    const result = parseOrders(`Order No. PRICE-AUDIT\nmerchandise\nTEST PRODUCT\nProduct amount: ${price}\nquantity: 1`);
    assert.equal(result.orders[0].items[0].amount, null, price);
    assert.ok(result.warnings.some(warning => warning.includes('상품금액')), price);
  }
  const valid = parseOrders('Order No. PRICE-VALID\nmerchandise\nTEST PRODUCT\nProduct amount: ¥1,234,567.50\nquantity: 1');
  assert.equal(valid.orders[0].items[0].amount, 1234567.5);
  assert.deepEqual(valid.warnings, []);
});

test('an empty order number never consumes the next field or hides another order', () => {
  const result = parseOrders('Order No.\nOrder date\nOctober 31, 2026 12:00\nOrdered items\nmerchandise\nFIRST PRODUCT\nProduct amount: ¥1000\nquantity: 1\nOrder No. VALID-SECOND\nOrdered items\nmerchandise\nSECOND PRODUCT\nProduct amount: ¥2000\nquantity: 2');
  assert.deepEqual(result.orders.map(order => order.orderNo), ['', 'VALID-SECOND']);
  assert.deepEqual(result.orders.map(order => order.items[0].name), ['FIRST PRODUCT', 'SECOND PRODUCT']);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /주문번호를 찾지 못/);
  const nextLineId = parseOrders('Order No.\nVALID-NEXT-LINE\nmerchandise\nTEST PRODUCT\nProduct amount: ¥1000\nquantity: 1');
  assert.equal(nextLineId.orders[0].orderNo, 'VALID-NEXT-LINE');
  assert.deepEqual(nextLineId.warnings, []);
});

test('a quantity beyond the next product prelude cannot be assigned to an incomplete first product', () => {
  const source = 'Order No. INCOMPLETE-ITEMS\nmerchandise\n[image](https://example.test/first.jpg)\nFIRST PRODUCT\nProduct amount: ¥1000\n[image](https://example.test/second.jpg)\nSECOND PRODUCT\nquantity: 2';
  for (const input of [source, source.replace(/\[image\]\([^)]*\)\n/g, '')]) {
    const result = parseOrders(input);
    assert.equal(result.orders[0].items[0].name, 'FIRST PRODUCT');
    assert.equal(result.orders[0].items[0].amount, 1000);
    assert.equal(result.orders[0].items[0].quantity, null);
    assert.ok(result.warnings.some(warning => warning.includes('수량')));
  }
});
