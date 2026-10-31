// Remove only telephone formatting separators. Keep other input visible so
// validation can reject letters, country prefixes, punctuation and excess digits.
export function phoneDigits(value) {
  return String(value ?? '').normalize('NFKC').trim().replace(/[-\s\u2010-\u2015\u2212]/gu, '');
}

export function isValidPhone(value) {
  return /^\d{9,11}$/.test(phoneDigits(value));
}

function grouped(value, prefixLength, middleLength) {
  if (value.length <= prefixLength) return value;
  const prefix = value.slice(0, prefixLength);
  const middle = value.slice(prefixLength, prefixLength + middleLength);
  const last = value.slice(prefixLength + middleLength);
  return `${prefix}-${middle}${last ? '-' + last : ''}`;
}

export function formatPhone(value, template) {
  const digits = phoneDigits(value);
  if (template !== 'jimpass' || !/^\d+$/.test(digits) || digits.length > 11) return digits;
  if (digits.startsWith('02')) {
    // Seoul's complete numbers have 2-3-4 or 2-4-4 groups. Keep an unusual
    // longer 02 value intact rather than cutting or guessing its components.
    if (digits.length > 10) return digits;
    return grouped(digits, 2, digits.length === 9 ? 3 : 4);
  }
  return grouped(digits, 3, digits.length === 10 ? 3 : 4);
}
