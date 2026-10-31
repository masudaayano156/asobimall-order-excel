/** DOM-only order grouping. Amounts are supplied by the app, not recalculated here. */
function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function count(value, suffix = '') {
  return Number.isSafeInteger(value) && value >= 0 ? `${value.toLocaleString('ko-KR')}${suffix}` : '확인 필요';
}

function money(value) {
  return Number.isFinite(value)
    ? `¥${value.toLocaleString('ja-JP', {maximumFractionDigits: 2})}`
    : '확인 필요';
}

function metric(label, value, className = '') {
  const item = node('div', undefined, `order-section-metric${className ? ` ${className}` : ''}`);
  item.append(node('dt', label), node('dd', value));
  return item;
}

export function createOrderSection({order = {}, index = 0} = {}) {
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Order section index must be a nonnegative integer.');
  const element = node('section', undefined, 'order-section');
  element.dataset.orderIndex = String(index);
  const headingId = `order-heading-${index}`;
  element.setAttribute('aria-labelledby', headingId);

  const header = node('header', undefined, 'order-section-header');
  const titleGroup = node('div', undefined, 'order-section-title-group');
  const heading = node('h3', String(order.orderNo ?? '').trim() || '주문번호 확인 필요', 'order-section-number');
  heading.id = headingId;
  titleGroup.append(node('span', `주문 ${String(index + 1).padStart(2, '0')}`, 'order-section-label'), heading);
  header.append(titleGroup);
  // The parser exposes its source date as order.date, already a display string.
  const date = String(order.date ?? '').trim();
  if (date) header.append(node('p', `주문일 ${date}`, 'order-section-date'));

  const summaryContainer = node('div', undefined, 'order-section-summary');
  summaryContainer.id = `order-summary-${index}`;
  const shippingContainer = node('div', undefined, 'order-section-shipping');
  shippingContainer.id = `order-shipping-${index}`;
  const itemsContainer = node('div', undefined, 'order-section-items');
  itemsContainer.id = `order-items-${index}`;
  const toggle = node('button', undefined, 'button button-quiet order-section-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', itemsContainer.id);
  order.collapsed = order.collapsed === true;
  function applyCollapsedState() {
    itemsContainer.hidden = order.collapsed;
    toggle.setAttribute('aria-expanded', String(!order.collapsed));
    toggle.textContent = order.collapsed ? '상품 펼치기' : '상품 접기';
  }
  toggle.addEventListener('click', () => {
    order.collapsed = !order.collapsed;
    applyCollapsedState();
  });
  applyCollapsedState();
  header.append(toggle);
  element.append(header, summaryContainer, shippingContainer, itemsContainer);
  return {element, itemsContainer, shippingContainer, summaryContainer};
}

export function updateOrderSectionSummary(container, {
  products, connected, subtotal, postage, total, totalLabel = '주문 합계', shippingProducts, shippingSubtotal,
} = {}) {
  const main = node('dl', undefined, 'order-section-summary-main');
  const linked = Number.isSafeInteger(connected) && connected >= 0 && Number.isSafeInteger(products) && products >= 0
    ? `${connected.toLocaleString('ko-KR')}/${products.toLocaleString('ko-KR')}` : '확인 필요';
  main.append(
    metric('상품', count(products, '종')),
    metric('상품 연결', linked),
    metric('상품 합계', money(subtotal)),
    metric('현지 배송비', money(postage)),
    metric(totalLabel, money(total), 'is-order-total'),
  );
  container.replaceChildren(main);

  // Explicit zero means no shipping products or amount; it is never replaced
  // by the unfiltered order total. Missing optional properties remain omitted.
  if (shippingProducts !== undefined || shippingSubtotal !== undefined) {
    const shipping = node('dl', undefined, 'order-section-summary-extra');
    if (shippingProducts !== undefined) shipping.append(metric('배송 신청 상품', count(shippingProducts, '개')));
    if (shippingSubtotal !== undefined) shipping.append(metric('배송 신청 금액', money(shippingSubtotal)));
    container.append(shipping);
  }
}
