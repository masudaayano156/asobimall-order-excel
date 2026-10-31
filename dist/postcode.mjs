// The optional SDK runs in a separate noopener window. Only a fresh channel
// token is passed to it; no existing order, recipient or address is transmitted.
const TOKEN = /^[a-f0-9]{32}$/;
const CHANNEL_PREFIX = 'order-excel-postcode-';

export function readPostcodeChannelMessage(data, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.token !== token) return null;
  if (data.type === 'postcode:ready' || data.type === 'postcode:error') return {type: data.type};
  if (data.type !== 'postcode:selected' || typeof data.postcode !== 'string' || !/^\d{5}$/.test(data.postcode)) return null;
  if (typeof data.address !== 'string' || !data.address.trim() || data.address.length > 250 || /[\x00-\x1f\x7f-\x9f]/.test(data.address)) return null;
  return {type: data.type, postcode: data.postcode, address: data.address.trim()};
}

export function initPostcodeSearch(onSelect) {
  const button = document.getElementById('postcode-search-btn');
  const hint = document.getElementById('postcode-search-hint');
  const status = document.getElementById('postcode-search-status');
  const openLink = document.getElementById('postcode-open-link');
  if (!button) return {close() {}};
  let channel, token = '', loadTimeout, expiryTimeout;
  const show = message => { if (status) status.textContent = message; };
  function cleanup() {
    window.clearTimeout(loadTimeout); window.clearTimeout(expiryTimeout);
    channel?.close(); channel = undefined; token = '';
    if (openLink) { openLink.hidden = true; openLink.removeAttribute('href'); }
  }
  if (!['http:', 'https:'].includes(window.location.protocol)) {
    button.disabled = true;
    if (hint) hint.textContent = '파일 실행에서는 주소를 직접 입력해 주세요.';
    return {close: cleanup};
  }
  if (typeof window.BroadcastChannel !== 'function' || typeof window.crypto?.getRandomValues !== 'function' || typeof onSelect !== 'function') {
    button.disabled = true;
    if (hint) hint.textContent = '이 브라우저에서는 주소를 직접 입력해 주세요.';
    return {close: cleanup};
  }
  button.addEventListener('click', () => {
    cleanup();
    try {
      token = Array.from(window.crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
      channel = new window.BroadcastChannel(CHANNEL_PREFIX + token);
    } catch {
      cleanup(); show('주소 검색을 사용할 수 없습니다. 주소를 직접 입력해 주세요.'); return;
    }
    channel.onmessage = event => {
      const result = readPostcodeChannelMessage(event.data, token);
      if (!result) return;
      window.clearTimeout(loadTimeout);
      if (result.type === 'postcode:ready') show('별도 검색 창에서 주소를 선택해 주세요.');
      else if (result.type === 'postcode:error') {
        cleanup(); show('주소 검색을 불러오지 못했습니다. 주소를 직접 입력하거나 다시 시도해 주세요.');
      } else {
        try {
          onSelect({postcode: result.postcode, address: result.address});
          channel.postMessage({type: 'postcode:ack', token});
          show('선택한 우편번호와 주소를 입력했습니다.');
        } catch {
          show('주소를 반영하지 못했습니다. 주소를 직접 입력해 주세요.');
        } finally { cleanup(); }
      }
    };
    const url = new URL('./postcode-search.html', location.href);
    url.hash = token;
    if (openLink) { openLink.href = url.href; openLink.hidden = false; }
    show('주소 검색 창을 여는 중입니다… 팝업 차단 안내가 있으면 허용해 주세요.');
    try {
      // noopener may return null even when successful. Readiness is confirmed
      // through the channel, never through a reference to the popup window.
      window.open(url.href, '_blank', 'noopener,noreferrer,width=520,height=640');
    } catch {
      cleanup(); show('검색 창을 열지 못했습니다. 팝업 허용을 확인하거나 주소를 직접 입력해 주세요.'); return;
    }
    loadTimeout = window.setTimeout(() => show('검색 창이 열리지 않으면 팝업 허용·인터넷 연결을 확인하거나 주소를 직접 입력해 주세요.'), 15000);
    expiryTimeout = window.setTimeout(() => { cleanup(); show('주소 검색 연결이 종료되었습니다. 다시 검색하거나 주소를 직접 입력해 주세요.'); }, 300000);
  });
  window.addEventListener('pagehide', cleanup);
  if (hint) hint.textContent = '주소 검색은 별도 창에서 열리며 검색어는 카카오에 전달됩니다.';
  button.disabled = false;
  return {close: cleanup};
}
