import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const read = async relative => JSON.parse(await fs.readFile(path.join(root, relative), 'utf8'));
const inventoryText = await fs.readFile(path.join(root, '.verification/unclassified-products.json'), 'utf8');
const inventory = JSON.parse(inventoryText);
const expected = new Map(inventory.products.map(product => [String(product.id), product]));
const codebook = await read('.verification/jimpass-category-codes.json');
const general = await read('dist/general-config.json');
const jimpassCodes = new Map(codebook.categories.map(entry => [String(entry.code), entry]));
const normalize = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
const combined = new Map();
for (const group of ['a', 'b', 'c']) {
  const document = await read(`.verification/classification-review-${group}.json`);
  const records = Array.isArray(document) ? document : document.records;
  const assignment = await read(`.verification/review-${group}-assignment.json`);
  const assignedIds = new Set(assignment.products.map(product => String(product.id)));
  if (!Array.isArray(records) || records.length !== assignedIds.size) throw new Error(`Review ${group} is incomplete: ${records?.length}/${assignedIds.size}`);
  for (const record of records) {
    const id = String(record.identity?.id);
    const product = expected.get(id);
    if (!product || !assignedIds.has(id) || combined.has(id)) throw new Error(`Unexpected/duplicate reviewed product: ${record.identity?.code}`);
    if (record.identity.code !== product.code || record.identity.productUrl !== product.productUrl || normalize(record.identity.name) !== normalize(product.name)) throw new Error(`Reviewed identity does not match catalog: ${product.code}`);
    const detail = await read(`references/classification-details/${id}.json`);
    if (record.evidence?.descriptionSha256 !== detail.source.descriptionHtmlSha256 || record.evidence?.sourceUrl !== product.productUrl) throw new Error(`Reviewed evidence does not match saved official detail: ${product.code}`);
    if (record.evidence.responseSha256 && record.evidence.responseSha256 !== detail.source.responseSha256) throw new Error(`Reviewed response hash mismatch: ${product.code}`);
    record.identity = {code: product.code, id: product.id, name: product.name, productUrl: product.productUrl};
    if (record.jimpass?.code) {
      record.jimpass.code = String(record.jimpass.code);
      const source = jimpassCodes.get(record.jimpass.code);
      if (!source || record.jimpass.source !== source.source) throw new Error(`Unverified Jimpass code: ${product.code}`);
      record.jimpass.label = source.label;
    }
    if (record.general?.code) {
      record.general.code = String(record.general.code).padStart(3, '0');
      const source = general.categories.find(entry => entry.code === record.general.code);
      if (!source || record.general.source?.range !== `A${source.row}:C${source.row}`) throw new Error(`Unverified Hoottown code: ${product.code}`);
      record.general.label = source.item;
      record.general.source = {file: 'General_Excel_Upload.xlsx', sheet: '카테고리 품목 코드', range: `A${source.row}:C${source.row}`};
    }
    if (record.reason.length > 160) throw new Error(`Review explanation should be concise: ${product.code}`);
    combined.set(id, record);
  }
}
if (combined.size !== expected.size) throw new Error(`Incomplete review union: ${combined.size}/${expected.size}`);
const dataset = await read('dist/product-classifications.json');
dataset.reviewScope = {
  catalogProducts: inventory.total, requestedProducts: inventory.pendingCount,
  productIds: inventory.products.map(product => product.id),
  inventorySha256: createHash('sha256').update(inventoryText).digest('hex'),
  completedAt: new Date().toISOString(), timeZone: 'Asia/Seoul',
};
dataset.codeSources = {jimpass: codebook, hoottown: {file: 'General_Excel_Upload.xlsx', sheet: '카테고리 품목 코드', configuration: 'dist/general-config.json'}};
dataset.reviewedProducts = inventory.products.map(product => combined.get(String(product.id)));
const target = path.join(root, 'dist/product-classifications.json');
await fs.writeFile(target + '.tmp', JSON.stringify(dataset, null, 2) + '\n');
await fs.rename(target + '.tmp', target);
const counts = {};
for (const record of dataset.reviewedProducts) counts[record.status] = (counts[record.status] ?? 0) + 1;
console.log(JSON.stringify({reviewed: combined.size, expected: expected.size, byStatus: counts}, null, 2));
