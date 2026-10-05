// Sur la page du dashboard : lui transmet les donnees (uniquement si ce dashboard a ete associe dans l'extension).
(function () {
  function push() {
    chrome.runtime.sendMessage({ type: "getDatasets" }, function (res) {
      if (chrome.runtime.lastError || !res) return;
      window.postMessage({ __dashOpsExt: true, linked: res.linked, datasets: res.linked ? res.datasets : null }, location.origin);
    });
  }
  window.addEventListener("message", function (e) {
    if (e.source !== window || !e.data) return;
    if (e.data.__dashOpsHello) { chrome.runtime.sendMessage({ type: "dashHello" }); push(); }
    if (e.data.__dashOpsRefresh) chrome.runtime.sendMessage({ type: "refreshNow" }, function () { push(); });
  });
  chrome.storage.onChanged.addListener(function (ch, area) { if (area === "local" && (ch.datasets || ch.dashboards)) push(); });
  push();
})();
