import test from 'node:test';
import assert from 'node:assert/strict';
import {findMatches, safeUrl} from '../dist/catalog-match.mjs';

const product = (id, name, image = 'uniform.jpg', extras = {}) => ({
  id, name,
  productUrl: `https://asobisystem.shop/products/${id}`,
  imageUrl: `https://images.groobee.com/images/asobisystem/${image}`,
  ...extras,
});

test('unique image path match ignores allowed host and resizing query', () => {
  const products = [product('1', 'ユニフォーム'), product('2', 'チャーム', 'charm.jpg')];
  const result = findMatches({name: 'OSHI API UNIFORM', imageUrl: 'https://asobisystem.shop/images/asobisystem/uniform.jpg?width=120&height=120'}, products);
  assert.equal(result[0].product.id, '1');
  assert.equal(result[0].exact, true);
  assert.equal(result[0].score, 100);
});

test('different filenames never become image matches', () => {
  const result = findMatches({name: 'UNRELATED', imageUrl: 'https://images.groobee.com/images/asobisystem/uniform-100x100.jpg'}, [product('1', 'ユニフォーム')]);
  assert.deepEqual(result, []);
});

test('shared image does not select an arbitrary variant', () => {
  const products = [product('blue', 'UNIFORM BLUE'), product('red', 'UNIFORM RED')];
  const result = findMatches({name: 'UNIFORM', imageUrl: products[0].imageUrl}, products);
  assert.equal(result.length, 2);
  assert.ok(result.every(match => match.exact === false));
});

test('a unique exact name can disambiguate shared image variants', () => {
  const products = [product('blue', 'UNIFORM BLUE'), product('red', 'UNIFORM RED')];
  const result = findMatches({name: 'UNIFORM RED', imageUrl: products[0].imageUrl}, products);
  assert.equal(result[0].product.id, 'red');
  assert.equal(result[0].exact, true);
  assert.equal(result.filter(match => match.exact).length, 1);
});

test('normalizes full-width characters, punctuation and sales/count metadata', () => {
  const result = findMatches({name: '【受注販売】ＣＵＴＩＥ　ＳＴＲＥＥＴ：CHARM （全8種）'}, [product('1', 'CUTIE STREET CHARM')]);
  assert.equal(result[0].exact, true);
  assert.equal(result[0].score, 96);
  const english = findMatches({name: '[PRE-ORDER] CUTIE STREET CHARM (8 TYPES)'}, [product('1', 'CUTIE STREET CHARM')]);
  assert.equal(english[0].exact, true);
});

test('retains member, color and pack-count variant meaning', () => {
  const products = [product('1', 'UNIFORM (BLUE)'), product('2', 'UNIFORM (RED)')];
  assert.equal(findMatches({name: 'UNIFORM (RED)'}, products)[0].product.id, '2');
  assert.equal(findMatches({name: 'UNIFORM'}, products).filter(match => match.exact).length, 0);
  assert.equal(findMatches({name: 'CHARM (8 PACK)'}, [product('3', 'CHARM')])[0]?.exact, false);
});

test('English/Japanese equivalence requires an explicit catalog alias', () => {
  assert.deepEqual(findMatches({name: 'CUTIE STREET UNIFORM'}, [product('1', '推しアピユニフォーム')]), []);
  const aliased = product('1', '推しアピユニフォーム', 'uniform.jpg', {aliases: ['CUTIE STREET UNIFORM']});
  assert.equal(findMatches({name: 'CUTIE STREET UNIFORM'}, [aliased])[0].exact, true);
});

test('fuzzy token overlap only suggests, and limits results to eight', () => {
  const products = Array.from({length: 12}, (_, index) => product(String(index), `CUTIE STREET UNIFORM MEMBER ${index}`, `image-${index}.jpg`));
  const result = findMatches({name: 'CUTIE STREET UNIFORM'}, products);
  assert.equal(result.length, 8);
  assert.ok(result.every(match => !match.exact));
  assert.deepEqual(findMatches({name: 'TOTALLY DIFFERENT ITEM'}, products), []);
});

test('unique image evidence takes precedence over a conflicting name', () => {
  const products = [product('1', 'UNIFORM'), product('2', 'CHARM', 'charm.jpg')];
  const result = findMatches({name: 'CHARM', imageUrl: products[0].imageUrl}, products);
  assert.equal(result[0].product.id, '1');
  assert.equal(result.filter(match => match.exact).length, 1);
});

test('safeUrl allows only expected schemes and exact public hosts', () => {
  assert.equal(safeUrl('https://asobisystem.shop/products/1'), 'https://asobisystem.shop/products/1');
  assert.equal(safeUrl('http://www.asobisystem.shop/products/1'), 'http://www.asobisystem.shop/products/1');
  assert.equal(safeUrl('https://images.groobee.com/image.jpg', 'image'), 'https://images.groobee.com/image.jpg');
  for (const unsafe of ['javascript:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//asobisystem.shop/x', 'https://evil.test/x', 'https://asobisystem.shop.evil.test/x', 'https://user:secret@asobisystem.shop/x', 'https://asobisystem.shop:8443/x']) {
    assert.equal(safeUrl(unsafe), '', unsafe);
    assert.equal(safeUrl(unsafe, 'image'), '', unsafe);
  }
  assert.equal(safeUrl('https://images.groobee.com/image.jpg'), '');
  assert.deepEqual(findMatches({name: 'UNIFORM'}, [{id: 'bad', name: 'UNIFORM', productUrl: 'javascript:alert(1)'}]), []);
});

test('English fanlight without images ranks the main unit above parts, charm and strap', () => {
  const products = [
    product('CS-0085', 'CUTIE STREET OFFICIAL FAN LIGHT CUSTOM PARTS'),
    product('CS-0316', 'CUTIE STREET OFFICIAL FAN LIGHT CUSTOM CHARM'),
    product('CS-0139', 'CUTIE STREET Official Light Strap(全8種)'),
    product('CS-0084', 'CUTIE STREET OFFICIAL FAN LIGHT （単4電池付）'),
  ];
  const result = findMatches({name: 'CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)'}, products);
  assert.equal(result[0].product.id, 'CS-0084');
  assert.ok(result.every(match => match.exact === false));
  assert.ok(result.find(match => match.product.id === 'CS-0085').score < result[0].score);
});

test('explicit English fields enable exact screenshot aliases without source image URLs', () => {
  const lightQuery = 'CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)';
  const standQuery = 'CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -';
  const products = [
    product('CS-0085', 'CUTIE STREET OFFICIAL FAN LIGHT CUSTOM PARTS'),
    product('CS-0084', 'CUTIE STREET OFFICIAL FAN LIGHT （単4電池付）', 'light.jpg', {enName: lightQuery}),
    product('CS-0293', 'CUTIE STREET メンバー別アクスタ-ツイード衣装ver.-', 'tweed.jpg', {nameEn: standQuery}),
    product('CS-0243', 'CUTIE STREET Acrylic stand - Prima costume-', 'prima.jpg'),
  ];
  for (const [query, id] of [[lightQuery, 'CS-0084'], [standQuery, 'CS-0293']]) {
    const matches = findMatches({name: query}, products);
    assert.equal(matches[0].product.id, id);
    assert.equal(matches[0].exact, true);
    assert.equal(matches.filter(match => match.exact).length, 1);
  }
  const field = product('name-en', '日本語の商品名', 'other.jpg', {name_en: 'EXPLICIT ENGLISH TITLE'});
  assert.equal(findMatches({name: 'EXPLICIT ENGLISH TITLE'}, [field])[0].exact, true);
});

test('duplicate English aliases and alternate outfit versions are not auto selected', () => {
  const query = 'CUTIE STREET Member-Specific Acrylic Stands - Tweed Outfit Version -';
  const shared = [product('tweed-1', '日本語1', 'one.jpg', {enName: query}), product('tweed-2', '日本語2', 'two.jpg', {nameEn: query})];
  assert.ok(findMatches({name: query}, shared).every(match => !match.exact));
  const prima = product('prima', 'CUTIE STREET Acrylic stand - Prima costume-', 'prima.jpg');
  assert.ok(findMatches({name: query}, [prima]).every(match => !match.exact));
  const [batteryVariant] = findMatches({name: 'CUTIE STREET OFFICIAL FAN LIGHT (AA batteries included)'}, [product('aaa', 'CUTIE STREET OFFICIAL FAN LIGHT (AAA batteries included)', 'aaa.jpg')]);
  assert.equal(batteryVariant.exact, false);
});

test('rare outfit tokens rank matching suggestions over a different version', () => {
  const products = [
    product('prima', 'CUTIE STREET Member-Specific Acrylic Stand Prima Outfit Version'),
    product('tweed', 'CUTIE STREET Member-Specific Acrylic Stand Tweed Outfit Version'),
    product('plain', 'CUTIE STREET Member-Specific Acrylic Stand Standard Outfit Version'),
  ];
  const result = findMatches({name: 'CUTIE STREET Acrylic Stand Tweed Outfit'}, products);
  assert.equal(result[0].product.id, 'tweed');
  assert.ok(result.every(match => !match.exact));
});
