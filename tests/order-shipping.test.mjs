import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {CARRIERS, resolveOrderShipping} from '../dist/order-shipping.mjs';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

const configs = Object.fromEntries(await Promise.all(['general', 'hoottown-fast'].map(async kind => [kind,
  JSON.parse(await fs.readFile(new URL(`../dist/${kind === 'general' ? 'general' : 'fast'}-config.json`, import.meta.url), 'utf8')),
])));
const order = Object.freeze({orderNo: 'SAMPLE-LATER', shippingEntry: 'later', tracking: '000111222333', carrierKey: 'japanpost'});
const cell = (xml, address) => xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';

test('later Hoottown entry uses the registered Japanese ETC carrier and hides previously typed tracking', () => {
  for (const kind of ['general', 'hoottown-fast']) {
    assert.deepEqual(resolveOrderShipping(order, kind), {tracking: '', carrier: '[일본]기타 운송사(ETC)', localCarrier: ''});
    const registered = configs[kind].lists.carriers.find(c => c.label === CARRIERS.other.hoottown);
    assert.equal(registered.code, 35);
    assert.equal(registered.center, '일본');
  }
  assert.equal(order.tracking, '000111222333');
  assert.equal(order.carrierKey, 'japanpost');
});

test('switching back to now restores each actual carrier and leading-zero tracking without mutating the order', () => {
  for (const [carrierKey, carrier] of Object.entries(CARRIERS)) {
    const now = Object.freeze({...order, shippingEntry: 'now', carrierKey});
    assert.deepEqual(resolveOrderShipping(now, 'general'), {tracking: order.tracking, carrier: carrier.hoottown, localCarrier: carrier.jimpass});
    assert.deepEqual(resolveOrderShipping(now, 'hoottown-fast'), resolveOrderShipping(now, 'general'));
    assert.equal(resolveOrderShipping({...now, shippingEntry: 'later'}, 'general').carrier, CARRIERS.other.hoottown);
    assert.equal(resolveOrderShipping(now, 'general').tracking, order.tracking);
  }
  assert.equal(resolveOrderShipping({...order, shippingEntry: 'now', carrierKey: ''}, 'general').carrier, '');
});

test('Jimpass and Postmall deferred entry keep their existing blank shipping behavior', () => {
  for (const kind of ['jimpass', 'postmall']) assert.deepEqual(resolveOrderShipping(order, kind), {tracking: '', carrier: '', localCarrier: ''});
  assert.equal(resolveOrderShipping({...order, shippingEntry: 'now'}, 'jimpass').localCarrier, '우체국');
  assert.deepEqual(resolveOrderShipping({...order, shippingEntry: 'now'}, 'postmall'), {tracking: order.tracking, carrier: '', localCarrier: ''});
});

for (const kind of ['general', 'hoottown-fast']) test(`${kind} real XLSX writes blank tracking, ETC in F and numeric carrier code 35 with the original G formula`, async () => {
  const templateBytes = new Uint8Array(await fs.readFile(new URL(`../dist/templates/${kind}.xlsx`, import.meta.url)));
  const rows = [
    {...order, name: 'SAMPLE DEFERRED GOODS', quantity: 10, unitPrice: 500, category: '291', ...resolveOrderShipping(order, kind)},
    {orderNo: 'SAMPLE-NOW', name: 'SAMPLE KNOWN CARRIER', quantity: 2, unitPrice: 200, category: '105', ...resolveOrderShipping({...order, shippingEntry: 'now'}, kind)},
  ];
  const before = structuredClone(rows);
  const files = unzipSync(exportWorkbook({template: kind, templateBytes, config: configs[kind], items: rows,
    profile: {center: '일본', tracking: '000999888777', carrier: CARRIERS.yamato.hoottown}}));
  const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.doesNotMatch(cell(xml, 'E11'), /<v>|<is>/);
  assert.match(cell(xml, 'F11'), /t="inlineStr".*>\[일본\]기타 운송사\(ETC\)<\/t>/);
  assert.match(cell(xml, 'G11'), /<f>.*F11.*<\/f><v>35<\/v>/);
  assert.doesNotMatch(cell(xml, 'G11'), /\bt=/);
  assert.match(cell(xml, 'E12'), />000111222333<\/t>/);
  assert.match(cell(xml, 'F12'), /JAPAN POST/);
  assert.match(cell(xml, 'G12'), /<v>31<\/v>/);
  assert.match(cell(xml, kind === 'general' ? 'AJ11' : 'AH11'), /<v>10<\/v>/);
  assert.deepEqual(rows, before);
});
