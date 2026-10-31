import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

const config = JSON.parse(await fs.readFile(new URL('../dist/postmall-config.json', import.meta.url), 'utf8'));
const templateBytes = new Uint8Array(await fs.readFile(new URL('../dist/templates/postmall.xlsx', import.meta.url)));
const source = unzipSync(templateBytes), sourceXml = strFromU8(source['xl/worksheets/sheet1.xml']);
const profile = {recipient: '샘플 수취인', phone: '010-0000-0000', postal: '01234', address: '샘플 기본주소와 상세주소', customs: 'P000000000000', brand: 'ASOBISYSTEM', courierNote: '샘플 배송 요청'};
const item = {name: "ARTIST'S T-SHIRT - SAMPLE 2026", color: 'Ayano Masuda', size: 'L', quantity: 3, unitPrice: 19.99, orderNo: 'SAMPLE-POSTMALL-A', orderIndex: 0,
  category: '291', postmallHsCode: '0101.21', imageUrl: 'https://example.test/image.jpg?a=1&b=2', productUrl: 'https://example.test/product?quoted="x"&token=$&', tracking: '000123456789'};

function row(xml, number) { return xml.match(new RegExp(`<row\\b(?=[^>]*\\br="${number}")[^>]*>[\\s\\S]*?<\\/row>`))?.[0] ?? ''; }
function cell(xml, address) { return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? ''; }
function decoded(value) { return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function text(xml, address) { return decoded([...cell(xml, address).matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join('')); }
function number(xml, address) { const entry = cell(xml, address); assert.doesNotMatch(entry, /\bt=/); return Number(entry.match(/<v>([^<]+)<\/v>/)?.[1]); }
function generate(items = [item], overriddenProfile = {}) { return unzipSync(exportWorkbook({template: 'postmall', templateBytes, items, profile: {...profile, ...overriddenProfile}, config})); }
function main(files) { return strFromU8(files['xl/worksheets/sheet1.xml']); }

test('Postmall writes one horizontal row per order index, preserving common fields and typed item values', () => {
  const items = [item, {...item, name: 'SECOND PRODUCT', quantity: 1, unitPrice: 1500}, {...item, name: 'OTHER ORDER PRODUCT', orderIndex: 1, orderNo: 'SAMPLE-POSTMALL-B', quantity: 2, unitPrice: 500}];
  const xml = main(generate(items));
  assert.equal(text(xml, 'A4'), profile.recipient); assert.equal(text(xml, 'B4'), profile.phone);
  assert.equal(text(xml, 'C4'), 'SAMPLE-POSTMALL-A'); assert.equal(text(xml, 'C5'), 'SAMPLE-POSTMALL-B');
  for (const [column, value] of [['D', profile.customs], ['E', profile.recipient], ['F', '01234'], ['G', profile.address], ['H', profile.courierNote], ['I', profile.phone]]) assert.equal(text(xml, `${column}4`), value);
  assert.equal(text(xml, 'V4'), item.name); assert.equal(text(xml, 'W4'), profile.brand);
  assert.equal(text(xml, 'X4'), item.color); assert.equal(text(xml, 'Y4'), 'L');
  assert.equal(number(xml, 'Z4'), 3); assert.equal(number(xml, 'AA4'), 19.99); assert.equal(number(xml, 'AB4'), 59.97);
  assert.equal(text(xml, 'AC4'), '010121'); assert.equal(text(xml, 'AD4'), item.imageUrl); assert.equal(text(xml, 'AE4'), item.productUrl); assert.equal(text(xml, 'AF4'), '000123456789');
  assert.equal(text(xml, 'AG4'), 'SECOND PRODUCT'); assert.equal(number(xml, 'AK4'), 1); assert.equal(number(xml, 'AM4'), 1500);
  assert.equal(text(xml, 'V5'), 'OTHER ORDER PRODUCT'); assert.equal(number(xml, 'AB5'), 1000);
  assert.doesNotMatch(row(xml, 6), /<v>|<is>|<f\b/);
});

test('duplicate source order numbers stay separate when indexes differ, with order-number fallback otherwise', () => {
  const indexed = main(generate([{...item, orderIndex: 0}, {...item, orderIndex: 1}]));
  assert.equal(text(indexed, 'V4'), item.name); assert.equal(text(indexed, 'V5'), item.name);
  assert.equal(text(indexed, 'C4'), text(indexed, 'C5'));
  const fallback = main(generate([{...item, orderIndex: undefined}, {...item, orderIndex: undefined, orderNo: 'SAMPLE-SECOND'}, {...item, orderIndex: undefined, name: 'NONADJACENT SAME ORDER'}]));
  assert.equal(text(fallback, 'AG4'), 'NONADJACENT SAME ORDER'); assert.equal(text(fallback, 'C5'), 'SAMPLE-SECOND');
});

test('twenty item slots reach column IG and a twenty-first product is rejected instead of split or dropped', () => {
  const items = Array.from({length: 20}, (_, index) => ({...item, name: `SAMPLE PRODUCT ${index + 1}`, quantity: 1, unitPrice: index + 1, tracking: String(index + 1).padStart(8, '0')}));
  const xml = main(generate(items));
  assert.equal(text(xml, 'HW4'), 'SAMPLE PRODUCT 20'); assert.equal(number(xml, 'IA4'), 1);
  assert.equal(number(xml, 'IB4'), 20); assert.equal(number(xml, 'IC4'), 20); assert.equal(text(xml, 'IG4'), '00000020');
  assert.ok(cell(xml, 'IG4')); assert.ok(!cell(xml, 'IH4'));
  assert.throws(() => generate([...items, {...item, name: 'TWENTY FIRST PRODUCT'}]), /최대 20개/);
});

test('paid options require explicit Postmall flags, packing uses A/B/C, and Japanese FTA stays blank', () => {
  const plain = main(generate([item], {inspection: 'Y', businessCustoms: 'Y', packingReinforce: 'Y'}));
  for (const column of ['J', 'K', 'L', 'M', 'N', 'O', 'Q', 'R', 'S', 'T', 'U']) assert.doesNotMatch(cell(plain, `${column}4`), /<v>|<is>/);
  assert.equal(text(plain, 'P4'), 'A');
  const configured = main(generate([item], {postmallBuyerName: '샘플 주문자', postmallBuyerPhone: '00000123456', postmallCustomsType: 'F', postmallPackaging: 'B', postmallInspection: true, postmallAircap: 'T', postmallReinforce: 'TRUE', postmallBusiness: true,
    postmallInvoiceRemove: 'T', postmallHangerRemove: true, postmallAutomaticRelease: 'T', postmallSplitBoxes: true, postmallSplitPolybag: 'T', postmallFtaClearance: true}));
  assert.equal(text(configured, 'A4'), '샘플 주문자'); assert.equal(text(configured, 'B4'), '00000123456');
  assert.equal(text(configured, 'J4'), 'F'); assert.equal(text(configured, 'P4'), 'B');
  for (const column of ['K', 'L', 'M', 'N', 'Q', 'R', 'S', 'T', 'U']) assert.equal(text(configured, `${column}4`), 'T');
  assert.doesNotMatch(cell(configured, 'O4'), /<v>|<is>/);
  const repacked = main(generate([item], {postmallCustomsType: 'B', postmallPackaging: 'C'}));
  assert.equal(text(repacked, 'J4'), 'B'); assert.equal(text(repacked, 'P4'), 'C');
  assert.throws(() => generate([item], {postmallCustomsType: 'Y'}), /통관 구분/);
  assert.throws(() => generate([item], {postmallPackaging: 'Y'}), /포장 방식/);
});

test('HS uses only explicit HS fields and preserves leading zeroes without borrowing other forwarder codes', () => {
  const blank = main(generate([{...item, postmallHsCode: undefined, hsCode: undefined, category: '124', tracking: ''}]));
  assert.doesNotMatch(cell(blank, 'AC4'), /<v>|<is>/); assert.doesNotMatch(cell(blank, 'AF4'), /<v>|<is>/);
  const cleared = main(generate([{...item, postmallHsCode: '', hsCode: '640299'}]));
  assert.doesNotMatch(cell(cleared, 'AC4'), /<v>|<is>/);
  for (const [input, expected] of [['０１０１．２１', '010121'], ['6402.9900', '64029900'], ['6402 9900 00', '6402990000']]) assert.equal(text(main(generate([{...item, postmallHsCode: input}])), 'AC4'), expected);
  for (const hs of ['291', '124', '64029A', '640299123456']) assert.throws(() => generate([{...item, postmallHsCode: hs}]), /HS CODE/);
});

test('literal XML, formula-like input, source data and template formatting remain intact', () => {
  const name = '=HYPERLINK("https://example.test","literal")', note = '$& $` $\' <tag> & quoted';
  const items = [{...item, name, postmallHsCode: '', productUrl: 'https://example.test/?a=$&b="quoted"'}];
  const before = JSON.stringify(items), bytesBefore = new Uint8Array(templateBytes);
  const files = generate(items, {courierNote: note}), xml = main(files);
  assert.equal(text(xml, 'V4'), name); assert.equal(text(xml, 'H4'), note); assert.equal(text(xml, 'AE4'), items[0].productUrl);
  assert.doesNotMatch(row(xml, 4), /<f\b/);
  assert.equal(JSON.stringify(items), before); assert.deepEqual(templateBytes, bytesBefore);
  for (const number of [1, 2, 3]) assert.equal(row(xml, number), row(sourceXml, number));
  assert.equal(cell(xml, 'Z4').match(/s="(\d+)"/)?.[1], cell(sourceXml, 'Z4').match(/s="(\d+)"/)?.[1]);
  assert.equal(strFromU8(files['xl/styles.xml']), strFromU8(source['xl/styles.xml']));
  assert.equal(xml.match(/<mergeCells\b[\s\S]*?<\/mergeCells>/)?.[0], sourceXml.match(/<mergeCells\b[\s\S]*?<\/mergeCells>/)?.[0]);
  for (const key of Object.keys(source).filter(key => /comment|vml/i.test(key))) assert.deepEqual(files[key], source[key]);
  assert.throws(() => generate([{...item, name: 'BAD\u0000NAME'}]), /저장할 수 없는 문자/);
});

test('the delivered Postmall template contains no input samples or orphan shared-string examples', () => {
  assert.equal(createHash('sha256').update(templateBytes).digest('hex'), config.sanitizedTemplateSha256);
  for (const matched of sourceXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
    const number = Number(matched[0].match(/\br="(\d+)"/)?.[1]);
    if (number >= 4) assert.doesNotMatch(matched[0], /<v>|<is>|<f\b/);
  }
  const shared = strFromU8(source['xl/sharedStrings.xml']);
  const headerRefs = new Set([...sourceXml.matchAll(/<c\b[^>]*\bt="s"[^>]*><v>(\d+)<\/v><\/c>/g)].map(match => Number(match[1])));
  const entries = [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)];
  entries.forEach((entry, index) => { if (/<t\b[^>]*>[^<]+<\/t>/.test(entry[1])) assert.ok(headerRefs.has(index), `Unreferenced example string ${index} must be removed.`); });
});
