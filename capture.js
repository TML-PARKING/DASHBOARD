// Injecte dans les sites autorises (monde de la page).
// Observe les reponses JSON que le site charge deja pour toi (fetch / XHR).
// Ne lit JAMAIS les en-tetes de requete (pas de jeton, pas de cookie) : seulement le contenu des reponses.
(function () {
  if (window.__dashOpsCapture) return;
  window.__dashOpsCapture = true;
  var MAX = 3000000; // 3 Mo max par reponse

  function send(url, method, status, text) {
    if (!text || text.length > MAX) return;
    var c = text.charAt(0);
    if (c !== "{" && c !== "[") return;
    try { JSON.parse(text); } catch (e) { return; }
    window.postMessage({ __dashOpsCap: true, url: String(url), method: method || "GET", status: status, body: text }, location.origin);
  }

  var origFetch = window.fetch;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var method = (init && init.method) || (input && input.method) || "GET";
    return origFetch.apply(this, arguments).then(function (res) {
      try {
        var ct = res.headers.get("content-type") || "";
        if (res.ok && ct.indexOf("json") >= 0) res.clone().text().then(function (t) { send(res.url || url, method, res.status, t); }).catch(function () {});
      } catch (e) {}
      return res;
    });
  };

  var open = XMLHttpRequest.prototype.open, sendX = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) { this.__dash = { method: method, url: url }; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    xhr.addEventListener("load", function () {
      try {
        if (xhr.status < 200 || xhr.status >= 300) return;
        var ct = xhr.getResponseHeader("content-type") || "";
        if (ct.indexOf("json") < 0) return;
        var t = xhr.responseType === "" || xhr.responseType === "text" ? xhr.responseText
              : xhr.responseType === "json" ? JSON.stringify(xhr.response) : null;
        send(xhr.responseURL || (xhr.__dash && xhr.__dash.url), xhr.__dash && xhr.__dash.method, xhr.status, t);
      } catch (e) {}
    });
    return sendX.apply(this, arguments);
  };
})();
