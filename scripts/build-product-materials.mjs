// Manual public-evidence refresh. Offline builds use the checked-in snapshot.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const catalog = JSON.parse(await fs.readFile(path.join(root, 'dist/catalog.json'), 'utf8'));
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const sha = value => createHash('sha256').update(value).digest('hex');
const materialLabel = /^(?:(?:本体|表地|裏地|本体部分|印刷部|製品|商品の?)[の\s]*)?(?:素材|材質|原材料名?|materials?)(?:\s*[:：].*)?$/i;
const materialWord = /COTTON|POLYESTER|ACRYLIC|NYLON|PAPER|PLASTIC|GLASS|CERAMIC|PORCELAIN|LINEN|RUBBER|SILK|WOOD|\b(?:PET|PVC|PP|ABS|PC|PU|PS|AS|TPU|PE|POM|TPE)\b|綿|コットン|ポリエステル|アクリル|ナイロン|紙|樹脂|ガラス|陶磁|陶器|磁器|麻|リネン|ゴム|絹|シルク|木|亜鉛|鉄|金属|ステンレス|アルミ|ポリウレタン|ウール|羊毛|レーヨン|シリコン|ポリカーボネート|ポリプロピレン|ポリエチレン|ポリアミド|牛革|合成皮革|ポリ塩化ビニル|砂糖|米|小麦|ココア|糖/i;
const unrelated = /販売|送料|配送|発送|予約|返品|キャンセル|ご注文|お問い合わせ|お問合せ|購入|お届け|https?:|@|copyright|Material Stock Design Store/i;

export function compactMaterialSections(sections) {
  const result = [];
  for (const section of Array.isArray(sections) ? sections : []) {
    const label = normalized(section.label);
    if (!materialLabel.test(label)) continue;
    const inline = label.match(/[:：]\s*(.+)$/)?.[1] ?? '';
    const lines = [];
    for (const raw of [inline, ...String(section.text ?? '').split(/\r?\n/)]) {
      const line = normalized(raw);
      if (!line) continue;
      if (unrelated.test(line) || line.length > 300) break;
      if (materialWord.test(line)) lines.push(line);
      if (lines.length >= 8) break;
    }
    if (lines.length) result.push(`${label.replace(/[:：].*$/, '')}: ${lines.join(' / ')}`.slice(0, 1000));
  }
  return [...new Set(result)].slice(0, 6).join('\n');
}

export function compactProductFacts(cache) {
  const lines = [];
  for (const section of cache.explicitSections ?? []) {
    const label = normalized(section.label);
    if (!/^(?:仕様|商品仕様|商品説明|内容|商品内容|収録曲|収録内容|電池|使用電池|電源|SPECIFICATIONS?|CONTENTS?)$/i.test(label)) continue;
    for (const raw of section.lines ?? []) {
      const line = normalized(raw);
      if (!line || unrelated.test(line) || line.length > 240) continue;
      if (/電池|乾電池|充電|USB|BATTER(?:Y|IES)|\bCD\b|DVD|BLU[- ]?RAY|ブルーレイ|収録曲|収録内容/i.test(line)) lines.push(line);
      if (lines.length >= 8) return [...new Set(lines)];
    }
  }
  return [...new Set(lines)].slice(0, 8);
}

async function main() {
const records = [];
let cached = 0, nameMismatch = 0;
for (const product of catalog.products) {
  let cache;
  try { cache = JSON.parse(await fs.readFile(path.join(root, `references/classification-details/${product.id}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  if (cache.id !== product.id || cache.slug !== product.slug || cache.productUrl !== product.productUrl
    || cache.detail?.id !== product.id || cache.source?.pageUrl !== product.productUrl
    || cache.source?.status !== 200 || !/^[a-f0-9]{64}$/.test(cache.source?.responseSha256 ?? '')
    || sha(cache.detail?.description ?? '') !== cache.source?.descriptionHtmlSha256) throw new Error(`Invalid public material cache identity/hash: ${product.code}`);
  cached++;
  if (normalized(cache.detail.name) !== normalized(product.name)) { nameMismatch++; continue; }
  const material = compactMaterialSections(cache.material), facts = compactProductFacts(cache);
  if (!material && !facts.length) continue;
  records.push({identity: {id: product.id, code: product.code, name: product.name, productUrl: product.productUrl},
    material, facts, sourceUrl: product.productUrl, checkedAt: cache.fetchedAt,
    descriptionSha256: cache.source.descriptionHtmlSha256, responseSha256: cache.source.responseSha256});
}
const body = JSON.stringify(records, null, 2).replace(/</g, '\\u003c');
await fs.writeFile(path.join(root, 'dist/product-materials.mjs'), `// Generated from identity-checked public product details. No customer/order data.\nexport const PRODUCT_MATERIALS = ${body};\n`);
console.log(JSON.stringify({catalog: catalog.products.length, cached, nameMismatch, materialRecords: records.length}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
