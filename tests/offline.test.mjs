import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';
import {loadJson, loadTemplate} from '../dist/data.mjs';

const dist = new URL('../dist/', import.meta.url);
const html = await fs.readFile(new URL('offline.html', dist), 'utf8');
const payloadMatch = html.match(/<script>window\.__ORDER_EXCEL_OFFLINE__=([\s\S]*?);<\/script>/);
assert.ok(payloadMatch, 'Offline data bootstrap is required.');
const payload = JSON.parse(payloadMatch[1]);

test('both standalone inline scripts compile as JavaScript without executing', () => {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.equal(scripts.length, 2, 'The standalone document must have exactly two inline scripts.');
  for (const [index, source] of scripts.entries()) {
    let problem = '';
    try { new vm.Script(source, {filename: `offline-inline-${index + 1}.js`}); }
    catch (error) { problem = String(error?.message ?? 'Unknown syntax error').slice(0, 200); }
    // Never attach the SyntaxError object: its stack may include the entire
    // multi-megabyte bundle line. Compilation alone must not execute app code.
    assert.equal(problem, '', `Offline inline script ${index + 1} must compile: ${problem}`);
  }
});

test('offline ZIP preserves the standalone HTML and embeds all data without external loaders or hosting scripts', async () => {
  const offlineArchive = await fs.readFile(new URL('offline.zip', dist));
  const offlineFiles = unzipSync(offlineArchive);
  assert.deepEqual(Object.keys(offlineFiles).sort(), ['README.txt', 'fflate-LICENSE.txt', 'order-excel-offline.html']);
  assert.deepEqual(Buffer.from(offlineFiles['order-excel-offline.html']), Buffer.from(html, 'utf8'));
  assert.equal(strFromU8(offlineFiles['fflate-LICENSE.txt']), await fs.readFile(new URL('fflate-LICENSE.txt', dist), 'utf8'));
  const readme = strFromU8(offlineFiles['README.txt']);
  assert.match(readme, /압축을 풀어/);
  assert.match(readme, /인터넷 연결을 끊어/);
  assert.match(readme, /order-excel-offline\.html/);
  assert.ok(readme.includes(createHash('sha256').update(Buffer.from(html, 'utf8')).digest('hex')));
  assert.equal([...html.matchAll(/<script\b/gi)].length, 2, 'Only the generated data bootstrap and bundled app are allowed; hosting-injected scripts must not enter the ZIP.');
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=|<script\b[^>]*\btype=["']module|<link\b|<iframe\b|<object\b/i);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.match(html, /img-src data:/);
  assert.doesNotMatch(html, /href=["']\.\/(?:offline\.(?:html|zip)|source\.zip|checksums\.txt)["']/i);
  assert.deepEqual(Object.keys(payload.json).sort(), ['catalog.json', 'fast-config.json', 'general-config.json', 'postmall-config.json', 'thumbnails.json']);
  for (const kind of ['jimpass', 'general', 'hoottown-fast', 'postmall']) {
    const original = await fs.readFile(new URL(`templates/${kind}.xlsx`, dist));
    assert.deepEqual(Buffer.from(payload.templates[kind], 'base64'), original);
  }
  assert.doesNotMatch(payloadMatch[1], /<|\u2028|\u2029/);
});

test('embedded adapter never fetches and returns fresh values', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = {__ORDER_EXCEL_OFFLINE__: payload};
  globalThis.fetch = () => { throw new Error('Network must not be called in offline mode.'); };
  try {
    const data = await loadJson('./catalog.json');
    assert.equal(data.products.length, payload.json['catalog.json'].products.length);
    data.products[0].name = 'temporary mutation';
    assert.notEqual((await loadJson('catalog.json')).products[0].name, 'temporary mutation');
    const bytes = await loadTemplate('jimpass');
    assert.equal(bytes[0], 80);
    bytes[0] = 0;
    assert.equal((await loadTemplate('jimpass'))[0], 80);
    await assert.rejects(loadJson('https://example.test/private.json'), /지원하지/);
    await assert.rejects(loadTemplate('../private'), /지원하지/);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test('HTTP adapter requests only the expected relative public files', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = undefined;
  const requested = [];
  globalThis.fetch = async path => {
    requested.push(path);
    return {ok: true, json: async () => ({example: true}), arrayBuffer: async () => Uint8Array.of(80, 75).buffer};
  };
  try {
    assert.deepEqual(await loadJson('./general-config.json'), {example: true});
    assert.deepEqual(await loadTemplate('general'), Uint8Array.of(80, 75));
    assert.deepEqual(await loadJson('postmall-config.json'), {example: true});
    assert.deepEqual(await loadTemplate('postmall'), Uint8Array.of(80, 75));
    assert.deepEqual(requested, ['./general-config.json', './templates/general.xlsx', './postmall-config.json', './templates/postmall.xlsx']);
    globalThis.fetch = async () => ({ok: false});
    await assert.rejects(loadJson('fast-config.json'), /불러오지/);
    await assert.rejects(loadTemplate('hoottown-fast'), /불러오지/);
  } finally {
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  }
});

test('source ZIP contains public allowlisted files and checksum manifest matches both binary ZIP downloads', async () => {
  const archive = await fs.readFile(new URL('source.zip', dist));
  const files = unzipSync(archive);
  const names = Object.keys(files);
  assert.ok(names.includes('README.md'));
  assert.ok(names.includes('dist/data.mjs'));
  assert.ok(names.includes('dist/catalog.json'));
  assert.ok(names.includes('dist/_headers'));
  assert.ok(names.includes('.gitignore'));
  const testNames = (await fs.readdir(new URL('../tests/', dist)))
    .filter(name => /^[^/\\]+\.test\.mjs$/.test(name)).sort();
  assert.deepEqual(names.filter(name => name.startsWith('tests/')).sort(), testNames.map(name => `tests/${name}`));
  for (const name of testNames) {
    assert.equal(strFromU8(files[`tests/${name}`]), await fs.readFile(new URL(`../tests/${name}`, dist), 'utf8'));
  }
  for (const name of ['scripts/enrich_catalog_english.py', 'scripts/catalog-english-overrides.json', 'scripts/sanitize_templates.py']) {
    assert.ok(names.includes(name), `${name} is part of the reviewed public maintenance source.`);
  }
  for (const name of names) {
    assert.doesNotMatch(name, /(?:^|\/)(?:\.git|\.openai|references|node_modules|\.verification)(?:\/|$)/);
    assert.doesNotMatch(name, /offline\.(?:html|zip)|source\.zip|checksums\.txt|credential|\.env/i);
    assert.doesNotMatch(name, /^(?:[A-Za-z]:|\/)|\.\./);
  }
  assert.equal(strFromU8(files['dist/data.mjs']), await fs.readFile(new URL('data.mjs', dist), 'utf8'));
  const expected = await fs.readFile(new URL('checksums.txt', dist), 'utf8');
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const offlineArchive = await fs.readFile(new URL('offline.zip', dist));
  assert.equal(expected, `${digest(offlineArchive)}  offline.zip\n${digest(archive)}  source.zip\n`);
  assert.doesNotMatch(expected, /offline\.html/);
});
