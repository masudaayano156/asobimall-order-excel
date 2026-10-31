import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';
import {build} from 'esbuild';
import {zipSync} from '../dist/fflate.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
await import('./build-product-classifications.mjs');
const dist = path.join(root, 'dist');
const read = relative => fs.readFile(path.join(root, relative));
const text = async relative => (await read(relative)).toString('utf8');
const jsonNames = ['general-config.json', 'fast-config.json', 'catalog.json', 'thumbnails.json', 'postmall-config.json'];
const templateKinds = ['jimpass', 'general', 'hoottown-fast', 'postmall'];
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; font-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";

// Explicit public-file allowlist. Do not walk the checkout or include Git,
// deployment manifests, reference captures, credentials, or user order data.
const sourceFiles = [
  'dist/postmall-hs.mjs', 'tests/postmall-hs.test.mjs',
  'dist/fixed-shipping.mjs', 'tests/fixed-shipping.test.mjs',
  'scripts/prepare_postmall_template.py', 'tests/postmall-export.test.mjs',
  'README.md', 'SECURITY.md', '.gitignore', 'package.json', 'package-lock.json', 'scripts/build-offline.mjs',
  'dist/index.html', 'dist/style.css', 'dist/app.mjs', 'dist/data.mjs', 'dist/_headers', 'dist/local-file-entry.js',
  'dist/parser.mjs', 'dist/catalog-match.mjs', 'dist/categories.mjs',
  'dist/category-rules.json', 'dist/product-classifications.json', 'dist/product-classifications.mjs',
  'dist/classification-coverage.json', 'scripts/build-product-classifications.mjs',
  'scripts/merge-classification-reviews.mjs', 'scripts/fetch_classification_details.py', 'scripts/crawl_catalog.py',
  'dist/exporter.mjs', 'dist/navigation.mjs', 'dist/postcode.mjs', 'dist/postcode-search.html', 'dist/item-name.mjs',
  'dist/product-picker.mjs', 'dist/product-picker.css', 'scripts/build_thumbnails.py', 'dist/phone.mjs',
  'dist/order-sections.mjs', 'dist/order-sections.css', 'scripts/apply-mixed-goods-policy.mjs',
  'dist/jimpass-name.mjs',
  'dist/download-review.mjs', 'dist/download-review.css',
  'dist/fflate.mjs', 'dist/fflate-LICENSE.txt',
  'scripts/enrich_catalog_english.py', 'scripts/catalog-english-overrides.json', 'scripts/sanitize_templates.py',
  'tests/bulk-classifications.test.mjs', 'tests/catalog-match.test.mjs', 'tests/categories.test.mjs',
  'tests/download-review.test.mjs', 'tests/english-orders.test.mjs', 'tests/exporter.test.mjs',
  'tests/hoottown-names.test.mjs', 'tests/item-name.test.mjs', 'tests/jimpass-name-export.test.mjs',
  'tests/jimpass-name.test.mjs', 'tests/local-file-entry.test.mjs', 'tests/mixed-random-goods.test.mjs',
  'tests/offline.test.mjs', 'tests/parser.test.mjs', 'tests/phone-export.test.mjs', 'tests/phone.test.mjs',
  'tests/postcode.test.mjs', 'tests/product-classification.test.mjs', 'tests/thumbnails.test.mjs',
  ...jsonNames.map(name => `dist/${name}`),
  ...templateKinds.map(kind => `dist/templates/${kind}.xlsx`),
].sort();

const [index, baseCss, pickerCss, ordersCss, reviewCss, app] = await Promise.all(['dist/index.html', 'dist/style.css', 'dist/product-picker.css', 'dist/order-sections.css', 'dist/download-review.css', 'dist/app.mjs'].map(text));
const css = `${baseCss}\n${pickerCss}\n${ordersCss}\n${reviewCss}`;
if (!/from\s*['"]\.\/data\.mjs(?:\?v=\d+)?['"]/.test(app) || /\bfetch\s*\(/.test(app)) {
  throw new Error('app.mjs must use loadJson/loadTemplate from data.mjs before building offline.');
}
if (/@import\b|url\s*\(\s*['"]?(?!data:)/i.test(css)) throw new Error('Offline CSS contains an external resource. Inline the asset first.');
if (!/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\.\/app\.mjs(?:\?v=\d+)?["'][^>]*>\s*<\/script>/i.test(index)) {
  throw new Error('Expected the local app.mjs module entrypoint in index.html.');
}

const payload = {json: {}, templates: {}};
for (const name of jsonNames) payload.json[name] = JSON.parse(await text(`dist/${name}`));
for (const kind of templateKinds) payload.templates[kind] = (await read(`dist/templates/${kind}.xlsx`)).toString('base64');
const safeJson = JSON.stringify(payload).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const bundled = await build({
  absWorkingDir: root,
  entryPoints: ['dist/app.mjs'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: ['chrome111', 'edge111', 'firefox115', 'safari16'],
  minify: true, sourcemap: false, legalComments: 'inline', charset: 'utf8',
});
if (bundled.outputFiles.length !== 1) throw new Error('Offline build unexpectedly emitted multiple assets.');
const appBundle = bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

let html = index
  .replace(/<meta\b[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>\s*/gi, '')
  .replace(/<link\b[^>]*>\s*/gi, '')
  .replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>\s*/gi, '')
  .replace(/<div\b[^>]*class=["']privacy-downloads["'][^>]*>[\s\S]*?<\/div>/i,
    '<p class="privacy-offline-note">현재 파일에 코드·공개 상품 목록·엑셀 양식이 모두 포함되어 있습니다. 파일을 보관하고 인터넷 연결을 끊은 상태로 사용할 수 있습니다.</p>')
  .replace('온라인 화면은 공개 상품 목록과 엑셀 양식·설정 파일을 불러옵니다.', '이 오프라인 파일에는 공개 상품 목록과 엑셀 양식·설정 파일이 포함되어 있습니다.')
  .replace(/href=["']\.\/["']/g, 'href="#template-section"')
  .replace(/<meta\s+charset=["']UTF-8["']\s*>/i, match => `${match}\n  <meta http-equiv="Content-Security-Policy" content="${policy}">`)
  .replace('</head>', () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>\n</head>`)
  .replace('</body>', () => `<script>window.__ORDER_EXCEL_OFFLINE__=${safeJson};</script>\n<script>${appBundle}</script>\n</body>`);

if (/<script\b[^>]*\bsrc=|<script\b[^>]*\btype=["']module|<link\b|<iframe\b|<object\b/i.test(html)) throw new Error('Standalone HTML still references an external asset or module.');
if (/href=["']\.\/(?:offline\.(?:html|zip)|source\.zip|checksums\.txt)["']/i.test(html)) throw new Error('Standalone HTML still has a circular download link.');
// Replacement callbacks preserve literal $&, $` and $' in bundled code/data.
// Parse the final HTML scripts without running them before writing any output.
const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (inlineScripts.length !== 2) throw new Error('Standalone HTML must have exactly two inline scripts.');
for (const [index, match] of inlineScripts.entries()) {
  try { new Script(match[1]); }
  catch (error) { throw new Error(`Offline inline script ${index + 1} is invalid: ${error.message}`); }
}
await fs.writeFile(path.join(dist, 'offline.html'), html, 'utf8');

const zipEntries = {};
const fixedDate = new Date(1980, 0, 1, 0, 0, 0);
for (const relative of sourceFiles) zipEntries[relative] = [new Uint8Array(await read(relative)), {mtime: fixedDate, level: 9}];
const sourceZip = zipSync(zipEntries, {level: 9});
await fs.writeFile(path.join(dist, 'source.zip'), sourceZip);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const htmlBytes = Buffer.from(html, 'utf8');
const offlineReadme = `주문 한 장 — 오프라인 사용 방법\n\n1. 이 ZIP 파일의 압축을 풀어 주세요.\n2. 인터넷 연결을 끊어도 사용할 수 있습니다.\n3. 압축을 푼 order-excel-offline.html 파일을 브라우저로 열어 주세요. 별도 서버나 설치가 필요하지 않습니다.\n4. 주문 내역을 붙여넣고 엑셀 파일을 다운로드하세요.\n\n코드·공개 상품 목록·네 가지 엑셀 양식이 HTML 파일 안에 포함되어 있습니다.\n입력한 주문과 수취인 정보는 페이지 메모리에서 처리하며, 다운로드한 엑셀 파일은 기기에 남습니다.\n공개 상품 목록은 이 파일을 만들 때의 자료이므로 최신 상품이 없으면 내용을 직접 확인해 주세요.\n\norder-excel-offline.html SHA-256\n${sha256(htmlBytes)}\n\n해시는 파일 내용 확인 자료이며 외부 보안 인증을 의미하지 않습니다.\nfflate 라이선스는 함께 포함한 fflate-LICENSE.txt를 확인해 주세요.\n`;
const offlineEntries = {};
for (const [name, bytes] of [
  ['README.txt', Buffer.from(offlineReadme, 'utf8')],
  ['fflate-LICENSE.txt', await read('dist/fflate-LICENSE.txt')],
  ['order-excel-offline.html', htmlBytes],
]) offlineEntries[name] = [new Uint8Array(bytes), {mtime: fixedDate, level: 9}];
const offlineZip = zipSync(offlineEntries, {level: 9});
await fs.writeFile(path.join(dist, 'offline.zip'), offlineZip);
const checksums = `${sha256(offlineZip)}  offline.zip\n${sha256(sourceZip)}  source.zip\n`;
await fs.writeFile(path.join(dist, 'checksums.txt'), checksums, 'utf8');
console.log(JSON.stringify({offlineBytes: htmlBytes.length, offlineZipBytes: offlineZip.length, sourceZipBytes: sourceZip.length, sourceFiles: sourceFiles.length, outputs: ['dist/offline.html', 'dist/offline.zip', 'dist/source.zip', 'dist/checksums.txt']}, null, 2));
