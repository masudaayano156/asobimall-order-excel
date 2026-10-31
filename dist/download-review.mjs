export function initDownloadReview() {
  const dialog = document.getElementById('download-review-dialog');
  const confirm = document.getElementById('download-review-confirm');
  const cancel = document.getElementById('download-review-cancel');
  let pending = null;

  // Return the pending Promise directly, so duplicate callers share one modal.
  return function confirmDownloadReview() {
    if (pending) return pending;
    if (!dialog || !confirm || !cancel || typeof dialog.showModal !== 'function') return Promise.resolve(false);
    const previousFocus = document.activeElement;
    let resolve, finished = false;
    const promise = new Promise(done => { resolve = done; });
    pending = promise;
    function finish(accepted) {
      if (finished) return;
      finished = true;
      confirm.removeEventListener('click', onConfirm);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      dialog.removeEventListener('close', onClose);
      if (dialog.open) dialog.close();
      pending = null;
      resolve(accepted);
      if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({preventScroll: true});
    }
    function onConfirm(event) { event.preventDefault(); finish(true); }
    function onCancel(event) { event.preventDefault(); finish(false); }
    function onClose() {
      // A queued close from the previous request must not cancel a newly opened dialog.
      if (!dialog.open) finish(false);
    }
    confirm.addEventListener('click', onConfirm);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.addEventListener('close', onClose);
    try {
      dialog.returnValue = '';
      dialog.showModal();
      cancel.focus({preventScroll: true});
    } catch { finish(false); }
    return promise;
  };
}
