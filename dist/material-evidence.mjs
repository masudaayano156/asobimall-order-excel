import {PRODUCT_MATERIALS} from './product-materials.mjs';

const records = new Map(PRODUCT_MATERIALS.map(record => [String(record.identity.id), record]));
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

/** Public material evidence belongs only to this exact catalog product. */
export function resolveProductMaterial(product) {
  if (!product) return null;
  const record = records.get(String(product.id)), identity = record?.identity;
  if (!identity || String(product.code ?? '') !== identity.code || product.productUrl !== identity.productUrl
    || normalized(product.name) !== normalized(identity.name) || record.sourceUrl !== identity.productUrl
    || !record.checkedAt || !/^[a-f0-9]{64}$/.test(record.descriptionSha256)) return null;
  const {material, facts, sourceUrl, checkedAt, descriptionSha256} = record;
  return {material, facts: [...facts], sourceUrl, checkedAt, descriptionSha256};
}
