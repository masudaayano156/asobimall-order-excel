import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {getFixedShippingErrors} from '../dist/fixed-shipping.mjs';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

const general = JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8'));
const fast = JSON.parse(await fs.readFile(new URL('../dist/fast-config.json', import.meta.url), 'utf8'));
const profile = {center: '일본', fixedShippingCode: '28'};
const item = {orderNo: 'SAMPLE-A', tracking: '000111222333', category: '124', quantity: 1, unitPrice: 1000, name: 'SAMPLE PLUSH DOLL'};
const errors = (items, overrides = {}) => getFixedShippingErrors({template: 'hoottown-fast', items, profile, config: fast, ...overrides});

const decodeText = value => value.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const xmlCell = (xml, address) => xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';

test('the preserved original headers restrict Excel fixed-rate requests to one product and quantity one', async () => {
  for (const [filename, address, config] of [['general.xlsx', 'AW10', general], ['hoottown-fast.xlsx', 'AK10', fast]]) {
    const files = unzipSync(new Uint8Array(await fs.readFile(new URL(`../dist/templates/${filename}`, import.meta.url))));
    const header = xmlCell(strFromU8(files['xl/worksheets/sheet1.xml']), address);
    const strings = files['xl/sharedStrings.xml'] ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(match => decodeText(match[1])) : [];
    const text = /\bt="s"/.test(header) ? strings[Number(header.match(/<v>(\d+)<\/v>/)?.[1])] : decodeText(header);
    assert.match(text, /단,\s*상품\s*단건\s*및\s*수량\s*1개인\s*경우에만\s*엑셀\s*고정배송비\s*신청\s*가능/);
    assert.equal(text.replace(/\r\n?/g, '\n'), config.headers.find(entry => entry.column === address.replace(/\d+$/, '')).label);
  }
});

test('fixed rates remain optional and do not affect Jimpass or empty selections', () => {
  assert.deepEqual(getFixedShippingErrors(), []);
  assert.deepEqual(errors([]), []);
  assert.deepEqual(errors([{...item, quantity: 2}], {profile: {center: '일본', fixedShippingCode: ''}}), []);
  assert.deepEqual(errors([item], {template: 'jimpass'}), []);
});

test('each Japanese QUICK rate accepts its actual single-item category with quantity one', () => {
  for (const [code, category] of [['9', '142'], ['10', '143'], ['28', '124'], ['31', '121']]) {
    assert.deepEqual(errors([{...item, category, fixedShippingCode: code}]), []);
  }
});

test('the reported eight-product doll-rate selection is rejected without changing product categories', () => {
  const rows = ['012', '076', '105', '151', '151', '076', '105', '151'].map((category, index) => ({...item, name: `SAMPLE PRODUCT ${index + 1}`, category}));
  const original = JSON.stringify(rows), result = errors(rows);
  assert.equal(result.length, rows.length + 1);
  assert.ok(result.some(message => message.includes('코드 28') && message.includes('124')));
  assert.ok(result.some(message => message.includes('상품 단건 및 수량 1개')));
  assert.equal(JSON.stringify(rows), original);
  assert.ok(errors([{...item, quantity: 2}]).some(message => message.includes('상품 단건 및 수량 1개')));
});

test('a fixed-rate request constrains the whole tracking group including blank-rate rows and nonadjacent orders', () => {
  const rows = [{...item, orderNo: 'SAMPLE-A'}, {...item, orderNo: 'SAMPLE-B', fixedShippingCode: ''}];
  assert.ok(errors(rows).some(message => message.includes('상품 단건 및 수량 1개')));
  const nonadjacent = [rows[0], {...item, orderNo: 'SAMPLE-C', tracking: '000999', fixedShippingCode: ''}, rows[1]];
  assert.equal(errors(nonadjacent).filter(message => message.includes('상품 단건 및 수량 1개')).length, 1);
  assert.deepEqual(errors([{...item, orderNo: 'SAMPLE-A', tracking: ''}, {...item, orderNo: 'SAMPLE-B', tracking: ''}]), []);
  assert.deepEqual(errors(rows.map(row => ({...row, quantity: 3, fixedShippingCode: ''}))), []);
});

test('per-item blank overrides clear common rates while nullish values inherit them', () => {
  assert.deepEqual(errors([{...item, category: '012', quantity: 2, fixedShippingCode: ''}]), []);
  assert.deepEqual(errors([{...item, fixedShippingCode: null}]), []);
  assert.deepEqual(errors([{...item, fixedShippingCode: undefined}]), []);
  assert.ok(errors([{...item, fixedShippingCode: '999'}]).some(message => message.includes('원본 양식')));
  assert.ok(errors([{...item, fixedShippingCode: '0'}]).some(message => message.includes('원본 양식')));
});

test('center, service and declared category must all agree with the original rate table', () => {
  assert.ok(errors([item], {profile: {center: '미국OR', fixedShippingCode: '28'}}).some(message => message.includes('일본 센터용')));
  assert.ok(errors([item], {template: 'general', config: general}).some(message => message.includes('일반 배송에서 지원되지')));
  assert.ok(errors([{...item, category: '151'}]).some(message => message.includes('대상 품목은 124')));
  assert.ok(errors([item], {config: undefined}).some(message => message.includes('원본 양식')));
  assert.deepEqual(errors([{...item, category: '248'}], {template: 'general', config: general, profile: {center: '미국OR', fixedShippingCode: '11'}}), []);
  assert.deepEqual(errors([{...item, category: '057'}], {profile: {center: '미국OR', fixedShippingCode: '19'}}), []);
});

test('General order groups and QUICK tracking groups apply the limit only when requesting a fixed rate', () => {
  const rows = ['SAMPLE-A', 'SAMPLE-B', 'SAMPLE-A'].map(orderNo => ({...item, orderNo, category: '248'}));
  assert.deepEqual(errors(rows, {template: 'general', config: general, profile: {center: '미국OR', fixedShippingCode: '11'}}), []);
  assert.ok(errors(rows.map(row => ({...row, category: '124'}))).some(message => message.includes('상품 단건 및 수량 1개')));
  const twelve = Array.from({length: 12}, (_, index) => ({...item, orderNo: `SAMPLE-${index}`}));
  assert.equal(errors(twelve).filter(message => message.includes('상품 단건 및 수량 1개')).length, 1);
  assert.deepEqual(errors(twelve.map(row => ({...row, quantity: 2})), {profile: {...profile, fixedShippingCode: ''}}), []);
  assert.ok(errors([{...item, category: '248', quantity: 2}], {template: 'general', config: general, profile: {center: '미국OR', fixedShippingCode: '11'}}).some(message => message.includes('상품 단건 및 수량 1개')));
});

test('the XLSX exporter blocks invalid fixed rates even when called without the UI', async () => {
  const templateBytes = new Uint8Array(await fs.readFile(new URL('../dist/templates/hoottown-fast.xlsx', import.meta.url)));
  assert.throws(() => exportWorkbook({template: 'hoottown-fast', templateBytes, items: [item, {...item, category: '151'}], profile, config: fast}), /대상 품목은 124/);
  assert.throws(() => exportWorkbook({template: 'hoottown-fast', templateBytes, items: [{...item, category: '151'}], profile, config: fast}), /대상 품목은 124/);
  assert.throws(() => exportWorkbook({template: 'hoottown-fast', templateBytes, items: [item, {...item}], profile, config: fast}), /상품 단건 및 수량 1개/);
  const files = unzipSync(exportWorkbook({template: 'hoottown-fast', templateBytes, items: [item], profile, config: fast}));
  const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(xmlCell(xml, 'AK11'), /<v>28<\/v>/);
  assert.doesNotMatch(xmlCell(xml, 'AK11'), /\bt="(?:inlineStr|s|str)"/);
  assert.match(xmlCell(xml, 'AL11'), /<f>.*AK11.*<\/f><v>.*인형/);
});

test('actual QUICK XLSX allows multiple products and quantities under one tracking when fixed rates are not selected', async () => {
  const templateBytes = new Uint8Array(await fs.readFile(new URL('../dist/templates/hoottown-fast.xlsx', import.meta.url)));
  const rows = [{...item, name: 'FIRST PLUSH DOLL', quantity: 2}, {...item, name: 'SECOND PLUSH DOLL', orderNo: 'SAMPLE-B', quantity: 3}];
  const noFixedRate = {...profile, fixedShippingCode: ''};
  assert.deepEqual(errors(rows, {profile: noFixedRate}), []);
  const files = unzipSync(exportWorkbook({template: 'hoottown-fast', templateBytes, items: rows, profile: noFixedRate, config: fast}));
  const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  const cell = address => xmlCell(xml, address);
  assert.match(cell('B11'), /<v>1<\/v>/); assert.match(cell('B12'), /<v>1<\/v>/);
  assert.match(cell('AE11'), />FIRST PLUSH DOLL<\/t>/); assert.match(cell('AE12'), />SECOND PLUSH DOLL<\/t>/);
  assert.match(cell('AH11'), /<v>2<\/v>/); assert.match(cell('AH12'), /<v>3<\/v>/);
  for (const address of ['AK11', 'AK12']) assert.doesNotMatch(cell(address), /<(?:v|t)>[^<]+/);
  assert.match(cell('AL12'), /<f>.*AK12.*<\/f><v><\/v>/);
});
