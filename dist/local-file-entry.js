/* Classic script: file:// cannot start the app's ES module/data loader. */
(function () {
  if (window.location.protocol === 'file:') {
    window.location.replace(new URL('./offline.html', window.location.href).href);
    return;
  }

  window.addEventListener('error', function (event) {
    if (event.target && event.target.tagName === 'SCRIPT' && event.target.type === 'module') {
      var message = document.getElementById('parse-status');
      if (!message) return;
      message.className = 'status warning';
      message.textContent = '실행 코드를 불러오지 못했습니다. ';
      var fallback = document.createElement('a');
      fallback.href = './offline.html';
      fallback.textContent = '파일 실행 버전 열기';
      message.appendChild(fallback);
    }
  }, true);
})();
