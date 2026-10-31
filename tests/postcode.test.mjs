import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {initPostcodeSearch, readPostcodeChannelMessage} from '../dist/postcode.mjs';

const token = 'a1'.repeat(16);
const selected = {type: 'postcode:selected', token, postcode: '00000', address: '샘플시 가상로 1'};

test('channel messages require a cryptographic-session token and a supported helper message type', () => {
  assert.deepEqual(readPostcodeChannelMessage({type: 'postcode:ready', token}, token), {type: 'postcode:ready'});
  assert.deepEqual(readPostcodeChannelMessage({type: 'postcode:error', token}, token), {type: 'postcode:error'});
  for (const invalid of [null, [], 'ready', {}, {...selected, token: 'b2'.repeat(16)}, {...selected, type: 'postcode:ack'}, {...selected, type: 'other'}]) {
    assert.equal(readPostcodeChannelMessage(invalid, token), null);
  }
  for (const invalidToken of ['', 'short', 'A1'.repeat(16), 'g1'.repeat(16), 123]) {
    assert.equal(readPostcodeChannelMessage({...selected, token: invalidToken}, invalidToken), null);
  }
});

test('selected messages validate five-digit string postcodes and bounded plain addresses', () => {
  assert.deepEqual(readPostcodeChannelMessage({...selected, address: '  샘플시 가상로 1  '}, token), {type: 'postcode:selected', postcode: '00000', address: '샘플시 가상로 1'});
  assert.equal(readPostcodeChannelMessage({...selected, address: '가'.repeat(250)}, token).address.length, 250);
  for (const postcode of ['1234', '123456', '12A45', ' 00000', 12345, null]) assert.equal(readPostcodeChannelMessage({...selected, postcode}, token), null);
  for (const address of ['', '   ', '가'.repeat(251), '샘플\n주소', '샘플\u0000주소', '샘플\u0085주소', null, 123]) assert.equal(readPostcodeChannelMessage({...selected, address}, token), null);
});

test('only the postcode and base-address fields survive a selected message', () => {
  const data = {...selected, recipient: 'do not forward', order: {private: true}, query: 'do not forward', zonecode: 'extra', buildingCode: 'extra'};
  assert.deepEqual(readPostcodeChannelMessage(data, token), {type: 'postcode:selected', postcode: '00000', address: '샘플시 가상로 1'});
  assert.deepEqual(readPostcodeChannelMessage({...data, type: 'postcode:ready'}, token), {type: 'postcode:ready'});
});

function fakeChannels() {
  const all = [];
  class Channel {
    constructor(name) { this.name = name; this.messages = []; this.closed = false; all.push(this); }
    postMessage(data) { this.messages.push(structuredClone(data)); }
    close() { this.closed = true; }
    receive(data) { this.onmessage?.({data}); }
  }
  return {Channel, all};
}

function parentEnvironment(t, protocol = 'https:', supported = true) {
  const previous = {window: globalThis.window, document: globalThis.document, location: globalThis.location};
  const listeners = new Map();
  const button = {disabled: true, addEventListener: (type, listener) => listeners.set(type, listener)};
  const hint = {textContent: ''}, status = {textContent: ''};
  const openLink = {hidden: true, removeAttribute(name) { delete this[name]; }};
  const nodes = {'postcode-search-btn': button, 'postcode-search-hint': hint, 'postcode-search-status': status, 'postcode-open-link': openLink};
  const channels = fakeChannels(), opens = [], timers = new Map();
  let nextTimer = 0;
  const location = {protocol, href: `${protocol}//example.test/order/index.html?unused=1`};
  const window = {location, crypto: webcrypto, BroadcastChannel: supported ? channels.Channel : undefined,
    open: (...args) => { opens.push(args); return null; },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id), addEventListener() {}};
  globalThis.window = window; globalThis.location = location;
  globalThis.document = {getElementById: id => { assert.ok(Object.hasOwn(nodes, id), 'The module must not read existing order/address form fields.'); return nodes[id]; }};
  t.after(() => { globalThis.window = previous.window; globalThis.document = previous.document; globalThis.location = previous.location; });
  return {button, hint, status, openLink, channels: channels.all, opens, timers, click: () => listeners.get('click')?.()};
}

test('file mode and unsupported channels provide manual entry without loading a popup', t => {
  const env = parentEnvironment(t, 'file:');
  initPostcodeSearch(() => {});
  assert.equal(env.button.disabled, true);
  assert.equal(env.hint.textContent, '파일 실행에서는 주소를 직접 입력해 주세요.');
  env.click();
  assert.equal(env.channels.length, 0); assert.equal(env.opens.length, 0);
});

test('a browser without BroadcastChannel retains manual entry', t => {
  const env = parentEnvironment(t, 'https:', false);
  initPostcodeSearch(() => {}); env.click();
  assert.equal(env.button.disabled, true);
  assert.match(env.hint.textContent, /직접 입력/);
  assert.equal(env.channels.length, 0); assert.equal(env.opens.length, 0);
});

test('HTTP popup sends only a fresh fragment token and applies a validated result before ack', t => {
  const env = parentEnvironment(t, 'https:');
  const applied = [];
  initPostcodeSearch(value => applied.push(value)); env.click();
  assert.equal(env.button.disabled, false); assert.equal(env.opens.length, 1);
  const [href, target, features] = env.opens[0], url = new URL(href), actualToken = url.hash.slice(1);
  assert.match(actualToken, /^[a-f0-9]{32}$/);
  assert.equal(url.pathname, '/order/postcode-search.html'); assert.equal(url.search, '');
  assert.equal(target, '_blank'); assert.match(features, /noopener/); assert.match(features, /noreferrer/);
  assert.equal(env.openLink.hidden, false); assert.equal(env.openLink.href, href);
  const channel = env.channels[0];
  assert.equal(channel.name, 'order-excel-postcode-' + actualToken);
  channel.receive({type: 'postcode:ready', token: actualToken});
  assert.match(env.status.textContent, /주소를 선택/);
  channel.receive({...selected, token: 'b2'.repeat(16)}); assert.equal(applied.length, 0);
  channel.receive({...selected, token: actualToken, recipient: 'ignored', query: 'ignored'});
  assert.deepEqual(applied, [{postcode: '00000', address: '샘플시 가상로 1'}]);
  assert.deepEqual(channel.messages, [{type: 'postcode:ack', token: actualToken}]);
  assert.equal(channel.closed, true); assert.equal(env.timers.size, 0);
  assert.equal(env.openLink.hidden, true); assert.equal(env.openLink.href, undefined);
});

test('a new click closes the old channel and rotates its token', t => {
  const env = parentEnvironment(t);
  const controller = initPostcodeSearch(() => {}); env.click(); env.click();
  assert.equal(env.channels.length, 2); assert.equal(env.channels[0].closed, true);
  assert.notEqual(env.channels[0].name, env.channels[1].name);
  controller.close(); assert.equal(env.channels[1].closed, true);
  assert.equal(env.openLink.hidden, true); assert.equal(env.openLink.href, undefined);
});

const helper = await fs.readFile(new URL('../dist/postcode-search.html', import.meta.url), 'utf8');
const helperScript = helper.match(/<script>([\s\S]*?)<\/script>/)[1];
function helperEnvironment(fragment = token, protocol = 'https:') {
  const channels = fakeChannels(), loaded = [], error = {hidden: true, textContent: ''}, search = {};
  let options, embedded = false, closed = false;
  const timers = new Map(); let nextTimer = 0;
  const window = {opener: {document: 'must not access'}, addEventListener() {}, close() { closed = true; }};
  Object.defineProperty(window, 'parent', {get() { throw Error('Parent window must not be referenced'); }});
  const document = {getElementById: id => id === 'error' ? error : search, createElement: () => ({}), head: {append(script) { assert.equal(window.opener, null, 'opener must be cleared before SDK loading'); loaded.push(script); }}};
  const kakao = {Postcode: class {constructor(value) { options = value; } embed(element) { assert.equal(element, search); embedded = true; }}};
  vm.runInNewContext(helperScript, {window, document, location: {protocol, hash: '#' + fragment}, BroadcastChannel: channels.Channel, kakao,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout: id => timers.delete(id)}, {timeout: 1000});
  return {window, error, loaded, channels: channels.all, load: () => loaded[0]?.onload(), options: () => options, embedded: () => embedded, closed: () => closed};
}

test('helper rejects invalid fragments and file mode before loading any SDK', () => {
  for (const env of [helperEnvironment('invalid'), helperEnvironment(token, 'file:')]) {
    assert.equal(env.window.opener, null); assert.equal(env.loaded.length, 0); assert.equal(env.channels.length, 0); assert.equal(env.error.hidden, false);
  }
});

test('helper embeds the SDK without an opener and closes only on matching acknowledgement', () => {
  const env = helperEnvironment();
  assert.equal(env.loaded[0].src, 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js');
  env.load(); assert.equal(env.embedded(), true);
  const channel = env.channels[0];
  assert.deepEqual(channel.messages, [{type: 'postcode:ready', token}]);
  env.options().oncomplete({zonecode: '00000', userSelectedType: 'R', roadAddress: '샘플시 가상로 1', bname: '', apartment: 'N', query: 'not forwarded', recipient: 'not forwarded'});
  assert.deepEqual(channel.messages[1], {...selected});
  channel.receive({type: 'postcode:ack', token: 'b2'.repeat(16)}); assert.equal(env.closed(), false);
  channel.receive({type: 'postcode:ack', token}); assert.equal(env.closed(), true); assert.equal(channel.closed, true);
});
