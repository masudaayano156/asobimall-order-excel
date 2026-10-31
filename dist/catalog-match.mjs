/** Local-only catalog matching. This module never loads images or follows URLs. */

const PRODUCT_HOSTS = new Set(['asobisystem.shop', 'www.asobisystem.shop']);
const IMAGE_HOSTS = new Set([...PRODUCT_HOSTS, 'images.groobee.com']);

/** Return an allowed absolute URL, or an empty string for an unsafe URL. */
export function safeUrl(value, kind = 'product') {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password || url.port) return '';
    const hosts = kind === 'image' ? IMAGE_HOSTS : kind === 'product' ? PRODUCT_HOSTS : null;
    if (!hosts?.has(url.hostname.toLowerCase())) return '';
    return url.href;
  } catch {
    return '';
  }
}

function imageIdentity(value) {
  const safe = safeUrl(value, 'image');
  if (!safe) return '';
  let path = new URL(safe).pathname;
  // Cloudflare's optional resizing prefix is transport metadata. Keep the actual
  // path and filename intact: differently named images must never become equal.
  path = path.replace(/^\/cdn-cgi\/image\/[^/]+\//i, '/');
  try { path = decodeURIComponent(path); } catch { /* Compare the valid URL path. */ }
  return path.replace(/\/{2,}/g, '/');
}

const SALE_MARKER = /^(?:PRE[ -]?ORDER|RE[ -]?STOCK|RE[ -]?SALE|ON SALE|SALE|セール|予約|予約商品|予約受付|予約受付中|受注|受注商品|受注販売|受注生産|受注生産商品|受注受付|再販|再販売|再受注|追加受注|期間限定受注|再入荷|予約販売)$/i;

function normalizedName(value) {
  if (typeof value !== 'string') return '';
  let name = value.slice(0, 8192).normalize('NFKC').toUpperCase().trim();
  for (let i = 0; i < 5; i++) {
    const prefix = name.match(/^(?:【|\[|\(|<|「)\s*([^】\])>」]+?)\s*(?:】|\]|\)|>|」)\s*/);
    if (!prefix || !SALE_MARKER.test(prefix[1].trim())) break;
    name = name.slice(prefix[0].length).trim();
  }
  name = name.replace(/^(?:PRE[ -]?ORDER|予約商品|受注商品|受注販売|受注生産商品|再販)\s*[:：]\s*/i, '');
  // A full series count is editorial metadata. Member/color/size parentheses
  // remain in the name so variant meaning survives normalization.
  name = name.replace(/\(\s*(?:全\s*\d+\s*(?:種|種類)|(?:ALL\s*)?\d+\s*(?:TYPES?|KINDS?|VARIETIES))\s*\)/gi, ' ');
  return name.replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

function nameSet(product) {
  // These are explicit catalog names/aliases. Never synthesize translations or
  // discard outfit, color, battery, or version text to manufacture an exact hit.
  return [...new Set([product.name, product.enName, product.nameEn, product.name_en,
    ...(Array.isArray(product.aliases) ? product.aliases : [])]
    .map(normalizedName).filter(Boolean))];
}

function tokens(name) {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const result = new Set();
  for (const word of words) {
    if (word.length > 1) result.add(word);
    // Explicitly shared Japanese characters can suggest candidates without
    // pretending to translate a Japanese name into an English name.
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word)) {
      const chars = [...word];
      for (let i = 0; i + 1 < chars.length; i++) result.add(chars[i] + chars[i + 1]);
    }
  }
  return result;
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common++;
  return (2 * common) / (left.size + right.size);
}

function weightedOverlap(left, right, weights) {
  if (!left.size || !right.size) return 0;
  let common = 0;
  let total = 0;
  const weight = token => weights.get(token) ?? 3;
  for (const token of left) {
    total += weight(token);
    if (right.has(token)) common += weight(token);
  }
  for (const token of right) total += weight(token);
  return (2 * common) / total;
}

function objectKind(name) {
  // A light's charm, strap, case and replacement parts share its long name but
  // are different physical objects. This guard changes suggestions, not identity.
  const patterns = [
    ['keychain', /\bKEY\s*(?:CHAIN|RING|HOLDER)\b|キーホルダー|キーリング|アクキー/u],
    ['charm', /\bCHARMS?\b|チャーム/u],
    ['case', /\b(?:CASE|POUCH|HOLDER)S?\b|ケース|ポーチ|ホルダー/u],
    ['strap', /\bSTRAPS?\b|ストラップ/u],
    ['parts', /\bPARTS?\b|パーツ|部品/u],
    ['stand', /\bACRYLIC\s*STANDS?\b|アクリルスタンド|アクスタ/u],
    ['fanlight', /\b(?:(?:FAN|PEN)\s*LIGHTS?|FANLIGHT|PENLIGHT|LIGHT\s*STICKS?)\b|ペンライト/u],
  ];
  return patterns.find(([, pattern]) => pattern.test(name))?.[0] ?? '';
}

function kindPenalty(source, candidate) {
  return source && candidate && source !== candidate ? 30 : 0;
}

/**
 * `exact` is true only when the evidence identifies one catalog entry. Shared
 * image/name matches remain suggestions; fuzzy matches are never automatic.
 */
export function findMatches(item, products) {
  if (!item || !Array.isArray(products)) return [];
  const name = normalizedName(item.name);
  const image = imageIdentity(item.imageUrl);
  const sourceTokens = tokens(name);
  const sourceKind = objectKind(name);
  const entries = products.filter(product => product && typeof product === 'object' && safeUrl(product.productUrl))
    .map((product, index) => {
      const names = nameSet(product);
      const images = [product.imageUrl, ...(Array.isArray(product.images) ? product.images : [])].map(imageIdentity).filter(Boolean);
      return {
        product, index, names,
        tokenSets: names.map(tokens),
        kind: objectKind(normalizedName(product.name)) || names.map(objectKind).find(Boolean) || '',
        imageMatch: Boolean(image && images.includes(image)),
        nameMatch: Boolean(name && names.includes(name)),
        similarity: name ? Math.max(0, ...names.map(candidate => overlap(sourceTokens, tokens(candidate)))) : 0,
      };
    });

  // Repeated brand/type words should not outweigh a distinguishing outfit or
  // version word. Count each token once per catalog entry, across its aliases.
  const frequencies = new Map();
  for (const entry of entries) {
    const uniqueTokens = new Set(entry.tokenSets.flatMap(set => [...set]));
    for (const token of uniqueTokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }
  const weights = new Map([...frequencies].map(([token, count]) => [token, 1 + Math.min(2, Math.log((entries.length + 1) / (count + 1)))]));
  for (const entry of entries) entry.weightedSimilarity = name ? Math.max(0, ...entry.tokenSets.map(set => weightedOverlap(sourceTokens, set, weights))) : 0;

  const imageMatches = entries.filter(entry => entry.imageMatch);
  const nameMatches = entries.filter(entry => entry.nameMatch);
  let automatic = null;
  if (imageMatches.length === 1) automatic = imageMatches[0];
  else if (imageMatches.length > 1) {
    const namedImageMatches = imageMatches.filter(entry => entry.nameMatch);
    if (namedImageMatches.length === 1) automatic = namedImageMatches[0];
  } else if (nameMatches.length === 1) automatic = nameMatches[0];

  return entries.filter(entry => entry.imageMatch || entry.nameMatch || entry.similarity >= 0.35 || entry.weightedSimilarity >= 0.35)
    .map(entry => {
      const exact = entry === automatic;
      const penalty = kindPenalty(sourceKind, entry.kind);
      const score = entry.imageMatch ? (exact ? 100 : 98) : entry.nameMatch ? (exact ? 96 : 94) : Math.max(0, Math.min(89, Math.round(30 + entry.weightedSimilarity * 59)) - penalty);
      const reason = entry.imageMatch
        ? (exact ? (imageMatches.length > 1 ? '이미지와 상품명 일치' : '이미지 일치') : '같은 이미지를 쓰는 후보가 여러 개 있습니다')
        : entry.nameMatch ? (exact ? '상품명 또는 등록된 별칭 일치' : '같은 상품명의 후보가 여러 개 있습니다') : penalty ? '상품명 일부 일치 · 본체와 부속품 등 물품 종류가 다릅니다' : '상품명 일부 일치';
      return {product: entry.product, score, reason, exact, index: entry.index};
    })
    .sort((a, b) => b.score - a.score || Number(b.exact) - Number(a.exact) || a.index - b.index)
    .slice(0, 8)
    .map(({index, ...match}) => match);
}
