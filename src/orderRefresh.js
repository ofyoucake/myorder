// Only lifecycle events refresh data. No polling, per-editor fetch or mutation retry.
export function subscribeOrderRefresh({ document, window, canRefresh, refresh }) {
  let active = true;
  let inFlight = false;
  let queued = false;
  const run = () => {
    if (!active || document.hidden || !canRefresh()) return;
    if (inFlight) { queued = true; return; }
    inFlight = true;
    const settled = () => {
      inFlight = false;
      if (queued) { queued = false; run(); }
    };
    try {
      Promise.resolve(refresh()).catch(() => {}).finally(settled);
    } catch { settled(); }
  };
  const onPageShow = event => { if (event.persisted) run(); };
  // Start refresh synchronously so duplicate lifecycle events share this request.
  const onVisible = () => run();
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', onVisible);
  return () => {
    active = false;
    queued = false;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('online', onVisible);
  };
}
