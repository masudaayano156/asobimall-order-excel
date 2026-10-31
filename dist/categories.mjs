/** Product-kind suggestions tied to each forwarder's own documented code list. */
import {PRODUCT_DETAIL_CLASSIFICATIONS} from './product-classifications.mjs?v=2';

const JIMPASS = 'https://www.jimpass.com/tool/agencyCategory.php?category=';
const GENERAL_FILE = 'General_Excel_Upload.xlsx';
const GENERAL_SHEET = '카테고리 품목 코드';

const j = (code, label, parent) => ({code, label, source: `${JIMPASS}${parent}`});
const g = (code, label, row) => ({code, label, source: {file: GENERAL_FILE, sheet: GENERAL_SHEET, range: `A${row}:C${row}`}});
const rule = (kind, label, patterns, jimpass, general, reviewReason = '', exclude = []) => ({kind, label, patterns, exclude, jimpass, general, requiresReview: Boolean(reviewReason), reviewReason});

export const CATEGORY_RULES = {
  version: 4,
  verifiedAt: '2026-10-30',
  description: '상품명의 물품 종류로 제안하는 운영용 분류입니다. 배대지의 최종 승인 또는 통관 판정을 의미하지 않습니다.',
  sourceNotes: {
    jimpass: {
      discovery: 'https://www.jimpass.com/agency/expect/popup/1',
      script: 'https://www.jimpass.com/app/views/agency/js/default.js?v=2.312',
      method: '공개 예상비용 계산기가 호출하는 정상 AJAX 품목목록. category 부모값으로 하위 no/title을 확인했습니다.',
      endpoint: JIMPASS,
    },
    general: {file: GENERAL_FILE, sheet: GENERAL_SHEET, range: 'A2:D293', method: '사용자가 제공한 실제 업로드 양식의 입력 코드와 품목명'},
  },
  productOverrides: [
    {
      identity: {code: 'CS-0280', id: 202639, name: '増田彩乃生誕祭2026 あやのだけ ChooseMe セット', productUrl: 'https://asobisystem.shop/products/CS-0280'},
      kind: 'paper_goods_set',
      label: '종이 굿즈 세트',
      reason: '상품 상세에서 종이 소재와 구성품을 확인한 세트입니다.',
      jimpass: j('239', '종이인쇄물', 100),
      general: g('105', '[목록통관] 기타 문구/생활용품', 107),
      requiresReview: true,
      reviewReason: '여러 종이 구성품을 포함한 세트에 맞춘 제안입니다. 최종 품목은 배대지 안내를 확인해 주세요.',
      evidence: {
        sourceUrl: 'https://asobisystem.shop/products/CS-0280',
        checkedAt: '2026-10-30',
        material: '종이',
        components: [
          {name: '스탠드 봉투', quantity: null},
          {name: '트레이딩 카드', quantity: 2},
          {name: '스티커', quantity: 2},
          {name: '엽서', quantity: 3},
        ],
      },
    },
    ...PRODUCT_DETAIL_CLASSIFICATIONS,
  ],
  rules: [
    rule('digital', '디지털 상품·행사 참가권', ['デジタル(?:写真集|フォト|コンテンツ)', '\\bDIGITAL\\s*(?:PHOTO\\s*BOOK|DOWNLOAD)\\b', '参加権'], null, null, '배송할 실물 상품이 있는지 확인해 주세요. 디지털 상품이나 참가권에는 임의의 실물 품목코드를 넣지 않습니다.', ['CD|DVD|BLU.?RAY|ALBUM']),
    rule('card_holder', '카드·사진 홀더', ['(?:PHOTO|TRADING)?\\s*CARD\\s*(?:HOLDER|CASE|FILE)', '(?:トレカ|フォトカード|生写真|チェキ|カード)(?:ホルダー|ケース|ファイル)', 'カードケース'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('105', '[목록통관] 기타 문구/생활용품', 107), '카드 자체가 아닌 홀더입니다. 소재·구조에 맞는 문구 또는 잡화 분류를 확인해 주세요.'),
    rule('phone_case', '휴대전화 케이스·그립', ['(?:PHONE|SMARTPHONE|IPHONE)\\s*(?:CASE|RING|GRIP)', 'スマホ(?:ケース|リング|グリップ)', 'スマートフォンケース'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('105', '[목록통관] 기타 문구/생활용품', 107), '소재와 용도에 따른 잡화 분류를 확인해 주세요.'),
    rule('pouch', '파우치·수납 케이스', ['(?:PEN\\s*LIGHT|FAN\\s*LIGHT|ACRYLIC\\s*STAND)\\s*(?:CASE|POUCH)', '\\bPOUCH\\b', 'ポーチ', '(?:ペンライト|アクリルスタンド|アクスタ)(?:ケース|ポーチ)'], j('6', '가방 및 지갑', 3), g('059', '[목록통관] 가방', 61), '가죽 파우치는 짐패스 7번 등 별도 항목입니다. 소재와 수납용도 확인이 필요합니다.'),
    rule('book_cover', '책 커버·케이스', ['BOOKS?\\s*(?:COVER|CASE)', '(?:ブック|本|推し)カバー'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('105', '[목록통관] 기타 문구/생활용품', 107), '책 자체가 아닌 커버입니다. 소재에 맞는 잡화 분류를 확인해 주세요.'),
    rule('storage_case', '수납 케이스·주머니', ['マルチケース|クリアケース|缶ケース|コインケース|キーケース|巾着|\\bKINCHAKU\\b|筆箱', 'AIRPODS\\s*(?:PRO)?ケース'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('105', '[목록통관] 기타 문구/생활용품', 107), '가방·지갑·문구 케이스 중 실제 용도와 소재에 맞는 항목을 확인해 주세요.'),
    rule('video_disc', '공연 영상·DVD·블루레이', ['BLU\\s*[- ]?RAY|\\bDVD\\b|LIVE\\s*FILM'], j('103', '영화 음악 CD DVD', 100), g('146', '[목록통관] DVD Title/Video Tape', 148), '실제 영상 매체와 음악 CD가 혼합된 세트인지 확인해 주세요.', ['CASE|HOLDER|ケース|ホルダー']),
    rule('music_disc', '음악 CD·앨범', ['\\bCD\\b|シングルCD|音楽CD|\\bALBUM\\b|アルバム'], j('103', '영화 음악 CD DVD', 100), g('143', '[목록통관] 음반(CD, LP, LD)', 145), '음악 CD 등 실물 음반 기준입니다. 디지털판·영상판·혼합 세트 여부를 확인해 주세요.', ['CASE|HOLDER|ケース|ホルダー']),
    rule('postcard', '엽서', ['\\bPOST\\s*CARDS?\\b|ポストカード|ハガキ|年賀状'], j('239', '종이인쇄물', 100), g('140', '[목록통관] 엽서', 142), '', ['HOLDER|CASE|ホルダー|ケース']),
    rule('book', '책·사진집·잡지', ['\\b(?:BOOK|ZINE|MAGAZINE)S?\\b|フォトブック|写真集|雑誌'], j('102', '서책 및 잡지류', 100), g('139', '[목록통관] 책/잡지류', 141), '', ['COVER|CASE|カバー|ケース|デジタル']),
    rule('keychain', '키링·키홀더', ['\\bKEY\\s*[- ]?\\s*(?:CHAIN|RING|HOLDER)\\b', 'キーホルダー|キーリング|キーチェーン|アクキー'], j('240', '키링', 204), g('076', '[목록통관] 기타 악세서리', 78), '짐패스에는 키링 전용 코드가 있습니다. General 양식은 키링 전용 항목이 없어 악세서리 후보를 확인해 주세요.'),
    rule('charm', '참·장식 스트랩', ['\\bCHARM\\b', 'チャーム', 'めじるし', '\\b(?:PHONE|BEAD|DECORATIVE)\\s*STRAP\\b', 'ビーズストラップ'], j('258', '기타 악세사리', 3), g('076', '[목록통관] 기타 악세서리', 78), '장식용 참의 연결 방식·소재를 확인해 주세요. 열쇠고리이면 짐패스 키링 240번이 더 적합할 수 있습니다.'),
    rule('acrylic_stand', '아크릴 스탠드·패널', ['ACRYLIC\\s*(?:STAND|PANEL|BLOCK)', 'アクリルスタンド|アクスタ|アクリルパネル|アクリルブロック|アクリルシャドーボックス'], j('135', '장식품', 132), g('151', '[목록통관] 장식품', 153)),
    rule('badge', '배지·핀버튼', ['\\b(?:BADGE|PIN\\s*BADGE|BUTTON\\s*BADGE)\\b', '缶バッジ|缶バッチ|ピンバッジ|ピンズ'], j('258', '기타 악세사리', 3), g('076', '[목록통관] 기타 악세서리', 78), '금속·플라스틱 등 소재와 실제 용도에 맞는 악세서리 분류를 확인해 주세요.'),
    rule('photo_card', '포토카드·트레이딩카드', ['\\b(?:PHOTO\\s*CARDS?|TRADING\\s*CARDS?|TREADING\\s*CARDS?|PHOTOCARDS?)\\b', 'トレーディングカード|フォトカード|トレカ|クリアカード|コレクトカード'], j('107', '카드류', 100), g('105', '[목록통관] 기타 문구/생활용품', 107), 'General 양식에는 포토카드 전용 항목이 없어 문구/생활용품 후보를 확인해 주세요. 투명 카드 등 종이가 아닌 소재이면 추가 확인이 필요합니다.'),
    rule('photo', '사진·체키·브로마이드', ['\\b(?:PHOTO\\s*SET|PHOTOS?|BROMIDES?)\\b', '生写真|ブロマイド|チェキ|写真L判|カットフォト'], j('239', '종이인쇄물', 100), g('105', '[목록통관] 기타 문구/생활용품', 107), '종이에 인쇄된 사진 기준 제안입니다. General의 사진 전용 항목은 없으므로 최종 품목을 확인해 주세요.', ['\\b(?:T\\s*[- ]?SHIRT|TEE|HOODIE|UNIFORM)\\b', 'Tシャツ|ユニフォーム|パーカー']),
    rule('sticker', '스티커', ['\\bSTICKERS?\\b', 'ステッカー|シール'], j('239', '종이인쇄물', 100), g('105', '[목록통관] 기타 문구/생활용품', 107), '종이 스티커 기준 제안입니다. 비닐·금속·전사지이면 분류를 다시 확인해 주세요.'),
    rule('hair_accessory', '헤어 액세서리', ['\\b(?:HAIR\\s*(?:CLIP|PIN|BAND|TIE)|SCRUNCHIE)S?\\b', 'ヘアクリップ|ヘアピン|ヘアゴム|ヘアバンド|シュシュ|カチューシャ|前髪クリップ|髪バンド'], j('25', '헤어 액세서리', 3), g('076', '[목록통관] 기타 악세서리', 78)),
    rule('plush', '봉제인형', ['\\b(?:PLUSH(?:IE)?|STUFFED\\s*(?:TOY|ANIMAL)|DOLL|MASCOT)S?\\b', 'ぬいぐるみ|ぬい|マスコット'], j('174', '인형', 170), g('124', '[목록통관] 인형', 126), '', ['(?:DOLL|PLUSH)\\s*(?:CLOTHES|OUTFIT|COSTUME)', 'ぬい服|ぬいぐるみ服']),
    rule('fanlight_parts', '응원봉 교체·장식 부품', ['(?:PEN\\s*LIGHT|FAN\\s*LIGHT|LIGHT\\s*STICK).*\\bPARTS?\\b', 'ペンライト.*(?:パーツ|部品)'], null, null, '응원봉 본체가 아닌 부품입니다. 장식용 교체 부품인지 전기 부품인지 확인한 뒤 실제 소재와 용도에 맞는 품목코드를 선택해 주세요.'),
    rule('fanlight', '응원봉·펜라이트', ['\\b(?:PEN\\s*LIGHT|FAN\\s*LIGHT|LIGHT\\s*STICK|GLOW\\s*STICK)S?\\b', 'ペンライト|サイリウム'], j('217', '휴대용전등(랜턴등)', 194), g('012', '[목록통관] 휴대용손전등 (제한없음)', 14), '실제 발광기기인지, 무선기능·배터리 포함 여부를 확인해 주세요. 케이스·장식 부품에는 이 코드를 쓰지 않습니다.', ['CHARM|CASE|POUCH|RIBBON|STRAP|PARTS?|チャーム|ケース|ポーチ|リボン|ストラップ|パーツ|部品']),
    rule('uchiwa', '응원 부채', ['\\bUCHIWA\\b', 'うちわ|団扇|扇子', '\\bHAND\\s*FAN\\b'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('105', '[목록통관] 기타 문구/생활용품', 107), '종이·플라스틱 등 재질과 전동식이 아닌 부채인지 확인해 주세요.'),
    rule('towel', '타월·수건', ['\\bTOWELS?\\b', 'タオル'], j('22', '타월', 3), g('069', '[목록통관] 타월/원단', 71)),
    rule('handkerchief', '손수건', ['\\bHANDKERCHIEFS?\\b', 'ハンカチ'], j('12', '손수건/양말류', 3), g('068', '[목록통관] 손수건', 70)),
    rule('socks', '양말', ['\\bSOCKS?\\b', 'ソックス|靴下'], j('12', '손수건/양말류', 3), g('063', '[목록통관] 양말', 65)),
    rule('backpack', '배낭', ['\\b(?:BACK\\s*PACK|RUCKSACK)S?\\b', 'リュック|バックパック|ナップサック'], j('23', '배낭', 3), g('060', '[목록통관] 배낭', 62), '가죽 배낭이면 짐패스 24번입니다. 소재를 확인해 주세요.'),
    rule('bag', '가방', ['\\b(?:TOTE(?:\\s*BAG)?|ECO\\s*BAG|SHOULDER\\s*BAG|BAGS?)\\b', 'トートバッグ|トートバック|トート|エコバッグ|ショルダーバッグ|バッグ|かばん|サコッシュ|さこっしゅ'], j('6', '가방 및 지갑', 3), g('059', '[목록통관] 가방', 61), '가죽제품이면 짐패스 7번입니다. 소재를 확인해 주세요.'),
    rule('hat', '모자', ['\\b(?:HAT|CAP|BEANIE)S?\\b', 'キャップ|ハット|帽子|ニット帽'], j('15', '모자', 3), g('062', '[목록통관] 모자(밀짚모자 제외)', 64), 'General 코드 062는 밀짚모자를 제외합니다. 소재를 확인해 주세요.'),
    rule('clothing', '의류', ['\\b(?:UNIFORM|T\\s*[- ]?\\s*SHIRT|TSHIRT|TEE|HOODIE|SWEAT(?:\\s*SHIRT|\\s*PANTS)?|PANTS|JACKET|PARKA|SHIRT|JERSEY|TRACK\\s*SUIT|VEST|DRESS)S?\\b', 'ユニフォーム|Tシャツ|ティーシャツ|パーカー|トレーナー|スウェット|パンツ|ジャケット|シャツ|ジャージ|ロンT|ビブス|びぶす|パジャマ|ぱじゃま|運動着|短パン|法被|フーディー|スタジャン'], j('4', '모든의류', 3), g('053', '[목록통관] 일반 의류', 55), '', ['KEY\\s*[- ]?(?:CHAIN|RING|HOLDER)|CHARM|ACRYLIC|BADGE|PHOTO\\s*CARD|CASE|PLUSH|キーホルダー|キーリング|チャーム|アクリル|缶バッジ|トレカ|ケース|ぬいぐるみ|ぬい服|DOLL\\s*(?:CLOTHES|OUTFIT)']),
    rule('blanket', '담요·블랭킷', ['\\bBLANKETS?\\b', 'ブランケット|毛布'], j('166', '이불/쿠션/베게/방석', 163), g('116', '[목록통관] 이불', 118)),
    rule('cushion', '쿠션·베개', ['\\b(?:CUSHION|PILLOW)S?\\b', 'クッション|枕'], j('166', '이불/쿠션/베게/방석', 163), g('114', '[목록통관] 쿠션/베개/방석', 116), '', ['COVER|カバー']),
    rule('ballpoint_pen', '볼펜', ['\\bBALL\\s*POINT\\s*PENS?\\b', 'ボールペン'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('079', '[목록통관] 볼펜', 81)),
    rule('clear_file', '클리어파일·서류 폴더', ['\\bCLEAR\\s*(?:FILE|FOLDER)S?\\b', 'クリアファイル'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('105', '[목록통관] 기타 문구/생활용품', 107)),
    rule('stationery', '문구류', ['\\b(?:NOTE\\s*BOOK|NOTEPAD|MEMO\\s*PAD|STATIONERY|PENCIL|BOOK\\s*MARK|LETTER\\s*SET)S?\\b', 'ノート|メモ帳|付箋|ふせん|文房具|鉛筆|しおり|ブックマーク|レターセット'], j('205', '잡화(문구류/ 장식품/빗등 잡화류)', 204), g('105', '[목록통관] 기타 문구/생활용품', 107), '펜 등 전용 세부항목이 있는 물품이면 해당 항목으로 바꿔 주세요.'),
    rule('poster', '포스터·인쇄물', ['\\bPOSTERS?\\b', 'ポスター'], j('239', '종이인쇄물', 100), g('154', '[목록통관] 판화/인쇄화/석판화', 156), '종이에 인쇄된 포스터 기준입니다. 직물 포스터나 태피스트리는 별도 확인이 필요합니다.'),
    rule('accessory', '패션 액세서리', ['\\b(?:BRACELET|NECKLACE|EARRING|RING|BROOCH|RIBBON)S?\\b', 'ブレスレット|ネックレス|イヤリング|ピアス|ブローチ|リボン'], j('258', '기타 악세사리', 3), g('076', '[목록통관] 기타 악세서리', 78), '귀금속·보석 여부와 용도에 따라 별도 품목이 있으므로 재질을 확인해 주세요.'),
  ],
};

function matches(pattern, text) {
  try { return new RegExp(pattern, 'iu').test(text); } catch { return false; }
}

/** Returns a suggestion; blank codes mean that no supported mapping is known. */
export function classifyProduct(name, rules = CATEGORY_RULES) {
  const text = String(name ?? '').normalize('NFKC').replace(/[‐‑‒–—]/g, '-').toUpperCase();
  const list = Array.isArray(rules) ? rules : rules?.rules;
  if (text.trim() && Array.isArray(list)) {
    for (const entry of list) {
      if (!entry || !Array.isArray(entry.patterns)) continue;
      if (!entry.patterns.some(pattern => matches(pattern, text))) continue;
      if ((entry.exclude ?? []).some(pattern => matches(pattern, text))) continue;
      return {
        kind: entry.kind,
        label: entry.label,
        reason: `상품명에서 '${entry.label}'에 해당하는 표현을 찾았습니다.${entry.reviewReason ? ` ${entry.reviewReason}` : ' 배대지별 코드표의 해당 항목을 제안합니다.'}`,
        jimpassCode: entry.jimpass?.code ?? '',
        generalCode: entry.general?.code ?? '',
        jimpassLabel: entry.jimpass?.label ?? '',
        generalLabel: entry.general?.label ?? '',
        requiresReview: Boolean(entry.requiresReview || !entry.jimpass?.code || !entry.general?.code),
        reviewReason: entry.reviewReason ?? '',
        codeSources: {jimpass: entry.jimpass?.source ?? null, general: entry.general?.source ?? null},
      };
    }
  }
  return {kind: 'unknown', label: '분류 확인 필요', reason: '상품명만으로 물품 종류를 확인할 수 없습니다. 실제 물품을 확인하고 배대지별 품목코드를 선택해 주세요.', jimpassCode: '', generalCode: '', jimpassLabel: '', generalLabel: '', requiresReview: true, reviewReason: '일치하는 품목 규칙 없음', codeSources: {jimpass: null, general: null}};
}

/** Apply reviewed product-detail facts only to the exact catalog identity. */
export function classifyCatalogProduct(product, fallbackName = product?.name ?? '', rules = CATEGORY_RULES) {
  const normalized = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const override = (rules?.productOverrides ?? []).find(entry => {
    const identity = entry.identity;
    return product && identity
      && String(product.code ?? product.slug ?? '') === identity.code
      && String(product.id ?? '') === String(identity.id)
      && product.productUrl === identity.productUrl
      && normalized(product.name) === normalized(identity.name);
  });
  if (!override) return {...classifyProduct(fallbackName, rules), source: 'name-rule', reviewStatus: 'name_rule', nonPhysical: false};
  return {
    kind: override.kind, label: override.label,
    reason: override.reason ?? '상품 상세에서 확인한 구성품과 소재로 분류했습니다.',
    jimpassCode: override.jimpass?.code ?? '', generalCode: override.general?.code ?? '',
    jimpassLabel: override.jimpass?.label ?? '', generalLabel: override.general?.label ?? '',
    requiresReview: Boolean(override.requiresReview || !override.jimpass?.code || !override.general?.code),
    reviewReason: override.reviewReason ?? '',
    codeSources: {jimpass: override.jimpass?.source ?? null, general: override.general?.source ?? null},
    source: override.status === 'source_missing' ? 'detail-unavailable' : 'product-detail',
    reviewStatus: override.status ?? 'mapped', nonPhysical: override.status === 'non_physical',
    evidence: structuredClone(override.evidence),
  };
}
