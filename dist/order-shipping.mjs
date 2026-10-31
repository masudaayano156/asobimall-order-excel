export const CARRIERS = {
  japanpost: {label: '우체국 · Japan Post', jimpass: '우체국', hoottown: '[일본]JAPAN POST(日本郵便)'},
  yamato: {label: '야마토 · Yamato', jimpass: '야마토', hoottown: '[일본]YAMATO(ヤマト運輸)'},
  sagawa: {label: '사가와 · Sagawa', jimpass: '사가와', hoottown: '[일본]SAGAWA(佐川急便)'},
  other: {label: '기타 운송사', jimpass: '그 외', hoottown: '[일본]기타 운송사(ETC)'},
};

/** Later entry deliberately omits tracking; Hoottown still needs a carrier. */
export function resolveOrderShipping(order, template) {
  const now = order?.shippingEntry === 'now';
  const carrier = now && template !== 'postmall' ? CARRIERS[order?.carrierKey] : null;
  const deferredHoot = !now && ['general', 'hoottown-fast'].includes(template);
  return {
    tracking: now ? String(order?.tracking ?? '') : '',
    carrier: carrier?.hoottown ?? (deferredHoot ? CARRIERS.other.hoottown : ''),
    localCarrier: carrier?.jimpass ?? '',
  };
}
