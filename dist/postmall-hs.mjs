/** Conditional HS candidates from verified public material/type evidence. */
import {suggestPostmallHs as currentSuggestion} from './postmall-hs-core.mjs';
import {resolveProductMaterial} from './material-evidence.mjs';

const checkedAt = '2026-10-31';
const source = keyword => `https://www.postmall.net/api/hscodes?tag=true&q=${encodeURIComponent(keyword)}`;
const wco = chapter => `https://www.wcoomd.org/-/media/wco/public/global/pdf/topics/nomenclature/instruments-and-tools/hs-nomenclature-2022/2022/${chapter}_2022e.pdf?la=en`;
const japanClothing = 'https://www.customs.go.jp/tariff/2026_04_01/data/j_61.htm';
const list = value => Array.isArray(value) ? value : [];
const normalize = value => String(value ?? '').normalize('NFKC');
const proposal = (code, label, reason, ruleId, sourceUrl) => ({code, label, reason, requiresReview: true, ruleId, sourceUrl, checkedAt});

export function textileFamily(material) {
  const body = normalize(material).split(/\bRIB\b|リブ|裏地|LINING/i)[0]
    .split('\n').filter(line => !/미기재|미확인|불명|不明|未記載|UNKNOWN|NOT SPECIFIED/i.test(line)).join(' ');
  if (/ACRYLIC|アクリル|아크릴/i.test(body)
    && !/(?:ACRYLIC|アクリル|아크릴)\s*[:：]?\s*\d+(?:\.\d+)?\s*%|FIB(?:ER|RE)|繊維|섬유/i.test(body)) return null;
  const cotton = /COTTON|コットン|綿|棉|면/i.test(body);
  const manmade = /POLYESTER|NYLON|RAYON|ACRYLIC|POLYURETHANE|ポリエステル|ナイロン|レーヨン|アクリル|ポリウレタン|폴리에스테르|나일론|레이온|아크릴|폴리우레탄/i.test(body);
  if (/WOOL|SILK|LINEN|HEMP|羊毛|ウール|絹|麻|울|실크|린넨/i.test(body) || (!cotton && !manmade)) return null;
  if (cotton && !manmade) return 'cotton';
  if (manmade && !cotton) return 'manmade';
  const cottonPure = /(?:COTTON|コットン|綿|棉|면)\s*[:：]?\s*100\s*%|100\s*%\s*(?:COTTON|コットン|綿|棉|면)/i.test(body);
  const manmadePure = /(?:POLYESTER|NYLON|RAYON|ポリエステル|ナイロン|レーヨン)\s*[:：]?\s*100\s*%|100\s*%\s*(?:POLYESTER|NYLON|RAYON|ポリエステル|ナイロン|レーヨン)/i.test(body);
  if (cottonPure && manmadePure) return null;
  const match = body.match(/(?:COTTON|コットン|綿|棉|면)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/i)
    ?? body.match(/(\d+(?:\.\d+)?)\s*%\s*(?:COTTON|コットン|綿|棉|면)/i);
  if (!match) return null;
  const percent = Number(match[1]);
  if (percent < 0 || percent > 100) return null;
  const percentages = [...body.matchAll(/(?:COTTON|コットン|綿|棉|면)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*%/gi)].map(m => Number(m[1]));
  if (new Set(percentages).size > 1) return null;
  return percent > 50 ? 'cotton' : percent < 50 ? 'manmade' : null;
}

function context({name, product, classification}) {
  const evidence = classification?.evidence;
  if (product?.productUrl && evidence?.sourceUrl && product.productUrl !== evidence.sourceUrl) return null;
  const verified = classification?.source === 'product-detail' && evidence?.sourceUrl && evidence?.checkedAt
    && /^[a-f0-9]{64}$/.test(evidence?.descriptionSha256 ?? '');
  const publicProof = resolveProductMaterial(product);
  const material = [verified ? evidence.material : '', publicProof?.material].filter(value => typeof value === 'string' && value.trim()).join('\n');
  const facts = [...(verified ? list(evidence.facts) : []), ...list(publicProof?.facts)];
  const names = [product?.name, product?.enName, product?.nameEn, ...list(product?.aliases)]
    .filter(value => typeof value === 'string' && value.trim());
  return {names: normalize((names.length ? names : [name]).join('\n')), material: normalize(material),
    details: normalize([material, ...facts].join('\n')), hasProof: Boolean(verified || publicProof), publicProof, evidence};
}

/** Returns a review-required candidate from type, material or approved goods defaults. */
export function suggestPostmallHs(input = {}) {
  const {classification, product} = input;
  const kind = String(classification?.kind ?? '');
  if (!kind || classification?.nonPhysical || classification?.reviewStatus === 'non_physical'
    || classification?.source === 'detail-unavailable' || /digital|download|ticket|event|travel/i.test(kind)) return null;
  const ctx = context(input);
  if (!ctx) return null;
  const {names, material, details, hasProof, publicProof, evidence} = ctx;
  const approvedToyDefault = classification?.source === 'product-detail'
    && classification?.mappingPolicy?.id === 'unclassified-physical-goods-suggestion-v1'
    && classification?.mappingPolicy?.fallbackKind === 'other_toy'
    && product?.productUrl === evidence?.sourceUrl && /^[a-f0-9]{64}$/.test(evidence?.descriptionSha256 ?? '')
    && /RANDOM.*(?:CAPSULE|GOODS)|ランダム(?:カプセル|グッズ)|分身/i.test(names)
    && !/medical|powerbank|food|perfume|phone_tab|drinkware|clothing|sticker/i.test(kind)
    && !/반창고|의료|의약|식품|배터리|향수|絆創膏|医薬|食品|バッテリー|香水|MEDICAL|BATTERY|PERFUME/i.test(details);
  if (/unknown|mixed|lottery/i.test(kind) && !approvedToyDefault && kind !== 'mixed_photo_prize') return null;
  if (kind === 'mixed_photo_prize') return proposal('491191', '사진 세트·혼합 경품 확인', '본품인 인쇄 사진 세트를 기준으로 제안합니다. 당첨 아크릴 경품은 실제 수령 후 별도 품목인지 확인해 주세요.', 'photo-prize-main-photo-491191-v1', source('사진'));
  if (kind === 'doll_clothes') return proposal('950300', '인형용 의상·부속품', '사람이 입는 의류가 아닌 인형용 의상·부속품의 제안입니다. 실제 용도와 구성을 확인해 주세요.', 'doll-clothing-accessory-950300-v1', wco('2095'));
  if (['book', 'photo_book', 'photo_book_set', 'zine', 'printed_book'].includes(kind)
    && /ACRYLIC\s*STAND|アクリルスタンド|アクスタ|STICKER|シール|ステッカー|TOWEL\s*HOLDER|タオルホルダー/i.test(names)
    && !/BONUS|INCLUDES|特典|付属/i.test(names)) return null;
  // Enriched source is identity guarded. Conflicting original and fresh material
  // stay together; a fresh source never erases inconvenient older evidence.
  const enriched = publicProof ? {...classification, source: 'product-detail', evidence: {
    ...(evidence ?? {}), ...publicProof, material,
    facts: [...list(evidence?.facts), ...list(publicProof.facts)],
  }} : classification;
  const existing = currentSuggestion({...input, classification: enriched});
  if (existing) return existing;
  if (kind === 'metal_badge') return currentSuggestion({...input, classification: {...enriched, kind: 'badge'}});
  if (['sticker','paper_sticker','paper_stickers','sticker_material_unknown','sticker_material_unconfirmed'].includes(kind)) {
    const film = /\b(?:PVC|PET|VINYL|POLYPROPYLENE|POLYETHYLENE|PP)\b|塩化ビニル|塩ビ|ビニール|ポリプロピレン|ポリエチレン|비닐/i.test(material);
    if (!hasProof || !film || /PAPER|紙|종이/i.test(material)
      || /ACRYLIC|WOOD|METAL|アクリル|木|金属|아크릴|금속|レジン|PUFFY|DOME|3D|立体|ぷっくり|ワッペン|刺繍|タトゥー|TATTOO|TRANSFER|\bROLL\b|ロール|롤/i.test(names + '\n' + material)) return null;
    return proposal('391990','플라스틱 평면 스티커','확인된 PVC·PET 등 필름 스티커의 제안입니다. 평면 자가접착 제품인지와 롤·입체 장식물 여부를 확인해 주세요.','plastic-flat-sticker-391990-v1',wco('0739'));
  }
  if (kind === 'clear_file') {
    if (!/CLEAR\s*FILES?|クリアファイル|클리어.?파일/i.test(names)
      || /PAPER|LEATHER|WOOD|METAL|紙製|革|木製|金属|종이|가죽|금속/i.test(material)) return null;
    return proposal('392610','플라스틱 사무용 파일','클리어파일의 문서 보관 용도를 기준으로 추정했습니다. 실제 플라스틱 소재와 파일 형태를 확인해 주세요.','plastic-document-clearfile-392610-v1',source('클리어파일'));
  }
  if (['music_disc','music_cd','video_disc'].includes(kind)) {
    if (/DOWNLOAD|DIGITAL\s*ONLY|\bM[- ]?CARD\b|エムカード|ダウンロード|VINYL|ANALOG\s*RECORD|LPレコード|アナログ盤|CASSETTE|カセット/i.test(names)
      || /\b(?:CD|DVD|DISC)\s*(?:CASE|HOLDER|RACK|PLAYER)\b|CDケース|DVDケース/i.test(names)
      || !/\b(?:CD|DVD|BLU[- ]?RAY)\b|ブルーレイ|コンパクトディスク/i.test(names + '\n' + details)) return null;
    return proposal('852349','녹음·녹화된 광디스크','실물 음악·영상 CD·DVD·Blu-ray의 제안입니다. 다운로드 카드·빈 디스크·아날로그 레코드와 구분해 주세요.','recorded-optical-disc-852349-v1',source('음반'));
  }
  if (['clothing','tshirt','long_sleeve_tshirt','sweatshirt','hoodie'].includes(kind)) {
    const family = hasProof && textileFamily(material);
    if (!family || /DOLL|PLUSH|ぬい|ドール|人形|インナー|UNDERWEAR|ワンピース|DRESS|POLO|ポロ/i.test(names)) return null;
    if (/\bT[- ]?SHIRTS?\b|\bTEE\b|Tシャツ|ティーシャツ/i.test(names)) return proposal(family === 'cotton'?'610910':'610990',family === 'cotton'?'면 티셔츠':'기타 섬유 티셔츠','공개 소재와 티셔츠 종류에 따른 제안입니다. 실제 편물 조직·혼용률과 의류 형태를 확인해 주세요.',`material-tshirt-${family}-v1`,family === 'cotton'?source('티셔츠'):japanClothing);
    if (/SWEATSHIRT|\bHOOD(?:IE|Y)\b|スウェット|パーカー|トレーナー/i.test(names)
      && !/WINDBREAKER|ウィンド|ナイロンジャケット|COAT|コート|RAIN|レイン/i.test(names)) return proposal(family === 'cotton'?'611020':'611030',family === 'cotton'?'면 스웨트·후디':'인조섬유 스웨트·후디','공개 소재와 스웨트·후디 종류에 따른 제안입니다. 실제 편물 여부와 몸판 혼용률을 확인해 주세요.',`material-sweatshirt-${family}-v1`,family === 'cotton'?source('스웻셔츠'):japanClothing);
    return null;
  }
  if (kind === 'towel' && hasProof) {
    const family = textileFamily(material);
    if (family === 'cotton' && /TERRY|PILE|パイル|테리|파일\s*조직/i.test(details)) return proposal('630260','면 테리 수건','면 소재와 파일 조직이 명시된 수건의 제안입니다. 실제 직조와 혼용률을 확인해 주세요.','cotton-terry-towel-630260-v1',source('수건'));
    if (family === 'cotton' && /GAUZE|ガーゼ|NON[- ]?TERRY|거즈|비테리/i.test(details)) return proposal('630291','기타 면 수건','면 거즈·비테리 수건에 대한 제안입니다. 파일 수건과 구분해 주세요.','cotton-nonterry-towel-630291-v1',wco('1163'));
    if (family === 'manmade') return proposal('630293','인조섬유 수건','공개 인조섬유 소재와 수건 용도를 기준으로 제안합니다. 실제 혼용률을 확인해 주세요.','manmade-towel-630293-v1',wco('1163'));
    return null;
  }
  if (kind === 'hat' && hasProof && textileFamily(material)) {
    if (/SAFETY|HELMET|STRAW|RUBBER|PLASTIC|LEATHER|ヘルメット|麦わら|革|가죽|플라스틱/i.test(names + '\n' + material)) return null;
    return proposal('650500','섬유제 모자','공개 소재가 섬유인 모자의 제안입니다. 편물·직물로 만든 모자인지 확인해 주세요.','textile-headwear-650500-v1',source('모자'));
  }
  if (kind === 'socks' && hasProof && !/COMPRESSION|STOCKING|PANTYHOSE|着圧|ストッキング|압박/i.test(names)) {
    const family = textileFamily(material);
    if (!family || (family === 'manmade' && /RAYON|レーヨン|레이온/i.test(material))) return null;
    return proposal(family === 'cotton'?'611595':'611596',family === 'cotton'?'면 양말':'합성섬유 양말','공개 혼용률과 일반 양말 형태의 제안입니다. 압박·스타킹 등 특수 양말과 구분해 주세요.',`material-socks-${family}-v1`,source('양말'));
  }
  if (['backpack','pouch','drawstring_pouch'].includes(kind) && hasProof) {
    const fabric = /COTTON|POLYESTER|NYLON|CANVAS|\bPVC\b|\bPU\b|ポリエステル|ナイロン|綿|帆布|コットン|塩化ビニル|면|폴리에스테르|나일론/i.test(material);
    if (!fabric || /LEATHER|SILICONE|METAL|WOOD|革|シリコン|金属|木製|가죽|실리콘|금속/i.test(material)
      || /COIN|WALLET|CARD\s*(?:CASE|HOLDER)|コイン|財布|カードケース|지갑/i.test(names)) return null;
    return proposal('420292','섬유·플라스틱 표면 수납용 가방','공개 소재와 파우치·배낭의 수납 용도를 기준으로 제안합니다. 바깥 표면 소재와 지갑·핸드백 여부를 확인해 주세요.','textile-plastic-container-420292-v1',source('파우치'));
  }
  if (kind === 'plastic_cup' && /プラカップ|PLASTIC\s*CUP/i.test(names)
    && !/GLASS|CERAMIC|PORCELAIN|METAL|ガラス|陶器|磁器|金属/i.test(material)) {
    return proposal('392410', '플라스틱 식탁용 컵', '상품명에 플라스틱 컵이 명시된 제품의 제안입니다. 실제 소재와 용도를 확인해 주세요.', 'named-plastic-cup-392410-v1', wco('0739'));
  }
  if (['perfume', 'eau_de_toilette_45ml'].includes(kind) && /PERFUME|EAU\s*DE\s*TOILETTE|オードトワレ|香水|FRAGRANCE\s*MIST/i.test(names)) {
    return proposal('330300', '향수·오드트왈렛', '상품명과 향수 종류에 따른 제안입니다. 실제 성분과 배대지의 국가별 발송 제한을 확인해 주세요.', 'perfume-eau-de-toilette-330300-v1', wco('0633'));
  }
  if (kind === 'ballpoint_pen' && /BALL\s*POINT|ボールペン|볼펜/i.test(names)) {
    return proposal('960810', '볼펜', '실물 볼펜으로 확인한 제품의 제안입니다. 잉크 리필·다른 필기구 세트와 구분해 주세요.', 'ballpoint-pen-960810-v1', wco('2096'));
  }
  if (kind === 'hanafuda_cards' && /HANAFUDA|花札|화투/i.test(names)) {
    return proposal('950440', '게임용 카드', '실제 놀이용 화투 카드의 제안입니다. 사진·인물 수집카드와 구분해 주세요.', 'hanafuda-playing-cards-950440-v1', wco('2095'));
  }
  if (kind === 'tabletop_game' && /GAME|ゲーム|게임/i.test(names)) {
    return proposal('950490', '테이블 게임', '테이블에서 사용하는 실물 게임 종류에 따른 제안입니다. 전자게임·일반 굿즈와 구분해 주세요.', 'tabletop-game-950490-v1', wco('2095'));
  }
  if (/mug|cup|tumbler|drinkware/.test(kind) && hasProof) {
    if (/VACUUM|真空|진공/i.test(names + '\n' + details)) return proposal('961700','진공 보온 용기','진공 구조가 명시된 음료 용기의 제안입니다. 단순 이중벽 제품과 구분해 주세요.','verified-vacuum-vessel-961700-v1',wco('2096'));
    if (/PORCELAIN|\bCHINA\b|磁器|자기/i.test(material) && !/陶磁器/.test(material)) return proposal('691110','자기제 식탁용 컵','자기 소재가 명시된 식탁용 컵의 제안입니다. 도기와 구분해 주세요.','porcelain-table-cup-691110-v1',wco('1369'));
    if (/EARTHENWARE|STONEWARE|陶器|도기/i.test(material) && !/陶磁器/.test(material)) return proposal('691200','도기제 식탁용 컵','도기 소재가 명시된 식탁용 컵의 제안입니다. 자기 여부를 확인해 주세요.','pottery-table-cup-691200-v1',source('머그컵'));
    if (/STAINLESS|ステンレス|스테인리스/i.test(material)) return proposal('732393','스테인리스 식탁용 컵','스테인리스 음료 컵의 제안입니다. 진공 보온 구조는 별도로 확인해 주세요.','stainless-table-cup-732393-v1',wco('1573'));
    if (/POLYPROPYLENE|POLYCARBONATE|\b(?:PP|AS|ABS|PET)\b|ポリプロピレン|ポリカーボネート|플라스틱/i.test(material)) return proposal('392410','플라스틱 식탁용 컵','플라스틱 소재 식탁용 컵의 제안입니다. 포장용 병·진공 용기와 구분해 주세요.','plastic-table-cup-392410-v1',wco('0739'));
    return null;
  }
  if (approvedToyDefault) return proposal('950300', '일반 랜덤 굿즈·기타완구 추정', '요청한 기본값에 따라 일반 랜덤 굿즈를 기타완구로 넓게 추정했습니다. 실제 수령품의 구성·용도에 맞는지 확인해 주세요.', 'user-requested-other-toy-default-v1', source('완구'));
  return null;
}
