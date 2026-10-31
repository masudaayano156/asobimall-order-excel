import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { exportWorkbook } from '../dist/exporter.mjs';
import { unzipSync, strFromU8 } from '../dist/fflate.mjs';

const config = JSON.parse(await fs.readFile(new URL('../dist/general-config.json', import.meta.url), 'utf8'));
const fastConfig = JSON.parse(await fs.readFile(new URL('../dist/fast-config.json', import.meta.url), 'utf8'));
const templateBytes = Object.fromEntries(await Promise.all(['jimpass', 'general', 'hoottown-fast'].map(async (name) => [name, new Uint8Array(await fs.readFile(new URL(`../dist/templates/${name}.xlsx`, import.meta.url)))])));
const profile = {
  recipient: '테스트 수취인', phone: '010-0000-0000', postal: '01234', address: '테스트시 가상로 1 101호',
  customs: 'P000000000000', shopUrl: 'https://asobisystem.shop', brand: 'ASOBISYSTEM', tracking: '00123456789',
  carrier: '[일본]YAMATO(ヤマト運輸)', center: '일본',
};
const items = [
  { orderNo: 'ORDER-001', name: 'ITEM ONE <& "quoted"', option: 'Ayano Masuda', quantity: 1, unitPrice: 6500, productUrl: 'https://asobisystem.shop/items/1?a=1&b=2', imageUrl: 'https://example.test/image.jpg', category: '001' },
  { orderNo: 'ORDER-001', name: 'ITEM TWO', option: 'green', quantity: 2, unitPrice: 1800.25, productUrl: '', imageUrl: '', category: '002' },
  { orderNo: 'ORDER-002', name: '=HYPERLINK("https://example.test")', option: '', quantity: 1, unitPrice: 0, category: '' },
  { orderNo: 'ORDER-001', name: 'ITEM FOUR', option: '', quantity: 1, unitPrice: 1.01, category: '003' },
];
function part(files, name) { return strFromU8(files[name]); }
function getCell(xml, address) {
  return xml.match(new RegExp(`<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0];
}
function decoded(value) {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function formulaText(xml, address) {
  return decoded(getCell(xml, address)?.match(/<f>([\s\S]*?)<\/f>/)?.[1] ?? '');
}
function managedRow(xml, config, row) {
  for (const {column} of config.headers) {
    const entry = getCell(xml, `${column}${row}`);
    if (config.formulas[column]) {
      assert.match(entry, /<f>/, `${column}${row} must retain its original managed formula.`);
      assert.match(entry, /<v>[\s\S]*?<\/v>/, `${column}${row} must provide an immediate cached result.`);
      assert.doesNotMatch(entry, /<f\s/, 'Expanded formulas must not retain stale shared-formula attributes.');
    } else assert.doesNotMatch(entry, /<f\b/, `${column}${row} is an input cell and must never become a formula.`);
  }
}
function generated(template, overrides = {}) {
  return unzipSync(exportWorkbook({ template, templateBytes: templateBytes[template], items, profile, config: template === 'hoottown-fast' ? fastConfig : config, ...overrides }));
}

test('jimpass maps exact columns, keeps identifiers as strings and replaces all sample input rows', () => {
  const files = generated('jimpass');
  const source = unzipSync(templateBytes.jimpass);
  const xml = part(files, 'xl/worksheets/sheet1.xml');
  assert.match(xml, /<dimension ref="A1:Z5"\/>/);
  assert.equal((xml.match(/<row\b/g) ?? []).length, 5);
  assert.match(getCell(xml, 'A2'), />ITEM ONE and quoted<\/t>/);
  assert.match(getCell(xml, 'B2'), /t="inlineStr".*>001<\/t>/);
  assert.match(getCell(xml, 'E3'), /<v>2<\/v>/);
  assert.doesNotMatch(getCell(xml, 'E3'), /t=/);
  assert.match(getCell(xml, 'F3'), /<v>1800\.25<\/v>/);
  assert.match(getCell(xml, 'P2'), /s="16" t="inlineStr".*>01234<\/t>/);
  assert.match(getCell(xml, 'K2'), />00123456789<\/t>/);
  assert.match(getCell(xml, 'H2'), /a=1&amp;b=2/);
  assert.match(getCell(xml, 'A4'), /t="inlineStr".*>HYPERLINK https example test<\/t>/);
  assert.doesNotMatch(xml, /<f\b|<hyperlinks\b/);
  assert.equal(getCell(xml, 'X2'), '<c r="X2" s="2"/>');
  assert.equal(getCell(xml, 'Z2'), '<c r="Z2" s="2"/>');
  assert.match(getCell(xml, 'M2'), />ORDER-001<\/t>/);
  assert.equal(part(files, 'xl/styles.xml'), part(source, 'xl/styles.xml'));
  assert.equal((part(files, 'xl/workbook.xml').match(/<sheet\b/g) ?? []).length, 2);
  assert.match(part(files, 'xl/workbook.xml'), /activeTab="0"/);
  assert.doesNotMatch(part(files, 'xl/worksheets/_rels/sheet1.xml.rels'), /\/hyperlink/);
  assert.ok(part(files, 'xl/worksheets/_rels/sheet1.xml.rels').includes('printerSettings'));
});

test('jimpass includes inspection and compensation only after explicit Y', () => {
  const files = generated('jimpass', { profile: { ...profile, inspection: 'Y', compensation: 'Y' } });
  const xml = part(files, 'xl/worksheets/sheet1.xml');
  assert.match(getCell(xml, 'X2'), />Y<\/t>/);
  assert.match(getCell(xml, 'Z2'), />Y<\/t>/);
});

test('general fills 11th row onward, computes code values and clears unused shared formulas', () => {
  const files = generated('general');
  const source = unzipSync(templateBytes.general);
  const xml = part(files, 'xl/worksheets/sheet1.xml');
  assert.match(getCell(xml, 'B11'), /s="8"><v>1<\/v>/);
  assert.match(getCell(xml, 'B12'), /<v>1<\/v>/);
  assert.match(getCell(xml, 'B13'), /<v>2<\/v>/);
  assert.match(getCell(xml, 'B14'), /<v>3<\/v>/);
  assert.match(getCell(xml, 'D11'), /<v>0<\/v>/);
  assert.match(getCell(xml, 'G11'), /<v>21<\/v>/);
  assert.match(getCell(xml, 'I11'), /t="str".*<v>KR<\/v>/);
  assert.match(getCell(xml, 'L11'), /t="str".*<v>P_CUST_NO<\/v>/);
  assert.match(getCell(xml, 'M11'), /t="str".*<v>N<\/v>/);
  assert.match(getCell(xml, 'P11'), /<v>82<\/v>/);
  assert.match(getCell(xml, 'S11'), /<v>82<\/v>/);
  assert.match(getCell(xml, 'U11'), />01234<\/t>/);
  assert.match(getCell(xml, 'Y11'), /t="inlineStr".*>001<\/t>/);
  assert.match(getCell(xml, 'Z11'), /전자제품/);
  assert.match(getCell(xml, 'AB11'), /<v>10001<\/v>/);
  assert.match(getCell(xml, 'AC11'), /<v>2000001<\/v>/);
  assert.match(getCell(xml, 'AF12'), /<v>1800\.25<\/v>/);
  assert.match(getCell(xml, 'AG11'), />JPY<\/t>/);
  assert.match(getCell(xml, 'AJ12'), /<v>2<\/v>/);
  assert.match(getCell(xml, 'AU11'), /t="str".*<v>10<\/v>/);
  assert.match(getCell(xml, 'AN11'), />Ayano Masuda<\/t>/);
  assert.match(getCell(xml, 'AL11'), />N<\/t>/);
  assert.match(getCell(xml, 'AR11'), />N<\/t>/);
  assert.match(getCell(xml, 'AV11'), />N<\/t>/);
  assert.match(getCell(xml, 'AE13'), /t="inlineStr".*=HYPERLINK/);
  assert.equal(getCell(xml, 'Y13'), '<c r="Y13" s="16"/>');
  assert.match(getCell(xml, 'AB13'), /s="10" t="str"><f>.*Y13.*<\/f><v><\/v>/);
  for (const row of xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
    const number = Number(row[0].match(/\br="(\d+)"/)?.[1]);
    if (number >= 11 && number <= 14) managedRow(xml, config, number);
    if (number >= 15 && number <= 1000) assert.doesNotMatch(row[0], /<f\b/);
    if (number >= 15 && number <= 1000) assert.doesNotMatch(row[0], /<v>|<is>/);
  }
  assert.ok(!files['xl/calcChain.xml']);
  assert.doesNotMatch(part(files, 'xl/_rels/workbook.xml.rels'), /calcChain/);
  assert.doesNotMatch(part(files, '[Content_Types].xml'), /calcChain/);
  assert.match(part(files, 'xl/workbook.xml'), /<definedName name="상품카테고리">#REF!<\/definedName>/);
  assert.equal(part(files, 'xl/styles.xml'), part(source, 'xl/styles.xml'));
  assert.equal(part(files, 'xl/worksheets/sheet2.xml').replace(/ tabSelected="0"/, ''), part(source, 'xl/worksheets/sheet2.xml'));
  assert.equal((part(files, 'xl/workbook.xml').match(/<sheet\b/g) ?? []).length, 4);
  assert.match(getCell(xml, 'A11'), /<v>170<\/v>/);
  // Examples/instructions above the actual input area remain part of the supplied template.
  assert.equal(getCell(xml, 'B2'), getCell(part(source, 'xl/worksheets/sheet1.xml'), 'B2'));
});

test('export does not mutate original bytes and rejects non-finite, fractional quantity and excess precision', () => {
  const original = new Uint8Array(templateBytes.jimpass);
  generated('jimpass');
  assert.deepEqual(templateBytes.jimpass, original);
  for (const bad of [{ quantity: NaN }, { quantity: 1.5 }, { quantity: 0 }, { unitPrice: Infinity }, { unitPrice: -1 }, { unitPrice: 1.234 }]) {
    assert.throws(() => generated('jimpass', { items: [{ ...items[0], ...bad }] }));
  }
  assert.throws(() => generated('jimpass', { items: [] }));
  assert.throws(() => generated('general', { items: Array.from({ length: 991 }, () => ({ ...items[0] })) }));
  assert.throws(() => generated('general', { profile: { ...profile, center: '미국' } }), /국가/);
});

test('XML remains literal and rejects invalid control characters', () => {
  const files = generated('jimpass', { profile: {...profile, address: "<&'\" 🙂 _x0041_", warehouseNote: '=HYPERLINK("https://example.test")'} });
  const xml = part(files, 'xl/worksheets/sheet1.xml');
  assert.match(getCell(xml, 'Q2'), /&lt;&amp;&apos;&quot; 🙂 _x005F_x0041_/);
  assert.match(getCell(xml, 'U2'), /t="inlineStr".*=HYPERLINK\(&quot;https:\/\/example\.test&quot;\)/);
  assert.doesNotMatch(getCell(xml, 'U2'), /<f\b/);
  assert.throws(() => generated('jimpass', { profile: {...profile, address: 'bad\u0001'} }), /문자/);
});

test('dollar replacement tokens in addresses stay literal rather than restoring old template rows', () => {
  const address = "$& $` $' $1";
  for (const template of ['jimpass', 'general']) {
    const files = generated(template, { profile: {...profile, address} });
    const xml = part(files, 'xl/worksheets/sheet1.xml');
    assert.equal((xml.match(/<sheetData>/g) ?? []).length, 1);
    assert.ok(getCell(xml, template === 'jimpass' ? 'Q2' : 'V11').includes('$&amp; $` $&apos; $1'));
  }
});

test('tracking is independent for each order and an explicitly missing number stays blank', () => {
  const perOrderItems = [
    { ...items[0], orderNo: 'ORDER-A', tracking: '000111222333' },
    { ...items[1], orderNo: 'ORDER-A', tracking: '000111222333' },
    { ...items[2], orderNo: 'ORDER-B', tracking: '009998887777' },
    { ...items[3], orderNo: 'ORDER-C', tracking: '' },
    { ...items[3], orderNo: 'ORDER-D' },
  ];
  for (const template of ['jimpass', 'general']) {
    const xml = part(generated(template, { items: perOrderItems }), 'xl/worksheets/sheet1.xml');
    const column = template === 'jimpass' ? 'K' : 'E';
    const firstRow = template === 'jimpass' ? 2 : 11;
    assert.match(getCell(xml, `${column}${firstRow}`), /t="inlineStr".*>000111222333<\/t>/);
    assert.match(getCell(xml, `${column}${firstRow + 1}`), /t="inlineStr".*>000111222333<\/t>/);
    assert.match(getCell(xml, `${column}${firstRow + 2}`), /t="inlineStr".*>009998887777<\/t>/);
    assert.doesNotMatch(getCell(xml, `${column}${firstRow + 3}`), /<v>|<is>/);
    // Existing common-profile callers retain their fallback unless an item explicitly clears it.
    assert.match(getCell(xml, `${column}${firstRow + 4}`), />00123456789<\/t>/);
  }
});

test('distributed templates and exports contain no creator names or local absolute path metadata', () => {
  for (const template of ['jimpass', 'general', 'hoottown-fast']) {
    for (const files of [unzipSync(templateBytes[template]), generated(template)]) {
      if (files['docProps/core.xml']) {
        const core = part(files, 'docProps/core.xml');
        assert.doesNotMatch(core, /<(?:[A-Za-z_][\w.-]*:)?(?:creator|lastModifiedBy)\b[^>]*>[^<]+<\//);
      }
      assert.doesNotMatch(part(files, 'xl/workbook.xml'), /<(?:[A-Za-z_][\w.-]*:)?absPath\b/);
    }
  }
});

test('jimpass application service options use exact S:Z columns, with literal notes and no default consent', () => {
  const configuredProfile = {
    ...profile,
    packingReinforce: 'Y', businessCustoms: 'Y', warehouseNote: '<입고 & 확인> $& "메모"',
    courierNote: '문 앞에 놓아 주세요', immediateRelease: 'Y', inspection: 'Y',
    localCarrier: '사가와', compensation: 'Y',
  };
  const xml = part(generated('jimpass', { profile: configuredProfile }), 'xl/worksheets/sheet1.xml');
  for (const row of [2, 3, 4, 5]) {
    for (const column of ['S', 'T', 'W', 'X', 'Z']) assert.match(getCell(xml, `${column}${row}`), />Y<\/t>/);
    assert.match(getCell(xml, `U${row}`), /&lt;입고 &amp; 확인&gt; \$&amp; &quot;메모&quot;/);
    assert.match(getCell(xml, `V${row}`), />문 앞에 놓아 주세요<\/t>/);
    assert.match(getCell(xml, `Y${row}`), />사가와<\/t>/);
  }
  const disabled = part(generated('jimpass', { profile: {
    ...profile, packingReinforce: '', businessCustoms: 'N', immediateRelease: false,
    inspection: '', compensation: 'N', warehouseNote: '', courierNote: '', localCarrier: '',
  } }), 'xl/worksheets/sheet1.xml');
  for (const column of ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']) assert.doesNotMatch(getCell(disabled, `${column}2`), /<v>|<is>/);
  const baseGeneral = part(generated('general'), 'xl/worksheets/sheet1.xml');
  const generalWithJimpassOptions = part(generated('general', { profile: configuredProfile }), 'xl/worksheets/sheet1.xml');
  assert.equal(generalWithJimpassOptions, baseGeneral);
});

test('official QUICK template maps exact columns and preserves all reference sheets, including hidden sheet', () => {
  const source = unzipSync(templateBytes['hoottown-fast']);
  const fastItems = [
    { ...items[0], orderNo: 'FAST-001', tracking: '000111222333', category: '142', fixedShippingCode: '9' },
    { ...items[1], orderNo: 'FAST-002', tracking: '', quantity: 1, category: '143', fixedShippingCode: '10' },
  ];
  const files = generated('hoottown-fast', { items: fastItems });
  const xml = part(files, 'xl/worksheets/sheet1.xml');
  const headerStyle = (column) => fastConfig.headers.find((entry) => entry.column === column).row11Style;
  assert.match(getCell(xml, 'A10'), /<v>/);
  assert.match(getCell(xml, 'B11'), new RegExp(`s="${headerStyle('B')}"><v>1<\\/v>`));
  assert.match(getCell(xml, 'E11'), /t="inlineStr".*>000111222333<\/t>/);
  assert.doesNotMatch(getCell(xml, 'E12'), /<v>|<is>/);
  assert.match(getCell(xml, 'G11'), /<v>21<\/v>/);
  assert.match(getCell(xml, 'I11'), /t="str".*<v>KR<\/v>/);
  assert.match(getCell(xml, 'L11'), /t="str".*<v>P_CUST_NO<\/v>/);
  assert.match(getCell(xml, 'M11'), /t="str".*<v>N<\/v>/);
  assert.match(getCell(xml, 'P11'), /<v>82<\/v>/);
  assert.match(getCell(xml, 'U11'), />01234<\/t>/);
  assert.match(getCell(xml, 'Y11'), /t="inlineStr".*>142<\/t>/);
  assert.match(getCell(xml, 'AB11'), /<v>10007<\/v>/);
  assert.match(getCell(xml, 'AC11'), /<v>2000142<\/v>/);
  assert.match(getCell(xml, 'AF12'), /<v>1800\.25<\/v>/);
  assert.match(getCell(xml, 'AG11'), />JPY<\/t>/);
  assert.match(getCell(xml, 'AH12'), /<v>1<\/v>/);
  assert.match(getCell(xml, 'AI11'), />N<\/t>/);
  assert.match(getCell(xml, 'AJ11'), />N<\/t>/);
  assert.match(getCell(xml, 'AK11'), /<v>9<\/v>/);
  assert.doesNotMatch(getCell(xml, 'AK11'), /\bt=/);
  assert.match(getCell(xml, 'AL11'), /\[고정배송비 \$7\.7\] 우편물/);
  assert.match(getCell(xml, 'AK12'), /<v>10<\/v>/);
  assert.doesNotMatch(getCell(xml, 'AK12'), /\bt=/);
  assert.match(getCell(xml, 'AL12'), /\[고정배송비 \$9\.9\] 음반/);
  assert.match(getCell(xml, 'AM11'), />N<\/t>/);
  for (const column of ['AN', 'AO', 'AP', 'AR', 'AS']) assert.doesNotMatch(getCell(xml, `${column}11`), /<v>|<is>/);
  assert.match(getCell(xml, 'AQ11'), /t="str"><f>.*AP11.*<\/f><v><\/v>/);
  assert.match(getCell(xml, 'AT11'), />N<\/t>/);
  assert.ok(!getCell(xml, 'AU11'));
  for (const row of xml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/g)) {
    const number = Number(row[0].match(/\br="(\d+)"/)?.[1]);
    if (number === 11 || number === 12) managedRow(xml, fastConfig, number);
    if (number >= 13 && number <= 1000) assert.doesNotMatch(row[0], /<f\b/);
    if (number >= 13 && number <= 1000) assert.doesNotMatch(row[0], /<v>|<is>/);
    if (number === 11 || number === 12) {
      assert.doesNotMatch(row[0], /FAST-00|Ayano Masuda|https:\/\/example\.test|items\/1\?a=/);
    }
  }
  assert.ok(!files['xl/calcChain.xml']);
  assert.equal(part(files, 'xl/styles.xml'), part(source, 'xl/styles.xml'));
  for (const sheet of [2, 3, 4, 5]) assert.equal(part(files, `xl/worksheets/sheet${sheet}.xml`), part(source, `xl/worksheets/sheet${sheet}.xml`));
  assert.equal((part(files, 'xl/workbook.xml').match(/<sheet\b/g) ?? []).length, 5);
  assert.match(part(files, 'xl/workbook.xml'), /<sheet\b(?=[^>]*state="hidden")(?=[^>]*name="시트1")/);
});

test('QUICK groups the same tracking number contiguously across orders while blank drafts use order number', () => {
  const groupedItems = [
    { ...items[0], name: 'FIRST', orderNo: 'ORDER-A', tracking: '000111' },
    { ...items[0], name: 'SECOND', orderNo: 'ORDER-B', tracking: '000222' },
    { ...items[0], name: 'THIRD', orderNo: 'ORDER-C', tracking: '000111' },
    { ...items[0], name: 'FOURTH', orderNo: 'DRAFT-A', tracking: '' },
    { ...items[0], name: 'FIFTH', orderNo: 'DRAFT-B', tracking: '' },
    { ...items[0], name: 'SIXTH', orderNo: 'DRAFT-A', tracking: '' },
  ];
  const xml = part(generated('hoottown-fast', { items: groupedItems }), 'xl/worksheets/sheet1.xml');
  for (const [index, expected] of ['FIRST', 'THIRD', 'SECOND', 'FOURTH', 'SIXTH', 'FIFTH'].entries()) assert.match(getCell(xml, `AE${11 + index}`), new RegExp(`>${expected}<\\/t>`));
  for (const [index, expected] of [1, 1, 2, 3, 3, 4].entries()) assert.match(getCell(xml, `B${11 + index}`), new RegExp(`<v>${expected}<\\/v>`));
  const general = part(generated('general', { items: groupedItems }), 'xl/worksheets/sheet1.xml');
  assert.match(getCell(general, 'AE12'), />SECOND<\/t>/);
  assert.match(getCell(general, 'B13'), /<v>3<\/v>/);
});

test('fixed shipping code supports per-item overrides, blank override and common profile in both Hoot templates', () => {
  for (const template of ['general', 'hoottown-fast']) {
    const fast = template === 'hoottown-fast';
    const override = fast ? '10' : '46', common = fast ? '9' : '11';
    const withFixed = [
      { ...items[0], orderNo: 'FIX-001', tracking: '', category: fast ? '143' : '248', fixedShippingCode: override },
      { ...items[0], orderNo: 'FIX-002', tracking: '', fixedShippingCode: '' },
      { ...items[0], orderNo: 'FIX-003', tracking: '', category: fast ? '142' : '248' },
    ];
    const configuredProfile = { ...profile, fixedShippingCode: common, center: fast ? '일본' : '미국OR', carrier: fast ? profile.carrier : '' };
    const xml = part(generated(template, { items: withFixed, profile: configuredProfile }), 'xl/worksheets/sheet1.xml');
    const codeColumn = template === 'general' ? 'AW' : 'AK';
    const labelColumn = template === 'general' ? 'AX' : 'AL';
    assert.match(getCell(xml, `${codeColumn}11`), new RegExp(`<v>${override}<\\/v>`));
    assert.doesNotMatch(getCell(xml, `${codeColumn}11`), /\bt=/);
    assert.match(getCell(xml, `${labelColumn}11`), fast ? /음반/ : /와인 1병/);
    assert.doesNotMatch(getCell(xml, `${codeColumn}12`), /<v>|<is>/);
    assert.match(getCell(xml, `${labelColumn}12`), /t="str"><f>.*<\/f><v><\/v>/);
    assert.match(getCell(xml, `${codeColumn}13`), new RegExp(`<v>${common}<\\/v>`));
    assert.doesNotMatch(getCell(xml, `${codeColumn}13`), /\bt=/);
    assert.match(getCell(xml, `${labelColumn}13`), fast ? /우편물/ : /와인 1병/);
  }
});

test('per-order carriers map individually, compute the correct Hoot code and preserve explicit blank overrides', () => {
  const perOrderItems = [
    { ...items[0], orderNo: 'CARRIER-A', tracking: '000111', carrier: '[일본]JAPAN POST(日本郵便)', localCarrier: '우체국' },
    { ...items[1], orderNo: 'CARRIER-B', tracking: '000222', carrier: '[일본]YAMATO(ヤマト運輸)', localCarrier: '야마토' },
    { ...items[2], orderNo: 'CARRIER-C', tracking: '', carrier: '', localCarrier: '' },
    { ...items[3], orderNo: 'CARRIER-D', tracking: '' },
  ];
  const fallbackProfile = { ...profile, localCarrier: '사가와' };
  for (const template of ['general', 'hoottown-fast']) {
    const xml = part(generated(template, { items: perOrderItems, profile: fallbackProfile }), 'xl/worksheets/sheet1.xml');
    assert.match(getCell(xml, 'F11'), /JAPAN POST\(日本郵便\)/);
    assert.match(getCell(xml, 'G11'), /<v>31<\/v>/);
    assert.match(getCell(xml, 'F12'), /YAMATO\(ヤマト運輸\)/);
    assert.match(getCell(xml, 'G12'), /<v>21<\/v>/);
    assert.doesNotMatch(getCell(xml, 'F13'), /<v>|<is>/);
    assert.match(getCell(xml, 'G13'), /t="str"><f>.*F13.*<\/f><v><\/v>/);
    assert.match(getCell(xml, 'F14'), /YAMATO\(ヤマト運輸\)/);
    assert.match(getCell(xml, 'G14'), /<v>21<\/v>/);
    assert.throws(() => generated(template, { items: [{ ...items[0], carrier: '[미국]USPS' }] }), /국가/);
    assert.throws(() => generated(template, { items: [{ ...items[0], carrier: 'UNKNOWN' }] }), /운송사/);
  }
  const jimpass = part(generated('jimpass', { items: perOrderItems, profile: fallbackProfile }), 'xl/worksheets/sheet1.xml');
  assert.match(getCell(jimpass, 'Y2'), />우체국<\/t>/);
  assert.match(getCell(jimpass, 'Y3'), />야마토<\/t>/);
  assert.doesNotMatch(getCell(jimpass, 'Y4'), /<v>|<is>/);
  assert.match(getCell(jimpass, 'Y5'), />사가와<\/t>/);
});

test('Hoottown managed formulas follow each row and retain immediately readable numeric/string caches', () => {
  const rows = [
    {...items[0], orderNo: 'FORMULA-A', tracking: '000111', carrier: '[일본]JAPAN POST(日本郵便)', category: '001'},
    {...items[0], orderNo: 'FORMULA-B', tracking: '000222', carrier: '[일본]YAMATO(ヤマト運輸)', category: '053'},
  ];
  for (const template of ['general', 'hoottown-fast']) {
    const files = generated(template, {items: rows}), xml = part(files, 'xl/worksheets/sheet1.xml');
    assert.equal(formulaText(xml, 'G11'), 'IFERROR(VLOOKUP(F11,\'데이터 목록\'!C:D,2,FALSE),"")');
    assert.equal(formulaText(xml, 'G12'), 'IFERROR(VLOOKUP(F12,\'데이터 목록\'!C:D,2,FALSE),"")');
    assert.equal(formulaText(xml, 'AB12'), 'IFERROR(VLOOKUP(Y12,\'데이터 목록\'!O:Q,2,FALSE),"")');
    assert.match(formulaText(xml, 'M12'), /IF\(K12=/);
    assert.doesNotMatch(formulaText(xml, 'M12'), /K11/);
    assert.match(getCell(xml, 'G11'), /<v>31<\/v>/);
    assert.match(getCell(xml, 'G12'), /<v>21<\/v>/);
    assert.match(getCell(xml, 'AB12'), /<v>10002<\/v>/);
    assert.match(getCell(xml, 'AC12'), /<v>2000053<\/v>/);
    for (const address of ['G11', 'G12', 'AB12', 'AC12']) assert.doesNotMatch(getCell(xml, address), /\bt=/);
    assert.match(getCell(xml, 'I12'), /t="str"><f>.*<\/f><v>KR<\/v>/);
    managedRow(xml, template === 'general' ? config : fastConfig, 12);
    const calc = part(files, 'xl/workbook.xml').match(/<calcPr\b[^>]*>/)?.[0] ?? '';
    assert.match(calc, /calcMode="auto"/); assert.match(calc, /fullCalcOnLoad="1"/); assert.match(calc, /forceFullCalc="1"/);
  }
});

test('formula row expansion preserves absolute references, quoted literals and lookup ranges', () => {
  for (const input of ['$F11', 'F$11']) {
    const configuration = structuredClone(fastConfig);
    configuration.formulas.G.formula = `IFERROR(VLOOKUP(${input},'데이터 목록'!$C$2:$D$81,2,FALSE),"F11")`;
    const files = generated('hoottown-fast', {items: [items[0], {...items[0], orderNo: 'SECOND-FORMULA'}], config: configuration});
    const xml = part(files, 'xl/worksheets/sheet1.xml');
    const reference = input === '$F11' ? '$F12' : 'F$11';
    assert.equal(formulaText(xml, 'G12'), `IFERROR(VLOOKUP(${reference},'데이터 목록'!$C$2:$D$81,2,FALSE),"F11")`);
    assert.match(getCell(xml, 'G12'), /<v>21<\/v>/);
    assert.doesNotMatch(getCell(xml, 'AE12'), /<f\b/);
  }
});
