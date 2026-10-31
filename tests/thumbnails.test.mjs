import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';

const catalog = JSON.parse(await fs.readFile(new URL('../dist/catalog.json', import.meta.url), 'utf8'));
const registry = JSON.parse(await fs.readFile(new URL('../dist/thumbnails.json', import.meta.url), 'utf8'));
const productIds = new Set(catalog.products.map(product => String(product.id)));
const prefix = 'data:image/webp;base64,';

function webpBytes(uri, productId) {
  assert.equal(typeof uri, 'string', productId);
  assert.ok(uri.startsWith(prefix), `${productId} must contain an embedded WebP, not a remote URL.`);
  const encoded = uri.slice(prefix.length);
  assert.ok(encoded.length > 0 && encoded.length % 4 === 0, `${productId} has an incomplete Base64 payload.`);
  assert.match(encoded, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, productId);
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.toString('base64'), encoded, `${productId} must use canonical Base64.`);
  assert.ok(bytes.length >= 20 && bytes.length <= 256 * 1024, `${productId} must be a bounded thumbnail.`);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', productId);
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', productId);
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, `${productId} RIFF length must match the actual bytes.`);
  return bytes;
}

test('thumbnail registry contains only public catalog IDs and embedded image data', () => {
  assert.deepEqual(Object.keys(registry).sort(), ['products', 'schemaVersion', 'width']);
  assert.equal(registry.schemaVersion, 1);
  assert.ok([128, 144].includes(registry.width));
  assert.ok(registry.products && typeof registry.products === 'object' && !Array.isArray(registry.products));
  const entries = Object.entries(registry.products);
  assert.ok(entries.length > 0 && entries.length <= productIds.size);
  for (const [id, uri] of entries) {
    assert.match(id, /^[1-9]\d*$/);
    assert.ok(productIds.has(id), `${id} must identify an existing public product.`);
    assert.equal(typeof uri, 'string', `${id} must not contain arbitrary order/profile fields.`);
    assert.ok(uri.startsWith(prefix));
  }
  assert.doesNotMatch(JSON.stringify(registry), /https?:\/\//i, 'The delivered registry has no remote loader URLs or source request metadata.');
});

test('every cached WebP has valid bounded container chunks, expected dimensions and no EXIF/XMP payload', () => {
  for (const [id, uri] of Object.entries(registry.products)) {
    const bytes = webpBytes(uri, id);
    let offset = 12, dimensions, pixelPayload = false;
    while (offset < bytes.length) {
      assert.ok(offset + 8 <= bytes.length, `${id} has a truncated chunk header.`);
      const kind = bytes.toString('ascii', offset, offset + 4);
      const length = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + length;
      assert.ok(end <= bytes.length, `${id} has a truncated ${kind} chunk.`);
      assert.ok(['VP8X', 'VP8 ', 'VP8L', 'ALPH', 'ICCP'].includes(kind), `${id} has unexpected metadata/animation chunk ${kind}.`);
      if (kind === 'VP8X') {
        assert.ok(length >= 10);
        dimensions = [bytes.readUIntLE(start + 4, 3) + 1, bytes.readUIntLE(start + 7, 3) + 1];
      } else if (kind === 'VP8 ') {
        assert.ok(length >= 10);
        assert.equal(bytes.toString('hex', start + 3, start + 6), '9d012a');
        dimensions ??= [bytes.readUInt16LE(start + 6) & 0x3fff, bytes.readUInt16LE(start + 8) & 0x3fff];
        pixelPayload = true;
      } else if (kind === 'VP8L') {
        assert.ok(length >= 5); assert.equal(bytes[start], 0x2f);
        const bits = bytes.readUInt32LE(start + 1);
        dimensions ??= [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
        pixelPayload = true;
      }
      offset = end + (length % 2);
    }
    assert.equal(offset, bytes.length, `${id} has trailing or unpadded bytes.`);
    assert.equal(pixelPayload, true, `${id} must contain actual image pixels.`);
    assert.deepEqual(dimensions, [registry.width, registry.width], `${id} must use the declared square thumbnail size.`);
  }
});

test('products sharing the same public catalog image reuse identical cached WebP data when present', () => {
  const images = new Map();
  for (const product of catalog.products) {
    const uri = registry.products[String(product.id)];
    if (!uri) continue;
    const previous = images.get(product.imageUrl);
    if (previous) assert.equal(uri, previous.uri, `${product.id} and ${previous.id} share one source image and must reuse its cached thumbnail.`);
    else images.set(product.imageUrl, {id: product.id, uri});
  }
});

test('standalone offline HTML embeds the exact thumbnail registry instead of remote image loaders', async () => {
  const html = await fs.readFile(new URL('../dist/offline.html', import.meta.url), 'utf8');
  const bootstrap = html.match(/<script>window\.__ORDER_EXCEL_OFFLINE__=([\s\S]*?);<\/script>/);
  assert.ok(bootstrap, 'Build offline artifacts before running the full suite.');
  const payload = JSON.parse(bootstrap[1]);
  assert.ok(payload.json['thumbnails.json'], 'Rebuild offline artifacts after adding the thumbnail registry.');
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(digest(payload.json['thumbnails.json']), digest(registry), 'The offline snapshot must match the current thumbnail registry.');
  assert.match(html, /img-src data:/);
});
