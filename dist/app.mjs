import {parseOrders} from './parser.mjs';
import {findMatches, safeUrl} from './catalog-match.mjs';
import {classifyProduct,classifyCatalogProduct} from './categories.mjs?v=2';
import {exportWorkbook} from './exporter.mjs';
import {initNavigation} from './navigation.mjs';
import {loadJson,loadTemplate} from './data.mjs?v=3';
import {initPostcodeSearch} from './postcode.mjs';
import {shortenHoottownName} from './item-name.mjs';
import {createProductPicker} from './product-picker.mjs';
import {phoneDigits,formatPhone,isValidPhone} from './phone.mjs';
import {createOrderSection,updateOrderSectionSummary} from './order-sections.mjs';
import {formatJimpassName,isValidJimpassName,jimpassNameLength} from './jimpass-name.mjs';
import {initDownloadReview} from './download-review.mjs';
import {CARRIERS,resolveOrderShipping} from './order-shipping.mjs';
import {getFixedShippingErrors} from './fixed-shipping.mjs';
import {suggestPostmallHs} from './postmall-hs.mjs?v=2';

const $ = id => document.getElementById(id);
const dummy = {recipient:'홍길동', phone:'01000000000', postal:'00000', address:'예시 주소 (실제 주소로 변경)', address2:'예시 상세주소', customs:'P000000000000'};
let config, fastConfig, postmallConfig, catalog = {products:[]}, orders = [], items = [], parsedText = '', busy = false, analyzing = false, demoActive = false;
let productPickers = [], orderSections = [], thumbnailImages = new Map();
let confirmDownloadReview, reviewPending = false, postcodeSearch, stateRevision = 0, activeDownloadRevision = null;
const money = value => Number.isFinite(value) ? `¥${value.toLocaleString('ja-JP',{maximumFractionDigits:2})}` : '확인 필요';
const template = () => document.querySelector('[name=template]:checked').value;
const effectiveTemplate = () => template()==='general'&&$('hoottown-service')?.value==='fast'?'hoottown-fast':template();
const catalogName = product => product.enName||product.nameEn||product.name_en||product.name;
const fieldChecks=new Map();let fieldErrorSequence=0;
const unsupportedNameScript=/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Hangul}]/u;
function markStateChanged(){stateRevision++;if(activeDownloadRevision!==null){activeDownloadRevision=null;busy=false;}}
function syncDownloadButton(){
  $('download-btn').disabled=busy||reviewPending||analyzing||(template()==='postmall'&&!postmallConfig)||!items.some(item=>!item.classification?.nonPhysical)||$('order-input').value!==parsedText;
}
function downloadStateCurrent(revision){return revision===stateRevision&&!analyzing&&items.length>0&&$('order-input').value===parsedText;}
function stopStaleDownload(revision){
  if(downloadStateCurrent(revision))return false;
  // A reset leaves an empty page. Late completions must not restore its status.
  if(items.length&&!analyzing&&!reviewPending&&(activeDownloadRevision===null||activeDownloadRevision===revision)){
    if($('order-input').value!==parsedText)status('export-status','주문 내역이 변경되어 이전 다운로드 요청을 취소했습니다. 주문 내용을 다시 읽어 주세요.',true);
    else {updateSummary();status('export-status',`입력 내용이 변경되어 이전 다운로드 요청을 취소했습니다. 현재 내용을 확인하고 다시 다운로드해 주세요. ${$('export-status').textContent}`,true);}
  }
  syncDownloadButton();return true;
}
function requireField(input,message,valid=()=>input.value.trim()!=='',when=()=>true,badge=false) {
  const error=node('span',undefined,'field-error');error.id=`field-error-${++fieldErrorSequence}`;input.after(error);
  input.setAttribute('aria-describedby',[input.getAttribute('aria-describedby'),error.id].filter(Boolean).join(' '));
  if(badge){const label=document.querySelector(`label[for="${input.id}"]`)||input.previousElementSibling;if(label?.tagName==='LABEL')label.append(node('span',' 필수','required-text'));}
  const check=()=>{const needed=when()&&!input.disabled,invalid=needed&&!valid();input.required=needed;input.setAttribute('aria-required',String(needed));input.setAttribute('aria-invalid',String(invalid));error.textContent=invalid?(typeof message==='function'?message():message):'';error.hidden=!invalid;return invalid;};
  fieldChecks.set(input,check);input.addEventListener('input',check);input.addEventListener('change',check);return input;
}
function refreshRequiredFields(){let count=0;for(const [input,check]of fieldChecks){if(!input.isConnected){fieldChecks.delete(input);continue;}if(check())count++;}return count;}
function node(tag, text, cls) { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; if(cls)e.className=cls; return e; }
function clearItemCards(){productPickers.forEach(picker=>picker.destroy());productPickers=[];orderSections=[];document.getElementById('items-container').replaceChildren();}
function imageKey(value){const safe=safeUrl(value,'image');if(!safe)return '';return new URL(safe).pathname.replace(/^\/cdn-cgi\/image\/[^/]+\//i,'/');}
function cachedThumbnail(value){return thumbnailImages.get(imageKey(value))??'';}
function status(id, text, warning=false) { $(id).textContent=text; $(id).className=`status${warning?' warning':''}`; }
function option(select,value,label=value) { const o=node('option',label); o.value=value; select.append(o); }
function selectOptions(select, values, placeholder='선택해 주세요') { select.replaceChildren(); option(select,'',placeholder); for(const v of values)option(select,typeof v==='string'?v:v.value,typeof v==='string'?v:v.label); }
function normalizedHsCode(value){return String(value??'').normalize('NFKC').replace(/[.\s]/gu,'');}
function isValidHsCode(value){return /^(?:\d{6}|\d{8}|\d{10})$/.test(normalizedHsCode(value));}
function businessClearanceSelected(){return template()==='jimpass'?!!$('business-customs')?.checked:template()==='postmall'?!!$('postmall-business')?.checked:false;}
function syncCustomsFields(){
  const business=businessClearanceSelected();document.querySelector('label[for=customs]').textContent=business?'세관신고정보 (사업자통관) *':'개인통관고유부호 *';
  if(template()==='postmall'&&business)$('customs').removeAttribute('maxlength');else $('customs').maxLength=business?50:13;
}
function handleBusinessSelection(){syncCustomsFields();if(businessClearanceSelected()&&$('customs').value===dummy.customs)$('customs').value='0000000000';else if(!businessClearanceSelected()&&$('customs').value==='0000000000')$('customs').value=dummy.customs;if(items.length)updateSummary();else refreshRequiredFields();}
function activeConfig(kind=effectiveTemplate()){return kind==='postmall'?postmallConfig:kind==='hoottown-fast'?fastConfig:config;}
function syncPhone(typing=false) {
  const input=$('phone'),next=formatPhone(input.value,template());
  input.placeholder=template()==='jimpass'?'010-0000-0000':'01000000000';
  // Keep mid-number edits in place; format them when the user leaves the field.
  const atEnd=input.selectionStart===input.value.length&&input.selectionEnd===input.value.length;
  if(input.value!==next&&(!typing||document.activeElement!==input||atEnd))input.value=next;
}
function profile() {
  const base={...Object.fromEntries(['recipient','phone','postal','customs','brand','tracking'].map(k=>[k,$(k).value.trim()])),
    phone:formatPhone($('phone').value,template()),
    address:[$('address').value.trim(),$('address2').value.trim()].filter(Boolean).join(' '), shopUrl:$('shop-url').value.trim()};
  if(template()==='postmall'){
    const selected=id=>$(id)?.checked?'T':'';
    return {...base,center:'일본',carrier:'',localCarrier:'',fixedShippingCode:'',
      courierNote:$('postmall-delivery-note')?.value.trim()??'',
      postmallBuyerName:$('postmall-buyer-name')?.value.trim()??'',postmallBuyerPhone:$('postmall-buyer-phone')?.value.trim()??'',
      postmallCustomsType:$('postmall-customs-type')?.value??'',postmallPackaging:$('postmall-packaging')?.value??'A',
      postmallInspection:selected('postmall-inspection'),postmallAircap:selected('postmall-aircap'),postmallReinforce:selected('postmall-reinforce'),
      postmallBusiness:selected('postmall-business'),postmallInvoiceRemove:selected('postmall-invoice-remove'),postmallHangerRemove:selected('postmall-hanger-remove'),
      postmallAutomaticRelease:selected('postmall-automatic-release'),postmallSplitBoxes:$('postmall-split')?.value==='box'?'T':'',
      postmallSplitPolybag:$('postmall-split')?.value==='polybag'?'T':'',postmallFtaClearance:''};
  }
  return {...base,
    carrier:$('carrier').value, center:$('center').value, shippingType:'personal',
    packingReinforce:$('packing-reinforce')?.checked?'Y':'', businessCustoms:template()==='jimpass'&&$('business-customs')?.checked?'Y':'',
    immediateRelease:$('immediate-release')?.checked?'Y':'', warehouseNote:$('warehouse-note')?.value.trim()??'',courierNote:$('courier-note')?.value.trim()??'',localCarrier:$('local-carrier')?.value??'',
    fixedShippingCode:$('fixed-shipping')?.value??'',
    inspection:$('inspection')?.checked?'Y':'', compensation:$('compensation')?.checked?'Y':'',
  };
}
function reset() {
  markStateChanged();postcodeSearch?.close();if($('postcode-search-status'))$('postcode-search-status').textContent='';
  const review=$('download-review-dialog');if(review?.open)review.close();
  $('profile-form').reset(); for(const [id,value] of Object.entries(dummy))$(id).value=value;
  syncPhone();
  $('center').value='일본';$('shipping-type').value='personal';
  $('carrier').value='';if($('local-carrier'))$('local-carrier').value='';
  if($('hoottown-service'))$('hoottown-service').value='general';
  document.querySelector('label[for=customs]').textContent='개인통관고유부호 *';$('customs').maxLength=13;
  $('order-input').value=''; clearItemCards(); $('order-summary').replaceChildren();
  orders=[]; items=[]; parsedText=''; demoActive=false; $('preview-section').hidden=true; $('download-btn').disabled=true;
  status('parse-status',''); status('export-status','');
  refreshRequiredFields();
  if(config&&$('hoottown-service'))setTemplate();
}
function inputField(container, label, value, change, type='text', full=false) {
  const wrap=node('div',undefined,`field${full?' field-full':''}`), caption=node('label',label), input=document.createElement('input');
  input.type=type; input.value=value??''; input.autocomplete='off'; const id=`item-${Math.random().toString(36).slice(2)}`; input.id=id; caption.htmlFor=id;
  if(type==='number'){input.min='0';input.step=label.includes('수량')?'1':'0.01';}
  input.addEventListener('input',()=>{change(type==='number'?(input.value===''?null:Number(input.value)):input.value); updateSummary();});
  wrap.append(caption,input); container.append(wrap); return input;
}
function assignCategory(item, reference) {
  const product=reference&&typeof reference==='object'?reference:reference===undefined?catalog.products.find(p=>String(p.id)===item.matchedId):null;
  const classification=product?classifyCatalogProduct(product):classifyProduct(reference??item.name);
  item.classification=classification;
  if(!item.jimpassCategoryEdited)item.jimpassCategory=classification.jimpassCode??'';
  if(!item.generalCategoryEdited)item.generalCategory=classification.generalCode??'';
  item.postmallHsSuggestion=suggestPostmallHs({name:item.name,classification,product});
  if(!item.postmallHsCodeEdited)item.postmallHsCode=item.postmallHsSuggestion?.code??'';
}
function currentCategory(item) {return template()==='postmall'?normalizedHsCode(item.postmallHsCode):template()==='jimpass'?item.jimpassCategory:item.generalCategory;}
function rawEditableName(item){return String((template()==='postmall'?item.postmallName:template()==='general'?item.hoottownName:item.jimpassName)??item.name??'');}
function exportName(item) {const raw=rawEditableName(item);return template()==='postmall'?raw:template()==='general'?(unsupportedNameScript.test(raw)?raw:shortenHoottownName(raw)):formatJimpassName(raw);}
function populateCategories(select,value) {
  selectOptions(select,config.categories.map(c=>({value:c.code,label:`${c.code} · ${c.category} / ${c.item}`})),'미분류 · 직접 선택'); select.value=value??'';
}
function itemCategoryLabel(item){return template()==='postmall'?`HS CODE · ${item.classification?.label||'상품별 확인'}`:`품목코드 · ${item.classification?.label||'미분류'}`;}
function itemCategoryNote(item){
  if(template()!=='postmall')return item.classification?.reason||'품목을 직접 확인해 주세요.';
  if(item.postmallHsCodeEdited)return currentCategory(item)?'직접 입력한 HS를 유지합니다. 상품이 바뀌었다면 실제 품목·소재와 코드를 다시 확인해 주세요.':'직접 비운 HS 공란을 유지합니다. 실제 업로드 전에 공식 HS 찾기에서 상품별 코드를 확인해 주세요.';
  if(item.postmallHsSuggestion)return `HS 자동 제안입니다. ${item.postmallHsSuggestion.reason}`;
  return '포스트몰 공식 HS 찾기에서 실제 품목·소재를 확인해 입력하세요. 다른 배대지 품목번호는 사용할 수 없습니다. 미확인 공란은 초안이며 실제 업로드 전에 확인해야 합니다.';
}
function renderItems() {
  clearItemCards();
  orderSections=orders.map((order,index)=>createOrderSection({order,index}));
  orderSections.forEach(section=>$('items-container').append(section.element));
  items.forEach((item,index)=>{
    const card=node('article',undefined,'item-card');
    const top=node('div',undefined,'item-top'), title=node('h4',`${String(index+1).padStart(2,'0')}  ${item.name||'상품명 확인 필요'}`,'item-title');
    top.append(title,node('span',item.orderNo,'badge')); card.append(top);
    const matches=findMatches(item,catalog.products), exact=matches.find(m=>m.exact);
    if(!item.matchChecked){
      if(exact){item.productUrl=exact.product.productUrl;item.imageUrl=safeUrl(item.imageUrl,'image')||exact.product.imageUrl; item.matchedId=String(exact.product.id);item.sourceMatchedId=String(exact.product.id);assignCategory(item,exact.product);}
      item.matchChecked=true;
    }
    const isNonPhysical=()=>!!item.classification?.nonPhysical;
    const nonPhysicalBadge=node('span','실물 없음 · 엑셀 제외','badge');nonPhysicalBadge.hidden=!isNonPhysical();top.append(nonPhysicalBadge);
    const matchField=node('div',undefined,'field match-field'), label=node('label','공개 상품 목록 대조');
    const picker=createProductPicker({id:`match-${index}`,value:item.matchedId??'',placeholder:matches.length?'일치하는 상품을 선택하거나 URL을 직접 입력':'목록에서 찾지 못했습니다 · URL 직접 입력',
      options:matches.map(match=>({value:String(match.product.id),label:`${match.exact?'일치 · ':''}${catalogName(match.product)} (${match.product.code||match.product.id})`,thumbnailSrc:cachedThumbnail(match.product.imageUrl)})),
      onChange(value){const p=catalog.products.find(p=>String(p.id)===value);item.matchedId=value;if(p){item.productUrl=p.productUrl;item.imageUrl=p.imageUrl;assignCategory(item,p);}else{item.productUrl=item.sourceProductUrl;item.imageUrl=item.sourceImageUrl;const source=catalog.products.find(p=>String(p.id)===item.sourceMatchedId);assignCategory(item,source??item.name);}renderItems();updateSummary();document.getElementById(`match-${index}`)?.focus({preventScroll:true});}
    });
    productPickers.push(picker);const select=picker.control;label.htmlFor=select.id;
    const selectedMatch=matches.find(m=>String(m.product.id)===item.matchedId);
    const matchText=node('p',selectedMatch?(selectedMatch.exact?`${selectedMatch.reason}. 상품·이미지 URL을 연결했습니다.`:'직접 선택한 상품입니다. 주문한 상품과 버전이 같은지 확인해 주세요.'):'상품 연결 미완료 · 후보를 선택하거나 상품·이미지 URL을 입력해 주세요.','field-hint');
    if(!selectedMatch)matchField.classList.add('is-unmatched');
    matchField.append(label,picker.element,matchText);
    const productRow=node('div',undefined,'item-product-row'),thumbnail=node('div',undefined,'item-thumbnail');
    function refreshThumbnail(){thumbnail.replaceChildren();const src=cachedThumbnail(item.imageUrl);if(src){const img=document.createElement('img');img.src=src;img.alt=`${item.name} 상품 이미지`;img.width=144;img.height=144;img.loading='lazy';img.decoding='async';thumbnail.append(img);}else thumbnail.append(node('span','이미지 없음','thumbnail-empty'));}
    refreshThumbnail();productRow.append(thumbnail,matchField);card.append(productRow);
    requireField(select,'상품을 선택하거나 아래 상품 URL을 직접 입력해 주세요.',()=>!!item.matchedId||!!safeUrl(item.productUrl,'product'),()=>!isNonPhysical()&&effectiveTemplate()!=='hoottown-fast');
    const fields=node('div',undefined,'field-grid item-fields');
    const nameInput=inputField(fields,'엑셀에 들어갈 영문 상품명',exportName(item),v=>{
      if(template()==='postmall')item.postmallName=v;
      else if(template()==='general')item.hoottownName=v;
      else item.jimpassName=v;
      updateNameHint();
    },'text',true);
    nameInput.dataset.field='export-name';
    const nameHint=node('p',undefined,'field-hint');nameInput.parentElement.append(nameHint);
    function updateNameHint(){const invalidScript=unsupportedNameScript.test(rawEditableName(item)),changed=exportName(item)!==item.name;nameHint.hidden=!invalidScript&&!changed;nameHint.textContent=invalidScript?'영문 상품명으로 직접 수정해 주세요.':changed?(template()==='postmall'?'포스트몰에 입력할 상품명을 직접 수정했습니다. 원문은 위의 상품명에서 확인할 수 있습니다.':template()==='general'?`훗타운 80자 이내로 작성 · ${exportName(item).length}/80자. 원문은 위의 상품명에서 확인할 수 있습니다.`:`짐패스용 상품명 · 영문·숫자 ${jimpassNameLength(exportName(item))}/100자. 원문은 위의 상품명에서 확인할 수 있습니다.`):'';}
    nameInput.addEventListener('blur',()=>{nameInput.value=exportName(item);updateNameHint();refreshRequiredFields();});
    updateNameHint();
    requireField(nameInput,template()==='jimpass'?'필수 입력 · 영문·숫자·공백으로 작성하고 영문·숫자를 10~100자 입력해 주세요.':'필수 입력 · 영문 상품명을 입력해 주세요.',()=>!unsupportedNameScript.test(rawEditableName(item))&&(template()==='jimpass'?isValidJimpassName(exportName(item)):!!exportName(item).trim()),()=>!isNonPhysical(),!isNonPhysical());
    inputField(fields,'색상 / 멤버 옵션',item.color,v=>{item.color=v;},'text');
    inputField(fields,'사이즈 (해당하는 경우)',item.size,v=>{item.size=v;},'text');
    const amountInput=inputField(fields,'상품 1개당 단가 (JPY)',item.amount,v=>item.amount=v,'number');
    requireField(amountInput,'필수 입력 · 0 이상의 단가를 입력해 주세요.',()=>Number.isFinite(item.amount)&&item.amount>=0,()=>!isNonPhysical(),!isNonPhysical());
    const quantityInput=inputField(fields,'수량',item.quantity,v=>item.quantity=v,'number');
    requireField(quantityInput,'필수 입력 · 수량은 1 이상의 정수로 입력해 주세요.',()=>Number.isInteger(item.quantity)&&item.quantity>0,()=>!isNonPhysical(),!isNonPhysical());
    const categoryField=node('div',undefined,'field field-full'), clabel=node('label',itemCategoryLabel(item)), categoryId=`category-${index}`;clabel.htmlFor=categoryId;
    const cat=template()==='general'?document.createElement('select'):document.createElement('input'); cat.id=categoryId;
    // Delivery speed and optional fixed rates never disable a physical item's category.
    cat.disabled=isNonPhysical();
    if(isNonPhysical()){if(cat.tagName==='SELECT')option(cat,'','배송 대상 아님 · 코드 불필요');else cat.placeholder='배송 대상 아님 · 코드 불필요';}
    else if(template()==='general')populateCategories(cat,item.generalCategory);else{cat.value=currentCategory(item)??'';cat.placeholder=template()==='postmall'?'공식 조회한 숫자 6·8·10자리':'짐패스 품목코드 · 확인 후 입력';}
    function editCategory(){if(template()==='postmall'){item.postmallHsCode=cat.value;item.postmallHsCodeEdited=true;classificationNote.textContent=itemCategoryNote(item);refreshHsBadge();}else if(template()==='general'){item.generalCategory=cat.value;item.generalCategoryEdited=true;}else{item.jimpassCategory=cat.value;item.jimpassCategoryEdited=true;}updateSummary();}
    cat.addEventListener('change',editCategory);
    if(template()!=='general')cat.addEventListener('input',editCategory);
    if(template()==='postmall'){cat.inputMode='numeric';cat.autocomplete='off';cat.dataset.field='postmall-hs';cat.addEventListener('blur',()=>{item.postmallHsCode=normalizedHsCode(item.postmallHsCode);cat.value=item.postmallHsCode;refreshRequiredFields();});}
    const classificationNote=node('p',itemCategoryNote(item),'field-hint');
    categoryField.append(clabel,cat,classificationNote);fields.append(categoryField);
    requireField(cat,template()==='postmall'?'HS 미확인 · 공식 HS 찾기에서 상품별 코드를 확인해 주세요. 공란은 초안으로만 작성됩니다.':'필수 선택 · 상품에 맞는 품목코드를 선택하거나 입력해 주세요.',()=>template()==='postmall'?isValidHsCode(item.postmallHsCode):!!currentCategory(item),()=>!isNonPhysical(),!isNonPhysical()&&template()!=='postmall');
    function refreshHsBadge(){
      if(template()!=='postmall')return;
      let badge=clabel.querySelector('.required-text,.optional');if(isNonPhysical()){badge?.remove();return;}
      if(!badge){badge=node('span');clabel.append(badge);}
      const valid=isValidHsCode(item.postmallHsCode);badge.className=valid?'optional':'required-text';
      badge.textContent=valid?(item.postmallHsCodeEdited?'  직접 입력':item.postmallHsSuggestion?'  자동 제안':'  입력됨'):'  확인 필요';
    }
    if(template()==='postmall'){
      refreshHsBadge();
      const finder=node('a','포스트몰 공식 HS 찾기 ↗','postmall-hs-link');finder.href=postmallConfig?.officialHsFinderUrl??'https://www.postmall.net/hs-finder';finder.target='_blank';finder.rel='noopener noreferrer';finder.referrerPolicy='no-referrer';categoryField.append(finder);
    }
    function paintCategory(){
      const excluded=isNonPhysical(),wasDisabled=cat.disabled;nonPhysicalBadge.hidden=!excluded;cat.disabled=excluded;
      if(cat.tagName==='SELECT'){
        if(excluded){cat.replaceChildren();option(cat,'','배송 대상 아님 · 코드 불필요');}
        else if(wasDisabled)populateCategories(cat,currentCategory(item));else cat.value=currentCategory(item);
      }else{cat.value=excluded?'':currentCategory(item);cat.placeholder=excluded?'배송 대상 아님 · 코드 불필요':template()==='postmall'?'공식 조회한 숫자 6·8·10자리':'짐패스 품목코드 · 확인 후 입력';}
      clabel.textContent=itemCategoryLabel(item);classificationNote.textContent=itemCategoryNote(item);
      for(const input of [nameInput,amountInput,quantityInput,cat]){const label=input.previousElementSibling;if(label?.tagName!=='LABEL')continue;const badge=label.querySelector('.required-text');if(excluded)badge?.remove();else if(!badge)label.append(node('span',input===cat&&template()==='postmall'?' 확인 필요':' 필수','required-text'));}
      refreshHsBadge();
    }
    const productUrlInput=inputField(fields,'상품 URL',item.productUrl,v=>{
      item.productUrl=v;item.matchedId='';picker.setValue('');
      // A manually typed URL supplies no new product-kind evidence. Preserve
      // the source classification, including verified electronic tickets.
      paintCategory();matchText.textContent='직접 입력한 상품 URL입니다. 원주문 상품 분류는 유지되며 상품과 버전을 확인해 주세요.';refreshLinks();
    },'url',true);
    requireField(productUrlInput,'필수 입력 · 상품을 연결하거나 아소비몰 상품 URL을 입력해 주세요.',()=>!!safeUrl(item.productUrl,'product'),()=>!isNonPhysical()&&template()==='jimpass');
    inputField(fields,'상품 이미지 URL',item.imageUrl,v=>{item.imageUrl=v;matchText.textContent='직접 입력한 이미지 URL입니다. 이미지 확인 링크로 확인해 주세요.';refreshLinks();refreshThumbnail();},'url',true);
    card.append(fields);
    const links=node('div',undefined,'item-links');
    function refreshLinks(){links.replaceChildren();for(const [url,text,kind] of [[item.productUrl,'상품 페이지 확인 ↗','product'],[item.imageUrl,'이미지 확인 ↗','image']]){
      const safe=safeUrl(url,kind);if(safe){const a=node('a',text);a.href=safe;a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';links.append(a);}
    }}refreshLinks();
    card.append(links);(orderSections[item.orderIndex]?.itemsContainer??$('items-container')).append(card);
  });
  renderOrderShipping();
}
function normalizedItems(includeExcluded=false) {
  return items.filter(i=>includeExcluded||!i.classification?.nonPhysical).map(i=>{const o=orders[i.orderIndex]??orders.find(o=>o.orderNo===i.orderNo);return {...i,name:exportName(i),rawEditableName:rawEditableName(i),postmallHsCode:normalizedHsCode(i.postmallHsCode),...resolveOrderShipping(o,effectiveTemplate()),category:currentCategory(i),unitPrice:Number.isFinite(i.amount)?i.amount:null,color:i.color??i.option.replace(/^[^:：]+[:：]\s*/,''),size:i.size??''};});
}
function fixedRateDisplayLabel(value){return String(value??'').replace(/^\s*\[[^\]]*고정배송비[^\]]*\$\s*[\d,.]+[^\]]*\]\s*/iu,'');}
function fixedRateDisplayError(value){return String(value??'').replace(/\[[^\]]*고정배송비[^\]]*\$\s*[\d,.]+[^\]]*\]\s*/giu,'');}
function fixedShippingErrorsFor(code=$('fixed-shipping')?.value??'',rows=normalizedItems(),p=profile()){
  const kind=effectiveTemplate();
  return getFixedShippingErrors({template:kind,items:rows,profile:{...p,fixedShippingCode:code},config:kind==='hoottown-fast'?fastConfig:config}).map(fixedRateDisplayError);
}
function refreshFixedShippingOptions(rows=normalizedItems()){
  const select=$('fixed-shipping');if(!select||template()!=='general')return;
  const selected=select.value,fast=effectiveTemplate()==='hoottown-fast',p=profile();
  const list=(fast?fastConfig:config)?.fixedShipping??[];
  const available=list.filter(entry=>entry.center===p.center&&(fast?entry.fastService:entry.generalService)==='Y');
  selectOptions(select,[],available.length?'신청 안 함':'현재 센터·배송 유형의 고정배송비 항목 없음');
  let eligible=0;
  for(const entry of available){
    // The shared validator applies Excel fixed-rate eligibility. Choosing the
    // QUICK service alone never disables an item's category or multiple goods.
    const code=String(entry.code),errors=fixedShippingErrorsFor(code,rows,p);
    const choice=node('option',`${code} · ${fixedRateDisplayLabel(entry.label)}${errors.length?' · 현재 상품 구성에서 사용 불가':''}`);
    choice.value=code;choice.disabled=!!errors.length;if(errors.length)choice.title=errors.join('\n');else eligible++;
    select.append(choice);
  }
  if(selected&&!available.some(entry=>String(entry.code)===selected)){
    const previous=[...(config?.fixedShipping??[]),...(fastConfig?.fixedShipping??[])].find(entry=>String(entry.code)===selected);
    const retained=node('option',`${selected} · ${fixedRateDisplayLabel(previous?.label??'이전 선택 코드')} · 현재 센터·배송 유형에서 사용 불가`);
    retained.value=selected;retained.disabled=true;select.append(retained);
  }
  // Preserve invalid selections visibly. Validation must block them rather
  // than silently changing the user's requested add-on to no service.
  select.value=selected;
  const hint=$('fixed-shipping-hint');
  if(hint)hint.textContent=!rows.length
    ? '엑셀 고정배송비 신청만 신청서별 상품 1종·수량 1개 조건입니다. THE빠른배송 자체는 여러 상품을 신청할 수 있습니다.'
    : available.length?eligible
      ?'현재 구성은 엑셀 고정배송비 신청 조건에 맞습니다. 대상 품목과 상품 1종·수량 1개 조건을 확인하세요.'
      :'고정배송비 신청 조건에 맞지 않습니다. 여러 상품은 고정배송비를 신청하지 않고 THE빠른배송을 이용하세요. 품목은 위 상품 카드에서 선택할 수 있습니다.'
    : `현재 센터·배송 유형의 고정요금 항목은 없습니다.${selected?' 이전 고정요금 선택은 신청 안 함으로 해제하세요.':''} 상품별 품목코드는 위 상품 카드에서 선택할 수 있습니다.`;
}
function shippingEntryNote(order) {
  if(template()==='postmall')return order.shippingEntry==='now'?'발송 메일에서 확인한 운송장번호를 입력하세요. 포스트몰 양식에는 운송사 열이 없으며 미발급 운송장번호는 공란으로 작성할 수 있습니다.':'운송장번호를 공란 초안으로 작성합니다. 원본 안내에 따라 미발급 번호는 추후 입력할 수 있으며 포스트몰 양식에는 운송사 열이 없습니다.';
  const fast=effectiveTemplate()==='hoottown-fast';
  if(template()==='general'&&order.shippingEntry!=='now')return `운송장번호는 공란, 현지 운송사는 ${CARRIERS.other.hoottown}로 엑셀에 자동 입력됩니다. 실제 운송사를 확인한 뒤 배대지에서 수정해 주세요.${fast?' THE빠른배송의 실제 업로드 전에는 운송장번호를 보완해 주세요.':''}`;
  return order.shippingEntry==='now'
    ? `발송 메일에서 확인한 운송장번호와 운송사를 입력하세요. 비운 값은 초안 엑셀에도 빈칸으로 작성됩니다.${fast?' THE빠른배송은 실제 업로드 전에 운송장번호와 현지 운송사를 모두 입력해야 합니다.':''}`
    : `운송장번호와 현지 운송사를 엑셀에 빈칸으로 작성합니다. 발송 메일을 받으면 배대지에서 직접 입력하세요.${fast?' THE빠른배송은 실제 업로드 전에 운송장번호와 현지 운송사를 모두 입력해야 합니다.':''}`;
}
function refreshShippingHints() {
  orders.forEach((order,index)=>{const note=$(`order-shipping-note-${index}`);if(note)note.textContent=shippingEntryNote(order);});
}
function renderOrderShipping() {
  for(const [orderIndex,order] of orders.entries()){
    const container=orderSections[orderIndex]?.shippingContainer;if(!container)continue;container.replaceChildren();
    const requiresShipping=()=>items.some(item=>item.orderIndex===orderIndex&&!item.classification?.nonPhysical);
    const box=node('div',undefined,'field order-tracking-field');
    const modeWrap=node('div',undefined,'field'),modeLabel=node('label','운송정보 입력 시점'),mode=document.createElement('select');
    mode.id=`order-shipping-entry-${orderIndex}`;modeLabel.htmlFor=mode.id;
    option(mode,'now','지금 입력');option(mode,'later','추후 배대지에서 직접 입력');mode.value=order.shippingEntry??'later';
    modeWrap.append(modeLabel,mode);box.append(modeWrap);
    const fields=node('div',undefined,'field-grid order-shipping-inputs');
    const tracking=inputField(fields,'운송장번호',order.tracking,v=>{order.tracking=v;},'text',true);
    tracking.id=`order-tracking-${orderIndex}`;tracking.previousElementSibling.htmlFor=tracking.id;
    requireField(tracking,'필수 입력 · 운송장번호를 입력하거나 추후 입력으로 바꿔 주세요.',()=>!!order.tracking?.trim(),()=>order.shippingEntry==='now'&&requiresShipping());
    const carrierWrap=node('div',undefined,'field field-full'),carrierLabel=node('label','이 주문의 일본 현지 운송사'),carrier=document.createElement('select');
    carrier.id=`order-carrier-${orderIndex}`;carrierLabel.htmlFor=carrier.id;
    selectOptions(carrier,Object.entries(CARRIERS).map(([value,c])=>({value,label:c.label})),'운송사 확인 후 선택 · 모르면 공란');
    carrier.value=order.carrierKey??'';carrier.addEventListener('change',()=>{order.carrierKey=carrier.value;updateSummary();});
    carrierWrap.append(carrierLabel,carrier);carrierWrap.hidden=template()==='postmall';fields.append(carrierWrap);box.append(fields);
    requireField(carrier,'필수 선택 · 현지 운송사를 선택하거나 추후 입력으로 바꿔 주세요.',()=>!!order.carrierKey,()=>template()!=='postmall'&&order.shippingEntry==='now'&&requiresShipping());
    const note=node('p',shippingEntryNote(order),'field-hint');note.id=`order-shipping-note-${orderIndex}`;mode.setAttribute('aria-describedby',note.id);box.append(note);
    function applyMode(){const later=mode.value!=='now';order.shippingEntry=later?'later':'now';fields.hidden=later;tracking.disabled=later;carrier.disabled=later||template()==='postmall';note.textContent=shippingEntryNote(order);}
    mode.addEventListener('change',()=>{applyMode();updateSummary();});applyMode();container.append(box);
  }
}
function updateSummary() {
  const allRows=normalizedItems(true),rows=normalizedItems(),excluded=allRows.length-rows.length;
  refreshFixedShippingOptions(rows);
  const sum=allRows.reduce((s,i)=>s+(Number.isFinite(i.unitPrice)&&Number.isFinite(i.quantity)?i.unitPrice*i.quantity:0),0), postage=orders.reduce((s,o)=>s+(o.postage??0),0);
  const categoriesMissing=rows.filter(i=>!currentCategory(i)).length, linksMissing=rows.filter(i=>!safeUrl(i.productUrl,'product')).length;
  $('order-summary').replaceChildren();
  const connected=items.filter(i=>safeUrl(i.productUrl,'product')&&safeUrl(i.imageUrl,'image')).length;
  for(const [label,value] of [['주문',`${orders.length}건`],['상품',`${items.length}종`],['상품 연결',`${connected}/${items.length}`],['상품 합계',money(sum)],['현지 배송비',money(postage)]]){
    const p=node('div');p.append(node('span',label),node('strong',value));$('order-summary').append(p);
  }
  if(excluded){const info=node('div');info.append(node('span','배송 신청'),node('strong',`${rows.length}종 · ${money(rows.reduce((s,i)=>s+(Number.isFinite(i.unitPrice)?i.unitPrice*(i.quantity||0):0),0))}`));$('order-summary').append(info);}
  orderSections.forEach((section,index)=>{
    const order=orders[index],orderRows=allRows.filter(item=>item.orderIndex===index),shippingRows=rows.filter(item=>item.orderIndex===index);
    const subtotal=orderRows.every(item=>Number.isFinite(item.unitPrice)&&Number.isInteger(item.quantity)&&item.quantity>0)?orderRows.reduce((total,item)=>total+item.unitPrice*item.quantity,0):null;
    const orderPostage=Number.isFinite(order.postage)?order.postage:null;
    const sourceTotal=Number.isFinite(order.total),total=sourceTotal?order.total:subtotal!==null&&orderPostage!==null?subtotal+orderPostage:null;
    updateOrderSectionSummary(section.summaryContainer,{products:orderRows.length,connected:orderRows.filter(item=>safeUrl(item.productUrl,'product')&&safeUrl(item.imageUrl,'image')).length,subtotal,postage:orderPostage,total,totalLabel:sourceTotal?'원문 결제금액':'주문 합계',
      ...(shippingRows.length!==orderRows.length?{shippingProducts:shippingRows.length,shippingSubtotal:shippingRows.every(item=>Number.isFinite(item.unitPrice)&&Number.isInteger(item.quantity)&&item.quantity>0)?shippingRows.reduce((sum,item)=>sum+item.unitPrice*item.quantity,0):null}:{})});
  });
  const notes=[];if(categoriesMissing)notes.push(`${template()==='postmall'?'HS 미확인':'품목코드 미확인'} ${categoriesMissing}개`);if(linksMissing)notes.push(`상품 URL 미확인 ${linksMissing}개`);
  if(template()==='postmall'){const invalidHs=rows.filter(item=>currentCategory(item)&&!isValidHsCode(item.postmallHsCode)).length;if(invalidHs)notes.push(`HS 형식 확인 ${invalidHs}개`);notes.push(...postmallOrderLimitErrors(rows));}
  const review=rows.filter(i=>i.classification?.requiresReview||(template()==='postmall'&&i.postmallHsSuggestion?.requiresReview)).length;if(review)notes.push(`${template()==='postmall'?'실물 구성·HS 확인 권장':'상품 분류 확인 권장'} ${review}개`);
  const shippingOrders=orders.filter((order,index)=>rows.some(item=>item.orderIndex===index));
  const enterNow=shippingOrders.filter(o=>o.shippingEntry==='now'),laterCount=shippingOrders.length-enterNow.length;
  if(template()!=='postmall'&&enterNow.some(o=>!o.carrierKey))notes.push('지금 입력할 현지 운송사 미입력 · 현재 공란 초안');
  if(enterNow.some(o=>!o.tracking?.trim()))notes.push('지금 입력할 운송장번호 미입력 · 현재 공란 초안');
  const quickMissing=effectiveTemplate()==='hoottown-fast'?[rows.some(item=>!item.tracking?.trim())?'운송장번호':'',rows.some(item=>!item.carrier?.trim())?'현지 운송사':''].filter(Boolean):[];
  if(quickMissing.length)notes.push(`THE빠른배송 실제 업로드 전 ${quickMissing.join('·')} 보완 필요 · 현재 공란 초안`);
  for(const [index,order] of orders.entries()){const total=allRows.filter(i=>i.orderIndex===index).reduce((s,i)=>s+(Number.isFinite(i.unitPrice)?i.unitPrice*(i.quantity||0):0),0);if(order.subtotal!==null&&Math.abs(total-order.subtotal)>0.02)notes.push(`${order.orderNo}: 원문 소계 ${money(order.subtotal)}와 상품 합계가 다릅니다. 단가와 수량, 누락된 상품을 확인해 주세요.`);}
  const usesDummy=Object.entries(dummy).some(([id,v])=>id==='phone'?phoneDigits($(id).value)===phoneDigits(v):$(id).value===v);
  if(usesDummy)notes.push('수취인 예시 정보가 포함됩니다.');
  const laterInfo=!laterCount?'':template()==='general'?`추후 입력 ${laterCount}건은 운송장번호를 비우고 현지 운송사를 기타(ETC)로 자동 입력합니다. 실제 운송사를 확인한 뒤 배대지에서 수정해 주세요. `:`운송정보 ${laterCount}건은 추후 배대지에서 직접 입력하도록 ${template()==='postmall'?'운송장번호를':'운송장번호·현지 운송사를'} 공란으로 작성합니다. `;
  const shippingInfo=(excluded?`실물 없는 전자 참가권 ${excluded}개는 배송용 엑셀에서 제외합니다. `:'')+laterInfo+(template()==='postmall'&&categoriesMissing?'HS 공란은 코드가 확인되지 않은 초안입니다. 포스트몰 실제 업로드 전에 공식 HS 찾기에서 상품별 코드를 확인해 주세요. ':'');
  status('export-status',shippingInfo+(notes.length?`${notes.join(' / ')} 확인이 필요한 값이 있어도 초안 엑셀은 내려받을 수 있습니다.`:'입력한 수취인 정보와 확인한 상품으로 엑셀을 만듭니다.'),!!notes.length);
  const missing=refreshRequiredFields();if($('download-label'))$('download-label').textContent=missing||quickMissing.length?'초안 엑셀 다운로드':'엑셀 다운로드';
  syncDownloadButton();
}
function setTemplate() {
  syncPhone();
  const general=template()==='general';$('general-fields').hidden=!general;$('jimpass-fields').hidden=template()!=='jimpass';$('postmall-fields').hidden=template()!=='postmall';
  const fast=effectiveTemplate()==='hoottown-fast';
  syncCustomsFields();
  refreshFixedShippingOptions();
  if($('hoottown-service-note'))$('hoottown-service-note').textContent=fast?'THE빠른배송은 1트래킹·1박스에 여러 상품을 신청할 수 있습니다. 고정배송비는 신청하지 않아도 됩니다. 다운로드 양식: Quick_Excel_Upload.xlsx.':'다운로드 양식: General_Excel_Upload.xlsx (일반 배송). 운송장번호는 비워 두고 나중에 입력할 수 있습니다.';
  refreshShippingHints();
  if(items.length){renderItems();updateSummary();}else{refreshRequiredFields();syncDownloadButton();}
}
function analyze() {
  markStateChanged();
  const text=$('order-input').value.trim();if(!text){status('parse-status','먼저 주문 상세 내역을 붙여넣어 주세요.',true);return;}
  const parsed=parseOrders(text);orders=parsed.orders.map(order=>({...order,shippingEntry:'later',tracking:order.tracking??'',carrierKey:order.carrierKey??''}));items=orders.flatMap((order,orderIndex)=>order.items.map(i=>({...i,orderIndex,orderNo:order.orderNo,sourceProductUrl:i.productUrl||'',sourceImageUrl:i.imageUrl||'',sourceMatchedId:'',productUrl:i.productUrl||'',imageUrl:i.imageUrl||'',color:i.color||(/^(?:Members?|メンバー)[^:：]*[:：]\s*(.*)/i.exec(i.option)?.[1]??(!i.size?i.option.replace(/^[^:：]+[:：]\s*/,''):'')),size:i.size??'',postmallHsCode:'',postmallHsCodeEdited:false,jimpassCategoryEdited:false,generalCategoryEdited:false})));
  parsedText=$('order-input').value;
  items.forEach(item=>assignCategory(item));$('preview-section').hidden=!items.length;
  if(!items.length){status('parse-status','상품을 읽지 못했습니다. 아소비몰 상단에서 English를 선택한 뒤 주문 상세 내역을 다시 복사해 주세요. Order No., Product amount, quantity가 포함되어야 합니다.',true);$('download-btn').disabled=true;return;}
  renderItems();updateSummary();
  const unmatched=items.filter(i=>!safeUrl(i.productUrl,'product')||!safeUrl(i.imageUrl,'image')).length;
  status('parse-status',`${orders.length}개 주문에서 상품 ${items.length}개를 읽었습니다. ${unmatched?`상품 연결 미완료 ${unmatched}개를 확인해 주세요.`:'모든 상품의 상품·이미지 URL을 연결했습니다.'}${parsed.warnings.length?' '+parsed.warnings.join(' '):''}`,!!parsed.warnings.length||!!unmatched);
  $('preview-section').scrollIntoView({behavior:'smooth',block:'start'});
}
async function runAnalysis() {
  if(analyzing)return;
  const revision=stateRevision;analyzing=true;$('analyze-btn').disabled=true;$('sample-btn').disabled=true;
  syncDownloadButton();
  $('paste-section').setAttribute('aria-busy','true');
  status('parse-status','주문 내용을 읽고 있습니다…');
  try {
    await new Promise(resolve=>{const fallback=setTimeout(resolve,80);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(fallback);resolve();}));});
    if(revision!==stateRevision)return;
    analyze();
  } catch {
    orders=[];items=[];parsedText='';clearItemCards();$('order-summary').replaceChildren();
    $('preview-section').hidden=true;$('download-btn').disabled=true;
    status('parse-status','주문 내용을 읽는 중 오류가 발생했습니다. 입력 내용은 유지했습니다. 새로고침 후 다시 시도해 주세요.',true);
    status('export-status','');refreshRequiredFields();
  } finally {
    analyzing=false;$('paste-section').setAttribute('aria-busy','false');
    $('analyze-btn').disabled=false;$('sample-btn').disabled=false;
    syncDownloadButton();
  }
}
function postmallOrderLimitErrors(rows){
  if(template()!=='postmall')return [];
  const groups=new Map();for(const row of rows){const key=Number.isInteger(row.orderIndex)?`index:${row.orderIndex}`:`order:${row.orderNo??''}`;if(!groups.has(key))groups.set(key,{orderNo:row.orderNo,count:0});groups.get(key).count++;}
  const limit=postmallConfig?.maxItemsPerRow??20;return [...groups.values()].filter(group=>group.count>limit).map(group=>`${group.orderNo||'주문번호 확인 필요'}: 포스트몰은 신청서 한 행에 상품 ${limit}종까지 입력할 수 있습니다. 현재 ${group.count}종이므로 신청 구성을 확인해 주세요.`);
}
function validation(rows,p) {
  const errors=[];
  if(template()==='postmall'&&!postmallConfig)errors.push('포스트몰 양식을 불러오지 못했습니다. 새로고침하거나 다른 배대지를 선택해 주세요.');
  if(orders.some(o=>o.currency!=='JPY'))errors.push('이 사이트는 아소비몰의 일본 엔화(JPY) 주문만 지원합니다. 원문의 통화를 확인해 주세요.');
  for(const [key,label] of [['recipient','수취인명'],['phone','연락처'],['postal','우편번호'],['address','주소'],['customs','개인통관고유부호']])if(!p[key])errors.push(`${label}를 입력해 주세요.`);
  if(!/^\d{5}$/.test(p.postal))errors.push('우편번호는 앞자리 0을 포함한 숫자 5자리로 입력해 주세요.');
  if(p.businessCustoms!=='Y'&&p.postmallBusiness!=='T'&&!/^P\d{12}$/i.test(p.customs))errors.push('개인통관고유부호는 P와 숫자 12자리로 입력해 주세요.');
  if(!isValidPhone(p.phone))errors.push('휴대폰 번호를 확인해 주세요.');
  if(!safeUrl(p.shopUrl,'product'))errors.push('쇼핑몰 주소는 아소비몰 주소를 입력해 주세요.');
  if(!p.brand)errors.push('브랜드 / 셀러를 입력해 주세요.');
  if(template()==='general'&&p.brand.length>20)errors.push('훗타운 브랜드명은 20자 이내여야 합니다.');
  if(template()==='general'&&rows.length>990)errors.push('훗타운은 한 파일에 상품 990개까지 입력할 수 있습니다.');
  if(template()==='general'&&p.center!=='일본')errors.push('훗타운 물류센터는 일본 기준입니다.');
  errors.push(...postmallOrderLimitErrors(rows));
  rows.forEach((i,n)=>{
    if(!i.name.trim())errors.push(`${n+1}번 상품명을 확인해 주세요.`);
    if(unsupportedNameScript.test(i.rawEditableName??i.name))errors.push(`${n+1}번 상품명을 영문으로 입력해 주세요. 아소비몰 상단에서 English를 선택하고 복사할 수 있습니다.`);
    if(template()==='general'&&i.name.length>80)errors.push(`${n+1}번 상품명은 80자 이내로 줄여 주세요.`);
    if(template()==='jimpass'&&!isValidJimpassName(i.name))errors.push(`${n+1}번 짐패스 상품명은 영문·숫자·공백으로 작성하고 영문·숫자를 10~100자 입력해 주세요.`);
    if(template()==='jimpass'&&i.category&&!/^\d+$/.test(i.category))errors.push(`${n+1}번 짐패스 품목코드는 숫자로 입력해 주세요.`);
    if(template()==='postmall'&&i.postmallHsCode&&!isValidHsCode(i.postmallHsCode))errors.push(`${n+1}번 HS CODE는 점·공백을 제외한 숫자 6·8·10자리로 입력해 주세요. 미확인 코드로 임의 분류하지 말고 공식 HS 찾기에서 확인해 주세요.`);
    if(!Number.isInteger(i.quantity)||i.quantity<1)errors.push(`${n+1}번 상품 수량은 1 이상의 정수여야 합니다.`);
    if(!Number.isFinite(i.unitPrice)||i.unitPrice<0||Math.abs(i.unitPrice*100-Math.round(i.unitPrice*100))>1e-6)errors.push(`${n+1}번 상품 단가는 소수점 두 자리 이내의 숫자여야 합니다.`);
    if(i.productUrl&&!safeUrl(i.productUrl,'product'))errors.push(`${n+1}번 상품 URL은 아소비몰 상품 주소를 입력해 주세요.`);
    if(i.imageUrl&&!safeUrl(i.imageUrl,'image'))errors.push(`${n+1}번 이미지 URL을 확인해 주세요.`);
  });
  errors.push(...getFixedShippingErrors({template:effectiveTemplate(),items:rows,profile:p,config:effectiveTemplate()==='hoottown-fast'?fastConfig:config}).map(fixedRateDisplayError));
  return errors;
}
async function download() {
  if(busy||reviewPending||analyzing||!items.length)return;
  if($('order-input').value!==parsedText){status('export-status','수정한 주문 내역을 다시 읽어온 뒤 다운로드해 주세요.',true);return;}
  const p=profile(), rows=normalizedItems(), errors=validation(rows,p);
  if(!rows.length){status('export-status','배송 신청할 실물 상품이 없습니다.',true);return;}
  refreshRequiredFields();
  if(errors.length){status('export-status',errors.join('\n'),true);return;}
  const revision=stateRevision,kind=effectiveTemplate();
  reviewPending=true;let confirmed=false;
  try{confirmed=await confirmDownloadReview();}
  catch{if(downloadStateCurrent(revision))status('export-status','다운로드 확인 창을 열지 못했습니다. 다시 시도해 주세요.',true);return;}
  finally{reviewPending=false;syncDownloadButton();}
  if(!confirmed||stopStaleDownload(revision)||busy)return;
  busy=true;activeDownloadRevision=revision;syncDownloadButton();status('export-status','브라우저 안에서 엑셀 파일을 만들고 있습니다.');
  try{
    const templateBytes=await loadTemplate(kind);
    if(stopStaleDownload(revision))return;
    const bytes=await exportWorkbook({template:kind,templateBytes,items:rows,profile:p,config:activeConfig(kind)});
    if(stopStaleDownload(revision))return;
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const orderNumbers=[...new Set(rows.map(i=>i.orderNo))];
    const orderName=String(orderNumbers[0]||'주문').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,90);
    const a=document.createElement('a');a.href=url;a.download=`${kind==='postmall'?'포스트몰':kind==='jimpass'?'짐패스':'훗타운'}_${orderName}${orderNumbers.length>1?`_외${orderNumbers.length-1}건`:''}${kind==='hoottown-fast'?'_THE빠른배송':''}.xlsx`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    updateSummary();const previous=$('export-status').textContent,warning=$('export-status').classList.contains('warning');status('export-status',`엑셀 파일을 만들었습니다. ${previous}`,warning);
  }catch(e){if(!stopStaleDownload(revision))status('export-status',`엑셀을 만들지 못했습니다. ${e.message}`,true);}
  finally{if(activeDownloadRevision===revision){activeDownloadRevision=null;busy=false;}syncDownloadButton();}
}
const sample=`Order No. DEMO-1001\nOrder date\nSeptember 18, 2026 20:00\nPayment amount\nsubtotal\n¥8,300\npostage\n¥880\nAmount due\n¥9,180\nOrdered items\nmerchandise\n[image](https://images.groobee.com/images/asobisystem/Z51Ta2ununni5HhHxUwRFLTR5lC7SZ4m9vBKMMJZ.jpg)\nCUTIE STREET OSHI API UNIFORM\nMembers (CUTIE STREET):\nAyano Masuda\nProduct amount:\n¥6,500\nquantity:\n1\n[image](https://images.groobee.com/images/asobisystem/Z2zS54WGCRVYa06W8PjlEW2afy5rMF5nQDhLzF7b.jpg)\nCUTIE STREET OFFICIAL FAN LIGHT CUSTOM CHARM\nMembers (CUTIE STREET):\nAyano Masuda\nProduct amount:\n¥1,800\nquantity:\n1`;

function buildPostmallFields(){
  const section=$('postmall-fields'),heading=node('h3','포스트몰 신청 설정');heading.id='postmall-settings-title';
  section.replaceChildren(heading,node('p','일본 아소비몰 주문 → 한국 수취 기준입니다. 한 주문은 한 행에 최대 20개 상품으로 작성하며 국가·센터·통화·운송사 열은 없습니다. 포스트몰 신청 화면에서 일본 센터와 엔화 조건을 확인해 주세요. HS 코드는 상품별로 확인해야 하며 다른 배대지의 품목번호를 복사하지 않습니다.','postmall-note'));
  const grid=node('div',undefined,'field-grid extra-fields');
  function optionalInput(parent,id,label,type='text'){
    const input=inputField(parent,label,'',()=>{},type);input.id=id;input.previousElementSibling.htmlFor=id;return input;
  }
  optionalInput(grid,'postmall-buyer-name','주문자명 (선택 · 공란이면 수취인명)');
  optionalInput(grid,'postmall-buyer-phone','주문자 휴대폰 (선택 · 공란이면 수취인 연락처)','tel');
  const reportField=node('div',undefined,'field'),reportLabel=node('label','통관 구분 (모르면 공란)'),report=document.createElement('select');report.id='postmall-customs-type';reportLabel.htmlFor=report.id;
  selectOptions(report,(postmallConfig?.cargoReportType?.values??[{code:'F',label:'일반통관'},{code:'B',label:'목록통관'}]).map(row=>({value:row.code,label:`${row.code} · ${row.label}`})),'모르면 공란');reportField.append(reportLabel,report);grid.append(reportField);
  const packingField=node('div',undefined,'field'),packingLabel=node('label','포장 방식 (원본 박스제거 열)'),packing=document.createElement('select');packing.id='postmall-packaging';packingLabel.htmlFor=packing.id;
  for(const row of postmallConfig?.packagingMode?.values??[{code:'A',label:'그대로 발송'},{code:'B',label:'폴리백 포장'},{code:'C',label:'박스 재포장'}])option(packing,row.code,`${row.code} · ${row.label}`);
  packing.value='A';for(const choice of packing.options)choice.defaultSelected=choice.value==='A';packingField.append(packingLabel,packing);grid.append(packingField);
  const deliveryField=node('div',undefined,'field field-full'),deliveryLabel=node('label','배송 메시지 (선택)'),delivery=document.createElement('textarea');delivery.id='postmall-delivery-note';deliveryLabel.htmlFor=delivery.id;delivery.rows=2;delivery.autocomplete='off';deliveryField.append(deliveryLabel,delivery);grid.append(deliveryField);section.append(grid);
  const advanced=node('details',undefined,'postmall-advanced'),summary=node('summary','부가서비스 · 나눔배송 설정');advanced.append(summary);
  advanced.append(node('p','선택한 항목만 원본 양식의 T 값으로 작성합니다. 이용 요금과 적용 조건을 포스트몰에서 확인해 주세요. 사업자통관을 선택하면 통관정보를 사업자번호로 입력해야 합니다.','field-hint'));
  const services=node('div',undefined,'service-options');
  for(const [id,label]of [['postmall-inspection','정밀검수'],['postmall-aircap','에어캡포장'],['postmall-reinforce','보강제강화'],['postmall-business','사업자통관'],['postmall-invoice-remove','인보이스 제거'],['postmall-hanger-remove','의류 행거 제거'],['postmall-automatic-release','자동출고']]){
    const caption=node('label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id=id;caption.append(checkbox,document.createTextNode(label));services.append(caption);
  }
  const ftaLabel=node('label'),fta=document.createElement('input');fta.type='checkbox';fta.id='postmall-fta';fta.disabled=true;ftaLabel.append(fta,document.createTextNode('FTA통관 · 원본은 캐나다산·캐나다 전용, 일본 주문은 공란'));services.append(ftaLabel);advanced.append(services);
  const splitField=node('div',undefined,'field extra-fields'),splitLabel=node('label','나눔배송 포장 (선택)'),split=document.createElement('select');split.id='postmall-split';splitLabel.htmlFor=split.id;selectOptions(split,[{value:'box',label:'나눔배송 · 박스'},{value:'polybag',label:'나눔배송 · 폴리백'}],'나눔배송 신청 안 함');splitField.append(splitLabel,split,node('p','원본 안내: 나눔배송과 박스제거를 함께 요청할 때는 포장 열에 A, 나눔배송 박스 또는 폴리백 항목에 T를 입력합니다. 선택한 조합과 실제 요청을 확인해 주세요.','field-hint'));advanced.append(splitField);section.append(advanced);
  $('postmall-business').addEventListener('change',handleBusinessSelection);
}

async function init() {
  reset();
  $('order-input').disabled=true;
  $('analyze-btn').disabled=true;
  $('sample-btn').disabled=true;
  status('parse-status','공개 상품 목록과 엑셀 양식을 불러오는 중입니다.');
  const [cfg,cat,fast,thumbs,post]=await Promise.allSettled([loadJson('general-config.json'),loadJson('catalog.json'),loadJson('fast-config.json'),loadJson('thumbnails.json'),loadJson('postmall-config.json')]);
  if(cfg.status!=='fulfilled'){status('parse-status','품목코드표를 불러오지 못했습니다. 새로고침해 주세요.',true);return;}
  config=cfg.value;if(cat.status==='fulfilled')catalog=cat.value;if(fast.status==='fulfilled')fastConfig=fast.value;if(post.status==='fulfilled'&&post.value?.provider==='postmall'&&Array.isArray(post.value.itemSlots)&&post.value.itemSlots.length)postmallConfig=post.value;
  const postmallRadio=document.querySelector('[name=template][value=postmall]');postmallRadio.disabled=!postmallConfig;
  status('provider-status',postmallConfig?'':'포스트몰 양식을 불러오지 못했습니다. 훗타운·짐패스는 사용할 수 있으며 포스트몰은 새로고침 후 다시 확인해 주세요.',!postmallConfig);
  if(thumbs.status==='fulfilled')for(const product of catalog.products){const src=thumbs.value.products?.[String(product.id)];if(typeof src==='string'&&/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/.test(src))thumbnailImages.set(imageKey(product.imageUrl),src);}
  else console.warn('공개 썸네일 자료를 불러오지 못했습니다.',thumbs.reason?.message??'');
  if(window.__ORDER_EXCEL_OFFLINE__)document.title='주문 한 장 · 오프라인';
  selectOptions($('center'),['일본'],'일본 → 한국');$('center').value='일본';
  selectOptions($('carrier'),config.lists.carriers.filter(c=>c.center==='일본').map(c=>({value:c.label,label:c.label})), '현지 운송사 확인 후 선택');
  // Unknown carrier stays blank: draft download is permitted with a visible reminder.
  populateCategories($('general-category'),'');
  selectOptions($('shipping-type'),[{value:'personal',label:'한국 개인 수취 · 개인통관고유부호'}]);$('shipping-type').value='personal';
  const shippingLabel=document.querySelector('label[for=shipping-type]');shippingLabel.textContent='통관 구분';
  const privacy=node('p','예시 정보가 기본으로 채워져 있습니다. 바꾸지 않고 다운로드하면 예시 정보가 들어갑니다. 새로고침하면 입력값이 초기화됩니다.','info-note dummy-note');
  $('profile-form').prepend(privacy);
  const options=node('div',undefined,'service-options');
  for(const [id,label] of [['compensation','해외 구매물품 보상보험'],['immediate-release','바로출고'],['inspection','실물검수 (원본 양식 기본값: 신청)'],['packing-reinforce','포장보완'],['business-customs','사업자통관']]){const l=node('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id=id;checkbox.defaultChecked=id==='inspection';checkbox.checked=checkbox.defaultChecked;l.append(checkbox,document.createTextNode(label));options.append(l);}
  $('jimpass-fields').append(options);
  const extra=node('div',undefined,'field-grid extra-fields field-full');
  const carrierWrap=node('div',undefined,'field field-full'),carrierLabel=node('label','짐패스 현지 택배사 (선택)'),localCarrier=document.createElement('select');localCarrier.id='local-carrier';carrierLabel.htmlFor=localCarrier.id;selectOptions(localCarrier,['야마토','사가와','우체국','아마존 익스프레스','윌포트','라쿠텐','후쿠야마','세이노','에코하이','그 외'],'발송 메일 확인 후 선택');carrierWrap.append(carrierLabel,localCarrier);extra.append(carrierWrap);
  for(const [id,label,hint] of [['warehouse-note','입고담당자 요청 메모','상품 상태·검수 요청 사항. 합배송·사진·다른 신청서 이동 요청은 작성할 수 없습니다.'],['courier-note','택배사 요청 메모','한국 택배사에 전달할 배송 요청 사항']]){const wrap=node('div',undefined,'field field-full'),l=node('label',label),t=document.createElement('textarea');t.id=id;l.htmlFor=id;t.rows=2;t.autocomplete='off';wrap.append(l,t,node('p',hint,'field-hint'));extra.append(wrap);}
  extra.append(node('p','의류 박스 제거·기타 구성품 포함·기프트박스 포함·재포장·신발 박스 추가는 엑셀에 개별 항목이 없습니다. 엑셀 업로드 후 짐패스 신청 화면에서 설정해 주세요. 선택한 부가서비스의 요금은 짐패스에서 확인해 주세요.','field-hint field-full'));
  $('jimpass-fields').append(extra);
  $('business-customs').addEventListener('change',handleBusinessSelection);
  $('general-options').append(node('p','한국 개인 수취 기준입니다. 배송비 포인트 자동결제·브랜드 박스 제거·인보이스 제거·트루패킹은 미신청(N), 보험은 기본 미신청으로 작성합니다. 상품 단가는 화면에 표시된 금액을 사용하며 배송비를 배분하지 않습니다.','field-hint field-full'));
  const delivery=node('div',undefined,'field-grid extra-fields');
  const modeField=node('div',undefined,'field field-full'),modeLabel=node('label','훗타운 배송 유형'),mode=document.createElement('select');mode.id='hoottown-service';modeLabel.htmlFor=mode.id;selectOptions(mode,[{value:'general',label:'일반 배송'},{value:'fast',label:'THE 빠른배송'}]);mode.value='general';if(!fastConfig)mode.options[2].disabled=true;
  const modeNote=node('p',undefined,'field-hint');modeNote.id='hoottown-service-note';modeField.append(modeLabel,mode,modeNote);delivery.append(modeField);
  const fixedField=node('div',undefined,'field field-full'),fixedLabel=node('label','특정 품목 고정배송비 (선택)'),fixed=document.createElement('select');fixed.id='fixed-shipping';fixedLabel.htmlFor=fixed.id;
  const fixedExplanation=node('p','배송 유형과 별도인 엑셀 고정배송비 신청입니다. 신청서별 상품 1종·수량 1개일 때만 선택하세요.','field-hint');fixedExplanation.id='fixed-shipping-explanation';
  const fixedHint=node('p',undefined,'field-hint');fixedHint.id='fixed-shipping-hint';fixed.setAttribute('aria-describedby',`${fixedExplanation.id} ${fixedHint.id}`);fixedField.append(fixedLabel,fixedExplanation,fixed,fixedHint);
  const fixedDetails=node('details',undefined,'field-hint');fixedDetails.id='fixed-shipping-details';fixedDetails.append(node('summary','고정배송비 상세조건'));
  fixedDetails.append(node('p','일본 THE빠른배송 홈페이지 조건입니다. 홈페이지 조건과 별개로 엑셀 고정배송비 신청에는 상품 1종·수량 1개 조건(AK10/AW10)이 적용됩니다.'));
  const conditions=node('ul');
  for(const condition of [
    '9 · 우편물: 수량 999개까지, 실중량 0.5kg까지, 부피중량 제한 없음. A4 이하·두께 2cm 이내.',
    '10 · 음반 CD·팩: 수량 99개까지, 실중량 1kg까지, 부피중량 제한 없음.',
    '28 · 인형: 수량 10개까지, 실중량 1kg까지, 부피중량 1kg까지.',
    '31 · 프라모델: 수량 1개까지, 실중량 3kg까지, 부피중량 3kg까지.',
  ])conditions.append(node('li',condition));
  fixedDetails.append(conditions,node('p','고정배송비에는 쿠폰을 사용할 수 없으며, 조건을 초과하면 기본 운송료가 적용됩니다.'));fixedField.append(fixedDetails);
  delivery.append(fixedField);$('general-fields').prepend(delivery);
  requireField(fixed,()=>{const errors=fixedShippingErrorsFor();return errors.slice(0,2).join(' ')+(errors.length>2?` 외 ${errors.length-2}건의 조건을 확인해 주세요.`:'');},()=>fixedShippingErrorsFor().length===0,()=>template()==='general'&&!!fixed.value);
  fixed.addEventListener('change',()=>{if(items.length)updateSummary();else{refreshFixedShippingOptions();refreshRequiredFields();}});
  buildPostmallFields();
  mode.addEventListener('change',setTemplate);
  $('tracking').parentElement.hidden=true;
  document.querySelector('.catalog-note').textContent=`공개 상품 ${catalog.products.length.toLocaleString()}개와 이미지 주소·상품명을 대조합니다. 목록에 없거나 후보가 여러 개면 직접 확인해 주세요.${catalog.updatedAt?' 목록 수집: '+catalog.updatedAt.slice(0,10):''}`;
  for(const n of document.querySelectorAll('.template-copy strong'))if(n.textContent==='General Excel')n.textContent='훗타운';
  document.querySelector('label[for=general-category]').textContent='훗타운 공통 품목코드 (상품별 자동 분류를 덮어쓸 때)';
  document.querySelector('label[for=jimpass-category]').textContent='짐패스 공통 품목코드 (상품별 자동 분류를 덮어쓸 때)';
  $('center').disabled=true;$('shipping-type').disabled=true;
  $('carrier').parentElement.hidden=true;$('local-carrier').parentElement.hidden=true;
  for(const [id,message,valid]of [
    ['recipient','필수 입력 · 수취인명을 입력해 주세요.'],['address','필수 입력 · 기본주소를 입력해 주세요.'],
    ['phone','필수 입력 · 휴대폰 번호를 확인해 주세요.',()=>isValidPhone($('phone').value)],
    ['postal','필수 입력 · 숫자 5자리 우편번호를 입력해 주세요.',()=>/^\d{5}$/.test($('postal').value)],
    ['customs','필수 입력 · 통관정보를 확인해 주세요.',()=>businessClearanceSelected()?!!$('customs').value.trim():/^P\d{12}$/i.test($('customs').value)],
    ['shop-url','필수 입력 · 아소비몰 주소를 입력해 주세요.',()=>!!safeUrl($('shop-url').value,'product')],['brand','필수 입력 · 브랜드 / 셀러를 입력해 주세요.']
  ])requireField($(id),message,valid);
  for(const text of [...$('download-btn').childNodes].filter(n=>n.nodeType===3))text.remove();const downloadLabel=node('span','엑셀 다운로드');downloadLabel.id='download-label';$('download-btn').append(downloadLabel);
  setTemplate();
  $('sample-btn').addEventListener('click',()=>{$('order-input').value=sample;demoActive=true;void runAnalysis();});
  $('order-input').addEventListener('focus',()=>{if(demoActive&&$('order-input').value===sample){$('order-input').value='';orders=[];items=[];parsedText='';demoActive=false;clearItemCards();$('order-summary').replaceChildren();$('preview-section').hidden=true;$('download-btn').disabled=true;status('parse-status','주문 상세 내역을 붙여넣어 주세요.');status('export-status','');}});
  $('clear-btn').addEventListener('click',reset);
  $('analyze-btn').addEventListener('click',()=>void runAnalysis());$('download-btn').addEventListener('click',download);
  $('profile-form').addEventListener('submit',e=>e.preventDefault());
  $('phone').addEventListener('input',()=>{syncPhone(true);fieldChecks.get($('phone'))?.();});
  $('phone').addEventListener('blur',()=>{syncPhone();fieldChecks.get($('phone'))?.();if(items.length)updateSummary();});
  document.querySelectorAll('[name=template]').forEach(r=>r.addEventListener('change',setTemplate));
  $('profile-form').addEventListener('input',()=>{if(items.length)updateSummary();});
  for(const [id,key] of [['jimpass-category','jimpassCategory'],['general-category','generalCategory']])$(id).addEventListener('change',()=>{if($(id).value){items.forEach(i=>{i[key]=$(id).value;i[`${key}Edited`]=true;});renderItems();updateSummary();}});
  $('order-input').addEventListener('input',()=>{demoActive=false;if(items.length&&$('order-input').value!==parsedText){$('download-btn').disabled=true;status('parse-status','주문 내역이 변경되었습니다. 주문 내용 읽어오기를 다시 눌러 주세요.',true);}});
  window.addEventListener('pagehide',reset);window.addEventListener('pageshow',e=>{if(e.persisted)reset();});
  initNavigation();
  confirmDownloadReview=initDownloadReview();
  postcodeSearch=initPostcodeSearch(({postcode,address})=>{
    markStateChanged();
    const changed=$('address').value!==address;
    $('postal').value=postcode;$('address').value=address;
    if(changed)$('address2').value='';
    updateSummary();$('address2').focus();
  });
  const onDataChange=event=>{const target=event.target;if(target instanceof Element&&(target.id==='order-input'||target.closest('#profile-form,#preview-section')||target.matches('[name="template"]')))markStateChanged();};
  document.addEventListener('input',onDataChange,{capture:true});document.addEventListener('change',onDataChange,{capture:true});
  $('order-input').disabled=false;$('analyze-btn').disabled=false;$('sample-btn').disabled=false;$('clear-btn').disabled=false;
  status('parse-status','');
}
init().catch(()=>status('parse-status','사이트 초기화에 실패했습니다. 새로고침해 주세요.',true));
