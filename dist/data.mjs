/** Read public catalog/templates from HTTP or from the standalone offline bundle. */

const JSON_FILES = new Set(['general-config.json', 'fast-config.json', 'catalog.json', 'thumbnails.json', 'postmall-config.json']);
const TEMPLATE_KINDS = new Set(['jimpass', 'general', 'hoottown-fast', 'postmall']);

function embeddedData() {
  return globalThis.window?.__ORDER_EXCEL_OFFLINE__;
}

function jsonName(path) {
  const name = typeof path === 'string' ? path.replace(/^\.\//, '') : '';
  if (!JSON_FILES.has(name)) throw new Error('지원하지 않는 공개 데이터 파일입니다.');
  return name;
}

/** `path` is one of the app's allowlisted local public JSON filenames. */
export async function loadJson(path) {
  const name = jsonName(path);
  const offline = embeddedData();
  if (offline) {
    if (!Object.hasOwn(offline.json ?? {}, name)) throw new Error(`오프라인 데이터가 없습니다: ${name}`);
    // Catalog/profile edits in one app view must not change the embedded source.
    return structuredClone(offline.json[name]);
  }
  const response = await fetch(`./${name}`, {cache: 'no-store'});
  if (!response.ok) throw new Error(`공개 데이터를 불러오지 못했습니다: ${name}`);
  return response.json();
}

/** Return fresh workbook bytes so generating one file cannot mutate the source. */
export async function loadTemplate(kind) {
  if (!TEMPLATE_KINDS.has(kind)) throw new Error('지원하지 않는 엑셀 양식입니다.');
  const offline = embeddedData();
  if (offline) {
    const encoded = offline.templates?.[kind];
    if (typeof encoded !== 'string' || !encoded) throw new Error(`오프라인 엑셀 양식이 없습니다: ${kind}`);
    const binary = atob(encoded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  }
  const response = await fetch(`./templates/${kind}.xlsx`);
  if (!response.ok) throw new Error(`엑셀 양식을 불러오지 못했습니다: ${kind}`);
  return new Uint8Array(await response.arrayBuffer());
}
