import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const UNCLASSIFIED_GOODS_POLICY_ID = 'unclassified-physical-goods-suggestion-v1';
const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
// A new name, identity or official description requires another review, rather
// than silently inheriting a suggestion intended for an older product.
const targets = [
  ['CS-0283',202641,'増田彩乃生誕祭2026 ひょっこりしてますだｯ⭐︎','adhesive_pvc_goods_unresolved','ca220b55768211d4d8dbeaa1f9a1b3bb346f52997accddfebe744b014bb0b7bc','toy'],
  ['CS-0281',202638,'増田彩乃生誕祭2026 と・め・ま・す・だ あやの〜！','acrylic_goods_unknown','e0952b683feed01023832f5837ba16682f566d235d6e1de7f0a167c706efee92','toy'],
  ['SS-0187',188745,'白石まゆみ 生誕祭 2025 「きみのお名前(おしえて！)ネームプレート♡」','nameplate_unresolved','a7b200477d97ac0a4322ef768b169422afd92bbe4baf862598c26be2b47dbe80','toy'],
  ['CS-0207',186236,'佐野愛花 生誕祭2025 爆食のおともっ！','goods_unresolved','6356f7cfd405e153f8457d3a1283b56ee9306011bab434de285cae44b3fd9384','toy'],
  ['CS-0210',186233,'佐野愛花 生誕祭2025 もぐもぐホルダー','goods_unresolved','6356f7cfd405e153f8457d3a1283b56ee9306011bab434de285cae44b3fd9384','toy'],
  ['RF-0001',183093,'ROOM KEY','room_key_unresolved','8a029e205f1108cf5b841b1b6250d1eca9046acf984f36e42078019d129517eb','toy'],
  ['CS-0076',170158,'桜庭遥花生誕祭2025 桜庭遥花の分身','goods_unresolved','4c6e880eff631fd962757242efef3228fa45bc5b3ccb325e651b579cd72a8773','toy'],
  ['sn-00059',152076,'フォンタブ（小）','phone_tab_spec_unconfirmed','0510e92d6b8e8db866f8601a7c1c335e51ce1a701ca4efaa26163dc8ebc271ae','toy'],
  ['ASB-AS0042',203530,'ASOBIEXPO RANDOM CAPSULE Ver.2（ARTIST）','random_contents_unknown','9d1fd3b6531fa39f32cc98bb86756435b8c8b29504f48fe0bc589237b4ac8c71','toy'],
  ['ASB-AS0078',203536,'ASOBIEXPO RANDOM CAPSULE Ver.2（CREATOR）','random_contents_unconfirmed','9d1fd3b6531fa39f32cc98bb86756435b8c8b29504f48fe0bc589237b4ac8c71','toy'],
  ['RF-0007',183087,'STICKER2','sticker_material_unconfirmed','b496c6f04a80bfe18653ff6b3110a1d4ce54e594e32b5c8fa687edba595b6b1d','sticker'],
  ['RF-0009',183085,'STICKER4','sticker_material_unconfirmed','b496c6f04a80bfe18653ff6b3110a1d4ce54e594e32b5c8fa687edba595b6b1d','sticker'],
  ['sn-00035',129887,'お祭りストリート','sticker_material_unconfirmed','6bba23ccaa5fbadc7492523396af5cf086385252a0fd24af844c9d3d75a438d6','sticker'],
  ['NP-059',184600,'ナカキンチャク','drawstring_pouch','03dac267b84f449d4505159a2183b948eb878560f37cc9309308ba63f64fe788','pouch'],
  ['FZ-00264',151566,'真中まな生誕記念ZINE2024','zine_format_unconfirmed','3a338bff8d172c709324ce266db250cd9dc9c37bf62ac0ac48dfdacd8b2418c7','zine'],
].map(([code,id,name,kind,hash,type])=>({code,id,name,kind,hash,type,url:`https://asobisystem.shop/products/${code}`}));

const definitions = {
  toy: {j:'176',g:'127',label:'일반 실물 굿즈 · 기타완구 제안',reason:'일반 실물 팬 굿즈를 기타완구로 넓게 추정하여 제안했습니다. 정확한 종류·구성·수령품을 확인해 주세요.'},
  sticker: {j:'205',label:'스티커 · 잡화 제안',reason:'스티커의 바탕 소재가 미확인되어 종이로 단정하지 않고 문구·잡화를 제안했습니다. 실제 소재를 확인해 주세요.'},
  pouch: {j:'6',label:'주머니 · 가방 제안',reason:'주머니라는 상품 종류로 가방 항목을 넓게 제안했습니다. 가죽 제품이면 별도 항목이므로 소재를 확인해 주세요.'},
  zine: {j:'102',g:'139',label:'ZINE · 인쇄 책자 제안',reason:'ZINE이라는 상품명에서 실물 인쇄 책자로 추정했습니다. 디지털판이 아닌지와 실제 책자 구성을 확인해 주세요.'},
};
const canonicalJ = {'176':['기타 완구','170'],'205':['잡화(문구류/ 장식품/빗등 잡화류)','204'],'6':['가방 및 지갑','3'],'102':['서책 및 잡지류','100']};
const canonicalG = {'127':['[목록통관] 기타 완구',129],'139':['[목록통관] 책/잡지류',141]};
const specialContents = /반창고|의약품|의료용|리튬|배터리|보조배터리|식품|팝콘|초콜릿|캔디|카레|향수|오븐.?장갑|여행.?세트|식기|텀블러|絆創膏|医薬|食品|バッテリー|香水|トラベル|\b(?:FOOD|POPCORN|CANDY|CURRY|LITHIUM|BATTER(?:Y|IES)|PERFUME|TABLEWARE|TUMBLER|APRON|MITTEN|LOTTERY)\b|[SABCDE]賞|10連|抽選|くじ/i;

/** Fill only approved missing provider fields, preserving reviewed identities and facts. */
export function applyUnclassifiedGoodsPolicy(dataset, generalConfig, catalog) {
  if (!Array.isArray(dataset?.reviewedProducts) || !Array.isArray(catalog?.products)) throw new Error('Reviewed registry and public catalog are required.');
  const jCodes = new Map();
  for (const [code,[label,parent]] of Object.entries(canonicalJ)) {
    const actual = dataset.codeSources?.jimpass?.categories?.find(entry=>String(entry.code)===code);
    if (actual?.label!==label || String(actual?.parentCode)!==parent || actual?.source!==`https://www.jimpass.com/tool/agencyCategory.php?category=${parent}`) throw new Error(`Canonical Jimpass ${code} code provenance is missing.`);
    jCodes.set(code,{code,label:actual.label,source:actual.source});
  }
  const gCodes = new Map();
  for (const [code,[label,row]] of Object.entries(canonicalG)) {
    const actual = generalConfig?.categories?.find(entry=>String(entry.code)===code);
    if (actual?.item!==label || actual?.row!==row) throw new Error(`Canonical Hoottown ${code} code provenance is missing.`);
    gCodes.set(code,{code,label:actual.item,source:{file:'General_Excel_Upload.xlsx',sheet:'카테고리 품목 코드',range:`A${row}:C${row}`}});
  }
  const byCode = new Map(catalog.products.map(product=>[String(product.code),product]));
  const approved = new Map(targets.map(target=>[target.code,target]));
  const result = {policyId:UNCLASSIFIED_GOODS_POLICY_ID,changed:0,applied:[],skipped:[]};
  for (const record of dataset.reviewedProducts) {
    const target = approved.get(record.identity?.code);
    if (!target) continue;
    const actual = byCode.get(target.code), identity = record.identity, evidence = record.evidence;
    const identityMatches = candidate => candidate && String(candidate.code)===target.code && String(candidate.id)===String(target.id)
      && normalized(candidate.name)===normalized(target.name) && candidate.productUrl===target.url;
    let skip = '';
    if (!identityMatches(identity) || !identityMatches(actual)) skip='identity-mismatch';
    else if (record.kind!==target.kind || record.status!=='needs_review' || record.nonPhysical) skip='reviewed-physical-kind-mismatch';
    else if (evidence?.sourceUrl!==target.url || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(evidence?.checkedAt??'')
      || evidence?.descriptionSha256!==target.hash || !Array.isArray(evidence?.facts) || !evidence.facts.length) skip='reviewed-evidence-mismatch';
    else if (specialContents.test([evidence.material,...evidence.facts].filter(value=>typeof value==='string').join('\n'))
      || target.type==='pouch' && /LEATHER|本革|皮革|レザー|가죽/i.test(evidence.material??'')) skip='incompatible-material-or-contents';
    if (skip) {result.skipped.push({code:target.code,reason:skip});continue;}
    const definition=definitions[target.type], missingJ=!normalized(record.jimpass?.code), missingG=!!definition.g&&!normalized(record.general?.code);
    if (!missingJ&&!missingG) {result.skipped.push({code:target.code,reason:'codes-already-present'});continue;}
    if (!Object.hasOwn(record,'policyOriginalReviewReason')) record.policyOriginalReviewReason=record.reviewReason??'';
    if (!Object.hasOwn(record,'policyOriginalReason')) record.policyOriginalReason=record.reason??'';
    if (missingJ) record.jimpass=structuredClone(jCodes.get(definition.j));
    if (missingG) record.general=structuredClone(gCodes.get(definition.g));
    Object.assign(record,{label:definition.label,reason:definition.reason,requiresReview:true,
      reviewReason:'자동 추정 제안입니다. 실제 수령품과 배대지 안내를 확인하고 필요하면 직접 수정해 주세요.',
      mappingPolicy:{id:UNCLASSIFIED_GOODS_POLICY_ID,mode:'automatic-broad-suggestion',basedOn:'identity-guarded-reviewed-source',requiresUserReview:true,officialDetermination:false,
        ...(target.type==='toy'?{fallbackKind:'other_toy'}:{})}});
    result.changed++;result.applied.push(target.code);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const [dataset,general,catalog]=await Promise.all(['dist/product-classifications.json','dist/general-config.json','dist/catalog.json'].map(async relative=>JSON.parse(await fs.readFile(path.join(root,relative),'utf8'))));
  const result=applyUnclassifiedGoodsPolicy(dataset,general,catalog);
  if (result.changed) await fs.writeFile(path.join(root,'dist/product-classifications.json'),JSON.stringify(dataset,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
