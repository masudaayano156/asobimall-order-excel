import test from 'node:test';
import assert from 'node:assert/strict';
import {phoneDigits, formatPhone, isValidPhone} from '../dist/phone.mjs';

test('phone normalization removes formatting separators and normalizes Unicode width', () => {
  assert.equal(phoneDigits('  ０１０－１２３４－５６７８  '), '01012345678');
  assert.equal(phoneDigits('010\u20111234\u20135678'), '01012345678');
  assert.equal(phoneDigits('010\u2003 1234\u00a05678'), '01012345678');
  for (const value of ['', ' \t\n', null, undefined]) assert.equal(phoneDigits(value), '');
});

test('Jimpass formats complete mobile, Seoul and regional numbers without changing digits', () => {
  const cases = [
    ['01012345678', '010-1234-5678'],
    ['0101234567', '010-123-4567'],
    ['021234567', '02-123-4567'],
    ['0212345678', '02-1234-5678'],
    ['0311234567', '031-123-4567'],
    ['03112345678', '031-1234-5678'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(formatPhone(value, 'jimpass'), expected);
    assert.equal(phoneDigits(formatPhone(value, 'jimpass')), value);
  }
});

test('all partial mobile inputs retain every digit and remain stable after formatting again', () => {
  const full = '01012345678';
  for (let length = 0; length <= full.length; length++) {
    const partial = full.slice(0, length);
    const formatted = formatPhone(partial, 'jimpass');
    assert.equal(phoneDigits(formatted), partial);
    assert.equal(formatPhone(formatted, 'jimpass'), formatted);
  }
  assert.equal(formatPhone('010', 'jimpass'), '010');
  assert.equal(formatPhone('0101', 'jimpass'), '010-1');
  assert.equal(formatPhone('0101234', 'jimpass'), '010-1234');
  assert.equal(formatPhone('01012345', 'jimpass'), '010-1234-5');
  assert.equal(formatPhone('02', 'jimpass'), '02');
  assert.equal(formatPhone('021', 'jimpass'), '02-1');
});

test('both Hoot services use separator-free values and switching back preserves leading zeroes', () => {
  for (const original of ['01012345678', '0101234567', '021234567', '03112345678']) {
    const jimpass = formatPhone(original, 'jimpass');
    for (const template of ['general', 'hoottown-fast']) {
      const hoot = formatPhone(jimpass, template);
      assert.equal(hoot, original);
      assert.equal(formatPhone(hoot, 'jimpass'), jimpass);
      assert.equal(formatPhone(hoot, template), hoot);
      assert.ok(hoot.startsWith('0'));
    }
  }
});

test('letters, country prefixes and other punctuation remain visible to validation', () => {
  const invalid = [
    ['010-12A4-5678', '01012A45678'],
    ['+82 10-1234-5678', '+821012345678'],
    ['010/1234/5678', '010/1234/5678'],
    ['010.1234.5678', '010.1234.5678'],
    ['(02) 123-4567', '(02)1234567'],
    ['01012\u200b345678', '01012\u200b345678'],
  ];
  for (const [input, expected] of invalid) {
    assert.equal(phoneDigits(input), expected);
    assert.equal(isValidPhone(input), false);
    for (const template of ['jimpass', 'general', 'hoottown-fast']) assert.equal(formatPhone(input, template), expected);
  }
});

test('overlong values are never cut down to a valid-looking phone number', () => {
  for (const value of ['010123456789', '031123456789012345', '0'.repeat(30)]) {
    for (const template of ['jimpass', 'general', 'hoottown-fast']) {
      const formatted = formatPhone(value, template);
      assert.equal(phoneDigits(formatted), value);
      assert.equal(isValidPhone(formatted), false);
      assert.equal(formatPhone(formatted, template), formatted);
    }
  }
  assert.equal(formatPhone('02123456789', 'jimpass'), '02123456789', 'An unusual 11-digit Seoul value must remain intact rather than be truncated.');
});

test('validation keeps the existing nine-to-eleven-digit policy and handles empty values', () => {
  for (const value of ['02-123-4567', '031-123-4567', '010-1234-5678']) assert.equal(isValidPhone(value), true);
  for (const value of ['', '12345678', '123456789012', null, undefined]) assert.equal(isValidPhone(value), false);
  for (const template of ['jimpass', 'general', 'hoottown-fast']) assert.equal(formatPhone('', template), '');
});
