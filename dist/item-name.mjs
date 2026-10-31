// Hoottown accepts at most 80 UTF-16 code units, matching the app's length check.
function codePointClip(value, budget, fromEnd = false) {
  const points = Array.from(value);
  if (fromEnd) points.reverse();
  let result = '';
  for (const point of points) {
    if (result.length + point.length > budget) break;
    result += point;
  }
  return fromEnd ? Array.from(result).reverse().join('') : result;
}

function wordsWithin(value, budget, fromEnd = false) {
  if (budget <= 0) return '';
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (fromEnd) words.reverse();
  const kept = [];
  let length = 0;
  for (const word of words) {
    if (length + word.length + Number(kept.length > 0) > budget) break;
    kept.push(word); length += word.length + Number(kept.length > 1);
  }
  if (!kept.length) return codePointClip(words[0] ?? '', budget, fromEnd);
  if (fromEnd) kept.reverse();
  return kept.join(' ');
}

export function shortenHoottownName(name, maxLength = 80) {
  const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : 80;
  let text = String(name ?? '').trim();
  if (text.length <= limit) return text;
  if (!limit) return '';
  text = text.replace(/\s+/gu, ' ')
    .replace(/\s*[（(]\s*(?:(?:ALL\s+)?\d+\s+(?:TYPES?|KINDS?)(?:\s+IN\s+TOTAL)?|全\s*\d+\s*種)\s*[)）]/gi, '')
    .replace(/\bMembers?[\s\-‐‑–—]+Specific\s+/gi, '')
    .replace(/\bAcrylic\s+Stands\b/gi, 'Acrylic Stand')
    .replace(/\b(Outfit|Costume)\s+Version\b/gi, '$1 Ver.')
    .replace(/\b(Outfit|Costume)\s+Edition\b/gi, '$1 Ed.')
    .replace(/\s+/gu, ' ').trim();
  if (text.length <= limit) return text;
  for (const [pattern, replacement] of [
    [/\bBirthday\s+Celebration\b/gi, 'Birthday'],
    [/\b(Photo\s+Set\s*\(\d+\s+L-size)\s+photos?\)/gi, '$1)'],
    [/\bSummer\s+Festival\b/gi, 'Summer Fest.'],
  ]) {
    text = text.replace(pattern, replacement);
    if (text.length <= limit) return text;
  }

  // Preserve the final physical item phrase, including a photo pack count.
  // Spend the remaining space on leading group/member names and trailing version.
  const kinds = /\b(?:Photo\s+Set(?:\s*\([^)]{1,60}\))?|Acrylic\s+Stand|FAN\s*LIGHT|PEN\s*LIGHT|KEY\s*(?:CHAIN|RING)|T[- ]?SHIRT|TEE|TOWEL|BADGE|CHARM|STICKER(?:\s+SET)?|PLUSH|DOLL|BAG|CAP|HAT|POSTCARD|BOOK|CALENDAR|BRACELET)(?![A-Za-z0-9_])/gi;
  const anchor = [...text.matchAll(kinds)].at(-1);
  if (anchor && anchor[0].length <= limit) {
    const before = text.slice(0, anchor.index).trim();
    const after = text.slice(anchor.index + anchor[0].length).trim();
    const spare = Math.max(0, limit - anchor[0].length - 2);
    const headBudget = after ? Math.min(spare, Math.max(24, Math.floor(spare * 0.55))) : spare;
    const head = wordsWithin(before, headBudget);
    const tail = wordsWithin(after, spare - head.length, true);
    return [head, anchor[0], tail].filter(Boolean).join(' ');
  }
  const head = wordsWithin(text, Math.max(0, Math.ceil((limit - 5) * 0.55)));
  const tail = wordsWithin(text, Math.max(0, limit - head.length - 5), true);
  const shortened = tail ? `${head} ... ${tail}`.trim() : wordsWithin(text, limit);
  return shortened || codePointClip(text, limit) || '.'.repeat(Math.min(limit, 3));
}
