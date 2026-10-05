"use strict";
var tab = null, state = null;
var $ = function (id) { return document.getElementById(id); };
var esc = function (v) { return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
function msg(m) { return new Promise(function (ok) { chrome.runtime.sendMessage(m, ok); }); }
function ago(t) {
  if (!t) return "jamais";
  var d = new Date(t), today = new Date().toDateString() === d.toDateString();
  return (today ? "aujourd'hui " : d.toLocaleDateString("fr-BE") + " ") + d.toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" });
}

async function load() {
  tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  state = await msg({ type: "state", tab: { id: tab.id, url: tab.url } });
  render();
}

function render() {
  var s = state, web = !!s.origin;
  $("site").textContent = web ? s.origin : "Ouvre un site ou ton dashboard";

  /* --- dashboard --- */
  var prefix = web ? tab.url.split("#")[0].split("?")[0].replace(/[^\/]*$/, "") : "";
  var looksDash = s.looksDash || /Dashboard Ops/i.test(tab.title || "");
  $("dash").style.display = web && (looksDash || s.isDashboard) ? "" : "none";
  $("dash").innerHTML = "<h3>Dashboard</h3>" + (s.isDashboard
    ? '<div class="row"><span class="grow">Ce dashboard recoit les donnees.</span><button class="small" id="unlink">Dissocier</button></div>'
    : '<p class="muted">Autoriser cette page a recevoir tes donnees ?</p><button class="primary" id="link">Associer ce dashboard</button>');
  if ($("link")) $("link").onclick = async function () { await msg({ type: "linkDashboard", prefix: prefix }); chrome.tabs.reload(tab.id); load(); };
  if ($("unlink")) $("unlink").onclick = async function () {
    for (var d of s.dashboards) if (tab.url.indexOf(d) === 0) await msg({ type: "unlinkDashboard", prefix: d });
    load();
  };

  /* --- capture sur le site courant --- */
  var h = "<h3>Donnees de ce site</h3>";
  if (!web || (s.isDashboard || looksDash)) h = "";
  else if (!s.allowed) {
    h += '<p class="muted">Connecte-toi normalement au site, puis active la capture. L\'extension verra les donnees que le site affiche (jamais ton mot de passe ni tes cookies).</p><button class="primary" id="allow">Activer sur ' + esc(s.origin) + "</button>";
  } else if (!s.captures.length) {
    h += '<p class="muted">Capture active. Va sur la page qui affiche les donnees voulues (ou recharge-la) puis rouvre ce menu.</p><button id="reload">Recharger la page</button>';
  } else {
    h += '<p class="muted">Donnees detectees (les plus recentes en haut). Choisis celle qui correspond a ce que tu vois :</p>';
    s.captures.forEach(function (c, i) {
      var path = c.url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
      h += '<div class="item"><div class="row"><div class="grow"><div class="path" title="' + esc(c.url) + '">' + esc(c.method + " " + path) + "</div>" +
        '<div class="muted">' + c.count + " lignes &middot; " + esc(c.keys.slice(0, 6).join(", ")) + "</div></div>" +
        '<button class="small" data-i="' + i + '">Utiliser</button></div>' +
        '<div class="form" id="f' + i + '"><input type="text" placeholder="Nom (ex. Qargo trajets)" id="n' + i + '">' +
        '<div class="row"><span class="grow muted">Mise a jour chaque jour a</span><input type="time" id="t' + i + '" value="06:30"></div>' +
        '<div class="row" style="margin-top:6px"><span class="grow"></span><button class="primary small" data-create="' + i + '">Creer la source</button></div></div></div>';
    });
  }
  $("cap").innerHTML = h; $("cap").style.display = h ? "" : "none";
  if ($("allow")) $("allow").onclick = async function () {
    var granted = await chrome.permissions.request({ origins: [s.origin + "/*"] });
    if (!granted) return;
    await msg({ type: "allowSite", origin: s.origin });
    chrome.tabs.reload(tab.id); setTimeout(load, 2500);
  };
  if ($("reload")) $("reload").onclick = function () { chrome.tabs.reload(tab.id); setTimeout(load, 3000); };
  document.querySelectorAll("[data-i]").forEach(function (b) { b.onclick = function () { $("f" + b.dataset.i).classList.toggle("open"); $("n" + b.dataset.i).focus(); }; });
  document.querySelectorAll("[data-create]").forEach(function (b) {
    b.onclick = async function () {
      var i = b.dataset.create, name = $("n" + i).value.trim();
      if (!name) { $("n" + i).focus(); return; }
      var r = await msg({ type: "createRule", tabId: tab.id, captureId: s.captures[i].id, name: name, daily: $("t" + i).value });
      if (r.error) alert(r.error);
      load();
    };
  });

  /* --- sources configurees --- */
  var ds = {}; s.datasets.forEach(function (d) { ds[d.name] = d; });
  h = "<h3>Sources (" + s.rules.length + ")</h3>";
  if (!s.rules.length) h += '<p class="muted">Aucune pour l\'instant.</p>';
  s.rules.forEach(function (r) {
    var d = ds[r.name] || {};
    h += '<div class="item"><div class="row"><div class="grow"><b>' + esc(r.name) + '</b><div class="muted">' + (d.n || 0) + " lignes &middot; maj " + esc(ago(d.updated)) + "</div>" +
      (d.error ? '<div class="err">' + esc(d.error) + "</div>" : "") + "</div>" +
      '<input type="time" value="' + esc(r.daily || "") + '" data-daily="' + r.id + '" title="Mise a jour quotidienne">' +
      '<button class="small" data-now="' + r.id + '" title="Mettre a jour maintenant">&#8635;</button>' +
      '<button class="small" data-del="' + r.id + '" title="Supprimer">&#10005;</button></div></div>';
  });
  $("rules").innerHTML = h;
  document.querySelectorAll("[data-daily]").forEach(function (el) { el.onchange = function () { msg({ type: "setDaily", id: el.dataset.daily, daily: el.value }); }; });
  document.querySelectorAll("[data-now]").forEach(function (b) {
    b.onclick = async function () { b.disabled = true; b.textContent = "..."; await msg({ type: "refreshNow", id: b.dataset.now }); load(); };
  });
  document.querySelectorAll("[data-del]").forEach(function (b) {
    b.onclick = async function () { if (confirm("Supprimer cette source ?")) { await msg({ type: "deleteRule", id: b.dataset.del }); load(); } };
  });

  /* --- sites autorises --- */
  h = "<h3>Sites autorises</h3>" + (s.sites.length ? "" : '<p class="muted">Aucun.</p>');
  s.sites.forEach(function (o) { h += '<div class="row item"><span class="grow path">' + esc(o) + '</span><button class="small" data-rm="' + esc(o) + '">Retirer</button></div>'; });
  $("sites").innerHTML = h;
  document.querySelectorAll("[data-rm]").forEach(function (b) { b.onclick = async function () { await msg({ type: "removeSite", origin: b.dataset.rm }); load(); }; });
}
load();
