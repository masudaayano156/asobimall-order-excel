import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {exportWorkbook} from '../dist/exporter.mjs';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

const templateNames = ['jimpass', 'general', 'hoottown-fast'];
const templates = Object.fromEntries(await Promise.all(templateNames.map(async template => [
  template, new Uint8Array(await fs.readFile(new URL(`../dist/templates/${template}.xlsx`, import.meta.url))),
])));
const configs = {
  general: JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8')),
  'hoottown-fast': JSON.parse(await fs.readFile(new URL('../dist/fast-config.json', import.meta.url), 'utf8')),
};
const phoneInputs = [
  {name: 'digits', value: '01012345678'},
  {name: 'hyphens', value: '010-1234-5678'},
  {name: 'spaces', value: ' 010 1234 5678 '},
];

function cellXml(xml, address) {
  return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] ?? '';
}

function stringValue(xml, address) {
  const cell = cellXml(xml, address);
  assert.ok(cell, `Missing cell ${address}`);
  assert.match(cell, /t="inlineStr"/, `${address} must keep its leading zero as an explicit string.`);
  assert.doesNotMatch(cell, /<v>/);
  const text = [...cell.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(match => match[1]).join('');
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function numberValue(xml, address) {
  const cell = cellXml(xml, address);
  assert.ok(cell, `Missing cell ${address}`);
  assert.doesNotMatch(cell, /t="(?:inlineStr|s|str)"/);
  return Number(cell.match(/<v>([^<]+)<\/v>/)?.[1]);
}

for (const template of templateNames) {
  for (const input of phoneInputs) {
    test(`${template} exports ${input.name} phone input in the forwarder's format without mutating its source`, () => {
      const profile = Object.freeze({
        recipient: '샘플', phone: input.value, postal: '01234', address: '샘플 주소', customs: 'P000000000000',
        shopUrl: 'https://asobisystem.shop', brand: 'ASOBISYSTEM', tracking: '', center: '일본',
        carrier: '[일본]JAPAN POST(日本郵便)', localCarrier: '우체국',
      });
      const baseline = structuredClone(profile);
      const items = [{
        orderNo: 'SAMPLE-PHONE-001', name: 'SYNTHETIC PHONE EXPORT ITEM', option: 'Test option',
        quantity: 2, unitPrice: 1234.5, category: template === 'jimpass' ? '4' : '053',
        productUrl: '', imageUrl: '', tracking: '',
      }];
      const itemBaseline = structuredClone(items);
      // Pass the original phone directly to the real template exporter. The test
      // does not preformat it with the implementation's phone helper.
      const bytes = exportWorkbook({template, templateBytes: templates[template], items, profile, config: configs[template]});
      const files = unzipSync(bytes);
      const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
      if (template === 'jimpass') {
        assert.equal(stringValue(xml, 'O2'), '010-1234-5678');
        assert.equal(stringValue(xml, 'P2'), '01234');
        assert.equal(stringValue(xml, 'A2'), items[0].name);
        assert.equal(numberValue(xml, 'E2'), 2);
        assert.equal(numberValue(xml, 'F2'), 1234.5);
      } else {
        assert.equal(stringValue(xml, 'Q11'), '01012345678');
        assert.equal(stringValue(xml, 'T11'), '01012345678');
        assert.equal(stringValue(xml, 'U11'), '01234');
        assert.equal(stringValue(xml, 'AE11'), items[0].name);
        assert.equal(numberValue(xml, template === 'general' ? 'AJ11' : 'AH11'), 2);
        assert.equal(numberValue(xml, 'AF11'), 1234.5);
      }
      assert.deepEqual(profile, baseline);
      assert.equal(profile.phone, input.value);
      assert.deepEqual(items, itemBaseline);
    });
  }
}
