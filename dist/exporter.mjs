import { unzipSync, zipSync, strFromU8, strToU8 } from './fflate.mjs';
import { shortenHoottownName } from './item-name.mjs';
import { formatPhone } from './phone.mjs';
import { formatJimpassName } from './jimpass-name.mjs';
import { getFixedShippingErrors } from './fixed-shipping.mjs';

const MAIN_SHEET = 'xl/worksheets/sheet1.xml';
const CELL_RE = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
const ROW_RE = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;

function attribute(xml, key) {
  return xml.match(new RegExp(`\\b${key}="([^"]*)"`))?.[1];
}

function setAttribute(tag, key, value) {
  const re = new RegExp(`\\s${key}="[^"]*"`);
  return re.test(tag)
    ? tag.replace(re, ` ${key}="${value}"`)
    : tag.replace(/\/?\>$/, (end) => ` ${key}="${value}"${end}`);
}

function xmlText(value) {
  const text = String(value ?? '');
  for (const character of text) {
    const cp = character.codePointAt(0);
    if ((cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13)
        || (cp >= 0xd800 && cp <= 0xdfff) || cp === 0xfffe || cp === 0xffff) {
      throw new Error('입력 내용에 엑셀에 저장할 수 없는 문자가 있습니다. 내용을 확인해 주세요.');
    }
  }
  return text
    .replace(/_x[0-9a-fA-F]{4}_/g, (match) => `_x005F_${match.slice(1)}`)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function cell(address, value, style) {
  const styleAttribute = style == null ? '' : ` s="${style}"`;
  if (value === undefined || value === null || value === '') return `<c r="${address}"${styleAttribute}/>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('상품 금액과 수량은 유한한 숫자여야 합니다.');
    return `<c r="${address}"${styleAttribute}><v>${value}</v></c>`;
  }
  // Explicit inline strings keep identifiers, leading zeros and formula-like text literal.
  return `<c r="${address}"${styleAttribute} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

function formulaAtRow(rule, rowNumber, baseRow) {
  if (typeof rule.formula !== 'string' || !/^[A-Z]+$/.test(rule.inputColumn ?? '')) throw new Error('원본 자동 코드 수식을 확인해 주세요.');
  const input = new RegExp(`(^|[^A-Za-z0-9_!$])(\\$?${rule.inputColumn})${baseRow}(?![A-Za-z0-9_])`, 'g');
  // Leave quoted text/sheet names, absolute rows and qualified lookup ranges alone.
  return rule.formula.split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/g)
    .map((part, index) => index % 2 ? part : part.replace(input, (_, before, column) => `${before}${column}${rowNumber}`)).join('');
}

function managedCell(address, value, style, formula) {
  const styleAttribute = style == null ? '' : ` s="${style}"`;
  const numeric = typeof value === 'number';
  if (numeric && !Number.isFinite(value)) throw new Error('자동 코드 계산값이 올바르지 않습니다.');
  const cached = numeric ? value : xmlText(value ?? '');
  return `<c r="${address}"${styleAttribute}${numeric ? '' : ' t="str"'}><f>${xmlText(formula)}</f><v>${cached}</v></c>`;
}

function rowCells(row) {
  return [...row.matchAll(CELL_RE)].map((match) => match[0]);
}

function inputStyles(row) {
  return Object.fromEntries(rowCells(row).map((entry) => [attribute(entry, 'r')?.replace(/\d+$/, ''), attribute(entry, 's')]));
}

function rowTag(row, rowNumber, defaultHeight = '16.5') {
  const opening = row?.match(/^<row\b[^>]*>/)?.[0];
  if (opening) return opening.replace(/\/>$/, '>');
  return `<row r="${rowNumber}" ht="${defaultHeight}" customHeight="1">`;
}

function tableXml(xml) {
  const table = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/);
  if (!table) throw new Error('엑셀 양식에서 입력 시트를 찾지 못했습니다.');
  return table[1];
}

function requireItems(items, maximum) {
  if (!Array.isArray(items) || !items.length) throw new Error('다운로드할 상품이 없습니다.');
  if (items.length > maximum) throw new Error(`한 파일에는 상품 ${maximum}개까지 넣을 수 있습니다.`);
  for (const [index, item] of items.entries()) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      throw new Error(`${index + 1}번째 상품의 수량은 1 이상의 정수여야 합니다.`);
    }
    if (typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice) || item.unitPrice < 0) {
      throw new Error(`${index + 1}번째 상품의 단가를 확인해 주세요.`);
    }
    if (Math.abs(item.unitPrice * 100 - Math.round(item.unitPrice * 100)) > 1e-7) {
      throw new Error(`${index + 1}번째 상품의 단가는 소수점 두 자리까지 입력해 주세요.`);
    }
  }
}

function jimpassSheet(xml, items, profile) {
  const originalRows = [...tableXml(xml).matchAll(ROW_RE)].map((match) => match[0]);
  const header = originalRows.find((row) => attribute(row, 'r') === '1');
  const sample = originalRows.find((row) => attribute(row, 'r') === '2');
  if (!header || !sample) throw new Error('짐패스 양식의 헤더 또는 서식을 찾지 못했습니다.');
  const styles = inputStyles(sample);
  const rows = items.map((item, index) => {
    const rowNumber = index + 2;
    const values = {
      A: formatJimpassName(item.name), B: String(item.category ?? ''), C: item.color ?? item.option ?? '', D: item.size ?? '',
      E: item.quantity, F: item.unitPrice, G: profile.brand ?? '', H: item.productUrl ?? '',
      I: item.imageUrl ?? '', J: String(item.orderNo ?? ''), K: String(item.tracking ?? profile.tracking ?? ''),
      L: '', M: String(item.orderNo ?? ''), N: profile.recipient ?? '', O: formatPhone(profile.phone, 'jimpass'),
      P: String(profile.postal ?? ''), Q: profile.address ?? '', R: profile.customs ?? '',
      S: profile.packingReinforce === 'Y' ? 'Y' : '', T: profile.businessCustoms === 'Y' ? 'Y' : '',
      U: profile.warehouseNote ?? '', V: profile.courierNote ?? '', W: profile.immediateRelease === 'Y' ? 'Y' : '',
      X: profile.inspection === 'Y' ? 'Y' : '', Y: item.localCarrier ?? profile.localCarrier ?? '', Z: profile.compensation === 'Y' ? 'Y' : '',
    };
    return `${rowTag(sample, rowNumber).replace(/\br="2"/, `r="${rowNumber}"`)}${Object.entries(values)
      .map(([column, value]) => cell(`${column}${rowNumber}`, value, styles[column] ?? '2')).join('')}</row>`;
  });
  let output = xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, () => `<sheetData>${header}${rows.join('')}</sheetData>`);
  output = output.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:Z${items.length + 1}"/>`);
  // Original sample hyperlinks point to unrelated products; URL cell values are authoritative.
  output = output.replace(/<hyperlinks\b[^>]*>[\s\S]*?<\/hyperlinks>/g, '');
  return output;
}

function lookupList(config, name) {
  if (name === 'categories') return config.categories ?? [];
  if (name === 'fixedShipping') return config.fixedShipping ?? [];
  return config.lists?.[name] ?? [];
}

function computeCodes(values, config) {
  for (const rule of Object.values(config.formulas ?? {})) {
    const input = values[rule.inputColumn];
    if (rule.rule) {
      values[rule.outputColumn] = input === rule.rule.sampleCustomsType
        ? rule.rule.sampleValue : input == null || input === '' ? rule.rule.blankInputValue : rule.rule.otherValue;
    } else {
      // Excel exact VLOOKUP distinguishes numeric keys from text keys.
      // Preserve that distinction in the cached result too.
      const found = lookupList(config, rule.lookupList).find((entry) => (entry[rule.lookupKey] ?? '') === (input ?? ''));
      values[rule.outputColumn] = found?.[rule.outputKey] ?? rule.whenInputNotFound ?? '';
    }
  }
  return values;
}

function generalSheet(xml, items, profile, config, fast = false) {
  if (!config?.headers || !config?.formulas || !config?.defaults) throw new Error('훗타운 양식 설정을 읽지 못했습니다.');
  const firstRow = config.startRow ?? 11;
  const lastRow = config.lastTemplateInputRow ?? 1000;
  const defaults = config.defaults;
  const groupKey = (item) => {
    const tracking = String(item.tracking ?? profile.tracking ?? '');
    return fast && tracking ? `tracking:${tracking}` : `order:${String(item.orderNo ?? '')}`;
  };
  let exportItems = items;
  if (fast) {
    // QUICK permits one application per tracking number. Gather nonadjacent matches first.
    const trackingGroups = new Map();
    for (const item of items) {
      const key = groupKey(item);
      if (!trackingGroups.has(key)) trackingGroups.set(key, []);
      trackingGroups.get(key).push(item);
    }
    exportItems = [...trackingGroups.values()].flat();
  }
  let group = 0;
  let previousOrder = Symbol('first order');
  const valuesByRow = new Map(exportItems.map((item, index) => {
    const orderNo = String(item.orderNo ?? '');
    const carrierLabel = item.carrier ?? profile.carrier ?? '';
    const carrier = config.lists?.carriers?.find((entry) => entry.label === carrierLabel);
    if (carrierLabel && !carrier) throw new Error('훗타운 양식에 등록된 운송사를 선택해 주세요.');
    if (profile.center && carrier && profile.center !== carrier.center) throw new Error('운송사와 이용 물류센터의 국가가 다릅니다.');
    const applicationKey = groupKey(item);
    if (applicationKey !== previousOrder) { group += 1; previousOrder = applicationKey; }
    const requestedFixedCode = item.fixedShippingCode ?? profile.fixedShippingCode ?? '';
    // Fixed-rate keys are numbers in the vendor lookup sheet. Category codes,
    // tracking numbers and other identifiers retain their existing text types.
    const fixedShippingCode = requestedFixedCode === '' ? ''
      : config.fixedShipping.find(entry => String(entry.code) === String(requestedFixedCode)).code;
    const values = {
      B: group, C: defaults.pickup, E: String(item.tracking ?? profile.tracking ?? ''), F: carrierLabel,
      H: defaults.destinationCountry, J: profile.recipient ?? '', K: defaults.customsType,
      N: profile.customs ?? '', O: defaults.phoneCountry, Q: formatPhone(profile.phone, 'general'),
      R: defaults.phoneCountry, T: formatPhone(profile.phone, 'general'), U: String(profile.postal ?? ''),
      V: profile.address ?? '', W: '', X: profile.shopUrl ?? '', Y: String(item.category ?? ''),
      AD: profile.brand ?? '', AE: shortenHoottownName(item.name), AF: item.unitPrice, AG: 'JPY',
    };
    if (fast) {
      // The official QUICK template has no order, color, size or product/image URL columns.
      Object.assign(values, {
        AH: item.quantity, AI: defaults.fta, AJ: defaults.automaticPointPayment,
        AK: fixedShippingCode,
        AM: defaults.giftRecipientDirectInput, AN: '', AO: '', AP: '', AR: '', AS: '', AT: defaults.taxAdvance,
      });
    } else {
      Object.assign(values, {
        AH: '', AI: '', AJ: item.quantity, AK: defaults.fta, AL: defaults.automaticPointPayment, AM: orderNo,
        AN: item.color ?? item.option ?? '', AO: item.size ?? '', AP: item.productUrl ?? '', AQ: item.imageUrl ?? '',
        AR: defaults.removeBrandBox, AS: defaults.removeInvoice, AT: defaults.insurance,
        AV: defaults.truePacking, AW: fixedShippingCode,
        AY: defaults.giftRecipientDirectInput, AZ: '', BA: '', BB: '', BD: '', BE: '', BF: defaults.taxAdvance,
      });
    }
    return [firstRow + index, computeCodes(values, config)];
  }));
  const data = tableXml(xml);
  const seenRows = new Set();
  const replacement = data.replace(ROW_RE, (row) => {
    const rowNumber = Number(attribute(row, 'r'));
    if (rowNumber < firstRow || rowNumber > lastRow) return row;
    seenRows.add(rowNumber);
    const values = valuesByRow.get(rowNumber);
    if (values) {
      const columnA = rowCells(row).find((entry) => attribute(entry, 'r') === `A${rowNumber}`) ?? '';
      return `${rowTag(row, rowNumber)}${columnA}${config.headers.map(({ column, row11Style }) => {
        const rule = config.formulas[column];
        return rule ? managedCell(`${column}${rowNumber}`, values[column], row11Style, formulaAtRow(rule, rowNumber, firstRow))
          : cell(`${column}${rowNumber}`, values[column], row11Style);
      }).join('')}</row>`;
    }
    // Retain the template's unused row geometry and styles while removing all stale values/shared formulas.
    return `${rowTag(row, rowNumber)}${rowCells(row).map((entry) => {
      const address = attribute(entry, 'r');
      if (!address || !/^[A-Z]+\d+$/.test(address)) return '';
      if (address.startsWith('A') && address.replace(/\d+$/, '') === 'A') return entry;
      return cell(address, '', attribute(entry, 's'));
    }).join('')}</row>`;
  });
  for (const rowNumber of valuesByRow.keys()) {
    if (!seenRows.has(rowNumber)) throw new Error('훗타운 양식의 입력 범위를 확인해 주세요.');
  }
  return xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, () => `<sheetData>${replacement}</sheetData>`);
}

function postmallSheet(xml, items, profile, config) {
  if (config?.provider !== 'postmall' || config.headers?.length !== 241 || config.itemSlots?.length !== 20 || !config.commonColumns) throw new Error('포스트몰 양식 설정을 확인해 주세요.');
  const firstRow = config.startRow ?? 4, lastRow = config.preformattedLastRow ?? 300;
  const originalRows = [...tableXml(xml).matchAll(ROW_RE)].map(match => match[0]);
  const byRow = new Map(originalRows.map(row => [Number(attribute(row, 'r')), row]));
  const sample = byRow.get(firstRow);
  if (!sample) throw new Error('포스트몰 입력행 서식을 찾지 못했습니다.');
  const styles = inputStyles(sample), groups = new Map();
  for (const item of items) {
    const key = item.orderIndex != null ? `index:${String(item.orderIndex)}` : `order:${String(item.orderNo ?? '')}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  if (groups.size > lastRow - firstRow + 1) throw new Error(`현재 제공 포스트몰 양식의 입력 범위는 신청서 ${lastRow - firstRow + 1}건입니다. 파일을 나누어 주세요.`);
  const reportType = String(profile.postmallCustomsType ?? '');
  if (!['', 'F', 'B'].includes(reportType)) throw new Error('포스트몰 통관 구분은 공란·F(일반)·B(목록) 중에서 선택해 주세요.');
  const packaging = profile.postmallPackaging == null || profile.postmallPackaging === '' ? 'A' : String(profile.postmallPackaging);
  if (!['A', 'B', 'C'].includes(packaging)) throw new Error('포스트몰 포장 방식은 A·B·C 중에서 선택해 주세요.');
  const selected = value => value === true || value === 'T' || value === 'TRUE' ? 'T' : '';
  const common = {
    senderName: String(profile.postmallBuyerName ?? '').trim() || profile.recipient || '',
    senderPhone: String(profile.postmallBuyerPhone ?? '').trim() || String(profile.phone ?? ''),
    customs: profile.customs ?? '', recipient: profile.recipient ?? '', postal: String(profile.postal ?? ''),
    address: profile.address ?? '', courierNote: profile.courierNote ?? '', phone: String(profile.phone ?? ''),
    cargoReportType: reportType, inspection: selected(profile.postmallInspection), bubbleWrap: selected(profile.postmallAircap),
    reinforcement: selected(profile.postmallReinforce), businessClearance: selected(profile.postmallBusiness),
    ftaClearance: '', packagingMode: packaging, removeInvoice: selected(profile.postmallInvoiceRemove),
    removeHanger: selected(profile.postmallHangerRemove), autoOutput: selected(profile.postmallAutomaticRelease),
    splitDeliveryBox: selected(profile.postmallSplitBoxes), splitDeliveryPolybag: selected(profile.postmallSplitPolybag),
  };
  const valuesByRow = new Map();
  for (const [index, group] of [...groups.values()].entries()) {
    if (group.length > 20) throw new Error(`포스트몰 신청서 ${index + 1}의 상품은 ${group.length}개입니다. 한 신청서에는 최대 20개까지 넣을 수 있으며 자동 분할하지 않습니다.`);
    if (new Set(group.map(item => String(item.orderNo ?? ''))).size > 1) throw new Error('같은 포스트몰 주문 구분에 서로 다른 주문번호가 있습니다. 주문 내역을 확인해 주세요.');
    const values = {};
    for (const [field, column] of Object.entries(config.commonColumns)) values[column] = field === 'merchantOrderNo' ? String(group[0].orderNo ?? '') : common[field] ?? '';
    for (const [slotIndex, item] of group.entries()) {
      const hs = String(item.postmallHsCode ?? item.hsCode ?? '').normalize('NFKC').replace(/[.\s]/gu, '');
      if (hs && !/^(?:\d{6}|\d{8}|\d{10})$/.test(hs)) throw new Error(`${index + 1}번째 포스트몰 신청서의 ${slotIndex + 1}번 HS CODE는 숫자 6·8·10자리로 입력해 주세요. 배대지별 품목코드는 사용할 수 없습니다.`);
      const totalCents = Math.round(item.unitPrice * 100) * item.quantity;
      if (!Number.isSafeInteger(totalCents)) throw new Error('포스트몰 상품 합계가 정확하게 계산할 수 있는 숫자 범위를 넘었습니다.');
      const product = {name: item.postmallName ?? item.name ?? '', brand: item.brand ?? profile.brand ?? '', color: item.color ?? item.option ?? '', size: item.size ?? '',
        quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: totalCents / 100, hsCode: hs,
        imageUrl: item.imageUrl ?? '', productUrl: item.productUrl ?? '', tracking: String(item.tracking ?? profile.tracking ?? '')};
      for (const [field, column] of Object.entries(config.itemSlots[slotIndex].columns)) values[column] = product[field] ?? '';
    }
    valuesByRow.set(firstRow + index, values);
  }
  const outputRows = originalRows.filter(row => Number(attribute(row, 'r')) < firstRow);
  for (let rowNumber = firstRow; rowNumber <= lastRow; rowNumber++) {
    const original = byRow.get(rowNumber) ?? sample;
    const values = valuesByRow.get(rowNumber) ?? {};
    const rowStyles = valuesByRow.has(rowNumber) ? styles : inputStyles(original);
    const opening = rowTag(original, rowNumber).replace(/\br="\d+"/, `r="${rowNumber}"`);
    outputRows.push(`${opening}${config.headers.map(({column}) => cell(`${column}${rowNumber}`, values[column], rowStyles[column] ?? styles[column])).join('')}</row>`);
  }
  return xml.replace(/<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/, () => `<sheetData>${outputRows.join('')}</sheetData>`);
}

function selectFirstSheet(files) {
  let workbook = strFromU8(files['xl/workbook.xml']);
  workbook = workbook.replace(/<workbookView\b[^>]*\/?\>/g, (tag) => setAttribute(setAttribute(tag, 'activeTab', '0'), 'firstSheet', '0'));
  files['xl/workbook.xml'] = strToU8(workbook);
  for (const path of Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))) {
    let xml = strFromU8(files[path]);
    xml = xml.replace(/<sheetView\b[^>]*\/?\>/g, (tag) => path === MAIN_SHEET
      ? setAttribute(tag, 'tabSelected', '1') : /\btabSelected="1"/.test(tag) ? setAttribute(tag, 'tabSelected', '0') : tag);
    files[path] = strToU8(xml);
  }
}

function removeCalcChain(files) {
  for (const name of Object.keys(files)) {
    if (/^xl\/calcChain\d*\.xml$/.test(name)) delete files[name];
  }
  const relationshipPath = 'xl/_rels/workbook.xml.rels';
  if (files[relationshipPath]) {
    files[relationshipPath] = strToU8(strFromU8(files[relationshipPath])
      .replace(/<Relationship\b[^>]*\bType="[^"]*\/calcChain"[^>]*\/>/g, ''));
  }
  if (files['[Content_Types].xml']) {
    files['[Content_Types].xml'] = strToU8(strFromU8(files['[Content_Types].xml'])
      .replace(/<Override\b[^>]*\bPartName="\/xl\/calcChain\d*\.xml"[^>]*\/>/g, ''));
  }
}

function enableAutoCalculation(files) {
  let workbook = strFromU8(files['xl/workbook.xml']);
  const update = tag => setAttribute(setAttribute(setAttribute(tag, 'calcMode', 'auto'), 'fullCalcOnLoad', '1'), 'forceFullCalc', '1');
  if (/<calcPr\b/.test(workbook)) workbook = workbook.replace(/<calcPr\b[^>]*>/, update);
  else workbook = workbook.replace(/<(?:oleSize|customWorkbookViews|ignoredErrors|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/,
    tag => `${update('<calcPr/>')}${tag}`);
  files['xl/workbook.xml'] = strToU8(workbook);
}

/** Create a real XLSX from the supplied template entirely in the browser. */
export function exportWorkbook({ template, templateBytes, items, profile = {}, config }) {
  if (!['jimpass', 'general', 'hoottown-fast', 'postmall'].includes(template)) throw new Error('다운로드 양식을 선택해 주세요.');
  const maximum = template === 'postmall' ? (config?.preformattedRequestRows ?? 297) * 20 : template === 'jimpass' ? 10000 : config?.maxTemplateProducts ?? 990;
  requireItems(items, maximum);
  const fixedShippingErrors = getFixedShippingErrors({template, items, profile, config});
  if (fixedShippingErrors.length) throw new Error(fixedShippingErrors.join('\n'));
  const files = unzipSync(templateBytes);
  if (!files[MAIN_SHEET] || !files['xl/workbook.xml']) throw new Error('올바른 엑셀 양식이 아닙니다.');
  const xml = strFromU8(files[MAIN_SHEET]);
  files[MAIN_SHEET] = strToU8(template === 'jimpass' ? jimpassSheet(xml, items, profile)
    : template === 'postmall' ? postmallSheet(xml, items, profile, config)
    : generalSheet(xml, items, profile, config, template === 'hoottown-fast'));
  if (template === 'jimpass' && files['xl/worksheets/_rels/sheet1.xml.rels']) {
    const path = 'xl/worksheets/_rels/sheet1.xml.rels';
    files[path] = strToU8(strFromU8(files[path]).replace(/<Relationship\b[^>]*\bType="[^"]*\/hyperlink"[^>]*\/>/g, ''));
  }
  removeCalcChain(files);
  selectFirstSheet(files);
  if (template === 'general' || template === 'hoottown-fast') enableAutoCalculation(files);
  return zipSync(files, { level: 6 });
}
