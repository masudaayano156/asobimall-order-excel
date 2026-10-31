import {shortenHoottownName} from './item-name.mjs';

export function jimpassNameLength(name) {
  return (String(name ?? '').match(/[A-Za-z0-9]/g) ?? []).length;
}

function cleanName(name) {
  return String(name ?? '').normalize('NFKC')
    // Fold Latin accents only. Korean/Japanese and other unsupported letters
    // remain present, so validation cannot turn a mixed-script name valid.
    .replace(/\p{Script=Latin}\p{M}*/gu, letter => letter.normalize('NFKD').replace(/\p{M}/gu, ''))
    .replace(/&/g, ' and ')
    .replace(/['’‘ʼ]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ').trim();
}

export function formatJimpassName(name) {
  let result = cleanName(name);
  // Never shorten away unsupported script/control characters and accidentally
  // produce an apparently valid name from invalid source text.
  if (/[^A-Za-z0-9 ]/.test(result)) return result;
  if (jimpassNameLength(result) > 100) {
    result = cleanName(shortenHoottownName(String(name ?? '').normalize('NFKC'), 100));
    // Ampersand expansion may add letters after the first abbreviation pass.
    if (jimpassNameLength(result) > 100) result = cleanName(shortenHoottownName(result, 100));
  }
  return result;
}

export function isValidJimpassName(name) {
  const result = formatJimpassName(name);
  const length = jimpassNameLength(result);
  return /^[A-Za-z0-9 ]+$/.test(result) && length >= 10 && length <= 100;
}
