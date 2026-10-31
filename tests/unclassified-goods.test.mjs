import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {applyUnclassifiedGoodsPolicy,UNCLASSIFIED_GOODS_POLICY_ID} from '../scripts/apply-unclassified-goods-policy.mjs';

const registry=JSON.parse(await fs.readFile(new URL('../dist/product-classifications.json',import.meta.url),'utf8'));
const catalog=JSON.parse(await fs.readFile(new URL('../dist/catalog.json',import.meta.url),'utf8'));
const general=JSON.parse(await fs.readFile(new URL('../dist/general-config.json',import.meta.url),'utf8'));
const toys=['CS-0283','CS-0281','SS-0187','CS-0207','CS-0210','RF-0001','CS-0076','sn-00059','ASB-AS0042','ASB-AS0078'];
const stickers=['RF-0007','RF-0009','sn-00035'];
const targetCodes=[...toys,...stickers,'NP-059','FZ-00264'];
const find=(data,code)=>data.reviewedProducts.find(record=>record.identity.code===code);
function pendingRegistry() {
  const data=structuredClone(registry);
  for (const code of targetCodes) {
    const record=find(data,code);assert.ok(record,`Reviewed public product ${code} is required.`);
    record.jimpass=null;
    if (toys.includes(code)||code==='FZ-00264') record.general=null;
    if (record.mappingPolicy?.id===UNCLASSIFIED_GOODS_POLICY_ID) {
      record.reason=record.policyOriginalReason??record.reason;
      record.reviewReason=record.policyOriginalReviewReason??record.reviewReason;
      delete record.mappingPolicy;delete record.policyOriginalReason;delete record.policyOriginalReviewReason;
    }
  }
  return data;
}
function only(code='CS-0281') {
  const data=pendingRegistry();data.reviewedProducts=[find(data,code)];return data;
}

test('only the approved fifteen reviewed products receive missing provider suggestions with real per-provider codes',()=>{
  const data=pendingRegistry(),before=structuredClone(data);
  const proofReferences=new Map(data.reviewedProducts.map(record=>[record.identity.code,{identity:record.identity,evidence:record.evidence}]));
  const result=applyUnclassifiedGoodsPolicy(data,general,catalog);
  assert.equal(result.changed,15);assert.deepEqual(new Set(result.applied),new Set(targetCodes));
  for (const code of targetCodes) {
    const record=find(data,code),original=find(before,code);
    assert.equal(record.status,original.status);assert.equal(record.kind,original.kind);
    assert.equal(record.identity,proofReferences.get(code).identity);assert.equal(record.evidence,proofReferences.get(code).evidence);
    assert.deepEqual(record.evidence,original.evidence);assert.equal(record.requiresReview,true);
    assert.equal(record.mappingPolicy.id,UNCLASSIFIED_GOODS_POLICY_ID);assert.equal(record.mappingPolicy.officialDetermination,false);
    assert.equal(record.mappingPolicy.requiresUserReview,true);assert.match(record.reason,/제안|추정/);
    const officialJ=data.codeSources.jimpass.categories.find(item=>String(item.code)===record.jimpass.code);
    assert.ok(officialJ);assert.equal(record.jimpass.label,officialJ.label);assert.equal(record.jimpass.source,officialJ.source);
    if (toys.includes(code)) {
      assert.equal(record.jimpass.code,'176');assert.equal(record.general.code,'127');assert.equal(record.mappingPolicy.fallbackKind,'other_toy');
      assert.equal(record.general.source.range,'A129:C129');
    } else {
      assert.equal(record.mappingPolicy.fallbackKind,undefined);
      if (stickers.includes(code)) {assert.equal(record.jimpass.code,'205');assert.deepEqual(record.general,original.general);}
      if (code==='NP-059') {assert.equal(record.jimpass.code,'6');assert.deepEqual(record.general,original.general);}
      if (code==='FZ-00264') {assert.equal(record.jimpass.code,'102');assert.equal(record.general.code,'139');assert.equal(record.general.source.range,'A141:C141');}
    }
    if (record.general?.code) assert.equal(record.general.label,general.categories.find(item=>item.code===record.general.code).item);
  }
  assert.deepEqual(data.reviewedProducts.filter(record=>!targetCodes.includes(record.identity.code)),before.reviewedProducts.filter(record=>!targetCodes.includes(record.identity.code)));
});

test('nonblank provider fields are preserved independently, including explicit manual or unusual values',()=>{
  const data=pendingRegistry(),record=find(data,'CS-0281');
  const manual={code:'240',label:'검토한 키링',source:'manual'};record.jimpass=manual;
  const stickerGeneral=find(data,'RF-0007').general;
  const zine=find(data,'FZ-00264');zine.general={code:'CUSTOM',label:'수동 분류',source:'manual'};
  const fullyClassified=find(data,'RF-0001');fullyClassified.jimpass={code:'0',label:'keep',source:null};fullyClassified.general={code:'0',label:'keep',source:null};
  const completeBefore=structuredClone(fullyClassified);
  applyUnclassifiedGoodsPolicy(data,general,catalog);
  assert.equal(record.jimpass,manual);assert.equal(record.general.code,'127');
  assert.equal(find(data,'RF-0007').general,stickerGeneral);
  assert.equal(zine.jimpass.code,'102');assert.equal(zine.general.code,'CUSTOM');
  assert.deepEqual(fullyClassified,completeBefore);
});

test('a second application makes no changes and preserves the original review explanation once',()=>{
  const data=pendingRegistry(),old=find(data,'CS-0283').reviewReason;
  applyUnclassifiedGoodsPolicy(data,general,catalog);const once=JSON.stringify(data);
  const result=applyUnclassifiedGoodsPolicy(data,general,catalog);
  assert.equal(result.changed,0);assert.equal(JSON.stringify(data),once);
  assert.equal(find(data,'CS-0283').policyOriginalReviewReason,old);
  assert.equal(data.reviewedProducts.filter(record=>record.mappingPolicy?.id===UNCLASSIFIED_GOODS_POLICY_ID&&record.mappingPolicy.fallbackKind==='other_toy').length,10);
});

test('stale identities and unverified or changed descriptions cannot inherit an approved fallback',()=>{
  const changes=[
    (record)=>{record.identity.id=1;},
    (record)=>{record.identity.name='NEW GOODS USING AN OLD SKU';},
    (record)=>{record.identity.productUrl='https://asobisystem.shop/products/OTHER';},
    (record)=>{record.evidence.sourceUrl='https://asobisystem.shop/products/OTHER';},
    (record)=>{record.evidence.descriptionSha256='a'.repeat(64);},
    (record)=>{record.evidence.checkedAt='';},
    (record)=>{record.evidence.facts=[];},
    (record)=>{record.status='non_physical';},
    (record)=>{record.nonPhysical=true;},
    (record)=>{record.kind='powerbank';},
  ];
  for (const change of changes) {
    const data=only();change(data.reviewedProducts[0]);const before=JSON.stringify(data);
    const result=applyUnclassifiedGoodsPolicy(data,general,catalog);
    assert.equal(result.changed,0);assert.equal(result.skipped.length,1);assert.equal(JSON.stringify(data),before);
  }
  const data=only(),renamed=structuredClone(catalog),actual=renamed.products.find(product=>product.code==='CS-0281');
  actual.name=data.reviewedProducts[0].identity.name='NEW GOODS USING AN OLD SKU';
  assert.equal(applyUnclassifiedGoodsPolicy(data,general,renamed).changed,0,'Changing both catalog and review names does not bypass the pinned identity.');
});

test('incompatible material or newly introduced medical, battery and food contents block toy suggestions',()=>{
  for (const value of ['리튬 배터리','식품 팝콘','의약품 반창고','향수','식기 텀블러','오븐 장갑','travel LOTTERY']) {
    for (const field of ['material','facts']) {
      const data=only();data.reviewedProducts[0].evidence[field]=field==='facts'?[value]:value;
      const before=JSON.stringify(data),result=applyUnclassifiedGoodsPolicy(data,general,catalog);
      assert.equal(result.changed,0,value);assert.equal(result.skipped[0].reason,'incompatible-material-or-contents');assert.equal(JSON.stringify(data),before);
    }
  }
  const leather=only('NP-059');leather.reviewedProducts[0].evidence.material='本革 LEATHER';
  assert.equal(applyUnclassifiedGoodsPolicy(leather,general,catalog).changed,0,'Known leather requires its own bag category rather than the broad noncommittal proposal.');
});

test('unrelated foods, electronics, unknown lotteries, travel sets and the existing mixed-goods policy remain untouched',()=>{
  const data=pendingRegistry();data.reviewedProducts=data.reviewedProducts.filter(record=>!targetCodes.includes(record.identity.code));
  const before=JSON.stringify(data);assert.ok(data.reviewedProducts.some(record=>record.identity.code==='FZ-00308'));
  assert.ok(data.reviewedProducts.some(record=>record.identity.code==='CT-00034'));
  assert.ok(find(data,'CS-0298')?.mappingPolicy,'The separate existing mixed-goods policy remains part of this fixture.');
  const result=applyUnclassifiedGoodsPolicy(data,general,catalog);
  assert.equal(result.changed,0);assert.deepEqual(result.applied,[]);assert.equal(JSON.stringify(data),before);
});

test('canonical code provenance is checked before any product is changed',()=>{
  const data=pendingRegistry();data.codeSources.jimpass.categories.find(item=>String(item.code)==='176').label='UNVERIFIED';
  const before=JSON.stringify(data);assert.throws(()=>applyUnclassifiedGoodsPolicy(data,general,catalog),/176.*provenance/);assert.equal(JSON.stringify(data),before);
  const valid=pendingRegistry(),badGeneral=structuredClone(general);badGeneral.categories.find(item=>item.code==='127').row=1;
  const validBefore=JSON.stringify(valid);assert.throws(()=>applyUnclassifiedGoodsPolicy(valid,badGeneral,catalog),/127.*provenance/);assert.equal(JSON.stringify(valid),validBefore);
});
