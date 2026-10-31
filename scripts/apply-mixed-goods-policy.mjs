import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const MIXED_GOODS_POLICY_ID = 'mixed-goods-kind-suggestion-v2';
const EXCLUDED_CODES = new Set(['FZ-00308', 'CT-00034']);
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const specialContents = /반창고|의료|의약|絆創膏|ばんそうこう|医療|医薬|\bBAND[ -]?AID\b|\bBANDAGES?\b|抽選|くじ|クジ|[SABCDE]賞|10連|추첨|\bLOTTERY\b|\bKUJI\b|전자.?티켓|디지털|다운로드|電子チケット|デジタル|ダウンロード|\bDIGITAL\b|\bDOWNLOAD\b/i;
const itemGroups = [
  /배지|뱃지|缶バッジ|缶バッチ|ピンズ|\bBADGES?\b/i,
  /스티커|테이프|메모|シール|ステッカー|テープ|\bSTICKERS?\b/i,
  /키링|키홀더|참|キーホルダー|アクキー|チャーム|\bKEYCHAIN\b|\bCHARM\b/i,
  /파우치|주머니|가방|토트|ポーチ|巾着|バッグ|トート|上履き入れ|\bPOUCH\b|\bBAG\b/i,
  /타월|수건|손수건|タオル|ハンカチ|\bTOWEL\b/i,
  /밴드|팔찌|バンド|ブレス|\bBRACELET\b/i,
  /마커|클립|태그|케이스|스탠드|マーカー|クリップ|タグ|ケース|スタンド|\bSTAND\b/i,
];

/** Mutate only reviewed, identity-matched registry records; never create a name rule. */
export function applyMixedGoodsPolicy(dataset, generalConfig, catalog) {
  if (!Array.isArray(dataset?.reviewedProducts) || !Array.isArray(catalog?.products)) throw new Error('Reviewed registry and public catalog are required.');
  const j = dataset.codeSources?.jimpass?.categories?.find(entry => String(entry.code) === '205');
  const toy = generalConfig?.categories?.find(entry => String(entry.code) === '127');
  const goods = generalConfig?.categories?.find(entry => String(entry.code) === '105');
  if (!j?.label || j.parentCode !== '204' || j.source !== 'https://www.jimpass.com/tool/agencyCategory.php?category=204') throw new Error('Canonical Jimpass 205 code provenance is missing.');
  if (toy?.item !== '[목록통관] 기타 완구' || toy.row !== 129 || toy.categoryCode !== 10005 || toy.itemCode !== 2000127) throw new Error('Canonical Hoottown toy code provenance is missing.');
  if (goods?.item !== '[목록통관] 기타 문구/생활용품' || goods.row !== 107 || goods.categoryCode !== 10003 || goods.itemCode !== 2000105) throw new Error('Canonical Hoottown general-goods code provenance is missing.');
  const codeJ = {code: '205', label: j.label, source: j.source};
  const byCode = new Map(catalog.products.map(product => [String(product.code), product]));
  const result = {policyId: MIXED_GOODS_POLICY_ID, changed: 0, applied: [], skipped: []};
  for (const record of dataset.reviewedProducts) {
    if (record.kind !== 'mixed_random_goods' || record.status !== 'needs_review') continue;
    const identity = record.identity, actual = byCode.get(identity?.code);
    let skip = '';
    if (EXCLUDED_CODES.has(identity?.code)) skip = 'explicit-exclusion';
    else if (!actual || String(actual.id) !== String(identity.id) || actual.productUrl !== identity.productUrl || normalize(actual.name) !== normalize(identity.name)) skip = 'identity-mismatch';
    else if (record.evidence?.sourceUrl !== identity.productUrl || !record.evidence?.checkedAt || !/^[a-f0-9]{64}$/.test(record.evidence?.descriptionSha256 ?? '')) skip = 'detail-evidence-missing';
    const facts = Array.isArray(record.evidence?.facts) ? record.evidence.facts.filter(value => typeof value === 'string').join('\n') : '';
    if (!skip && specialContents.test(identity.name + '\n' + facts)) skip = 'special-category-or-lottery';
    if (!skip && (!facts.trim() || itemGroups.filter(pattern => pattern.test(facts)).length < 2)) skip = 'composition-not-specific';
    if (skip) { result.skipped.push({code: identity?.code ?? '', reason: skip}); continue; }
    // The vendor's old spreadsheet calls 291 generic ETC, while its live
    // commodity table maps 2000291 to iron/steel. Never use it as a goods fallback.
    const capsule = /ランダムカプセル|\bRANDOM\s+CAPSULE\b/i.test(identity.name);
    const category = capsule ? toy : goods;
    const codeG = {code: String(category.code), label: category.item, source: {file: 'General_Excel_Upload.xlsx', sheet: '카테고리 품목 코드', range: `A${category.row}:C${category.row}`}};
    const before = JSON.stringify(record);
    if (!Object.hasOwn(record, 'policyOriginalReviewReason')) record.policyOriginalReviewReason = record.reviewReason ?? '';
    Object.assign(record, {
      label: capsule ? '랜덤 캡슐 굿즈 · 기타 완구 제안' : '혼합 랜덤 굿즈 · 문구·생활용품 제안',
      reason: capsule ? '상세 구성에 확인된 수집용 랜덤 캡슐 굿즈를 기타 완구로 제안했습니다. 실제 수령 구성과 배대지 분류를 확인해 주세요.' : '상세에서 확인된 문구·장식·생활 잡화의 혼합 구성을 문구·생활용품으로 제안했습니다. 실제 수령 구성과 배대지 분류를 확인해 주세요.',
      jimpass: structuredClone(codeJ), general: structuredClone(codeG), requiresReview: true,
      reviewReason: '자동 제안된 넓은 분류입니다. 실제 수령품과 배대지 안내를 확인해 주세요.',
      mappingPolicy: {id: MIXED_GOODS_POLICY_ID, mode: 'automatic-broad-suggestion', basedOn: 'reviewed-composition-facts', requiresUserReview: true, officialDetermination: false, fallbackKind: 'other_toy'},
    });
    result.applied.push(identity.code);
    if (JSON.stringify(record) !== before) result.changed++;
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
  const registryPath = path.join(root, 'dist/product-classifications.json');
  const [dataset, general, catalog] = await Promise.all(['dist/product-classifications.json', 'dist/general-config.json', 'dist/catalog.json'].map(async relative => JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'))));
  const result = applyMixedGoodsPolicy(dataset, general, catalog);
  if (result.changed) await fs.writeFile(registryPath, JSON.stringify(dataset, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
