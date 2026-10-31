/** Accessible catalog picker. Only prebuilt WebP data URLs may become images. */
export function createProductPicker({id, options = [], value = '', placeholder = '상품을 선택해 주세요', onChange} = {}) {
  if (typeof id !== 'string' || !id) throw new TypeError('Product picker requires an id.');

  const normalized = [];
  const seen = new Set();
  const blank = options.find(item => String(item?.value ?? '') === '');
  const candidates = [{value: '', label: blank?.label || placeholder}, ...options];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const candidateValue = String(candidate.value ?? '');
    if (seen.has(candidateValue)) continue;
    seen.add(candidateValue);
    normalized.push({value: candidateValue, label: String(candidate.label ?? candidateValue), thumbnailSrc: candidate.thumbnailSrc});
  }

  const controller = new AbortController();
  const {signal} = controller;
  let selectedValue = '';
  let activeIndex = 0;
  let opened = false;
  let destroyed = false;

  const element = document.createElement('div');
  element.className = 'product-picker';
  const control = document.createElement('button');
  control.type = 'button';
  control.id = id;
  control.className = 'product-picker-control';
  control.setAttribute('role', 'combobox');
  control.setAttribute('aria-haspopup', 'listbox');
  control.setAttribute('aria-expanded', 'false');
  control.setAttribute('aria-autocomplete', 'none');
  control.setAttribute('aria-controls', `${id}-listbox`);

  const popover = document.createElement('div');
  popover.className = 'product-picker-popover';
  popover.hidden = true;
  const listbox = document.createElement('div');
  listbox.id = `${id}-listbox`;
  listbox.className = 'product-picker-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', '상품 후보');
  popover.append(listbox);
  element.append(control, popover);

  function icon(path, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add(className);
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    drawing.setAttribute('d', path);
    drawing.setAttribute('stroke', 'currentColor');
    drawing.setAttribute('stroke-width', '1.6');
    drawing.setAttribute('stroke-linecap', 'round');
    drawing.setAttribute('stroke-linejoin', 'round');
    svg.append(drawing);
    return svg;
  }

  function thumbnail(item) {
    const frame = document.createElement('span');
    frame.className = 'product-picker-thumbnail';
    frame.setAttribute('aria-hidden', 'true');
    // Remote URLs and all other data formats are intentionally rejected.
    if (typeof item.thumbnailSrc === 'string' && /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(item.thumbnailSrc)) {
      const image = document.createElement('img');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.draggable = false;
      image.src = item.thumbnailSrc;
      image.addEventListener('error', () => {
        image.remove();
        frame.classList.add('is-empty');
        frame.textContent = '이미지 없음';
      }, {once: true, signal});
      frame.append(image);
    } else {
      frame.classList.add('is-empty');
      frame.textContent = item.value ? '이미지 없음' : '직접 입력';
    }
    return frame;
  }

  function labelContent(label) {
    const wrapper = document.createElement('span');
    wrapper.className = 'product-picker-label';
    const suffix = /\s+\(([A-Z0-9][A-Z0-9_-]*)\)$/.exec(label);
    if (suffix && /[\d_-]/.test(suffix[1])) {
      const name = document.createElement('span');
      name.className = 'product-picker-name';
      name.textContent = label.slice(0, suffix.index);
      const sku = document.createElement('span');
      sku.className = 'product-picker-sku';
      sku.textContent = suffix[1];
      wrapper.append(name, sku);
    } else {
      wrapper.textContent = label;
    }
    return wrapper;
  }

  function updateControl() {
    const selected = normalized.find(item => item.value === selectedValue) ?? normalized[0];
    control.replaceChildren(thumbnail(selected), labelContent(selected.value ? selected.label : placeholder),
      icon('m7 10 5 5 5-5', 'product-picker-caret'));
    control.classList.toggle('is-placeholder', !selectedValue);
    control.setAttribute('value', selectedValue);
    for (let index = 0; index < optionElements.length; index++) {
      optionElements[index].setAttribute('aria-selected', String(normalized[index].value === selectedValue));
    }
  }

  function placePopover() {
    if (!opened) return;
    const bounds = control.getBoundingClientRect();
    const below = window.innerHeight - bounds.bottom - 12;
    const above = bounds.top - 12;
    const upward = below < 220 && above > below;
    element.classList.toggle('opens-up', upward);
    popover.style.maxHeight = `${Math.max(80, Math.min(380, upward ? above : below))}px`;
  }

  function revealActive() {
    const option = optionElements[activeIndex];
    if (!option || !opened) return;
    const itemBounds = option.getBoundingClientRect();
    const menuBounds = popover.getBoundingClientRect();
    if (itemBounds.top < menuBounds.top) popover.scrollTop -= menuBounds.top - itemBounds.top;
    else if (itemBounds.bottom > menuBounds.bottom) popover.scrollTop += itemBounds.bottom - menuBounds.bottom;
  }

  function setActive(index, reveal = true) {
    activeIndex = Math.max(0, Math.min(normalized.length - 1, index));
    optionElements.forEach((option, position) => option.classList.toggle('is-active', position === activeIndex));
    if (opened) control.setAttribute('aria-activedescendant', optionElements[activeIndex].id);
    if (reveal) revealActive();
  }

  function openList(direction = 0) {
    if (destroyed || control.disabled) return;
    opened = true;
    popover.hidden = false;
    control.setAttribute('aria-expanded', 'true');
    placePopover();
    const selectedIndex = normalized.findIndex(item => item.value === selectedValue);
    const start = !selectedValue && direction > 0 && normalized.length > 1 ? 1
      : !selectedValue && direction < 0 ? normalized.length - 1 : Math.max(0, selectedIndex);
    setActive(start);
  }

  function closeList(restoreFocus = false) {
    opened = false;
    popover.hidden = true;
    control.setAttribute('aria-expanded', 'false');
    control.removeAttribute('aria-activedescendant');
    if (restoreFocus && control.isConnected && !control.disabled) control.focus({preventScroll: true});
  }

  function setValue(nextValue) {
    if (destroyed) return;
    const requested = String(nextValue ?? '');
    selectedValue = normalized.some(item => item.value === requested) ? requested : '';
    updateControl();
    if (opened) setActive(normalized.findIndex(item => item.value === selectedValue));
  }

  function choose(index) {
    const selected = normalized[index];
    if (!selected || destroyed) return;
    setValue(selected.value);
    // The parent's callback may destroy and rebuild the entire product card.
    closeList(true);
    control.dispatchEvent(new Event('input', {bubbles: true}));
    control.dispatchEvent(new Event('change', {bubbles: true}));
    if (typeof onChange === 'function') onChange(selected.value);
  }

  const optionElements = normalized.map((item, index) => {
    const option = document.createElement('div');
    option.id = `${id}-option-${index}`;
    option.className = `product-picker-option${item.value ? '' : ' is-empty-option'}`;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', 'false');
    const check = document.createElement('span');
    check.className = 'product-picker-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    option.append(thumbnail(item), labelContent(item.label), check);
    option.addEventListener('pointermove', event => {
      if (event.pointerType !== 'touch') setActive(index, false);
    }, {signal});
    option.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button === 0) event.preventDefault();
    }, {signal});
    option.addEventListener('click', () => choose(index), {signal});
    listbox.append(option);
    return option;
  });

  // Match the useful part of a native select's value contract, including silent
  // programmatic writes used when a product URL is edited manually.
  Object.defineProperty(control, 'value', {configurable: true, get: () => selectedValue, set: setValue});
  setValue(value);
  control.addEventListener('click', () => opened ? closeList() : openList(), {signal});
  control.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!opened) openList(direction);
      else setActive(activeIndex + direction);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (!opened) openList();
      setActive(event.key === 'Home' ? 0 : normalized.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (opened) choose(activeIndex);
      else openList();
    } else if (event.key === 'Escape' && opened) {
      event.preventDefault();
      event.stopPropagation();
      closeList(true);
    } else if (event.key === 'Tab') {
      closeList();
    }
  }, {signal});
  document.addEventListener('pointerdown', event => {
    if (opened && !element.contains(event.target)) closeList();
  }, {capture: true, signal});
  document.addEventListener('focusin', event => {
    if (opened && !element.contains(event.target)) closeList();
  }, {signal});
  window.addEventListener('resize', placePopover, {passive: true, signal});
  window.addEventListener('scroll', placePopover, {passive: true, signal});

  function destroy() {
    if (destroyed) return;
    closeList();
    destroyed = true;
    controller.abort();
  }

  return {element, control, setValue, destroy};
}
