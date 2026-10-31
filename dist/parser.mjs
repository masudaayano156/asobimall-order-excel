/** Parse ASOBISYSTEM order-detail clipboard text without fetching any URLs. */

const AMOUNT_LABEL = /^Product\s*amount\s*[:：]?\s*(.*)$/i;
const QUANTITY_LABEL = /^quantity\s*[:：]?\s*(.*)$/i;
const OPTION_LABEL = /^(?:Members?\s*(?:\([^)]*\))?|colou?r|size|style|type|option|カラー|色|サイズ|メンバー|種類)\s*[:：]/i;

function normalize(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n').map(cleanLine).join('\n')
    .replace(/Product\s*amoun\s*\n\s*t\s*[:：]/gi, 'Product amount:')
    .replace(/quan\s*\n\s*tity\s*[:：]/gi, 'quantity:');
}

function markdownLinks(line) {
  const links = [];
  const opening = /!?\[([^\]\n]*)\]\(/g;
  for (const match of line.matchAll(opening)) {
    const destinationStart = match.index + match[0].length;
    let depth = 1;
    let end = destinationStart;
    for (; end < line.length; end++) {
      if (line[end] === '\\') { end++; continue; }
      if (line[end] === '(') depth++;
      else if (line[end] === ')' && --depth === 0) break;
    }
    if (depth !== 0) continue;
    const destination = line.slice(destinationStart, end);
    const angled = destination.startsWith('<') && destination.endsWith('>');
    const url = angled ? destination.slice(1, -1) : destination;
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    links.push({start: match.index, end: end + 1, label: match[1], image: match[0].startsWith('!'), url, urlStart: destinationStart + Number(angled), urlEnd: end - Number(angled)});
  }
  return links;
}

function stripBlockPrefixes(line) {
  let result = line.trim();
  let heading = false;
  for (let i = 0; i < 32; i++) {
    if (/^#{1,6}[ \t]+/.test(result)) heading = true;
    const next = result.replace(/^(?:#{1,6}[ \t]+|(?:[-+*•]|\d+[.)])(?:[ \t]+|$))/, '').trimStart();
    if (next === result) break;
    result = next;
  }
  if (heading) result = result.replace(/[ \t]+#{1,6}[ \t]*$/, '');
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(result) ? '' : result;
}

function stripEmphasis(line) {
  let result = line;
  for (const marker of ['*', '_']) {
    for (const count of [3, 2, 1]) {
      const escaped = marker === '*' ? '\\*' : '_';
      const delimiter = escaped.repeat(count);
      const body = count === 1 ? `[^${escaped}\\n]*?\\S` : '[^\\n]*?\\S';
      const expression = new RegExp(`(^|[^\\p{L}\\p{N}_*])${delimiter}(?=\\S)(${body})${delimiter}(?=$|[^\\p{L}\\p{N}_*])`, 'gu');
      result = result.replace(expression, '$1$2');
    }
  }
  return result;
}

function cleanLine(line) {
  // Keep URL destinations byte-for-byte while removing clipboard presentation
  // markup. In particular, '*' and '_' inside URLs are not emphasis markers.
  const saved = [];
  let prefix = '\uE000ORDER';
  while (line.includes(prefix)) prefix += '_';
  const hold = value => `${prefix}${saved.push(value) - 1}\uE001`;
  let result = '';
  let cursor = 0;
  for (const link of markdownLinks(line)) {
    result += line.slice(cursor, link.urlStart) + hold(link.url);
    cursor = link.urlEnd;
  }
  result += line.slice(cursor);
  result = result.replace(/https?:\/\/[^\s<>\uE000\uE001]+/gi, hold)
    .replace(/\\([\\`*_[\]{}()#+.!>~-])/g, (_, character) => hold(character))
    .replace(/&(?:nbsp|#0*(?:32|160)|#x0*(?:20|a0));/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\\[ \t]*$/, '');
  for (let i = 0; i < 3; i++) result = stripEmphasis(stripBlockPrefixes(result));
  for (let i = 0; i < saved.length; i++) result = result.replace(`${prefix}${i}\uE001`, () => saved[i]);
  return result.trim();
}

function money(value) {
  const cleaned = String(value ?? '').trim().replace(/^(?:JPY|USD|EUR|GBP)\s*/i, '').replace(/^[¥￥$€£]\s*/, '');
  const match = cleaned.match(/^([+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?=\s|$|[（(])/);
  if (!match) return null;
  if (/^\s+\d/.test(cleaned.slice(match[0].length))) return null;
  const result = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(result) && result >= 0 ? result : null;
}

function quantity(value) {
  const cleaned = String(value ?? '').trim();
  if (!/^\d+$/.test(cleaned)) return null;
  const result = Number(cleaned);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

function nextValue(lines, index, tail, parse, end = lines.length) {
  if (tail.trim()) return {value: parse(tail), end: index};
  for (let i = index + 1; i < end; i++) {
    if (!lines[i]) continue;
    const result = parse(lines[i]);
    return {value: result, end: result === null ? index : i};
  }
  return {value: null, end: index};
}

function headerValue(lines, label) {
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(label);
    if (match) return nextValue(lines, i, match[1] ?? '', money).value;
  }
  return null;
}

function imageLink(line) {
  const md = markdownLinks(line).find(link => link.image || /^(?:image|画像)$/i.test(link.label) || /\.(?:jpe?g|png|gif|webp)(?:[?#]|$)/i.test(link.url));
  if (md) return md.url;
  const raw = line.match(/^(https?:\/\/[^\s]+\.(?:jpe?g|png|gif|webp)(?:[?#][^\s]*)?)$/i);
  return raw ? raw[1] : '';
}

function plainLinkText(line) {
  let result = '';
  let cursor = 0;
  for (const link of markdownLinks(line)) {
    result += line.slice(cursor, link.start) + link.label;
    cursor = link.end;
  }
  return (result + line.slice(cursor)).trim();
}

function namedOptions(lines) {
  const text = lines.map(plainLinkText).join('\n');
  const labels = [...text.matchAll(/(?:^|\n|[ \t]+)(Members?\s*(?:\([^)]*\))?|colou?r|size|style|type|option|カラー|色|サイズ|メンバー|種類)\s*[:：][ \t]*/gi)];
  const result = {};
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const field = /^(?:colou?r|カラー|色)$/i.test(label[1]) ? 'color' : /^(?:size|サイズ)$/i.test(label[1]) ? 'size' : '';
    if (!field) continue;
    const value = text.slice(label.index + label[0].length, labels[i + 1]?.index ?? text.length).replace(/\s+/g, ' ').trim();
    if (value) result[field] = result[field] ? `${result[field]} / ${value}` : value;
  }
  return result;
}

function itemPrelude(lines) {
  let imageUrl = '';
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const found = imageLink(lines[i]);
    if (found) {
      imageUrl = found;
      start = i + 1;
    }
  }
  const meaningful = lines.slice(start).filter(line => line && !/^(?:merchandise|ordered items|view details|hide details|shipping status\s*:|estimated delivery date\s*:|phone number\s*:|we are processing payments|payment methods|credit card payment|\[?change of\b|delivery address)/i.test(line));
  const optionStart = meaningful.findIndex(line => OPTION_LABEL.test(line));
  let titleLines = optionStart < 0 ? meaningful : meaningful.slice(0, optionStart);
  const optionLines = optionStart < 0 ? [] : meaningful.slice(optionStart);
  // A malformed prior item can leave a quantity label in the prefix. Never call it a title.
  const lastQuantity = titleLines.findLastIndex(line => QUANTITY_LABEL.test(line));
  if (lastQuantity >= 0) titleLines = titleLines.slice(lastQuantity + 1).filter(line => !/^\d+$/.test(line));
  const titleLink = titleLines.flatMap(markdownLinks).find(Boolean);
  return {
    name: titleLines.map(plainLinkText).join(' ').replace(/\s+/g, ' ').trim(),
    option: optionLines.map(plainLinkText).join(' ').replace(/\s+/g, ' ').trim(),
    ...namedOptions(optionLines),
    imageUrl,
    productUrl: titleLink?.url ?? '',
  };
}

function parseOrder(block, orderNo, warnings) {
  const lines = block.split('\n');
  const itemSection = lines.findIndex(line => /^ordered items\s*$/i.test(line));
  const header = itemSection >= 0 ? lines.slice(0, itemSection) : lines;
  const dateIndex = header.findIndex(line => /^Order date\b/i.test(line));
  let date = '';
  if (dateIndex >= 0) {
    date = header[dateIndex].replace(/^Order date\s*[:：]?\s*/i, '').trim();
    if (!date) date = header.slice(dateIndex + 1).find(Boolean) ?? '';
  }
  const order = {
    orderNo,
    date,
    currency: /[¥￥]|\bJPY\b/i.test(block) ? 'JPY' : /\$|\bUSD\b/i.test(block) ? 'USD' : 'JPY',
    subtotal: headerValue(header, /^subtotal\s*[:：]?\s*(.*)$/i),
    postage: headerValue(header, /^(?:postage|shipping fee)\s*[:：]?\s*(.*)$/i),
    total: headerValue(header, /^Amount due\s*[:：]?\s*(.*)$/i),
    items: [],
  };
  const markers = [];
  lines.forEach((line, i) => { if (AMOUNT_LABEL.test(line)) markers.push(i); });
  let prefixStart = itemSection >= 0 ? itemSection + 1 : 0;
  const merchandiseIndex = lines.findIndex((line, i) => i < (markers[0] ?? lines.length) && /^merchandise\s*$/i.test(line));
  if (merchandiseIndex >= 0) prefixStart = merchandiseIndex + 1;
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i];
    const nextMarker = markers[i + 1] ?? lines.length;
    const label = lines[marker].match(AMOUNT_LABEL);
    const amountRead = nextValue(lines, marker, label[1], money, nextMarker);
    const prelude = itemPrelude(lines.slice(prefixStart, marker));
    const nextImage = lines.findIndex((line, index) => index > amountRead.end && index < nextMarker && imageLink(line));
    const quantityEnd = nextImage < 0 ? nextMarker : nextImage;
    const followingLine = lines.findIndex((line, index) => index > amountRead.end && index < quantityEnd && line);
    const quantityIndex = amountRead.value !== null
      ? followingLine >= 0 && QUANTITY_LABEL.test(lines[followingLine]) ? followingLine : -1
      : lines.findIndex((line, index) => index > marker && index < quantityEnd && QUANTITY_LABEL.test(line));
    const quantityMatch = quantityIndex < 0 ? null : lines[quantityIndex].match(QUANTITY_LABEL);
    const quantityRead = quantityMatch ? nextValue(lines, quantityIndex, quantityMatch[1], quantity, quantityEnd) : {value: null, end: amountRead.end};
    const item = {...prelude, amount: amountRead.value, quantity: quantityRead.value, orderNo};
    order.items.push(item);
    const location = `${orderNo || '주문번호 없음'} / 상품 ${i + 1}`;
    if (!item.name) warnings.push(`${location}: 상품명을 읽지 못했습니다. 직접 입력해 주세요.`);
    if (item.amount === null) warnings.push(`${location}: 상품금액을 읽지 못했습니다. 직접 확인해 주세요.`);
    if (item.quantity === null) warnings.push(`${location}: 수량이 없거나 올바른 양의 정수가 아닙니다.`);
    prefixStart = Math.max(amountRead.end, quantityRead.end) + 1;
  }
  const quantityCount = lines.filter(line => QUANTITY_LABEL.test(line)).length;
  if (quantityCount > markers.length) warnings.push(`${orderNo || '주문번호 없음'}: 상품금액 표시보다 수량 표시가 많습니다. 금액이 누락된 상품이 있는지 확인해 주세요.`);
  if (!order.items.length) warnings.push(`${orderNo || '주문번호 없음'}: 상품을 찾지 못했습니다. 상품명, Product amount, quantity가 포함된 상세 내용을 복사해 주세요.`);
  return order;
}

/**
 * Product `amount` preserves ASOBIMALL's per-unit Product amount; quantity stays separate.
 * Missing/invalid quantities and prices are null and also produce explicit warnings.
 */
export function parseOrders(text) {
  const normalized = normalize(text);
  const warnings = [];
  if (!normalized.trim()) return {orders: [], warnings: ['주문 상세 내용을 먼저 붙여넣어 주세요.']};
  const pattern = /(?:^|\n)[ \t]*Order\s*No\b\.?[ \t]*[:：]?[ \t]*/gi;
  const starts = [...normalized.matchAll(pattern)];
  const orders = [];
  if (!starts.length) {
    warnings.push('주문번호를 찾지 못했습니다. 주문 상세 화면의 Order No.부터 복사해 주세요.');
    orders.push(parseOrder(normalized, '', warnings));
  } else {
    for (let i = 0; i < starts.length; i++) {
      const start = starts[i];
      const end = starts[i + 1]?.index ?? normalized.length;
      const afterLabel = normalized.slice(start.index + start[0].length, end).replace(/^(?:[ \t]*\n)+[ \t]*/, '');
      const candidate = afterLabel.split('\n')[0].trim();
      const orderNo = /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(candidate) && !/^(?:order|payment|amount|subtotal|postage|merchandise|quantity)$/i.test(candidate) ? candidate : '';
      if (!orderNo) warnings.push('주문번호를 찾지 못했습니다. 주문 상세 화면의 Order No.부터 복사해 주세요.');
      orders.push(parseOrder(normalized.slice(start.index, end), orderNo, warnings));
    }
  }
  const seen = new Set();
  for (const order of orders) {
    if (order.orderNo && seen.has(order.orderNo)) warnings.push(`${order.orderNo}: 같은 주문번호가 여러 번 있습니다. 중복 붙여넣기인지 확인해 주세요.`);
    if (order.orderNo) seen.add(order.orderNo);
  }
  return {orders, warnings};
}
