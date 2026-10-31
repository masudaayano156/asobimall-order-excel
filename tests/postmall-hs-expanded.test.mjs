import test from 'node:test';
import assert from 'node:assert/strict';
import {suggestPostmallHs as suggest, textileFamily} from '../dist/postmall-hs.mjs';
import fs from 'node:fs/promises';
import {classifyCatalogProduct} from '../dist/categories.mjs';
const proof = (kind,material,facts=[]) => ({kind,source:'product-detail',evidence:{sourceUrl:'https://asobisystem.shop/products/SAMPLE-HS-REVIEW',checkedAt:'2026-10-31',descriptionSha256:'b'.repeat(64),material,facts}});
test('expanded garment candidates need composition and retain actual fibre distinction',()=>{
  assert.equal(suggest({name:'ARTIST T-SHIRT',classification:{kind:'clothing'}}),null);
  assert.equal(suggest({name:'ARTIST T-SHIRT',classification:proof('clothing','綿100%')}).code,'610910');
  assert.equal(suggest({name:'ARTIST T-SHIRT',classification:proof('clothing','ポリエステル100%')}).code,'610990');
  assert.equal(suggest({name:'ARTIST SWEATSHIRT',classification:proof('clothing','綿60%、ポリエステル40%')}).code,'611020');
  assert.equal(suggest({name:'ARTIST HOODIE',classification:proof('clothing','ポリエステル100%')}).code,'611030');
  assert.equal(suggest({name:'ARTIST T-SHIRT',classification:proof('clothing','綿、ポリエステル')}),null);
  assert.equal(suggest({name:'WOVEN UNIFORM',classification:proof('clothing','ポリエステル100%')}),null);
  assert.equal(textileFamily('綿50%、ポリエステル50%'),null);
  assert.equal(textileFamily('소재 미기재\n綿100%'),'cotton');
  assert.equal(textileFamily('綿100%\nポリエステル100%'),null,'Conflicting verified compositions remain unresolved.');
  assert.equal(textileFamily('綿120% ポリエステル10%'),null);
  assert.equal(textileFamily('本体\n綿100%\nリブ\n綿95%・ポリウレタン5%'),'cotton');
});
test('flat plastic stickers exclude rolls, mixed paper and raised acrylic pieces',()=>{
  assert.equal(suggest({name:'ARTIST STICKER',classification:proof('sticker','PVC')}).code,'391990');
  for(const [name,material]of[['ROLL STICKER','PVC'],['ACRYLIC STICKER','アクリル'],['STICKER','紙・PVC'],['TATTOO STICKER','PET']])
    assert.equal(suggest({name,classification:proof('sticker',material)}),null,name);
});
test('recorded optical media are distinct from cases, vinyl and download cards',()=>{
  for(const name of['ARTIST MUSIC CD','CONCERT Blu-ray','CONCERT DVD'])assert.equal(suggest({name,classification:{kind:'music_disc'}}).code,'852349');
  for(const name of['CD CASE','ANALOG RECORD VINYL','M-CARD DOWNLOAD','ALBUM ONLY'])assert.equal(suggest({name,classification:{kind:'music_disc'}}),null,name);
});
test('towel weaving and cup body are not inferred from unrelated generic labels',()=>{
  assert.equal(suggest({name:'FACE TOWEL',classification:proof('towel','綿100%')}),null);
  assert.equal(suggest({name:'FACE TOWEL',classification:proof('towel','綿100% パイル')}).code,'630260');
  assert.equal(suggest({name:'GAUZE TOWEL',classification:proof('towel','綿100% ガーゼ')}).code,'630291');
  assert.equal(suggest({name:'FACE TOWEL',classification:proof('towel','ポリエステル100%')}).code,'630293');
  for(const [material,code]of[['陶器','691200'],['磁器','691110'],['ステンレス','732393']])assert.equal(suggest({name:'MUG CUP',classification:proof('mug',material)}).code,code);
  assert.equal(suggest({name:'MUG CUP',classification:proof('mug','陶磁器')}),null);
});
test('known utilitarian and nonphysical objects do not acquire generic toys',()=>{
  for(const kind of['event_access','digital','unknown','mixed_random_goods','clothing','candy','fanlight','bag'])assert.equal(suggest({name:'ARTIST GOODS',classification:{kind}}),null,kind);
  assert.equal(suggest({name:'PHOTO SET',classification:{kind:'photo',nonPhysical:true}}),null);
});
test('expanded candidates are fresh reviewed objects and never mutate source evidence',()=>{
  const input={name:'ARTIST T-SHIRT',classification:proof('clothing','綿100%')},before=structuredClone(input);
  const result=suggest(input);assert.equal(result.requiresReview,true);assert.match(result.code,/^\d{6}$/);assert.ok(result.sourceUrl);assert.deepEqual(input,before);
  result.code='000000';assert.equal(suggest(input).code,'610910');
});

test('verified reviewed toy defaults apply to ordinary unknown capsules, without treating known utilities as toys', async()=>{
  const catalog=JSON.parse(await fs.readFile(new URL('../dist/catalog.json',import.meta.url),'utf8'));
  for(const code of ['ASB-AS0042','ASB-AS0078','CS-0076']){
    const product=catalog.products.find(p=>p.code===code),classification=classifyCatalogProduct(product);
    const result=suggest({product,classification});
    assert.equal(result.code,'950300',code);assert.equal(result.requiresReview,true);
    assert.equal(result.ruleId,'user-requested-other-toy-default-v1');
  }
  const product=catalog.products.find(p=>p.code==='sn-00059');
  assert.equal(suggest({product,classification:classifyCatalogProduct(product)}),null,'A known phone attachment does not become an HS toy.');
  for(const code of ['CS-0298','CS-0305','FZ-00643','CT-00293','AGL-00041']){
    const product=catalog.products.find(p=>p.code===code);
    assert.equal(suggest({product,classification:classifyCatalogProduct(product)}),null,'Mixed household goods require their actual HS composition: '+code);
  }
});

test('actual outfit-name stands, stickers, mixed photo prizes and towel holders do not inherit book or standalone-doll codes', async()=>{
  const catalog=JSON.parse(await fs.readFile(new URL('../dist/catalog.json',import.meta.url),'utf8'));
  for(const code of ['FZ-00542','FZ-00543','FZ-00342']){
    const product=catalog.products.find(p=>p.code===code),result=suggest({product,classification:classifyCatalogProduct(product)});
    assert.equal(result.code,'392640',code);
  }
  for(const code of ['FZ-00226','CS-0099']){
    const product=catalog.products.find(p=>p.code===code),result=suggest({product,classification:classifyCatalogProduct(product)});
    assert.notEqual(result?.code,'490199',code);assert.notEqual(result?.code,'630260',code);
  }
  for(const code of ['CT-00033','FZ-00078','CT-00032','CT-00030']){
    const product=catalog.products.find(p=>p.code===code),result=suggest({product,classification:classifyCatalogProduct(product)});
    assert.equal(result.code,'491191',code);assert.equal(result.ruleId,'photo-prize-main-photo-491191-v1');
  }
});
