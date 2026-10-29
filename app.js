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
  function pctEl(v) { return h("span", { class: "pct " + L.trend(v) }, L.fmtPct(v)); }
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
          var started = Date.now();
          (function poll() {
            fetch(base + "/runs/" + runId, { headers: headers, cache: "no-store" }).then(function (r) { return r.json(); }).then(function (run) {
              var secs = Math.round((Date.now() - started) / 1000);
              toast(["Elaborazione su GitHub in corso (" + secs + " s)… ", link(run.html_url, "dettagli")], "info", true);
              if (run.status === "completed") resolve(run);
              else if (Date.now() - started > 15 * 60000) reject(new Error("Tempo scaduto: controlla l'esecuzione su GitHub."));
              else setTimeout(poll, 5000);
            }).catch(function () { setTimeout(poll, 8000); });
          })();
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
  function demoBanner() {
    return h("div", { class: "banner demo" }, h("strong", null, "DATI DEMO: "), "alcuni valori mostrati sono simulati e non sono quotazioni reali.");
  }
  function eventIds(e) { return e.instrument_ids || (e.instrument_id ? [e.instrument_id] : []); }
  function byDate(a, b) { return (b.published_at || "").localeCompare(a.published_at || ""); }
  /** Notizia: titolo e "fonte · quando". opts.forId = scheda di uno strumento; opts.names = elenco generale. */
  function newsCard(n, opts) {
    opts = opts || {};
    var via = n.via_holdings || {};
    var bits = [n.source || "Fonte non indicata", n.published_at ? L.timeAgo(n.published_at) : null];
    if (opts.names) {  // prima lo strumento citato direttamente, poi gli ETF che lo contengono
      var ids = (n.instrument_ids || []).filter(function (i) { return !via[i]; }).concat((n.instrument_ids || []).filter(function (i) { return via[i]; }));
      var who = ids.map(function (i) { return opts.names[i]; }).filter(Boolean);
      if (who.length) bits.unshift(who[0] + (who.length > 1 ? " +" + (who.length - 1) : ""));
    }
    var viaTxt = opts.forId ? via[opts.forId] : null;
    var meaning = n.meaning || {};
    var mean = opts.forId ? meaning[opts.forId] : meaning[Object.keys(meaning)[0]];
    return h("article", { class: "news" },
      h("h3", null, link(n.url, n.title_it || n.title)),
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
  function instRow(r) {
    return h("a", { class: "inst", href: "#/strumento/" + encodeURIComponent(r.id) },
      h("div", { class: "inst-main" },
        h("div", { class: "inst-name" }, r.short || r.name, r.demo ? badge("DEMO", "demo") : null),
        h("div", { class: "tiny muted" }, (r.type === "etf" ? "ETF" : "Azione"),
          r.outlook_label ? h("span", { class: "outlook-word " + (DIR[r.outlook] ? DIR[r.outlook][2] : "mixed") },
            " · " + (DIR[r.outlook] ? DIR[r.outlook][0] + " " + DIR[r.outlook][1] + (SICUREZZA[r.outlook_conf] ? ", " + SICUREZZA[r.outlook_conf] : "") : "previsione incerta")) : null)),
      h("div", { class: "inst-px" },
        r.price == null ? h("div", { class: "tiny muted" }, "prezzo n.d.") : pctEl(r.daily && r.daily.pct),
        h("div", { class: "tiny muted" }, r.m1 ? "1 mese " + L.fmtPct(r.m1.pct) : "")));
  }
  function nameMap(ov) {
    var names = {};
    ((ov && ov.instruments) || []).forEach(function (r) { names[r.id] = r.short || r.name; });
    return names;
  }

  // ---------------------------------------------------------------- PAGINA 1: i miei titoli
  function pageHome() {
    return Promise.all([load("overview.json"), load("status.json")]).then(function (r) {
      var ov = r[0], st = r[1] || {};
      var rows = (ov && ov.instruments) || [];
      var out = [h("header", { class: "page-head" },
        h("div", null, h("h1", null, "I miei titoli"),
          h("p", { class: "tiny muted" }, "Aggiornati " + L.timeAgo(st.last_refresh_at || (ov && ov.generated_at)))),
        refreshAction({}, "Aggiorna", "ghost"))];
      if (ov && ov.demo) out.push(demoBanner());
      out.push(rows.length ? h("div", { class: "card inst-list" }, rows.map(instRow)) : empty("Non segui ancora nessun titolo."));
      out.push(h("a", { class: "btn ghost add", href: "#/aggiungi" }, "+ Aggiungi un titolo"));
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
      field("benchmark", "Indice di confronto (facoltativo)", null, "Simbolo Yahoo, es. ^GSPC. Vuoto = predefinito per valuta."));
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
  function chart(bars) {
    var holder = h("div", { class: "chart" });
    var ranges = ["1M", "3M", "6M", "1Y"];
    var current = Prefs.get("range", "3M");
    var btns = h("div", { class: "seg" });
    var svgBox = h("div");
    function draw() {
      svgBox.textContent = "";
      btns.textContent = "";
      ranges.forEach(function (r) { btns.appendChild(h("button", { type: "button", class: r === current ? "on" : "", onclick: function () { current = r; Prefs.set("range", r); draw(); } }, r)); });
      var pts = L.sliceRange(bars, current);
      if (pts.length < 2) { svgBox.appendChild(empty("Dati insufficienti per il grafico.")); return; }
      var W = 600, H = 140, P = 6;
      var vals = pts.map(function (b) { return b.close; });
      var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals);
      var span = max - min || 1;
      var d = pts.map(function (b, i) {
        var x = P + (i / (pts.length - 1)) * (W - 2 * P);
        var y = P + (1 - (b.close - min) / span) * (H - 2 * P);
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join(" ");
      var NS = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.setAttribute("class", "spark " + L.trend(vals[vals.length - 1] - vals[0]));
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Andamento delle chiusure " + current);
      var path = document.createElementNS(NS, "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
      svgBox.appendChild(svg);
    }
    draw();
    holder.appendChild(svgBox);
    holder.appendChild(btns);
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

  function trendCard(q, a) {
    var s = section("Andamento");
    if (!q) { s.body.appendChild(empty("Prezzi non disponibili.")); return s; }
    var m = q.metrics || {};
    if (q.demo) s.body.appendChild(demoBanner());
    s.body.appendChild(h("div", { class: "price-hero" },
      h("span", { class: "px-big" }, L.fmtPrice(q.price, q.currency)),
      m.daily ? h("span", { class: "pct-big " + L.trend(m.daily.pct) }, L.fmtPct(m.daily.pct) + " oggi") : null,
      q.stale ? h("div", { class: "tiny muted" }, "Ultimo prezzo del " + L.fmtDate(q.last_bar_date) + " (non aggiornato)") : null));
    s.body.appendChild(chart(q.bars || []));
    s.body.appendChild(h("div", { class: "periods" }, [["1 settimana", m.d5], ["1 mese", m.m1], ["Da inizio anno", m.ytd]].map(function (p) {
      return h("div", null, h("div", { class: "tiny muted" }, p[0]), p[1] ? pctEl(p[1].pct) : h("span", { class: "muted" }, "—"));
    })));
    if (a.in_breve) clampText(a.in_breve, "small").forEach(function (n) { s.body.appendChild(n); });
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
      s.body.appendChild(h("div", { class: "outlook-head " + (d ? d[2] : "mixed") },
        h("strong", null, d ? d[0] + " Previsione " + d[1] : "Previsione incerta"),
        h("div", { class: "tiny muted" }, [d && SICUREZZA[p.fiducia] ? SICUREZZA[p.fiducia] : null, p.orizzonte].filter(Boolean).join(" · "))));
      if (p.spiegazione) clampText(p.spiegazione, "small").forEach(function (n) { s.body.appendChild(n); });
      if (p.fattori_chiave && p.fattori_chiave.length) {
        s.body.appendChild(h("div", { class: "keys" }, h("div", { class: "tiny muted" }, "Dipende soprattutto da"),
          p.fattori_chiave.map(function (f) { return h("div", { class: "small" }, "• " + f.testo); })));
      }
      var LBL = { rialzista: "Se va meglio", centrale: "Più probabile", ribassista: "Se va peggio" };
      var rows = ["centrale", "rialzista", "ribassista"].filter(function (k) { return sc[k] && sc[k].descrizione; });
      if (rows.length) {
        s.body.appendChild(h("ul", { class: "scen-list" }, rows.map(function (k) {
          return h("li", { class: "s-" + k }, h("strong", null, LBL[k] + ": "), sc[k].descrizione);
        })));
      }
    }
    if (events.length) {
      s.body.appendChild(h("div", { class: "dates" }, h("div", { class: "tiny muted" }, "Date da segnare"),
        events.slice(0, 3).map(function (e) {
          return h("div", { class: "small" }, h("strong", null, L.fmtDay(e.date) + " "), e.title.replace(/^Pubblicazione risultati trimestrali/, "Risultati"));
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
      var news = (newsMeta.items || []).filter(function (n) { return n.instrument_ids.indexOf(id) >= 0; }).sort(byDate);
      var today = new Date().toISOString().slice(0, 10);
      var events = evs.filter(function (e) { return eventIds(e).indexOf(id) >= 0 && e.date >= today; });
      var a = (rec && rec.analysis) || {};
      var out = [h("p", { class: "crumbs" }, h("a", { href: "#/" }, "← I miei titoli")),
        h("header", { class: "page-head" },
          h("div", null, h("h1", null, inst.short || inst.name), h("p", { class: "tiny muted" }, (inst.type === "etf" ? "ETF" : "Azione") + " · " + inst.symbol)),
          refreshAction({ components: ["prices", "funds", "events", "news", "analysis"], instrument: id }, "Aggiorna", "ghost"))];
      out.push(trendCard(q, a));
      var ns = section("Notizie");
      if (news.length) {
        news.slice(0, 8).forEach(function (n) { ns.body.appendChild(newsCard(n, { forId: id })); });
        if (news.length > 8) ns.body.appendChild(more("Altre " + (news.length - 8) + " notizie", news.slice(8, 40).map(function (n) { return newsCard(n, { forId: id }); })));
      } else ns.body.appendChild(empty("Nessuna notizia negli ultimi giorni."));
      out.push(ns);
      out.push(forecastCard(rec, events));
      out.push(h("p", { class: "center small" }, h("a", { href: "#/modifica/" + encodeURIComponent(id) }, "Modifica o rimuovi")));
      return out;
    });
  }

  // ---------------------------------------------------------------- PAGINA 3: notizie
  function pageNews() {
    return Promise.all([load("news.json"), load("overview.json")]).then(function (r) {
      var nm = r[0] || { items: [] };
      var names = nameMap(r[1]);
      var ids = Object.keys(names);
      var current = Prefs.get("newsFilter", "");
      if (current && !names[current]) current = "";
      var listEl = h("div", { class: "card" });
      var chips = h("div", { class: "chips filter", role: "group", "aria-label": "Filtra per titolo" });
      var all = nm.items.slice().sort(byDate);
      function draw() {
        chips.textContent = "";
        [["", "Tutte"]].concat(ids.map(function (i) { return [i, names[i]]; })).forEach(function (c) {
          chips.appendChild(h("button", { type: "button", class: "chip" + (current === c[0] ? " on" : ""), "aria-pressed": current === c[0] ? "true" : "false",
            onclick: function () { current = c[0]; Prefs.set("newsFilter", current); draw(); } }, c[1]));
        });
        var opts = current ? { forId: current } : { names: names };
        var items = all.filter(function (n) { return !current || n.instrument_ids.indexOf(current) >= 0; });
        listEl.textContent = "";
        if (!items.length) listEl.appendChild(empty("Nessuna notizia negli ultimi giorni."));
        items.slice(0, 20).forEach(function (n) { listEl.appendChild(newsCard(n, opts)); });
        if (items.length > 20) listEl.appendChild(more("Altre notizie", items.slice(20, 80).map(function (n) { return newsCard(n, opts); })));
      }
      draw();
      return [h("header", { class: "page-head" }, h("h1", null, "Notizie"), refreshAction({ components: ["news"] }, "Aggiorna", "ghost")), chips, listEl];
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
        h("tr", null, h("th", null, "Giorno"), h("th", null, "Chiamate"), h("th", null, "Token"), h("th", null, "Modelli")),
        keys.map(function (k) {
          var d = days[k] || {};
          var models = Object.keys(d.by_model || {}).map(function (m) { return m + " ×" + d.by_model[m]; }).join(", ");
          return h("tr", null, h("td", null, k), h("td", null, String(d.calls || 0) + (d.failed ? " (" + d.failed + " fallite)" : "")),
            h("td", null, (d.total_tokens || 0).toLocaleString("it-IT")), h("td", null, models || "—"));
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
        h("li", null, "Analisi e previsione: Google Gemini, solo sui dati raccolti. Non è una fonte né un consiglio di investimento."))));

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
})();
