/** Validate optional Hoottown fixed-rate codes against the official template. */
export function getFixedShippingErrors({template, items = [], profile = {}, config} = {}) {
  if (!['general', 'hoottown-fast'].includes(template) || !Array.isArray(items) || !items.length) return [];
  const fast = template === 'hoottown-fast', service = fast ? 'THE 빠른배송' : '일반 배송';
  const entries = Array.isArray(config?.fixedShipping) ? config.fixedShipping : [];
  const groups = [], byTracking = new Map();
  let previousKey;
  for (const [index, item] of items.entries()) {
    const tracking = String(item.tracking ?? profile.tracking ?? '');
    const key = fast && tracking ? `tracking:${tracking}` : `order:${String(item.orderNo ?? '')}`;
    let group;
    if (fast) {
      group = byTracking.get(key);
      if (!group) { group = []; byTracking.set(key, group); groups.push(group); }
    } else {
      // General preserves order and starts a new application when its No changes.
      if (key !== previousKey) groups.push([]);
      group = groups[groups.length - 1]; previousKey = key;
    }
    group.push({item, index, code: String(item.fixedShippingCode ?? profile.fixedShippingCode ?? '')});
  }
  const errors = [];
  for (const [groupIndex, group] of groups.entries()) {
    const selected = group.filter(row => row.code !== '');
    if (!selected.length) continue;
    // AW10/AK10 restrict Excel fixed-rate requests, not the delivery service itself.
    if (group.length !== 1 || group[0].item.quantity !== 1) {
      errors.push(`${groupIndex + 1}번 신청서: 엑셀 고정배송비 신청은 상품 단건 및 수량 1개인 경우에만 가능합니다. 고정배송비를 해제하거나 신청서를 확인해 주세요.`);
    }
    for (const {item, index, code} of selected) {
      const entry = entries.find(row => String(row.code) === code);
      if (!entry) { errors.push(`${index + 1}번 상품: 고정배송비 코드 ${code}는 선택한 원본 양식에 없습니다.`); continue; }
      const label = `고정배송비 코드 ${code} (${entry.label})`;
      const center = String(profile.center ?? '');
      const centerMatches = entry.center === center || (entry.center === '미국전체' && /^미국/.test(center));
      if (!center || !centerMatches) errors.push(`${index + 1}번 상품: ${label}는 ${entry.center} 센터용입니다. 이용 물류센터를 확인해 주세요.`);
      if ((fast ? entry.fastService : entry.generalService) !== 'Y') errors.push(`${index + 1}번 상품: ${label}는 ${service}에서 지원되지 않습니다.`);
      if (String(item.category ?? '') !== String(entry.categoryInputCode ?? '')) {
        errors.push(`${index + 1}번 상품: ${label}의 대상 품목은 ${entry.categoryInputCode} (${entry.item})입니다. 실제 상품의 품목코드를 확인하거나 고정배송비를 해제해 주세요.`);
      }
    }
  }
  return errors;
}
