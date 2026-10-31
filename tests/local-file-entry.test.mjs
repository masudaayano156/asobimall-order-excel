import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {unzipSync, strFromU8} from '../dist/fflate.mjs';

const dist = new URL('../dist/', import.meta.url);
const source = await fs.readFile(new URL('local-file-entry.js', dist), 'utf8');

function runEntry(href) {
  const redirected = [];
  const events = [];
  const location = {href, protocol: new URL(href).protocol, replace: target => redirected.push(String(target))};
  const window = {location, addEventListener: (...args) => events.push(args)};
  // This executes only the small routing script with fake globals. It does not
  // open a browser, navigate a file URL, or loosen any browser security setting.
  vm.runInNewContext(source, {window, location, URL, console}, {timeout: 1000, filename: 'local-file-entry.js'});
  return {redirected, events};
}

test('classic local-file entry selects its sibling standalone HTML, including Windows spaces and Unicode', () => {
  assert.deepEqual(runEntry('file:///C:/example/dist/index.html').redirected, ['file:///C:/example/dist/offline.html']);
  assert.deepEqual(runEntry('file:///C:/Work%20Space/%EC%A3%BC%EB%AC%B8/dist/index.html?draft=1#preview-section').redirected,
    ['file:///C:/Work%20Space/%EC%A3%BC%EB%AC%B8/dist/offline.html']);
});

test('classic entry leaves HTTP and HTTPS module applications on their current page', () => {
  assert.deepEqual(runEntry('http://127.0.0.1:8765/index.html').redirected, []);
  assert.deepEqual(runEntry('https://example.test/index.html').redirected, []);
});

test('source entry loads the classic script early while standalone HTML omits it and source ZIP retains it', async () => {
  const index = await fs.readFile(new URL('index.html', dist), 'utf8');
  const classic = index.match(/<script\b[^>]*\bsrc=["']\.\/local-file-entry\.js["'][^>]*>\s*<\/script>/i);
  assert.ok(classic, 'The direct-file routing script must be present in source HTML.');
  assert.doesNotMatch(classic[0], /\btype=["']module["']/i);
  assert.ok(classic.index < index.indexOf('rel="stylesheet"'));
  assert.ok(classic.index < index.indexOf('type="module"'));
  const offline = await fs.readFile(new URL('offline.html', dist), 'utf8');
  assert.doesNotMatch(offline, /<script\b[^>]*\bsrc=["'][^"']*local-file-entry\.js/i);
  assert.equal([...offline.matchAll(/<script\b/gi)].length, 2, 'The standalone app must not execute the file-entry redirect again.');
  const archive = unzipSync(await fs.readFile(new URL('source.zip', dist)));
  assert.equal(strFromU8(archive['dist/local-file-entry.js']), source);
});
