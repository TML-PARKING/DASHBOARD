// Cerveau de l'extension : sites autorises, regles de capture, donnees envoyees au dashboard.
// Stockage (chrome.storage.local) :
//   sites      : ["https://app.qargo.com", ...]           sites ou la capture est active
//   rules      : [{id, name, pattern, root, page, pageUrl, daily: "06:30"}]
//   datasets   : {nom: {rows, updated, page}}
//   dashboards : ["https://toi.github.io/dashboard-ops/"]  pages autorisees a recevoir les donnees
"use strict";

var recent = {}; // tabId -> [capture] (memoire, 20 dernieres)
var dashTabs = {}; // onglets ou un Dashboard Ops s'est annonce

/* ---------- utilitaires ---------- */
function get(keys) { return chrome.storage.local.get(keys); }
function set(obj) { return chrome.storage.local.set(obj); }
function uid() { return Math.random().toString(36).slice(2, 10); }

function patternOf(url) {
  var u = new URL(url);
  var segs = u.pathname.split("/").map(function (s) {
    if (/^\d+$/.test(s)) return "*";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "*";
    if (s.length >= 16 && /\d/.test(s) && /^[A-Za-z0-9_-]+$/.test(s)) return "*";
    return s;
  });
  return u.origin + segs.join("/");
}
function matches(pattern, url) {
  var u = new URL(url), target = u.origin + u.pathname;
  var re = new RegExp("^" + pattern.split("*").map(function (p) { return p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"); }).join("[^/]+") + "/?$");
  return re.test(target);
}
// Trouve la plus grande liste d'objets dans le JSON (souvent les donnees utiles).
function findRoot(json) {
  var best = { path: "", n: Array.isArray(json) ? json.length : 0 }, queue = [{ v: json, path: "" }], steps = 0;
  while (queue.length && steps++ < 5000) {
    var cur = queue.shift();
    if (Array.isArray(cur.v)) {
      if (cur.v.length > best.n && cur.v.some(function (x) { return x && typeof x === "object" && !Array.isArray(x); })) best = { path: cur.path, n: cur.v.length };
      if (cur.v[0] && typeof cur.v[0] === "object") queue.push({ v: cur.v[0], path: cur.path + (cur.path ? "." : "") + "0" });
    } else if (cur.v && typeof cur.v === "object") {
      Object.keys(cur.v).forEach(function (k) { queue.push({ v: cur.v[k], path: cur.path + (cur.path ? "." : "") + k }); });
    }
  }
  return best;
}
function dig(obj, path) {
  (path ? path.split(".") : []).forEach(function (p) { obj = obj == null ? obj : obj[p]; });
  return obj;
}
function flatten(obj, prefix, depth, out) {
  prefix = prefix || ""; depth = depth || 0; out = out || {};
  Object.keys(obj || {}).forEach(function (k) {
    var v = obj[k], key = prefix + k;
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) flatten(v, key + ".", depth + 1, out);
    else if (Array.isArray(v)) out[key] = v.length && typeof v[0] === "object" ? v.length : v.join(", ");
    else out[key] = v;
  });
  return out;
}
function rowsFrom(json, root) {
  var data = dig(json, root);
  if (data && !Array.isArray(data) && typeof data === "object") data = [data];
  return (data || []).filter(function (x) { return x && typeof x === "object"; }).slice(0, 5000)
    .map(function (x) { return flatten(x); });
}

/* ---------- capture sur les sites autorises ---------- */
function scriptIds(origin) { var h = btoa(origin).replace(/[^A-Za-z0-9]/g, ""); return ["cap-" + h, "rel-" + h]; }
async function registerSite(origin) {
  var ids = scriptIds(origin), existing = await chrome.scripting.getRegisteredContentScripts({ ids: ids });
  if (existing.length) return;
  await chrome.scripting.registerContentScripts([
    { id: ids[0], matches: [origin + "/*"], js: ["capture.js"], world: "MAIN", runAt: "document_start", allFrames: true },
    { id: ids[1], matches: [origin + "/*"], js: ["relay.js"], runAt: "document_start", allFrames: true }
  ]);
}
async function unregisterSite(origin) {
  try { await chrome.scripting.unregisterContentScripts({ ids: scriptIds(origin) }); } catch (e) {}
}
async function ensureRegistered() {
  var st = await get(["sites"]);
  for (var o of st.sites || []) { try { await registerSite(o); } catch (e) { console.warn(o, e); } }
}
chrome.runtime.onStartup.addListener(ensureRegistered);
chrome.runtime.onInstalled.addListener(function () { ensureRegistered(); syncAlarms(); });

async function onCaptured(msg, tab) {
  var json;
  try { json = JSON.parse(msg.body); } catch (e) { return; }
  var root = findRoot(json), page = tab && tab.url ? new URL(tab.url).origin : "";
  var list = recent[tab.id] = recent[tab.id] || [];
  list.unshift({ id: uid(), url: msg.url, pattern: patternOf(msg.url), method: msg.method, time: Date.now(), size: msg.body.length,
                 root: root.path, count: root.n, keys: Object.keys(flatten((dig(json, root.path) || [])[0] || {})).slice(0, 12), json: json, page: page, pageUrl: tab.url });
  recent[tab.id] = list.slice(0, 20);

  var st = await get(["rules", "datasets"]), rules = st.rules || [], ds = st.datasets || {}, changed = false;
  rules.forEach(function (r) {
    if (r.method && r.method !== msg.method) return;
    if (matches(r.pattern, msg.url)) { ds[r.name] = { rows: rowsFrom(json, r.root), updated: Date.now(), page: r.page }; changed = true; }
  });
  if (changed) await set({ datasets: ds });
}

/* ---------- mise a jour automatique quotidienne ----------
   Chaque regle a une heure (ex. "06:30"). A cette heure, l'extension ouvre la page du site
   dans un onglet en arriere-plan, attend que les donnees arrivent, puis referme l'onglet.
   Si le PC etait eteint a l'heure prevue : rattrapage au demarrage du navigateur. */
function nextTime(hhmm) {
  var p = (hhmm || "06:30").split(":"), d = new Date();
  d.setHours(+p[0] || 0, +p[1] || 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}
async function syncAlarms() {
  var st = await get(["rules"]);
  await chrome.alarms.clearAll();
  (st.rules || []).forEach(function (r) {
    if (r.daily) chrome.alarms.create("daily:" + r.id, { when: nextTime(r.daily), periodInMinutes: 1440 });
  });
}
var running = {};
async function refreshRule(r) {
  if (running[r.id]) return running[r.id];
  running[r.id] = (async function () {
    var started = Date.now(), tab = null;
    try {
      tab = await chrome.tabs.create({ url: r.pageUrl || r.page, active: false });
      for (var i = 0; i < 45; i++) { // jusqu'a 90 s
        await new Promise(function (ok) { setTimeout(ok, 2000); });
        var ds = (await get(["datasets"])).datasets || {};
        if (ds[r.name] && ds[r.name].updated >= started) return true;
      }
      var cur = (await get(["datasets"])).datasets || {};
      cur[r.name] = Object.assign(cur[r.name] || { rows: [] }, { error: "Pas de donnees recues : session expiree ? Ouvre le site et reconnecte-toi.", tried: Date.now() });
      await set({ datasets: cur });
      return false;
    } finally {
      if (tab) chrome.tabs.remove(tab.id).catch(function () {});
      delete running[r.id];
    }
  })();
  return running[r.id];
}
async function refreshAll(onlyStale) {
  var st = await get(["rules", "datasets"]), ds = st.datasets || {};
  for (var r of st.rules || []) {
    var last = ds[r.name] && ds[r.name].updated || 0;
    if (!onlyStale || (r.daily && Date.now() - last > 23 * 3600e3)) await refreshRule(r);
  }
}
chrome.alarms.onAlarm.addListener(async function (a) {
  var st = await get(["rules"]), r = (st.rules || []).filter(function (x) { return "daily:" + x.id === a.name; })[0];
  if (r) refreshRule(r);
});
chrome.runtime.onStartup.addListener(function () { syncAlarms(); setTimeout(function () { refreshAll(true); }, 20000); });
chrome.tabs.onRemoved.addListener(function (id) { delete recent[id]; delete dashTabs[id]; });

/* ---------- messages (popup + pages) ---------- */
chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  (async function () {
    if (msg.type === "captured") return onCaptured(msg, sender.tab);
    if (msg.type === "dashHello") { if (sender.tab) dashTabs[sender.tab.id] = true; return; }
    var st = await get(["sites", "rules", "datasets", "dashboards"]);
    var sites = st.sites || [], rules = st.rules || [], ds = st.datasets || {}, dashes = st.dashboards || [];

    if (msg.type === "state") {
      var tab = msg.tab, origin = tab.url && /^https?:/.test(tab.url) ? new URL(tab.url).origin : null;
      reply({
        origin: origin, allowed: sites.indexOf(origin) >= 0, sites: sites, dashboards: dashes,
        looksDash: !!dashTabs[tab.id],
        isDashboard: dashes.some(function (d) { return tab.url && tab.url.indexOf(d) === 0; }),
        captures: (recent[tab.id] || []).map(function (c) { var o = Object.assign({}, c); delete o.json; return o; }),
        rules: rules,
        datasets: Object.keys(ds).map(function (k) { return { name: k, n: ds[k].rows.length, updated: ds[k].updated }; })
      });
    } else if (msg.type === "allowSite") {
      if (sites.indexOf(msg.origin) < 0) sites.push(msg.origin);
      await set({ sites: sites }); await registerSite(msg.origin); reply({ ok: true });
    } else if (msg.type === "removeSite") {
      await set({ sites: sites.filter(function (s) { return s !== msg.origin; }) }); await unregisterSite(msg.origin);
      try { await chrome.permissions.remove({ origins: [msg.origin + "/*"] }); } catch (e) {}
      reply({ ok: true });
    } else if (msg.type === "createRule") {
      var c = (recent[msg.tabId] || []).filter(function (x) { return x.id === msg.captureId; })[0];
      if (!c) return reply({ error: "Capture expiree : recharge la page du site" });
      var r = { id: uid(), name: msg.name, pattern: msg.pattern || c.pattern, method: c.method, root: msg.root != null ? msg.root : c.root, page: c.page, pageUrl: c.pageUrl, daily: msg.daily || "" };
      rules = rules.filter(function (x) { return x.name !== r.name; }).concat([r]);
      ds[r.name] = { rows: rowsFrom(c.json, r.root), updated: Date.now(), page: r.page };
      await set({ rules: rules, datasets: ds }); await syncAlarms(); reply({ ok: true, n: ds[r.name].rows.length });
    } else if (msg.type === "deleteRule") {
      var gone = rules.filter(function (x) { return x.id === msg.id; })[0];
      rules = rules.filter(function (x) { return x.id !== msg.id; });
      if (gone) delete ds[gone.name];
      await set({ rules: rules, datasets: ds }); await syncAlarms(); reply({ ok: true });
    } else if (msg.type === "setDaily") {
      rules.forEach(function (x) { if (x.id === msg.id) x.daily = msg.daily; });
      await set({ rules: rules }); await syncAlarms(); reply({ ok: true });
    } else if (msg.type === "refreshNow") {
      var ok2 = dashes.some(function (d) { return sender.url && sender.url.indexOf(d) === 0; }) || !sender.tab;
      if (!ok2) return reply({ error: "non autorise" });
      var targets = rules.filter(function (x) { return !msg.id || x.id === msg.id; });
      for (var t of targets) await refreshRule(t);
      reply({ ok: true });
    } else if (msg.type === "linkDashboard") {
      if (dashes.indexOf(msg.prefix) < 0) dashes.push(msg.prefix);
      await set({ dashboards: dashes }); reply({ ok: true });
    } else if (msg.type === "unlinkDashboard") {
      await set({ dashboards: dashes.filter(function (d) { return d !== msg.prefix; }) }); reply({ ok: true });
    } else if (msg.type === "getDatasets") {
      var ok = dashes.some(function (d) { return sender.url && sender.url.indexOf(d) === 0; });
      reply(ok ? { linked: true, datasets: ds } : { linked: false });
    }
  })();
  return true;
});
