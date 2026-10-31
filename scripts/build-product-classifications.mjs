import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {applyMixedGoodsPolicy} from './apply-mixed-goods-policy.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const registryPath = path.join(root, 'dist/product-classifications.json');
const dataset = JSON.parse(await fs.readFile(registryPath, 'utf8'));
const catalog = JSON.parse(await fs.readFile(path.join(root, 'dist/catalog.json'), 'utf8'));
const general = JSON.parse(await fs.readFile(path.join(root, 'dist/general-config.json'), 'utf8'));
const mixedGoodsPolicy = applyMixedGoodsPolicy(dataset, general, catalog);
if (mixedGoodsPolicy.changed) await fs.writeFile(registryPath, JSON.stringify(dataset, null, 2) + '\n');
const byCode = new Map(catalog.products.map(product => [String(product.code), product]));
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const seen = new Set();
const allowedStatuses = new Set(['mapped', 'non_physical', 'needs_review', 'source_missing']);
const records = dataset.reviewedProducts;
if (!Array.isArray(records)) throw new Error('reviewedProducts must be an array.');
const jimpassCodes = new Map((dataset.codeSources?.jimpass?.categories ?? []).map(entry => [String(entry.code), entry]));
for (const record of records) {
  const identity = record.identity;
  const actual = byCode.get(identity?.code);
  if (!identity || !actual || seen.has(identity.code)) throw new Error(`Unknown or duplicate product: ${identity?.code}`);
  seen.add(identity.code);
  if (String(actual.id) !== String(identity.id) || actual.productUrl !== identity.productUrl || normalized(actual.name) !== normalized(identity.name)) throw new Error(`Product identity changed: ${identity.code}`);
  if (!allowedStatuses.has(record.status)) throw new Error(`Invalid review status: ${identity.code}`);
  if (!record.kind || !record.label || !record.reason) throw new Error(`Missing review explanation: ${identity.code}`);
  if (!record.evidence || record.evidence.sourceUrl !== actual.productUrl || !record.evidence.checkedAt) throw new Error(`Missing detail evidence: ${identity.code}`);
  if (record.status !== 'source_missing' && !/^[a-f0-9]{64}$/.test(record.evidence.descriptionSha256 ?? '')) throw new Error(`Missing source description hash: ${identity.code}`);
  if (record.status === 'mapped' && (!record.jimpass?.code || !record.general?.code)) throw new Error(`Mapped product is missing a forwarder code: ${identity.code}`);
  if (record.status === 'non_physical' && (record.jimpass?.code || record.general?.code)) throw new Error(`Nonphysical product has a shipping code: ${identity.code}`);
  if (record.general?.code) {
    const category = general.categories.find(entry => entry.code === record.general.code);
    if (!category || category.item !== record.general.label) throw new Error(`Invalid Hoottown category: ${identity.code}`);
    if (/미국센터만/.test(category.category)) throw new Error(`Hoottown category is not available for the Japanese center: ${identity.code}`);
  }
  if (record.jimpass?.code) {
    const category = jimpassCodes.get(record.jimpass.code);
    if (!category || record.jimpass.source !== category.source || normalized(record.jimpass.label) !== normalized(category.label)) throw new Error(`Invalid Jimpass category/provenance: ${identity.code}`);
  }
}
const body = JSON.stringify(records, null, 2).replace(/</g, '\\u003c');
await fs.writeFile(path.join(root, 'dist/product-classifications.mjs'), `// Generated from product-classifications.json by scripts/build-product-classifications.mjs.\nexport const PRODUCT_DETAIL_CLASSIFICATIONS = ${body};\n`);
const {CATEGORY_RULES, classifyCatalogProduct} = await import(pathToFileURL(path.join(root, 'dist/categories.mjs')).href);
await fs.writeFile(path.join(root, 'dist/category-rules.json'), JSON.stringify(CATEGORY_RULES, null, 2) + '\n');
const rows = catalog.products.map(product => {
  const classification = classifyCatalogProduct(product);
  const reviewed = records.find(record => record.identity.code === product.code);
  return {code: product.code, id: product.id, name: product.enName || product.name,
    productUrl: product.productUrl, kind: classification.kind,
    jimpassCode: classification.jimpassCode, generalCode: classification.generalCode,
    status: reviewed?.status ?? (classification.source === 'product-detail' ? 'preexisting_detail' : classification.jimpassCode && classification.generalCode ? 'name_rule' : 'not_reviewed'),
    requiresReview: classification.requiresReview, reason: classification.reason};
});
const counts = {};
for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
const report = {schemaVersion: 1, generatedAt: dataset.reviewScope?.completedAt ?? null, catalogProducts: rows.length,
  detailReviewedProducts: CATEGORY_RULES.productOverrides.filter(entry => entry.status !== 'source_missing').length, byStatus: counts,
  productsWithBothCodes: rows.filter(row => row.jimpassCode && row.generalCode).length,
  productsWithoutBothCodes: rows.filter(row => !row.jimpassCode || !row.generalCode).length,
  products: rows};
await fs.writeFile(path.join(root, 'dist/classification-coverage.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({reviewed: records.length, productsWithBothCodes: report.productsWithBothCodes,
  productsWithoutBothCodes: report.productsWithoutBothCodes, byStatus: counts}, null, 2));
