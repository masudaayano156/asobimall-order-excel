import test from 'node:test';
import assert from 'node:assert/strict';
import {initDownloadReview} from '../dist/download-review.mjs';

function environment(t, queuedClose = false) {
  const previous = globalThis.document;
  const deferred = [];
  class Target {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
    removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
    emit(type) { const event = {prevented: false, preventDefault() { this.prevented = true; }}; for (const callback of [...(this.listeners.get(type) ?? [])]) callback(event); return event; }
    focus() { document.activeElement = this; }
    get listenerCount() { return [...this.listeners.values()].reduce((count, set) => count + set.size, 0); }
  }
  const dialog = new Target(), confirm = new Target(), cancel = new Target(), originalFocus = new Target();
  originalFocus.isConnected = true;
  dialog.open = false; dialog.opens = 0; dialog.returnValue = 'old value';
  dialog.showModal = () => { dialog.open = true; dialog.opens++; };
  dialog.close = () => { dialog.open = false; if (queuedClose) deferred.push(() => dialog.emit('close')); else dialog.emit('close'); };
  const elements = {'download-review-dialog': dialog, 'download-review-confirm': confirm, 'download-review-cancel': cancel};
  globalThis.document = {getElementById: id => elements[id], activeElement: originalFocus};
  t.after(() => { globalThis.document = previous; });
  return {dialog, confirm, cancel, originalFocus, deferred, listeners: () => dialog.listenerCount + confirm.listenerCount + cancel.listenerCount};
}

test('explicit confirmation resolves true, closes the dialog and restores focus', async t => {
  const env = environment(t), review = initDownloadReview();
  const pending = review();
  assert.equal(env.dialog.open, true);
  assert.equal(env.dialog.returnValue, '');
  assert.equal(document.activeElement, env.cancel);
  env.confirm.emit('click');
  assert.equal(await pending, true);
  assert.equal(env.dialog.open, false);
  assert.equal(document.activeElement, env.originalFocus);
  assert.equal(env.listeners(), 0);
});

test('cancel, Escape and an external close each resolve false', async t => {
  const env = environment(t), review = initDownloadReview();
  let pending = review();
  env.cancel.emit('click'); assert.equal(await pending, false);
  pending = review();
  const escape = env.dialog.emit('cancel');
  assert.equal(escape.prevented, true); assert.equal(await pending, false);
  pending = review();
  env.dialog.close(); assert.equal(await pending, false);
  assert.equal(env.listeners(), 0);
});

test('duplicate requests share the exact pending Promise and only open one modal', async t => {
  const env = environment(t), review = initDownloadReview();
  const first = review(), second = review();
  assert.equal(first, second);
  assert.equal(env.dialog.opens, 1);
  env.confirm.emit('click');
  assert.equal(await first, true); assert.equal(await second, true);
  assert.equal(env.listeners(), 0);
});

test('ten cancel/confirm retries do not retain the last answer or accumulate listeners', async t => {
  const env = environment(t), review = initDownloadReview();
  for (let index = 0; index < 10; index++) {
    env.dialog.returnValue = 'stale result';
    const pending = review();
    assert.equal(env.dialog.returnValue, '');
    const accepted = index % 2 === 1;
    (accepted ? env.confirm : env.cancel).emit('click');
    assert.equal(await pending, accepted);
    assert.equal(env.listeners(), 0);
  }
  assert.equal(env.dialog.opens, 10);
});

test('a queued close from the last request cannot cancel a new open dialog', async t => {
  const env = environment(t, true), review = initDownloadReview();
  const first = review(); env.cancel.emit('click'); assert.equal(await first, false);
  const second = review();
  env.deferred.shift()();
  assert.equal(env.dialog.open, true);
  env.confirm.emit('click');
  assert.equal(await second, true);
  assert.equal(env.listeners(), 0);
});

test('a dialog opening failure resolves false and removes the temporary handlers', async t => {
  const env = environment(t), review = initDownloadReview();
  env.dialog.showModal = () => { throw new Error('Dialog unavailable'); };
  assert.equal(await review(), false);
  assert.equal(env.listeners(), 0);
});
