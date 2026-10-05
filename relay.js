// Monde isole : transmet les reponses capturees a l'extension.
(function () {
  if (window.__dashOpsRelay) return;
  window.__dashOpsRelay = true;
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data || !e.data.__dashOpsCap) return;
    try {
      chrome.runtime.sendMessage({ type: "captured", url: e.data.url, method: e.data.method, status: e.data.status, body: e.data.body });
    } catch (err) { /* extension rechargee : ignorer */ }
  });
})();
