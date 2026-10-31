const checkedAt = '2026-10-31';
const source = keyword => `https://www.postmall.net/api/hscodes?tag=true&q=${encodeURIComponent(keyword)}`;
const printedMatterSource = 'https://www.wcoomd.org/-/media/wco/public/global/pdf/topics/nomenclature/instruments-and-tools/hs-nomenclature-2022/2022/1049_2022e.pdf?la=en';
function proposal(code, label, reason, keyword, ruleId, sourceUrl = source(keyword)) {
  return {code, label, reason, requiresReview: true, sourceUrl, checkedAt, ruleId};
}

/** Offline suggestions use physical-kind/material evidence, never forwarder list IDs. */
export function suggestPostmallHs({name = '', classification, product} = {}) {
  const kind = String(classification?.kind ?? '');
  if (!kind || classification?.nonPhysical || classification?.reviewStatus === 'non_physical'
    || classification?.source === 'detail-unavailable' || /unknown|mixed|lottery|digital|download|ticket|event|travel/i.test(kind)) return null;
  const evidence = classification?.evidence;
  if (product?.productUrl && evidence?.sourceUrl && product.productUrl !== evidence.sourceUrl) return null;
  const currentNames = [product?.name, product?.enName, product?.nameEn, product?.name_en, ...(Array.isArray(product?.aliases) ? product.aliases : [])]
    .filter(value => typeof value === 'string' && value.trim());
  // An explicit current catalog selection supersedes the original order title.
  const names = (currentNames.length ? currentNames : [name]).filter(value => typeof value === 'string').join('\n').normalize('NFKC');
  const verified = classification?.source === 'product-detail' && evidence?.sourceUrl && evidence?.checkedAt && /^[a-f0-9]{64}$/.test(evidence?.descriptionSha256 ?? '');
  const array = value => Array.isArray(value) ? value : [];
  const details = verified ? [evidence.material, ...array(evidence.facts), ...array(evidence.components).map(item => item?.name),
    ...array(evidence.sourceCategories).map(item => item?.name), evidence.additionalCategory?.name].filter(value => typeof value === 'string').join('\n').normalize('NFKC') : '';
  const material = verified ? String(evidence.material ?? '').normalize('NFKC') : '';
  const unsupportedMaterial = /\b(?:PET|PVC|VINYL|PLASTIC|ACRYLIC|METAL|SILICONE|CLEAR|TRANSPARENT|RESIN|POLYESTER|POLYETHYLENE)\b|비닐|플라스틱|아크릴|투명|금속|수지|폴리에스테르|폴리에틸렌|シリコン|ビニール|アクリル|透明|クリア|樹脂|ポリエステル|ポリエチレン/i;
  const paper = /\bPAPER\b|종이|紙/i;
  const electronicPrint = /DIGITAL|DOWNLOAD|\b(?:NFT|VIRTUAL)\b|ONLINE\s*(?:CARD|PHOTO|GOODS)|\bM[- ]?CARD\b|37CARD|デジタル|ダウンロード|エムカード|オンライン|電子|다운로드|디지털/i;
  const photoObject = /HOLDER|CASE|ALBUM|BOOK|STAND|ホルダー|ケース|スタンド|写真集|フォトブック|홀더|케이스|앨범|스탠드/i;
  const gameCard = /\b(?:GAME|PLAYING|POKEMON|TAROT|SPORTS?|STATISTICS|BLANK)\b|TRUMP|ゲーム|トランプ|花札|遊戯|スポーツ|無地|게임|스포츠|통계/i;

  // This legacy reviewed record predates description hashes. Do not extend its
  // composition or photographed printed-paper estimate to other product sets.
  const chooseMeParts = array(evidence?.components);
  const reviewedChooseMe = kind === 'paper_goods_set' && classification?.source === 'product-detail'
    && product?.code === 'CS-0280' && String(product?.id) === '202639'
    && product?.name?.normalize('NFKC').replace(/\s+/g, '') === '増田彩乃生誕祭2026あやのだけChooseMeセット'
    && product?.productUrl === 'https://asobisystem.shop/products/CS-0280'
    && evidence?.sourceUrl === product.productUrl && Boolean(evidence?.checkedAt)
    && String(evidence?.material ?? '').trim() === '종이' && chooseMeParts.length === 4
    && [['스탠드 봉투', null], ['트레이딩 카드', 2], ['스티커', 2], ['엽서', 3]]
      .every(([part, quantity]) => chooseMeParts.filter(item => item?.name === part && item?.quantity === quantity).length === 1);
  if (reviewedChooseMe) {
    return proposal('491191', '사진·그림 인쇄 종이 세트 제안', '확인된 종이 구성과 상품 이미지를 기준으로 사진·그림 인쇄물 세트로 추정했습니다. 봉투·스티커·엽서 등 구성품별 HS는 확인해 주세요.', '사진', 'reviewed-chooseme-paper-picture-set-491191-v1');
  }

  if (kind === 'fanlight') {
    const accessory = /\b(?:CHARMS?|PARTS?|STRAPS?|CASES?|POUCH|COVER|GRIP|BANGLE|BRACELET|RIBBON|HOLDER)\b|チャーム|パーツ|部品|ストラップ|ケース|ポーチ|カバー|グリップ|バングル|ブレス|リボン/i;
    const chemical = /\bGLOW\s*STICKS?\b|CHEMICAL|ケミカル|サイリウム|화학|야광봉/i;
    if (accessory.test(names) || chemical.test(names)) return null;
    const knownDetails = details.split('\n').filter(line => !/미기재|미확인|불명|不明|未記載|UNKNOWN|NOT SPECIFIED/i.test(line)).join('\n');
    if (!/BATTER(?:Y|IES)|\b(?:LED|USB)\b|電池|充電|乾電池|전지|배터리/i.test(names + '\n' + knownDetails)) return null;
    return proposal('851310', '전지식 휴대용 전등', '전지식 발광 본체에 손전등 항목을 제안합니다. 응원봉의 실제 기능·전지 구성을 확인해 주세요.', '손전등', 'battery-fanlight-851310-v1');
  }
  if (kind === 'acrylic_stand') {
    if (!/\bACRYLIC\b|アクリル|アクスタ|아크릴/i.test(names + '\n' + material)) return null;
    if (/PHONE|SMARTPHONE|MONITOR|LAPTOP|TABLET|HOLDER|DOCK|CASE|POUCH|PARTS?|스마트폰|휴대폰|모니터|받침|スマホ|モニター|タブレット|ホルダー|ケース|ポーチ|パーツ|部品/i.test(names)) return null;
    if (/\b(?:STEEL|IRON|WOOD|METAL)\b|강철|금속|목재|나무|木製|木材|鋼|金属/i.test(material)) return null;
    return proposal('392640', '인물 모형 장식품', '아크릴 인물 스탠드를 플라스틱 장식품 항목으로 제안합니다. 실제 소재·장식 용도를 확인해 주세요.', '장식품', 'acrylic-ornament-392640-v1');
  }
  if (kind === 'badge') {
    const metal = /\b(?:METAL|TINPLATE|STEEL|IRON|ALUMINUM|ALUMINIUM)\b|금속|철|브리키|ブリキ|スチール|鉄|金属|アルミ/i.test(material);
    if (/\bACRYLIC\b|アクリル|아크릴/i.test(names + '\n' + material)
      || /\b(?:GOLD|SILVER|PLATINUM|STERLING|14K|18K|24K)\b|순금|순은|백금|純金|純銀/i.test(names + '\n' + material)) return null;
    if (/\bPAPER\b|종이|紙/i.test(material) && !metal) return null;
    if (!/\bCAN\s*BADGE\b|缶バッジ|캔.?배지|캔.?뱃지/i.test(names) && !metal) return null;
    return proposal('711719', '캔뱃지', '캔 형태 또는 비귀금속 몸체가 확인된 배지에 대한 제안입니다. 실제 금속·복합 소재를 확인해 주세요.', '뱃지', 'base-metal-can-badge-711719-v1');
  }
  if (['keychain', 'acrylic_keychain', 'charm', 'acrylic_charm', 'fanlight_decoration', 'acrylic_carabiner'].includes(kind)) {
    const explicitName = /\bACRYLIC\b|アクリル|아크릴/i.test(names);
    const explicitBody = /(?:本体|BODY|본체)\s*[:：]?\s*(?:アクリル|ACRYLIC|아크릴)/i.test(material);
    const materialAcrylic = /\bACRYLIC\b|アクリル|아크릴/i.test(material);
    if (/\b(?:STEEL|IRON|METAL|LEATHER|WOOD|GOLD|SILVER)\s+(?:KEYCHAIN|CHARM)\b|レザー|革製|木製|가죽/i.test(names)) return null;
    if (/LEATHER|POLYESTER|NYLON|SILICONE|가죽|폴리에스테르|나일론|실리콘|革|ポリエステル|ナイロン|シリコン/i.test(material)) return null;
    if (/(?:本体|BODY|본체)\s*[:：]?\s*(?:STEEL|IRON|METAL|WOOD|金属|鉄|鋼|木|금속|철|나무)/i.test(material)) return null;
    if (!materialAcrylic && /METAL|STEEL|IRON|금속|철|金属|鉄|鋼/i.test(material)) return null;
    if (!explicitName && !explicitBody && (!materialAcrylic || /METAL|STEEL|IRON|금속|철|金属|鉄|鋼/i.test(material))) return null;
    return proposal('392690', '기타 플라스틱 제품', '아크릴 본체의 키홀더·참에 기타 플라스틱 항목을 제안합니다. 금속 고리 등 복합 소재와 실제 용도를 확인해 주세요.', '플라스틱', 'acrylic-accessory-392690-v1');
  }
  if (['sticker', 'paper_sticker', 'paper_stickers'].includes(kind)) {
    if (unsupportedMaterial.test(names + '\n' + material) || !paper.test(names + '\n' + material)) return null;
    return proposal('482110', '종이 스티커', '종이 소재로 확인된 인쇄 스티커에 대한 제안입니다. 코팅·비닐 등 실제 소재를 확인해 주세요.', '스티커', 'paper-sticker-482110-v1');
  }
  if (['photo', 'photo_set', 'printed_photo', 'bromide', 'photo_card', 'photocard'].includes(kind)) {
    const card = ['photo_card', 'photocard'].includes(kind);
    if (unsupportedMaterial.test(names + '\n' + material)
      || photoObject.test(names) || electronicPrint.test(names) || gameCard.test(names)) return null;
    const pictureCard = /\b(?:PHOTO\s*|TRADING\s*)CARDS?\b|フォトカード|写真カード|トレーディングカード|トレカ|포토.?카드/i.test(names);
    if (card && !pictureCard) return null;
    if (card && !paper.test(names + '\n' + material)) {
      return proposal('491191', '사진이 인쇄된 기타 인쇄물', '상품명에서 실물 사진·그림 카드로 추정한 제안입니다. 종이·인쇄 여부와 게임·다운로드 카드가 아닌지 확인해 주세요.', '사진', 'picture-card-title-estimate-491191-v1');
    }
    if (!/\bPHOTO(?:GRAPH)?S?\s+SET\b|L[- ]SIZE\s+PHOTOS|生写真|ブロマイド|チェキ/i.test(names)
      && !(card && pictureCard)) return null;
    return proposal('491191', '사진이 인쇄된 기타 인쇄물', '실물 인쇄 사진 세트에 대한 제안입니다. 전자 다운로드 카드·투명 소재 사진과 구분해 확인해 주세요.', '사진', 'printed-photo-491191-v1');
  }
  if (['poster', 'art_poster', 'giclee_print', 'framed_giclee_print', 'art_print', 'printed_paper_goods'].includes(kind)) {
    if (electronicPrint.test(names) || unsupportedMaterial.test(names + '\n' + material)
      || /\b(?:FABRIC|TEXTILE|TAPESTRY|ORIGINAL\s+PAINTING|HAND\s*PAINTED)\b|布製|タペストリー|原画|肉筆|직물|원화|수작업.?그림/i.test(names + '\n' + material)) return null;
    const printedArt = /GICL[EÉ]E|ジー?クレー|지클레|인쇄|\bPRINT(?:ED)?\b/i.test(names + '\n' + details);
    const poster = /\bPOSTERS?\b|ポスター|포스터/i.test(names + '\n' + details);
    if (!printedArt && !poster) return null;
    if (kind === 'printed_paper_goods' && (!verified || !paper.test(material))) return null;
    return proposal('491191', '그림·디자인·사진 인쇄물', '포스터·인쇄화의 종류를 기준으로 그림 인쇄물 항목을 제안합니다. 실제 인쇄 방식·바탕 소재와 액자 구성을 확인해 주세요.', '사진', 'printed-art-picture-491191-v1');
  }
  if (['paper_calendar', 'daily_calendar'].includes(kind)) {
    if (electronicPrint.test(names) || unsupportedMaterial.test(material)
      || /TAPESTRY|FABRIC|TEXTILE|ACRYLIC|WOOD|タペストリー|布製|アクリル|木製|직물|아크릴|목재/i.test(names + '\n' + material)) return null;
    if (!/\bCALENDARS?\b|カレンダー|日めくり|달력|캘린더/i.test(names + '\n' + details)) return null;
    return proposal('491000', '캘린더·달력', '탁상·일력형 인쇄 달력으로 추정한 제안입니다. 전자 달력·직물·아크릴 장식품과 구분하고 실제 구성을 확인해 주세요.', '달력', 'printed-calendar-491000-v1');
  }
  if (kind === 'postcard') {
    if (electronicPrint.test(names) || unsupportedMaterial.test(names + '\n' + material)
      || /KEYCHAIN|CHARM|GUITAR\s*PICK|STICKER|HAND\s*WRITTEN|キーホルダー|チャーム|ギターピック|ステッカー|直筆|手書き/i.test(names)) return null;
    if (!/\bPOST\s*CARDS?(?=\b|\d)|ポストカード|ハガキ|はがき|엽서/i.test(names + '\n' + details)) return null;
    return proposal('490900', '인쇄·삽화 엽서', '상품명에서 인쇄·삽화 엽서로 추정한 제안입니다. 무지 서신 카드·스티커 등 다른 구성품이 포함됐는지 확인해 주세요.', '', 'illustrated-postcard-490900-v1', printedMatterSource);
  }
  if (['book', 'photo_book', 'photo_book_set', 'zine', 'printed_book'].includes(kind)) {
    if (electronicPrint.test(names) || unsupportedMaterial.test(material)
      || /HOLDER|CASE|COVER|BINDER|NOTE\s*BOOK|SKETCH\s*BOOK|COLOU?RING\s*BOOK|ホルダー|ケース|カバー|バインダー|ノート|スケッチ|ぬりえ|塗り絵|무지|노트/i.test(names)) return null;
    if (!/\b(?:BOOKS?|PHOTOBOOK|ZINE|PROGRAMME?|PAMPHLET)\b|写真集|フォトブック|ブック|冊子|図録|プログラム|책자|서적/i.test(names + '\n' + details)) return null;
    return proposal('490199', '인쇄 서적·책자', '실물 인쇄 서적·사진집으로 추정한 제안입니다. 전자 다운로드·무지 노트와 구분하고 부록·세트의 주된 구성을 확인해 주세요.', '', 'printed-book-490199-v1', printedMatterSource);
  }
  if (['doll', 'plush', 'plush_doll', 'figure', 'toy_doll'].includes(kind)) {
    if (/KEY\s*(?:CHAIN|RING|HOLDER)|CHARM|ACRYLIC\s*STAND|HOLDER|CASE|POSTER|STICKER|\b(?:DOLL|PLUSH(?:IE)?)\s*(?:CLOTHES|CLOTHING|OUTFIT|COSTUME)\b|キーホルダー|チャーム|アクスタ|アクリルスタンド|(?:ぬい(?:ぐるみ)?|ドール|人形)(?:用)?(?:服|衣装|コスチューム|お洋服)/i.test(names)) return null;
    if (!/\b(?:DOLL|PLUSH(?:IE)?|STUFFED\s+(?:TOY|ANIMAL)|(?:ACTION|VINYL|PVC|TOY)\s+FIGURE)\b|ぬいぐるみ|봉제인형|장난감.?인형|フィギュア|피규어|人形/i.test(names + '\n' + details)) return null;
    return proposal('950300', '봉제·장난감 인형', '실제 인형으로 확인된 물품에 대한 제안입니다. 장식품·인형옷·키홀더와 용도를 구분해 확인해 주세요.', '인형', 'toy-doll-950300-v1');
  }
  return null;
}
