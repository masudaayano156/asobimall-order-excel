/** Keep the three workflow links in sync with click and manual reading position. */
let previousCleanup = null;

export function initNavigation() {
  previousCleanup?.();

  const entries = [...document.querySelectorAll('.step-link')].map(link => {
    const href = link.getAttribute('href');
    const section = href?.startsWith('#') ? document.getElementById(href.slice(1)) : null;
    return section ? {
      link, section,
      original: {
        active: link.classList.contains('active'),
        current: link.getAttribute('aria-current'),
        disabled: link.getAttribute('aria-disabled'),
        tabindex: link.getAttribute('tabindex'),
      },
    } : null;
  }).filter(Boolean);
  if (!entries.length) return () => {};

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let clickedTarget = null;
  let settleTimer = 0;
  let safetyTimer = 0;
  let disposed = false;

  const visible = entry => !entry.section.hidden
    && entry.section.getAttribute('aria-hidden') !== 'true'
    && entry.section.getClientRects().length > 0;

  function setActive(entry) {
    for (const candidate of entries) {
      const active = candidate === entry;
      candidate.link.classList.toggle('active', active);
      if (active) candidate.link.setAttribute('aria-current', 'step');
      else candidate.link.removeAttribute('aria-current');
    }
  }

  function refreshAvailability() {
    for (const entry of entries) {
      if (!visible(entry)) {
        entry.link.setAttribute('aria-disabled', 'true');
        entry.link.setAttribute('tabindex', '-1');
      } else {
        entry.link.removeAttribute('aria-disabled');
        if (entry.original.tabindex === null) entry.link.removeAttribute('tabindex');
        else entry.link.setAttribute('tabindex', entry.original.tabindex);
      }
    }
    if (clickedTarget && !visible(clickedTarget)) clearClickTarget();
  }

  function update() {
    frame = 0;
    if (disposed) return;
    refreshAvailability();
    const available = entries.filter(visible);
    if (!available.length) { setActive(null); return; }
    if (clickedTarget && visible(clickedTarget)) {
      setActive(clickedTarget);
      return;
    }
    const viewport = window.innerHeight || document.documentElement.clientHeight;
    const readingLine = Math.min(220, Math.max(100, viewport * 0.25));
    let current = available[0];
    for (const entry of available) {
      if (entry.section.getBoundingClientRect().top <= readingLine) current = entry;
    }
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollHeight > viewport + 2 && root.scrollTop + viewport >= root.scrollHeight - 3) {
      current = available[available.length - 1];
    }
    setActive(current);
  }

  function scheduleUpdate() {
    if (!disposed && !frame) frame = window.requestAnimationFrame(update);
  }

  function clearClickTarget() {
    clickedTarget = null;
    window.clearTimeout(settleTimer);
    window.clearTimeout(safetyTimer);
    settleTimer = 0;
    safetyTimer = 0;
  }

  function finishScroll() {
    clearClickTarget();
    scheduleUpdate();
  }

  function onScroll() {
    if (clickedTarget) {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(finishScroll, 180);
    }
    scheduleUpdate();
  }

  function onManualInput() {
    if (clickedTarget) finishScroll();
  }

  function onKeydown(event) {
    if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
    onManualInput();
  }

  const clickHandlers = entries.map(entry => {
    const handler = event => {
      if (!visible(entry)) { event.preventDefault(); return; }
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      clearClickTarget();
      clickedTarget = entry;
      setActive(entry);
      entry.section.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
      settleTimer = window.setTimeout(finishScroll, reducedMotion.matches ? 50 : 220);
      safetyTimer = window.setTimeout(finishScroll, 3000);
    };
    entry.link.addEventListener('click', handler);
    return [entry.link, handler];
  });

  const observer = new MutationObserver(() => {
    refreshAvailability();
    scheduleUpdate();
  });
  for (const entry of entries) observer.observe(entry.section, { attributes: true, attributeFilter: ['hidden', 'aria-hidden'] });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', scheduleUpdate, { passive: true });
  window.addEventListener('scrollend', finishScroll, { passive: true });
  window.addEventListener('wheel', onManualInput, { passive: true });
  window.addEventListener('touchstart', onManualInput, { passive: true });
  window.addEventListener('pointerdown', onManualInput, { passive: true });
  window.addEventListener('keydown', onKeydown);
  update();

  function cleanup() {
    if (disposed) return;
    disposed = true;
    clearClickTarget();
    if (frame) window.cancelAnimationFrame(frame);
    observer.disconnect();
    for (const [link, handler] of clickHandlers) link.removeEventListener('click', handler);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', scheduleUpdate);
    window.removeEventListener('scrollend', finishScroll);
    window.removeEventListener('wheel', onManualInput);
    window.removeEventListener('touchstart', onManualInput);
    window.removeEventListener('pointerdown', onManualInput);
    window.removeEventListener('keydown', onKeydown);
    for (const entry of entries) {
      entry.link.classList.toggle('active', entry.original.active);
      for (const [name, value] of [['aria-current', entry.original.current], ['aria-disabled', entry.original.disabled], ['tabindex', entry.original.tabindex]]) {
        if (value === null) entry.link.removeAttribute(name);
        else entry.link.setAttribute(name, value);
      }
    }
    if (previousCleanup === cleanup) previousCleanup = null;
  }
  previousCleanup = cleanup;
  return cleanup;
}
