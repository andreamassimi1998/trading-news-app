/* Personal Investment Intelligence — dashboard (vanilla JS).
 * Sicurezza: tutto il contenuto esterno (notizie, nomi, output AI) è inserito come TESTO tramite
 * textContent; i link passano da PII.safeUrl e si aprono con rel="noopener noreferrer". */
(function () {
  "use strict";
  var L = window.PII;
  var app = document.getElementById("app");
  var toastEl = document.getElementById("toast");

  // ---------------------------------------------------------------- DOM helper
  function h(tag, attrs) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === "class") el.className = v;
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "href") {
        var u = v.charAt(0) === "#" ? v : L.safeUrl(v);
        if (u) { el.setAttribute("href", u); if (u.charAt(0) !== "#") { el.target = "_blank"; el.rel = "noopener noreferrer nofollow"; } }
      } else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "selected") el[k] = !!v;
      else el.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  function link(url, text) {
    var u = L.safeUrl(url);
    return u ? h("a", { href: u }, text || url) : h("span", null, text || "");
  }
  function badge(text, cls) { return h("span", { class: "badge " + (cls || "") }, text); }
  function section(title, sub) {
    var body = h("div", { class: "card-body" });
    var el = h("section", { class: "card" }, h("h2", null, title), sub ? h("p", { class: "muted small" }, sub) : null, body);
    el.body = body;
    return el;
  }
  function empty(text) { return h("p", { class: "empty" }, text); }
  function toast(msg, kind, sticky) {
    toastEl.textContent = "";
    append(toastEl, msg);
    toastEl.className = "toast show " + (kind || "");
    clearTimeout(toast.t);
    if (!sticky) toast.t = setTimeout(function () { toastEl.className = "toast"; }, 6000);
  }

  // ---------------------------------------------------------------- impostazioni locali
  var Prefs = {
    get: function (k, d) { try { var v = localStorage.getItem("pii." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("pii." + k, JSON.stringify(v)); } catch (e) { /* storage non disponibile */ } },
    del: function (k) { try { localStorage.removeItem("pii." + k); } catch (e) { /* idem */ } }
  };
  var DEFAULT_REPO = (document.querySelector('meta[name="pii-repo"]') || {}).content || "";
  function gh() {
    var g = Prefs.get("github", null) || { repo: DEFAULT_REPO, branch: "main", token: "" };
    if (!g.repo) g.repo = DEFAULT_REPO;
    return g;
  }

  // ---------------------------------------------------------------- backend
  var Backend = {
    mode: "static",
    init: function () {  // "github" con token salvato; altrimenti sola lettura
      var g = gh();
      Backend.mode = g.repo && g.token ? "github" : "static";
      return Promise.resolve();
    },
    canAct: function () { return Backend.mode === "github"; },
    data: function (path) {
      var g = gh();
      var req;
      if (Backend.mode === "github") {
        req = fetch("https://api.github.com/repos/" + g.repo + "/contents/data/" + path + "?ref=" + encodeURIComponent(g.branch || "main") + "&t=" + Date.now(), {
          headers: { Authorization: "Bearer " + g.token, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
          cache: "no-store"
        });
      } else {
        // sola lettura: dati dalla cartella data/ del repository (anteprima sul PC: python3 -m http.server, poi /web/)
        req = fetch("../data/" + path + "?t=" + Date.now(), { cache: "no-store" });
      }
      return req.then(function (r) {
        if (r.status === 404) return null;
        if (r.status === 401 || r.status === 403) throw new Error("Accesso a GitHub negato: controlla il token nelle Impostazioni.");
        if (!r.ok) throw new Error("Errore " + r.status + " nel caricamento di " + path);
        return r.json();
      });
    },
    // --- azioni (workflow GitHub Actions) ---
    dispatch: function (workflow, inputs) {
      var g = gh();
      var since = new Date(Date.now() - 5000).toISOString();
      var base = "https://api.github.com/repos/" + g.repo + "/actions";
      var headers = { Authorization: "Bearer " + g.token, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" };
      return fetch(base + "/workflows/" + workflow + "/dispatches", {
        method: "POST", headers: headers, body: JSON.stringify({ ref: g.branch || "main", inputs: inputs, return_run_details: true })
      }).then(function (r) {
        if (r.status === 200) return r.json().then(function (j) { return j.workflow_run_id; });
        if (r.status === 204) return null;
        return r.text().then(function (t) { throw new Error("GitHub ha rifiutato l'avvio (" + r.status + "): " + t.slice(0, 160)); });
      }).then(function (runId) {
        if (runId) return runId;
        return new Promise(function (resolve, reject) { // API senza dettagli: cerco l'esecuzione appena creata
          var tries = 0;
          (function find() {
            fetch(base + "/workflows/" + workflow + "/runs?event=workflow_dispatch&per_page=5&created=>" + since, { headers: headers, cache: "no-store" })
              .then(function (r) { return r.json(); }).then(function (j) {
                var run = (j.workflow_runs || [])[0];
                if (run) resolve(run.id); else if (++tries > 12) reject(new Error("Esecuzione non trovata su GitHub.")); else setTimeout(find, 3000);
              }).catch(reject);
          })();
        });
      }).then(function (runId) {
        return new Promise(function (resolve, reject) {
          // Se si passa a un'altra app il telefono può congelare una richiesta in corso: ogni controllo ha un tempo
          // massimo e, al ritorno nell'app, si ricontrolla subito.
          var started = Date.now(), done = false, timer = null, busy = false;
          function next(ms) { clearTimeout(timer); timer = setTimeout(poll, ms); }
          function finish() { done = true; clearTimeout(timer); document.removeEventListener("visibilitychange", onShow); }
          function onShow() { if (!document.hidden && !done) { busy = false; next(0); } }
          document.addEventListener("visibilitychange", onShow);
          function poll() {
            if (done || busy) return;
            busy = true;
            var ctrl = window.AbortController ? new AbortController() : null;
            var guard = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
            fetch(base + "/runs/" + runId, { headers: headers, cache: "no-store", signal: ctrl ? ctrl.signal : undefined }).then(function (r) { return r.json(); }).then(function (run) {
              clearTimeout(guard); busy = false;
              if (done) return;
              var secs = Math.round((Date.now() - started) / 1000);
              toast(["Elaborazione su GitHub in corso (" + secs + " s)… ", link(run.html_url, "dettagli")], "info", true);
              if (run.status === "completed") { finish(); resolve(run); }
              else if (Date.now() - started > 15 * 60000) { finish(); reject(new Error("Tempo scaduto: controlla l'esecuzione su GitHub.")); }
              else next(5000);
            }).catch(function () { clearTimeout(guard); busy = false; if (!done) next(5000); });
          }
          poll();
        });
      });
    },
    refresh: function (opts) {
      opts = opts || {};
      return Backend.dispatch("refresh.yml", {
        components: (opts.components || []).join(",") || "all", instrument: opts.instrument || "", force: opts.force ? "true" : "false"
      }).then(function (run) { return { status: run.conclusion === "success" ? "ok" : "error", run: run }; });
    },
    manage: function (action, payload) {
      var rid = "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      return Backend.dispatch("manage.yml", { action: action, payload: JSON.stringify(payload), request_id: rid }).then(function (run) {
        if (run.conclusion !== "success") throw new Error("L'esecuzione su GitHub non è andata a buon fine.");
        return Backend.data("requests/" + rid + ".json").then(function (res) { return res || { ok: false, error: "Risultato non trovato." }; });
      });
    }
  };

  // ---------------------------------------------------------------- dati
  var cache = {};
  var CACHE_MS = 60000; // i dati cambiano solo con gli aggiornamenti: un minuto di cache evita richieste ripetute
  function load(path, fresh) {
    var c = cache[path];
    if (!fresh && c && Date.now() - c.t < CACHE_MS) return c.p;
    var p = Backend.data(path).catch(function (e) { delete cache[path]; throw e; });
    cache[path] = { t: Date.now(), p: p };
    return p;
  }
  function clearCache() { cache = {}; }

  // ---------------------------------------------------------------- componenti comuni
  var NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.appendChild(arguments[i]);
    return el;
  }
  function demoBanner() {
    return h("div", { class: "banner demo" }, h("strong", null, "DATI DEMO: "), "alcuni valori mostrati sono simulati e non sono quotazioni reali.");
  }
  function eventIds(e) { return e.instrument_ids || (e.instrument_id ? [e.instrument_id] : []); }
  // dati incompleti (es. una notizia senza titoli collegati) vanno ignorati, mai bloccare la pagina
  function newsIds(n) { return n && Array.isArray(n.instrument_ids) ? n.instrument_ids : []; }
  function byDate(a, b) { return (b.published_at || "").localeCompare(a.published_at || ""); }
  function chg(v) { return h("span", { class: "chg " + L.trend(v) }, L.fmtPct(v)); }
  /** Notizia: titolo (in italiano se tradotto), cosa significa, "fonte · quando". Nessun link esterno. */
  function newsItem(n, opts) {
    opts = opts || {};
    var via = n.via_holdings || {};
    var bits = [n.source || "Fonte non indicata", n.published_at ? L.timeAgo(n.published_at) : null];
    if (opts.names) {  // prima lo strumento citato direttamente, poi gli ETF che lo contengono
      var ids = newsIds(n).filter(function (i) { return !via[i]; }).concat(newsIds(n).filter(function (i) { return via[i]; }));
      var who = ids.map(function (i) { return opts.names[i]; }).filter(Boolean);
      if (who.length) bits.unshift(who[0] + (who.length > 1 ? " +" + (who.length - 1) : ""));
    }
    var meaning = n.meaning || {};
    var mean = opts.forId ? meaning[opts.forId] : meaning[Object.keys(meaning)[0]];
    var viaTxt = opts.forId ? via[opts.forId] : null;
    return h("article", { class: "news" },
      h("h3", null, n.title_it || n.title),
      mean ? h("p", { class: "meaning" }, mean) : null,
      h("div", { class: "meta" }, bits.filter(Boolean).join(" · ")),
      viaTxt ? h("div", { class: "via" }, "Riguarda " + viaTxt) : null);
  }
  function more(title, nodes, open) {
    var d = h("details", { class: "more" }, h("summary", null, title), h("div", { class: "more-body" }, nodes));
    if (open) d.open = true;
    return d;
  }
  function actionButton(label, fn, cls) {
    var b = h("button", { class: "btn " + (cls || ""), type: "button" }, label);
    b.addEventListener("click", function () {
      if (!Backend.canAct()) {
        toast(["Azione non disponibile: collega GitHub nelle ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."], "warn");
        return;
      }
      b.disabled = true;
      Promise.resolve().then(fn).catch(function (e) { toast(e.message || String(e), "error"); }).then(function () { b.disabled = false; });
    });
    return b;
  }
  function refreshAction(opts, label, cls) {
    return actionButton(label || "Aggiorna", function () {
      return Backend.refresh(opts).then(function (res) {
        clearCache();
        var st = res && res.status;
        toast(st === "ok" ? "Aggiornamento completato." : st === "partial" ? "Aggiornamento parziale: alcune fonti non hanno risposto." : "Aggiornamento non riuscito: i dati precedenti sono stati conservati.", st === "ok" ? "ok" : "warn");
        route();
      });
    }, cls);
  }
  function errorBox(e) {
    return h("div", { class: "card error-card" }, h("h2", null, "Dati non disponibili"), h("p", null, e.message || String(e)),
      h("p", { class: "small" }, Backend.mode === "static"
        ? ["Per leggere i dati dal repository privato inserisci il token GitHub nelle ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."]
        : ["Riprova più tardi o controlla le ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."]));
  }
  // Previsione: direzione (freccia e colore) e quanto è sicura. Senza direzione = previsione incerta.
  var DIR = { rialzo: ["↑", "al rialzo", "up"], ribasso: ["↓", "al ribasso", "down"] };
  var SICUREZZA = { bassa: "incerta", media: "abbastanza sicura", alta: "più sicura" };
  var LIVELLO = { bassa: 1, media: 2, alta: 3 };
  function forecastChip(dir, conf) {
    var d = DIR[dir];
    var lvl = d ? LIVELLO[conf] || 1 : 0;
    return h("span", { class: "fc-chip " + (d ? d[2] : "flat"), title: d ? "Previsione " + d[1] + ", " + (SICUREZZA[conf] || "incerta") : "Previsione incerta" },
      d ? d[0] + " " + d[1].replace("al ", "") : "incerta",
      d ? h("span", { class: "meter mini", "aria-label": SICUREZZA[conf] || "incerta" }, [1, 2, 3].map(function (i) { return h("i", { class: i <= lvl ? "on" : "" }); })) : null);
  }
  /** Mini-grafico dell'ultimo mese nella lista: solo forma e direzione, senza assi. */
  function sparkline(values) {
    var W = 72, H = 30, P = 3;
    if (!values || values.length < 2) return h("span", { class: "spark-mini" });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values), span = max - min || 1;
    var pts = values.map(function (v, i) { return [P + i / (values.length - 1) * (W - 2 * P), P + (1 - (v - min) / span) * (H - 2 * P)]; });
    var last = pts[pts.length - 1];
    return svgEl("svg", { class: "spark-mini " + L.trend(values[values.length - 1] - values[0]), viewBox: "0 0 " + W + " " + H, width: W, height: H, "aria-hidden": "true" },
      svgEl("polyline", { points: pts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") }),
      svgEl("circle", { cx: last[0].toFixed(1), cy: last[1].toFixed(1), r: 2.5 }));
  }
  function instRow(r) {
    return h("a", { class: "inst", href: "#/strumento/" + encodeURIComponent(r.id) },
      h("div", { class: "inst-main" },
        h("div", { class: "inst-name" }, r.short || r.name, r.demo ? badge("DEMO", "demo") : null),
        h("div", { class: "inst-sub" }, h("span", { class: "kind" }, r.type === "etf" ? "ETF" : "Azione"),
          r.outlook_label ? forecastChip(r.outlook, r.outlook_conf) : null)),
      sparkline(r.spark),
      h("div", { class: "inst-px" },
        r.price == null ? h("span", { class: "tiny muted" }, "n.d.") : chg(r.daily && r.daily.pct),
        h("div", { class: "tiny muted" }, r.m1 ? "1 mese " + L.fmtPct(r.m1.pct) : "")));
  }
  function nameMap(ov) {
    var names = {};
    ((ov && ov.instruments) || []).forEach(function (r) { names[r.id] = r.short || r.name; });
    return names;
  }
  function today() {
    var s = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Rome" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------------------------------------------------------------- PAGINA 1: i miei titoli
  function pageHome() {
    return Promise.all([load("overview.json"), load("status.json")]).then(function (r) {
      var ov = r[0], st = r[1] || {};
      var rows = (ov && ov.instruments) || [];
      var up = rows.filter(function (x) { return x.daily && x.daily.pct > 0; }).length;
      var down = rows.filter(function (x) { return x.daily && x.daily.pct < 0; }).length;
      var out = [h("header", { class: "page-head home" },
        h("p", { class: "eyebrow wide" }, today() + " · ", h("span", { class: "nowrap" }, "aggiornati " + L.timeAgo(st.last_refresh_at || (ov && ov.generated_at)))),
        h("div", null, h("h1", null, "I miei titoli"), rows.length ? h("p", { class: "sub" }, up + " in rialzo e " + down + " in calo oggi") : null),
        refreshAction({}, "↻ Aggiorna", "ghost small"))];
      if (ov && ov.demo) out.push(demoBanner());
      out.push(rows.length ? h("div", { class: "card inst-list" }, rows.map(instRow)) : empty("Non segui ancora nessun titolo."));
      out.push(h("a", { class: "btn ghost add", href: "#/aggiungi" }, "+ Aggiungi un titolo"));
      out.push(disclaimer());
      return out;
    });
  }

  // ---------------------------------------------------------------- aggiunta / modifica
  function instrumentForm(initial, onSave, saveLabel) {
    var f = {};
    function field(key, label, attrs, hint) {
      var input = attrs && attrs.options
        ? h("select", { class: "input" }, attrs.options.map(function (o) { return h("option", { value: o[0], selected: initial[key] === o[0] }, o[1]); }))
        : h("input", Object.assign({ class: "input", value: initial[key] == null ? "" : (Array.isArray(initial[key]) ? initial[key].join(", ") : initial[key]) }, attrs || {}));
      f[key] = input;
      return h("label", { class: "field" }, h("span", null, label), input, hint ? h("span", { class: "tiny muted" }, hint) : null);
    }
    var form = h("form", { class: "form" },
      field("symbol", "Simbolo (ticker Yahoo) *", { required: "required", autocapitalize: "characters", readonly: initial.id ? "readonly" : null }, "Es. AAPL, ASML.AS, VWCE.DE. Il suffisso indica la borsa."),
      field("name", "Nome completo *", { required: "required" }),
      field("type", "Tipo *", { options: [["stock", "Azione"], ["etf", "ETF"]] }),
      field("isin", "ISIN", { autocapitalize: "characters", maxlength: "12" }, "Consigliato: identifica lo strumento senza ambiguità."),
      field("exchange", "Borsa / mercato"),
      field("currency", "Valuta di quotazione", { maxlength: "3", autocapitalize: "characters" }),
      field("issuer", "Emittente (ETF)"),
      field("index_name", "Indice replicato (ETF)", null, "Usato anche per cercare notizie sull'indice."),
      field("aliases", "Nomi alternativi per le notizie", null, "Separati da virgola, es. \"Apple\"."),
      field("benchmark", "Indice di confronto (facoltativo)", null, "Simbolo Yahoo, es. ^GSPC. Vuoto = predefinito per valuta."),
      field("price_symbol", "Quotazione per i prezzi (facoltativa)", { autocapitalize: "characters" }, "Es. EUNL.DE: la quotazione in euro su Xetra, più vicina a Trade Republic. Vuoto = il simbolo sopra."));
    var msg = h("p", { class: "form-msg" });
    var btn = h("button", { class: "btn primary", type: "submit" }, saveLabel || "Conferma e salva");
    form.appendChild(msg);
    form.appendChild(btn);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var data = {};
      Object.keys(f).forEach(function (k) { data[k] = f[k].value.trim(); });
      data.symbol = data.symbol.toUpperCase();
      data.isin = data.isin.toUpperCase();
      data.currency = data.currency.toUpperCase();
      data.price_symbol = data.price_symbol.toUpperCase();
      data.aliases = data.aliases ? data.aliases.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
      if (data.isin && !L.isinOk(data.isin)) { msg.textContent = "ISIN non valido: controlla le cifre."; return; }
      if (!Backend.canAct()) { msg.textContent = "Per salvare serve il collegamento a GitHub (Impostazioni)."; return; }
      btn.disabled = true;
      msg.textContent = "Invio a GitHub: il salvataggio e il primo aggiornamento richiedono 1-3 minuti…";
      Promise.resolve(onSave(data)).then(function (res) {
        if (!res || !res.ok) throw new Error((res && (res.error || (res.errors && res.errors[0] && res.errors[0].error))) || "Salvataggio non riuscito.");
        clearCache();
        toast("Salvato.", "ok");
        location.hash = "#/strumento/" + encodeURIComponent((res.instrument || (res.added && res.added[0]) || {}).id || "");
      }).catch(function (e) { msg.textContent = e.message; }).then(function () { btn.disabled = false; });
    });
    return form;
  }

  function pageAdd() {
    var wrap = h("div");
    var results = h("div");
    var formHolder = h("div");
    var q = h("input", { type: "search", class: "input", placeholder: "Nome, ticker o ISIN (es. ASML o NL0010273215)", "aria-label": "Cerca" });
    var btn = h("button", { class: "btn primary", type: "submit" }, "Cerca");
    var searchForm = h("form", { class: "search-row" }, q, btn);
    function showForm(initial) {
      formHolder.textContent = "";
      formHolder.appendChild(section("Verifica i dati e conferma", "Controlla soprattutto borsa e valuta: devono corrispondere alla quotazione che segui. Nulla viene salvato senza conferma.").body.parentNode);
      formHolder.firstChild.body.appendChild(instrumentForm(initial, function (data) { return Backend.manage("add", { instrument: data }); }));
      formHolder.scrollIntoView({ behavior: "smooth" });
    }
    searchForm.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (!Backend.canAct()) { results.textContent = ""; results.appendChild(empty("La ricerca richiede il collegamento a GitHub (Impostazioni). Puoi comunque inserire i dati a mano qui sotto.")); return; }
      btn.disabled = true;
      results.textContent = "";
      results.appendChild(h("p", { class: "muted" }, "Ricerca tramite GitHub (circa 30-60 secondi)…"));
      Backend.manage("search", { query: q.value }).then(function (res) {
        results.textContent = "";
        if (!res.ok) throw new Error(res.error || "Ricerca non riuscita");
        var r = res.result;
        if (r.demo) results.appendChild(demoBanner());
        r.notes.forEach(function (n) { results.appendChild(h("div", { class: "banner warn" }, n)); });
        r.candidates.forEach(function (c) {
          results.appendChild(h("button", { class: "cand", type: "button", onclick: function () {
            showForm({ symbol: c.symbol, name: c.name, type: c.type, exchange: c.exchange, currency: c.currency || "",
              isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(q.value.trim().toUpperCase()) ? q.value.trim().toUpperCase() : "" });
          } }, h("strong", null, c.name || c.symbol), h("span", { class: "muted small" }, " " + c.symbol + " · " + (c.exchange || "borsa ?") + " · " + (c.currency || "valuta ?") + " · " + (c.type === "etf" ? "ETF" : "Azione"))));
        });
        results.appendChild(h("p", { class: "tiny muted" }, "Risultati da " + r.provider + ". Seleziona la quotazione corretta: verrà chiesta conferma."));
      }).catch(function (e) { results.textContent = ""; results.appendChild(h("div", { class: "banner error" }, e.message)); })
        .then(function () { btn.disabled = false; });
    });
    wrap.appendChild(h("header", { class: "page-head" }, h("div", null, h("h1", null, "Aggiungi strumento"), h("p", { class: "muted small" }, "Cerca, scegli la quotazione giusta e conferma."))));
    var s = section("1. Cerca");
    s.body.appendChild(searchForm);
    s.body.appendChild(results);
    s.body.appendChild(h("button", { class: "btn ghost", type: "button", onclick: function () { showForm({ type: "stock" }); } }, "Oppure inserisci i dati a mano"));
    wrap.appendChild(s);
    wrap.appendChild(formHolder);
    return Promise.resolve([wrap]);
  }

  function pageEdit(id) {
    return load("instruments.json").then(function (d) {
      var inst = ((d && d.instruments) || []).filter(function (i) { return i.id === id; })[0];
      if (!inst) return [empty("Strumento non trovato.")];
      var s = section("Modifica " + inst.name, "Il simbolo non si può cambiare: per una quotazione diversa rimuovi lo strumento e aggiungilo di nuovo.");
      s.body.appendChild(instrumentForm(inst, function (data) { return Backend.manage("update", { id: id, instrument: data }); }, "Salva modifiche"));
      var rm = actionButton("Rimuovi dall'elenco", function () {
        if (!confirm("Rimuovere " + inst.name + "? Verranno eliminati anche i suoi dati e la sua analisi.")) return;
        return Backend.manage("remove", { id: id }).then(function (res) {
          if (!res.ok) throw new Error(res.error || "Rimozione non riuscita");
          clearCache(); toast("Rimosso.", "ok"); location.hash = "#/";
        });
      }, "danger");
      return [h("p", null, h("a", { href: "#/strumento/" + encodeURIComponent(id) }, "← Torna al titolo")), s, h("div", { class: "card" }, rm)];
    });
  }

  // ---------------------------------------------------------------- PAGINA 2: scheda del titolo
  /** Grafico delle chiusure: linea 2px, area leggera, punto finale; mirino con data e prezzo al passaggio. */
  function chart(bars, currency) {
    var holder = h("div", { class: "chart" });
    var plot = h("div", { class: "plot" });
    var tip = h("div", { class: "tip", role: "status" });
    var ranges = [["1M", "1 mese"], ["3M", "3 mesi"], ["6M", "6 mesi"], ["1Y", "1 anno"]];
    var current = Prefs.get("range", "3M");
    var btns = h("div", { class: "seg", role: "group", "aria-label": "Periodo del grafico" });
    function draw() {
      plot.textContent = "";
      btns.textContent = "";
      ranges.forEach(function (r) {
        btns.appendChild(h("button", { type: "button", class: r[0] === current ? "on" : "", "aria-pressed": r[0] === current ? "true" : "false",
          onclick: function () { current = r[0]; Prefs.set("range", r[0]); draw(); } }, r[1]));
      });
      var pts = L.sliceRange(bars, current);
      if (pts.length < 2) { plot.appendChild(empty("Dati insufficienti per il grafico.")); return; }
      var W = Math.max(260, plot.clientWidth || holder.clientWidth || 340), H = 170, P = 8;
      var vals = pts.map(function (b) { return b.close; });
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = max - min || 1;
      var xy = pts.map(function (b, i) { return [P + i / (pts.length - 1) * (W - 2 * P), P + (1 - (b.close - min) / span) * (H - 2 * P)]; });
      var line = xy.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      var area = line + " L" + xy[xy.length - 1][0].toFixed(1) + " " + H + " L" + xy[0][0].toFixed(1) + " " + H + " Z";
      var last = xy[xy.length - 1];
      var cross = svgEl("line", { class: "cross", x1: 0, x2: 0, y1: 0, y2: H, visibility: "hidden" });
      var dot = svgEl("circle", { class: "hover-dot", r: 4, visibility: "hidden" });
      var svg = svgEl("svg", { class: "price " + L.trend(vals[vals.length - 1] - vals[0]), viewBox: "0 0 " + W + " " + H, width: W, height: H,
          role: "img", "aria-label": "Chiusure da " + L.fmtDay(pts[0].date) + " (" + L.fmtPrice(vals[0], currency) + ") a " +
            L.fmtDay(pts[pts.length - 1].date) + " (" + L.fmtPrice(vals[vals.length - 1], currency) + ")" },
        svgEl("line", { class: "grid", x1: 0, x2: W, y1: H - 0.5, y2: H - 0.5 }),
        svgEl("path", { class: "area", d: area }), svgEl("path", { class: "line", d: line }),
        svgEl("circle", { class: "end", cx: last[0].toFixed(1), cy: last[1].toFixed(1), r: 4 }), cross, dot);
      function show(ev) {
        var rect = svg.getBoundingClientRect();
        var x = (ev.clientX - rect.left) * W / rect.width;
        var i = Math.max(0, Math.min(pts.length - 1, Math.round((x - P) / (W - 2 * P) * (pts.length - 1))));
        cross.setAttribute("x1", xy[i][0]); cross.setAttribute("x2", xy[i][0]); cross.setAttribute("visibility", "visible");
        dot.setAttribute("cx", xy[i][0]); dot.setAttribute("cy", xy[i][1]); dot.setAttribute("visibility", "visible");
        tip.textContent = L.fmtDay(pts[i].date) + " · " + L.fmtPrice(pts[i].close, currency);
        tip.style.left = Math.min(Math.max(xy[i][0] * rect.width / W, 50), rect.width - 50) + "px";  // CSSOM: consentito dalla CSP
        tip.className = "tip on";
      }
      function hide() { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.className = "tip"; }
      svg.addEventListener("pointermove", show);
      svg.addEventListener("pointerdown", show);
      svg.addEventListener("pointerleave", hide);
      plot.appendChild(svg);
      plot.appendChild(h("div", { class: "axis tiny muted" }, h("span", null, L.fmtDay(pts[0].date)),
        h("span", null, "min " + L.fmtPrice(min) + " · max " + L.fmtPrice(max)), h("span", null, L.fmtDay(pts[pts.length - 1].date))));
    }
    holder.appendChild(tip);
    holder.appendChild(plot);
    holder.appendChild(btns);
    setTimeout(draw, 0);  // serve la larghezza reale, nota solo dopo l'inserimento nella pagina
    window.addEventListener("resize", function onResize() { if (!holder.isConnected) window.removeEventListener("resize", onResize); else draw(); });
    return holder;
  }

  function clampText(text, cls) {
    var p = h("p", { class: (cls || "") + " clamp" }, text);
    var out = [p];
    if ((text || "").length > 260) {
      out.push(h("button", { type: "button", class: "linklike small", onclick: function (ev) {
        ev.target.textContent = p.classList.toggle("clamp") ? "Leggi tutto" : "Riduci";
      } }, "Leggi tutto"));
    }
    return out;
  }

  var EXCHANGES = { LSX: "LS Exchange", GER: "Xetra", FRA: "Francoforte", MIL: "Milano", AMS: "Amsterdam", LSE: "Londra", PAR: "Parigi",
    NMS: "Nasdaq", NGM: "Nasdaq", NCM: "Nasdaq", NYQ: "New York", PCX: "New York" };
  /** "Prezzo delle 15:42 · Xetra · ritardo ~15 min" oppure "Chiusura del 29 ott · Xetra", con l'eventuale conversione. */
  function priceWhen(q) {
    var intraday = q.session && q.session.price_kind === "intraday";
    var parts = [q.stale ? "Ultimo prezzo del " + L.fmtDate(q.last_bar_date) + " (non aggiornato)"
      : intraday ? "Prezzo delle " + L.fmtTime(/T/.test(q.as_of || "") ? q.as_of : q.fetched_at)  // senza l'ora di borsa: quella di lettura
        : "Chiusura del " + L.fmtDay(q.last_bar_date)];
    if (q.exchange) parts.push(EXCHANGES[q.exchange] || q.exchange);
    if (intraday && !q.stale && q.exchange !== "LSX") parts.push("ritardo ~15 min");  // Yahoo: ritardato; LS Exchange: pochi minuti
    if (q.original_currency) parts.push("convertito da " + q.original_currency + " al cambio del giorno");
    return parts.join(" · ");
  }

  function trendCard(q, a) {
    var s = h("section", { class: "card hero" });
    if (!q) { s.appendChild(empty("Prezzi non disponibili.")); return s; }
    var m = q.metrics || {};
    if (q.demo) s.appendChild(demoBanner());
    s.appendChild(h("div", { class: "price-hero" },
      h("span", { class: "px-big" }, L.fmtPrice(q.price, q.currency)),
      m.daily ? h("span", { class: "chg big " + L.trend(m.daily.pct) }, L.fmtPct(m.daily.pct) + " oggi") : null));
    s.appendChild(h("p", { class: "tiny muted" }, priceWhen(q)));
    s.appendChild(chart(q.bars || [], q.currency));
    s.appendChild(h("div", { class: "periods" }, [["1 settimana", m.d5], ["1 mese", m.m1], ["Quest'anno", m.ytd]].map(function (p) {
      return h("div", { class: "stat" }, h("div", { class: "tiny muted" }, p[0]), p[1] ? chg(p[1].pct) : h("span", { class: "muted" }, "—"));
    })));
    if (a.in_breve) clampText(a.in_breve, "lead").forEach(function (n) { s.appendChild(n); });
    return s;
  }

  function briefCard(rec) {
    var s = section("Le notizie in breve");
    var pts = (rec && rec.analysis && rec.analysis.notizie_in_breve) || [];
    if (!pts.length) {
      s.body.appendChild(empty(rec ? "Il riassunto arriverà con la prossima analisi." : "Riassunto non ancora disponibile."));
      return s;
    }
    s.body.appendChild(h("ol", { class: "brief" }, pts.map(function (p) {
      return h("li", null, h("p", null, p.testo),
        h("div", { class: "srcs" }, p.fonti.map(function (f) { return h("span", { class: "src" }, f); }),
          p.una_sola_fonte ? h("span", { class: "src single" }, "una sola fonte") : null));
    })));
    var srch = rec.search;
    s.body.appendChild(h("p", { class: "tiny muted" }, (srch && srch.sources.length
      ? "Gemini ha letto gli articoli di " + srch.sources.length + (srch.sources.length === 1 ? " testata" : " testate")
      : "Basato sui titoli delle notizie raccolte") + " · " + L.timeAgo(rec.generated_at)));
    return s;
  }

  function forecastCard(rec, events) {
    var s = section("Previsione");
    var p = (rec && rec.analysis && rec.analysis.prospettive) || {};
    var sc = p.scenari || {};
    var hasScen = ["rialzista", "centrale", "ribassista"].some(function (k) { return sc[k] && sc[k].descrizione; });
    if (!rec || (!p.spiegazione && !hasScen)) {
      s.body.appendChild(empty(rec ? "Informazioni insufficienti per una previsione ragionata." : "Previsione non ancora disponibile."));
    } else {
      var d = DIR[p.direzione];
      var lvl = d ? LIVELLO[p.fiducia] || 1 : 0;
      s.body.appendChild(h("div", { class: "fc-head " + (d ? d[2] : "flat") },
        h("div", { class: "fc-icon", "aria-hidden": "true" }, d ? d[0] : "?"),
        h("div", null, h("div", { class: "fc-title" }, d ? "Previsione " + d[1] : "Previsione incerta"),
          h("div", { class: "fc-conf" },
            h("span", { class: "meter", "aria-hidden": "true" }, [1, 2, 3].map(function (i) { return h("i", { class: i <= lvl ? "on" : "" }); })),
            h("span", { class: "tiny muted" }, [d && SICUREZZA[p.fiducia], p.orizzonte].filter(Boolean).join(" · "))))));
      if (p.spiegazione) clampText(p.spiegazione, "small").forEach(function (n) { s.body.appendChild(n); });
      if (p.fattori_chiave && p.fattori_chiave.length) {
        s.body.appendChild(h("div", { class: "keys" }, h("div", { class: "label" }, "Dipende soprattutto da"),
          h("ul", null, p.fattori_chiave.map(function (f) { return h("li", null, f.testo); }))));
      }
      var LBL = { rialzista: "Se va meglio", centrale: "Più probabile", ribassista: "Se va peggio" };
      var rows = ["centrale", "rialzista", "ribassista"].filter(function (k) { return sc[k] && sc[k].descrizione; });
      if (rows.length) {
        s.body.appendChild(h("ul", { class: "scen-list" }, rows.map(function (k) {
          return h("li", { class: "s-" + k }, h("span", { class: "scen-lbl" }, LBL[k]), h("span", null, sc[k].descrizione));
        })));
      }
    }
    if (events.length) {
      s.body.appendChild(h("div", { class: "dates" }, h("div", { class: "label" }, "Date da segnare"),
        events.slice(0, 3).map(function (e) {
          return h("div", { class: "date-row" }, h("span", { class: "date" }, L.fmtDay(e.date)), h("span", null, e.title.replace(/^Pubblicazione risultati trimestrali/, "Risultati")));
        })));
    }
    s.body.appendChild(h("p", { class: "tiny muted" }, "Ipotesi basate sulle notizie raccolte, non una raccomandazione."));
    return s;
  }

  function pageDetail(id) {
    var base = "analysis/" + id + "/";
    return Promise.all([load("overview.json"), load("quotes/" + id + ".json"), load(base + "latest.json"), load("news.json"),
      load("events.json")]).then(function (r) {
      var inst = (((r[0] || {}).instruments) || []).filter(function (x) { return x.id === id; })[0];
      if (!inst) return [empty("Titolo non trovato."), h("a", { href: "#/" }, "← I miei titoli")];
      var q = r[1], rec = r[2], newsMeta = r[3] || {}, evs = (r[4] && r[4].items) || [];
      var news = (newsMeta.items || []).filter(function (n) { return newsIds(n).indexOf(id) >= 0; }).sort(byDate);
      var todayIso = new Date().toISOString().slice(0, 10);
      var events = evs.filter(function (e) { return eventIds(e).indexOf(id) >= 0 && e.date >= todayIso; });
      var a = (rec && rec.analysis) || {};
      var out = [h("p", { class: "crumbs" }, h("a", { href: "#/" }, "← I miei titoli")),
        h("header", { class: "page-head" },
          h("div", null, h("p", { class: "eyebrow" }, (inst.type === "etf" ? "ETF" : "Azione") + " · " + inst.symbol), h("h1", null, inst.short || inst.name)),
          refreshAction({ components: ["prices", "funds", "events", "news", "analysis"], instrument: id }, "↻ Aggiorna", "ghost small"))];
      out.push(trendCard(q, a));
      out.push(briefCard(rec));
      out.push(forecastCard(rec, events));
      var ns = section("Titoli delle notizie");
      if (news.length) {
        news.slice(0, 6).forEach(function (n) { ns.body.appendChild(newsItem(n, { forId: id })); });
        if (news.length > 6) ns.body.appendChild(more("Altre " + (Math.min(news.length, 40) - 6) + " notizie", news.slice(6, 40).map(function (n) { return newsItem(n, { forId: id }); })));
      } else ns.body.appendChild(empty("Nessuna notizia negli ultimi giorni."));
      out.push(ns);
      out.push(h("p", { class: "center small" }, h("a", { href: "#/modifica/" + encodeURIComponent(id) }, "Modifica o rimuovi")));
      return out;
    });
  }

  // ---------------------------------------------------------------- PAGINA 3: notizie
  function dayLabel(iso) {
    if (!iso) return "Data non indicata";
    var d = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Rome" });  // AAAA-MM-GG, ora italiana
    var now = new Date(), y = new Date(now - 86400000);
    if (d === now.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })) return "Oggi";
    if (d === y.toLocaleDateString("en-CA", { timeZone: "Europe/Rome" })) return "Ieri";
    return L.fmtDay(d);
  }
  // le 2-4 notizie del giorno che pesano di più sui mercati mondiali (scritte da Gemini, data/market_brief.json)
  function marketCard(brief) {
    var items = (brief && brief.items) || [];
    if (!items.length) return null;
    var s = section("Oggi sui mercati");
    s.classList.add("market");
    s.body.appendChild(h("ol", { class: "brief" }, items.map(function (it) {
      return h("li", null, h("span", { class: "tema" }, it.tema), h("p", { class: "m-title" }, it.titolo), h("p", null, it.testo),
        h("div", { class: "srcs" }, (it.fonti || []).map(function (f) { return h("span", { class: "src" }, f); })));
    })));
    s.body.appendChild(h("p", { class: "tiny muted" }, "Aggiornato " + L.timeAgo(brief.generated_at)));
    return s;
  }

  function pageNews() {
    return Promise.all([load("news.json"), load("overview.json"), load("market_brief.json").catch(function () { return null; })]).then(function (r) {
      var nm = r[0] || { items: [] };
      var names = nameMap(r[1]);
      var ids = Object.keys(names);
      var current = Prefs.get("newsFilter", "");
      if (current && !names[current]) current = "";
      var listEl = h("div");
      var chips = h("div", { class: "chips filter", role: "group", "aria-label": "Filtra per titolo" });
      var all = nm.items.slice().sort(byDate);
      function draw() {
        chips.textContent = "";
        [["", "Tutte"]].concat(ids.map(function (i) { return [i, names[i]]; })).forEach(function (c) {
          chips.appendChild(h("button", { type: "button", class: "chip" + (current === c[0] ? " on" : ""), "aria-pressed": current === c[0] ? "true" : "false",
            onclick: function () { current = c[0]; Prefs.set("newsFilter", current); draw(); } }, c[1]));
        });
        var opts = current ? { forId: current } : { names: names };
        var matching = all.filter(function (n) { return newsIds(n).length && (!current || newsIds(n).indexOf(current) >= 0); });
        var items = matching.slice(0, 25), rest = matching.slice(25, 80);
        listEl.textContent = "";
        if (!items.length) { listEl.appendChild(empty("Nessuna notizia negli ultimi giorni.")); return; }
        var groups = [];
        items.forEach(function (n) {
          var g = dayLabel(n.published_at);
          if (!groups.length || groups[groups.length - 1].label !== g) groups.push({ label: g, items: [] });
          groups[groups.length - 1].items.push(n);
        });
        groups.forEach(function (g) {
          listEl.appendChild(h("section", { class: "card" }, h("h2", { class: "day" }, g.label), g.items.map(function (n) { return newsItem(n, opts); })));
        });
        if (rest.length) listEl.appendChild(h("section", { class: "card" }, more("Altre " + rest.length + " notizie", rest.map(function (n) { return newsItem(n, opts); }))));
      }
      draw();
      return [h("header", { class: "page-head" }, h("div", null, h("p", { class: "eyebrow" }, "Ultimi 14 giorni"), h("h1", null, "Notizie")),
        refreshAction({ components: ["news"] }, "↻ Aggiorna", "ghost small")), marketCard(r[2]), chips, listEl];
    });
  }

  // ---------------------------------------------------------------- PAGINA 4: impostazioni
  function aiUsageSection() {
    var sec = { body: h("div") };
    load("ai_usage.json").catch(function () { return null; }).then(function (u) {
      var days = (u && u.days) || {};
      var keys = Object.keys(days).sort().reverse().slice(0, 7);
      if (!keys.length) { sec.body.appendChild(h("p", { class: "small muted" }, "Nessuna chiamata registrata finora.")); return; }
      sec.body.appendChild(h("table", { class: "kv small" },
        h("tr", null, h("th", null, "Giorno"), h("th", null, "Chiamate"), h("th", null, "Ricerche"), h("th", null, "Token"), h("th", null, "Modelli")),
        keys.map(function (k) {
          var d = days[k] || {};
          var models = Object.keys(d.by_model || {}).map(function (m) { return m + " ×" + d.by_model[m]; }).join(", ");
          return h("tr", null, h("td", null, k), h("td", null, String(d.calls || 0) + (d.failed ? " (" + d.failed + " fallite)" : "")),
            h("td", null, String(d.searches || 0)), h("td", null, (d.total_tokens || 0).toLocaleString("it-IT")), h("td", null, models || "—"));
        })));
    });
    return sec.body;
  }

  function pageSettings() {
    return load("status.json").catch(function () { return null; }).then(function (status) {
      var out = [h("header", { class: "page-head" }, h("h1", null, "Impostazioni"))];
      var modeTxt = Backend.mode === "github" ? "Collegata a GitHub: i dati arrivano dal repository e gli aggiornamenti girano su GitHub Actions, anche a PC spento."
        : "Non collegata: inserisci qui sotto il token GitHub per leggere i dati e aggiornarli.";
      out.push(h("p", { class: "small" }, modeTxt));

      var comps = (status && status.components) || {};
      var NAMES = { prices: "Prezzi", events: "Eventi", funds: "Dati ETF", news: "Notizie", analysis: "Analisi" };
      var stTable = h("table", { class: "kv small" }, Object.keys(NAMES).map(function (k) {
        var c = comps[k];
        return h("tr", null, h("th", null, NAMES[k]),
          h("td", null, c ? badge(c.status, "st-" + c.status) : "—"),
          h("td", null, c ? (c.message || "") + " · ultimo successo " + (c.last_success ? L.fmtDate(c.last_success) : "mai") : "mai eseguito",
            c && c.errors && c.errors.length ? h("details", null, h("summary", null, c.errors.length + " errori"), h("ul", { class: "plain tiny" }, c.errors.map(function (e) { return h("li", null, (e.symbol || e.id || "") + ": " + e.error); }))) : null));
      }));
      var advanced = [more("Stato degli aggiornamenti", stTable), more("Consumo AI", aiUsageSection())];
      advanced.push(more("Fonti e limiti", h("ul", { class: "plain small" },
        h("li", null, "Prezzi: Yahoo Finance tramite la libreria non ufficiale yfinance. Dati ritardati, mai tempo reale; possibili buchi o errori."),
        h("li", null, "Notizie: Google News (per le azioni il nome della società; per gli ETF l'indice, il mercato e le principali partecipazioni) e i comunicati di BCE e Fed. Nessuno scraping, nessun aggiramento di paywall."),
        h("li", null, "Eventi: date dei risultati indicate dal provider (non verificate) e riunioni delle banche centrali da config/manual_events.json."),
        h("li", null, "Riassunto e previsione: Google Gemini, che legge gli articoli con la ricerca Google (quota gratuita; oltre il limite mensile usa solo i titoli). Non è un consiglio di investimento."))));

      var g = gh();
      var gs = section("Collegamento GitHub", "Il token resta solo in questo browser. Serve un token «fine-grained» limitato al repository dei dati, con permessi Contents: read e Actions: read and write.");
      var repo = h("input", { class: "input", value: g.repo, placeholder: "utente/repository" });
      var branch = h("input", { class: "input", value: g.branch || "main" });
      var token = h("input", { class: "input", type: "password", value: g.token, placeholder: "github_pat_…", autocomplete: "off" });
      var msg = h("p", { class: "form-msg" });
      gs.body.appendChild(h("label", { class: "field" }, h("span", null, "Repository"), repo));
      gs.body.appendChild(h("label", { class: "field" }, h("span", null, "Branch"), branch));
      gs.body.appendChild(h("label", { class: "field" }, h("span", null, "Token personale"), token));
      gs.body.appendChild(h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", onclick: function () {
          var v = { repo: repo.value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""), branch: branch.value.trim() || "main", token: token.value.trim() };
          if (v.repo && !/^[\w.-]+\/[\w.-]+$/.test(v.repo)) { msg.textContent = "Formato repository non valido (utente/repository)."; return; }
          msg.textContent = "Verifica in corso…";
          fetch("https://api.github.com/repos/" + v.repo, { headers: { Authorization: "Bearer " + v.token, Accept: "application/vnd.github+json" } }).then(function (r) {
            if (!r.ok) throw new Error("GitHub ha risposto " + r.status + ": controlla repository e token.");
            return r.json();
          }).then(function (j) {
            Prefs.set("github", v);
            msg.textContent = "Collegamento riuscito (" + j.full_name + (j.private ? ", privato" : ", pubblico") + ").";
            return Backend.init().then(function () { clearCache(); });
          }).catch(function (e) { msg.textContent = e.message; });
        } }, "Salva e verifica"),
        h("button", { class: "btn ghost", type: "button", onclick: function () { Prefs.del("github"); token.value = ""; msg.textContent = "Token rimosso da questo browser."; Backend.init().then(clearCache); } }, "Rimuovi token")));
      gs.body.appendChild(msg);
      out.push(gs);

      var adv = section("Avanzate");
      adv.body.appendChild(h("div", { class: "deep" }, advanced));
      out.push(adv);
      out.push(disclaimer());
      return out;
    });
  }

  function disclaimer() {
    return h("p", { class: "disclaimer" }, "Uso personale, non è consulenza finanziaria. Prezzi ritardati e fonti gratuite possono contenere errori.");
  }

  function pageConnect() {
    var s = section("Collega i tuoi dati", "Questa pagina contiene solo il codice della dashboard: i dati sono nel repository privato " + DEFAULT_REPO + ".");
    s.body.appendChild(h("ol", { class: "plain" },
      h("li", null, "Su GitHub crea un token «fine-grained» limitato a quel repository, con permessi Contents: Read e Actions: Read and write."),
      h("li", null, "Inseriscilo in ", h("a", { href: "#/impostazioni" }, "Impostazioni → Collegamento GitHub"), ". Resta salvato solo in questo browser.")));
    s.body.appendChild(h("a", { class: "btn primary", href: "#/impostazioni" }, "Vai alle impostazioni"));
    return [h("header", { class: "page-head" }, h("div", null, h("h1", null, "Benvenuto"))), s, disclaimer()];
  }

  // ---------------------------------------------------------------- router
  var ROUTES = [
    [/^#?\/?$/, pageHome, "home"],
    [/^#\/strumenti$/, pageHome, "home"],
    [/^#\/aggiungi$/, pageAdd, "home"],
    [/^#\/modifica\/(.+)$/, pageEdit, "home"],
    [/^#\/strumento\/(.+)$/, pageDetail, "home"],
    [/^#\/notizie$/, pageNews, "news"],
    [/^#\/impostazioni$/, pageSettings, "settings"]
  ];
  function route() {
    var hash = location.hash || "#/";
    var match = null, fn = pageHome, tab = "home";
    ROUTES.some(function (r) { var m = hash.match(r[0]); if (m) { match = m; fn = r[1]; tab = r[2]; return true; } return false; });
    document.querySelectorAll(".tabbar a").forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-tab") === tab); });
    app.setAttribute("aria-busy", "true");
    if (Backend.mode === "static" && DEFAULT_REPO && tab !== "settings") fn = pageConnect; // sito pubblico senza token
    Promise.resolve(fn(match && match[1] ? decodeURIComponent(match[1]) : undefined)).then(function (nodes) {
      app.textContent = "";
      append(app, nodes);
    }).catch(function (e) {
      app.textContent = "";
      app.appendChild(errorBox(e));
    }).then(function () { app.removeAttribute("aria-busy"); });
  }
  window.addEventListener("hashchange", function () { route(); window.scrollTo(0, 0); });
  Backend.init().then(route);

  // Il telefono può tenere in cache la pagina per alcuni minuti (anche giorni, se aggiunta alla Home): all'apertura
  // si controlla se è stata pubblicata una versione nuova e, in quel caso, la si carica con un indirizzo diverso.
  function checkUpdate() {
    var mine = ((document.querySelector('script[src*="app.js"]') || {}).src || "").split("v=")[1];
    if (!mine) return; // anteprima locale, senza versione
    fetch("index.html?check=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (t) {
      var m = /app\.js\?v=([a-z0-9]+)/.exec(t);
      if (m && m[1] !== mine && location.search.indexOf("v=" + m[1]) < 0) location.replace(location.pathname + "?v=" + m[1] + location.hash);
    }).catch(function () {});
  }
  checkUpdate();
  document.addEventListener("visibilitychange", function () { if (!document.hidden) checkUpdate(); });
})();
