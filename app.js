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
    health: null,
    init: function () {
      return fetch("api/health", { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error();
        return r.json();
      }).then(function (j) {
        if (!j || j.mode !== "local") throw new Error();
        Backend.mode = "local"; Backend.health = j;
      }).catch(function () {
        var g = gh();
        Backend.mode = g.repo && g.token ? "github" : "static";
      });
    },
    canAct: function () { return Backend.mode === "local" || Backend.mode === "github"; },
    data: function (path) {
      var g = gh();
      var req;
      if (Backend.mode === "github") {
        req = fetch("https://api.github.com/repos/" + g.repo + "/contents/data/" + path + "?ref=" + encodeURIComponent(g.branch || "main") + "&t=" + Date.now(), {
          headers: { Authorization: "Bearer " + g.token, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" },
          cache: "no-store"
        });
      } else {
        req = fetch("data/" + path + "?t=" + Date.now(), { cache: "no-store" });
      }
      return req.then(function (r) {
        if (r.status === 404) return null;
        if (r.status === 401 || r.status === 403) throw new Error("Accesso a GitHub negato: controlla il token nelle Impostazioni.");
        if (!r.ok) throw new Error("Errore " + r.status + " nel caricamento di " + path);
        return r.json();
      });
    },
    // --- azioni ---
    post: function (path, body, method) {
      return fetch("api/" + path, { method: method || "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok && !j.error) j.error = "Errore " + r.status; return j; }); });
    },
    waitLocalJob: function (onTick) {
      return new Promise(function (resolve) {
        (function poll() {
          fetch("api/jobs", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
            if (j.running) { if (onTick) onTick(j.running); setTimeout(poll, 2500); } else resolve(j.last);
          }).catch(function () { setTimeout(poll, 4000); });
        })();
      });
    },
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
      if (Backend.mode === "local") {
        return Backend.post("refresh", opts).then(function (j) {
          if (!j.started) throw new Error(j.running ? "Un aggiornamento è già in corso." : (j.error || "Avvio non riuscito"));
          toast("Aggiornamento in corso…", "info", true);
          return Backend.waitLocalJob().then(function (last) { return last && last.result; });
        });
      }
      return Backend.dispatch("refresh.yml", {
        components: (opts.components || []).join(",") || "all", instrument: opts.instrument || "", force: opts.force ? "true" : "false"
      }).then(function (run) { return { status: run.conclusion === "success" ? "ok" : "error", run: run }; });
    },
    manage: function (action, payload) {
      if (Backend.mode === "local") {
        if (action === "search") return Backend.post("search", payload);
        if (action === "add") return Backend.post("instruments", payload);
        if (action === "update") return Backend.post("instruments/" + encodeURIComponent(payload.id), payload);
        if (action === "remove") return Backend.post("instruments/" + encodeURIComponent(payload.id), {}, "DELETE");
      }
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
  function sourceLine(item) {
    return h("div", { class: "meta" },
      h("span", { class: "src" }, item.source || "Fonte non indicata"),
      item.source_quality ? badge(item.source_quality, "q-" + item.source_quality.split("/")[0].replace(/\s/g, "")) : null,
      h("span", null, " · " + (item.published_at ? L.timeAgo(item.published_at) : "data di pubblicazione non disponibile")));
  }
  function newsCard(n, opts) {
    opts = opts || {};
    return h("article", { class: "news" },
      h("h3", null, link(n.url, n.title)),
      sourceLine(n),
      opts.showInstruments && n.instrument_names ? h("div", { class: "chips" }, n.instrument_names.map(function (x) { return h("span", { class: "chip" }, x); })) : null,
      n.category_labels && n.category_labels.length ? h("div", { class: "chips" }, n.category_labels.map(function (c) { return h("span", { class: "chip cat" }, c); })) : null,
      h("p", { class: "why" }, h("span", { class: "label" }, "Perché può contare: "), n.why_relevant || "—"),
      n.also_reported_by && n.also_reported_by.length ? h("p", { class: "muted small" }, "Ripresa anche da: " + n.also_reported_by.map(function (a) { return a.source; }).join(", ")) : null,
      n.via_redirect ? h("p", { class: "muted tiny" }, "Il link passa da Google News e porta all'articolo originale di " + (n.source || "editore") + ".") : null);
  }
  function eventRow(e) {
    return h("li", { class: "event" },
      h("div", { class: "ev-date" }, L.fmtDate(e.date), e.date_end ? " – " + L.fmtDate(e.date_end) : ""),
      h("div", null,
        h("strong", null, e.title), e.instrument_name ? h("span", { class: "muted" }, " · " + e.instrument_name) : null,
        h("div", { class: "small" }, badge(e.confirmed ? "data confermata" : "data non confermata", e.confirmed ? "ok" : "warn"), " ", e.certainty || ""),
        h("div", { class: "tiny muted" }, "Fonte: ", e.url ? link(e.url, e.source) : (e.source || "—"))));
  }
  function actionButton(label, fn, cls) {
    var b = h("button", { class: "btn " + (cls || ""), type: "button" }, label);
    b.addEventListener("click", function () {
      if (!Backend.canAct()) {
        toast(["Azione non disponibile: avvia il server locale oppure configura GitHub nelle ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."], "warn");
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
        toast(st === "ok" ? "Aggiornamento completato." : st === "partial" ? "Aggiornamento parziale: alcune fonti non hanno risposto (vedi Impostazioni)." : "Aggiornamento non riuscito: i dati precedenti sono stati conservati.", st === "ok" ? "ok" : "warn");
        route();
      });
    }, cls);
  }
  function statusStamp(status) {
    var c = (status && status.components) || {};
    function one(key, label) {
      var s = c[key];
      return h("span", { class: "stamp " + (s ? s.status : "none") }, label + ": " + (s && s.last_success ? L.timeAgo(s.last_success) : "mai"));
    }
    return h("div", { class: "stamps" }, one("prices", "Prezzi"), one("news", "Notizie"), one("analysis", "Analisi"));
  }
  function errorBox(e) {
    return h("div", { class: "card error-card" }, h("h2", null, "Dati non disponibili"), h("p", null, e.message || String(e)),
      h("p", { class: "small" }, Backend.mode === "static"
        ? ["Per leggere i dati dal repository privato inserisci il token GitHub nelle ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."]
        : ["Riprova più tardi o controlla le ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."]));
  }

  // ---------------------------------------------------------------- PAGINA 1: panoramica
  function pageOverview() {
    return Promise.all([load("overview.json"), load("status.json")]).then(function (r) {
      var ov = r[0], st = r[1];
      var out = [h("header", { class: "page-head" },
        h("div", null, h("h1", null, "Panoramica"), h("p", { class: "muted small" }, "Che cosa è importante sapere oggi sugli strumenti che segui."), statusStamp(st)),
        refreshAction({}, "Aggiorna tutto"))];
      if (!ov) { out.push(empty("Nessun dato ancora: premi «Aggiorna tutto» oppure aggiungi strumenti.")); return out; }
      if (ov.demo) out.push(demoBanner());
      if (ov.problems && ov.problems.length) {
        out.push(h("section", { class: "card warn-card" }, h("h2", null, "Problemi di aggiornamento"),
          h("ul", { class: "plain" }, ov.problems.map(function (p) { return h("li", null, p); }))));
      }
      var ctx = section("Contesto di mercato", "Solo variazioni di prezzo degli indici, calcolate dai dati del provider. Nessuna interpretazione.");
      if (ov.context && ov.context.length) {
        ctx.body.appendChild(h("div", { class: "ctx-grid" }, ov.context.map(function (c) {
          return h("div", { class: "ctx" + (c.stale ? " stale" : "") }, h("div", { class: "ctx-name" }, c.name),
            h("div", null, "1 seduta ", pctEl(c.daily && c.daily.pct)), h("div", null, "5 sedute ", pctEl(c.d5 && c.d5.pct)),
            h("div", { class: "tiny muted" }, "al " + L.fmtDate(c.as_of, false) + (c.stale ? " · non aggiornato" : "")));
        })));
        ctx.body.appendChild(h("p", { class: "tiny muted" }, "Fonte: " + (ov.context[0].provider || "provider prezzi") + ". Dati ritardati, non in tempo reale."));
      } else ctx.body.appendChild(empty("Dati di contesto non disponibili."));
      out.push(ctx);

      var hot = (ov.instruments || []).filter(function (i) { return i.flags.indexOf("Nuova notizia") >= 0 || i.flags.indexOf("Evento imminente") >= 0; });
      if (hot.length) {
        var hs = section("Da guardare", "Strumenti con una notizia potenzialmente importante o un evento nei prossimi 7 giorni.");
        hs.body.appendChild(h("div", { class: "chips" }, hot.map(function (i) {
          return h("a", { class: "chip big", href: "#/strumento/" + encodeURIComponent(i.id) }, i.name + " — " + i.flags.filter(function (f) { return f !== "Nessuna notizia recente"; }).join(", "));
        })));
        out.push(hs);
      }
      var ns = section("Notizie principali", "Ordinate per rilevanza stimata e freschezza. Apri il link per leggere la fonte originale.");
      if (ov.top_news && ov.top_news.length) ov.top_news.forEach(function (n) { ns.body.appendChild(newsCard(n, { showInstruments: true })); });
      else ns.body.appendChild(empty("Non sono state trovate notizie recenti sufficientemente rilevanti nelle fonti consultate."));
      out.push(ns);
      var es = section("Eventi nei prossimi 30 giorni");
      if (ov.upcoming_events && ov.upcoming_events.length) es.body.appendChild(h("ul", { class: "events" }, ov.upcoming_events.map(eventRow)));
      else es.body.appendChild(empty("Nessun evento verificato in calendario per i prossimi 30 giorni nelle fonti consultate."));
      out.push(es);
      out.push(h("p", { class: "tiny muted center" }, "Panoramica generata " + L.fmtDate(ov.generated_at) + " (ora italiana)."));
      return out;
    });
  }

  // ---------------------------------------------------------------- PAGINA 2: elenco strumenti
  function pageList() {
    return load("overview.json").then(function (ov) {
      var rows = (ov && ov.instruments) || [];
      var listEl = h("div", { class: "inst-list" });
      var filter = h("input", { type: "search", class: "input", placeholder: "Cerca per nome o simbolo…", "aria-label": "Cerca strumento" });
      function draw() {
        var q = filter.value.trim().toLowerCase();
        listEl.textContent = "";
        var shown = rows.filter(function (r) { return !q || r.name.toLowerCase().indexOf(q) >= 0 || r.symbol.toLowerCase().indexOf(q) >= 0; });
        if (!shown.length) listEl.appendChild(empty(rows.length ? "Nessuno strumento corrisponde alla ricerca." : "Non segui ancora nessuno strumento. Aggiungine uno."));
        shown.forEach(function (r) {
          listEl.appendChild(h("a", { class: "inst", href: "#/strumento/" + encodeURIComponent(r.id) },
            h("div", { class: "inst-main" },
              h("div", { class: "inst-name" }, r.name, r.demo ? badge("DEMO", "demo") : null, r.example ? badge("esempio", "muted-b") : null),
              h("div", { class: "muted small" }, r.symbol + " · " + (r.type === "etf" ? "ETF" : "Azione")),
              h("div", { class: "chips" }, r.flags.map(function (f) { return h("span", { class: "chip flag" }, f); }))),
            h("div", { class: "inst-px" },
              h("div", { class: "px" }, L.fmtPrice(r.price, r.currency)),
              pctEl(r.daily && r.daily.pct),
              h("div", { class: "tiny muted" }, r.price == null ? "non disponibile" : (r.price_kind === "intraday" ? "in seduta, ritardato" : "chiusura " + L.fmtDate(r.as_of, false))))));
        });
      }
      filter.addEventListener("input", draw);
      draw();
      return [h("header", { class: "page-head" }, h("div", null, h("h1", null, "I miei strumenti"), h("p", { class: "muted small" }, rows.length + " strumenti seguiti. Nessun dato patrimoniale viene salvato.")),
        h("a", { class: "btn primary", href: "#/aggiungi" }, "+ Aggiungi")), ov && ov.demo ? demoBanner() : null, filter, listEl];
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
      if (!Backend.canAct()) { msg.textContent = "Per salvare serve il server locale o la configurazione GitHub (Impostazioni)."; return; }
      btn.disabled = true;
      msg.textContent = Backend.mode === "github" ? "Invio a GitHub: il salvataggio e il primo aggiornamento richiedono 1-3 minuti…" : "Salvataggio e primo aggiornamento dei dati…";
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
      if (!Backend.canAct()) { results.textContent = ""; results.appendChild(empty("La ricerca richiede il server locale o la configurazione GitHub. Puoi comunque inserire i dati a mano qui sotto.")); return; }
      btn.disabled = true;
      results.textContent = "";
      results.appendChild(h("p", { class: "muted" }, Backend.mode === "github" ? "Ricerca tramite GitHub (circa 30-60 secondi)…" : "Ricerca in corso…"));
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
        if (!confirm("Rimuovere " + inst.name + "? Verranno eliminati anche i suoi dati e lo storico delle analisi.")) return;
        return Backend.manage("remove", { id: id }).then(function (res) {
          if (!res.ok) throw new Error(res.error || "Rimozione non riuscita");
          clearCache(); toast("Rimosso.", "ok"); location.hash = "#/strumenti";
        });
      }, "danger");
      return [h("p", null, h("a", { href: "#/strumento/" + encodeURIComponent(id) }, "← Torna alla scheda")), s, h("div", { class: "card" }, rm)];
    });
  }

  // ---------------------------------------------------------------- PAGINA 3: scheda
  function chart(bars, currency) {
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
      var W = 600, H = 180, P = 6;
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
      svgBox.appendChild(h("div", { class: "chart-foot tiny muted" },
        h("span", null, L.fmtDate(pts[0].date) + ": " + L.fmtPrice(pts[0].close, currency)),
        h("span", null, "min " + L.fmtPrice(min) + " · max " + L.fmtPrice(max)),
        h("span", null, L.fmtDate(pts[pts.length - 1].date) + ": " + L.fmtPrice(pts[pts.length - 1].close, currency))));
    }
    draw();
    holder.appendChild(btns);
    holder.appendChild(svgBox);
    holder.appendChild(h("p", { class: "tiny muted" }, "Chiusure giornaliere. Grafico indicativo, secondario rispetto a notizie e spiegazioni."));
    return holder;
  }

  function refsEl(refs, registry) {
    if (!refs || !refs.length) return null;
    return h("span", { class: "refs" }, refs.map(function (r) {
      var s = registry[r];
      if (!s) return null;
      var label = "[" + r + "]";
      return s.url ? h("a", { href: s.url, title: (s.title || "") + " — " + (s.source || "") }, label) : h("span", { title: s.title || "" }, label);
    }));
  }

  function marketSection(inst, q) {
    var s = section("A · Dati di mercato");
    if (!q) { s.body.appendChild(empty("Prezzi non disponibili per questo strumento: il provider non ha restituito dati (simbolo non coperto o errore). Nessun valore viene stimato.")); return s; }
    var m = q.metrics || {};
    if (q.demo) s.body.appendChild(demoBanner());
    if (q.stale) s.body.appendChild(h("div", { class: "banner warn" }, "Dato non aggiornato: l'ultimo prezzo disponibile è del " + L.fmtDate(q.last_bar_date) + "."));
    if (q.last_error) s.body.appendChild(h("div", { class: "banner warn" }, "L'ultimo tentativo di aggiornamento (" + L.fmtDate(q.last_error_at) + ") è fallito: mostro l'ultimo dato valido. Dettaglio: " + q.last_error));
    s.body.appendChild(h("div", { class: "price-hero" },
      h("div", { class: "px-big" }, L.fmtPrice(q.price, q.currency)),
      m.daily ? h("div", { class: "pct-big " + L.trend(m.daily.pct) }, L.fmtPct(m.daily.pct) + " (" + L.fmtAbs(m.daily.abs) + ")") : null,
      h("div", { class: "small" }, q.price_kind_label),
      h("div", { class: "tiny muted" }, (q.session && q.session.label) || "", q.exchange_full ? " · " + q.exchange_full : "")));
    function row(label, c, sub) {
      return h("tr", null, h("th", null, label), h("td", null, c ? pctEl(c.pct) : "—"),
        h("td", { class: "tiny muted" }, c ? "dal " + L.fmtDate(c.from_date) + " (" + L.fmtPrice(c.from_price) + ") al " + L.fmtDate(c.to_date) : (sub || "non disponibile")));
    }
    var t = h("table", { class: "kv" },
      row("1 seduta", m.daily), row("5 sedute", m.d5), row("1 mese", m.m1), row("Da inizio anno", m.ytd),
      m.w52 ? h("tr", null, h("th", null, "52 settimane"), h("td", null, "max " + L.fmtPrice(m.w52.high) + " · min " + L.fmtPrice(m.w52.low)),
        h("td", { class: "tiny muted" }, "max il " + L.fmtDate(m.w52.high_date) + ", min il " + L.fmtDate(m.w52.low_date) + (m.w52.complete ? "" : " (storico parziale)"))) : null,
      m.volume ? h("tr", null, h("th", null, "Volume"), h("td", null, String(m.volume.ratio).replace(".", ",") + "× media"), h("td", { class: "tiny muted" }, m.volume.criterion)) : null);
    s.body.appendChild(t);
    (m.notes || []).forEach(function (n) { s.body.appendChild(h("p", { class: "tiny muted" }, n)); });
    var det = h("details", { class: "chart-details" }, h("summary", null, "Mostra grafico"), chart(q.bars || [], q.currency));
    if (window.innerWidth >= 700) det.open = true;
    s.body.appendChild(det);
    s.body.appendChild(h("p", { class: "tiny muted" }, "Fonte: ", q.provider_url ? link(q.provider_url, q.provider_label) : q.provider_label,
      " · aggiornato " + L.fmtDate(q.fetched_at) + ". " + (q.disclaimer || "") + " Criterio variazioni: chiusure giornaliere confrontate alle date indicate."));
    return s;
  }

  function etfSection(inst, fund) {
    var s = section("Scheda ETF", "Dati da fonti non ufficiali: verifica sempre KID e factsheet dell'emittente.");
    var kv = h("table", { class: "kv" },
      h("tr", null, h("th", null, "Emittente"), h("td", { colspan: "2" }, inst.issuer || (fund && fund.fund_family) || "non disponibile")),
      h("tr", null, h("th", null, "Indice replicato"), h("td", { colspan: "2" }, inst.index_name || "non verificato (aggiungilo nella modifica dello strumento)")),
      h("tr", null, h("th", null, "ISIN"), h("td", { colspan: "2" }, inst.isin || "—")),
      h("tr", null, h("th", null, "Costi correnti (TER)"), h("td", { colspan: "2" }, fund && fund.ter_pct != null ? String(fund.ter_pct).replace(".", ",") + "%" : "non disponibile dal provider")),
      h("tr", null, h("th", null, "Categoria"), h("td", { colspan: "2" }, (fund && fund.category) || "non disponibile")),
      fund && fund.asset_classes ? h("tr", null, h("th", null, "Tipologia"), h("td", { colspan: "2" }, Object.keys(fund.asset_classes).filter(function (k) { return fund.asset_classes[k] >= 1; }).map(function (k) {
        return ({ stockPosition: "azioni", bondPosition: "obbligazioni", cashPosition: "liquidità", otherPosition: "altro", preferredPosition: "privilegiate", convertiblePosition: "convertibili" }[k] || k) + " " + String(fund.asset_classes[k]).replace(".", ",") + "%";
      }).join(" · ") || "non disponibile")) : null);
    s.body.appendChild(kv);
    if (fund && fund.top_holdings && fund.top_holdings.length) {
      s.body.appendChild(h("h3", null, "Principali posizioni" + (fund.top10_weight_pct ? " (prime 10 = " + String(fund.top10_weight_pct).replace(".", ",") + "% del fondo)" : "")));
      s.body.appendChild(h("ol", { class: "holdings" }, fund.top_holdings.map(function (x) { return h("li", null, x.name + " ", h("span", { class: "muted" }, String(x.weight_pct).replace(".", ",") + "%")); })));
    } else s.body.appendChild(empty("Composizione non disponibile dal provider."));
    if (fund && fund.sectors && fund.sectors.length) {
      var SECT = { technology: "Tecnologia", financial_services: "Finanza", healthcare: "Salute", consumer_cyclical: "Consumi ciclici", industrials: "Industria", communication_services: "Comunicazioni", consumer_defensive: "Consumi difensivi", energy: "Energia", basic_materials: "Materie prime", utilities: "Servizi pubblici", realestate: "Immobiliare" };
      s.body.appendChild(h("h3", null, "Settori"));
      s.body.appendChild(h("div", { class: "bars" }, fund.sectors.slice(0, 8).map(function (x) {
        return h("div", { class: "barrow" }, h("span", null, SECT[x.name] || x.name), h("span", { class: "bar" }, h("i", { style: "width:" + Math.min(100, x.weight_pct) + "%" })), h("span", { class: "muted" }, String(x.weight_pct).replace(".", ",") + "%"));
      })));
    }
    s.body.appendChild(h("p", { class: "tiny muted" }, "Aree geografiche e copertura valutaria non sono fornite dal provider gratuito. Fonte: ",
      fund && fund.url ? link(fund.url, fund.source) : "—", fund ? " · " + L.fmtDate(fund.retrieved_at) : ""));
    return s;
  }

  function analysisSections(inst, rec, news, events, status, newsMeta) {
    var out = [];
    if (!rec) {
      out.push(h("section", { class: "card" }, h("h2", null, "Analisi"), empty("Analisi non ancora disponibile. Premi «Rigenera analisi» per crearla.")));
      return out;
    }
    var a = rec.analysis;
    var reg = {};
    (rec.sources || []).forEach(function (s) { reg[s.ref] = s; });
    var who = rec.kind === "ai" ? "Analisi AI (" + rec.provider + (rec.model ? ", " + rec.model : "") + ")" : "Sintesi automatica senza AI";
    var stamp = h("p", { class: "tiny muted" }, who + " · elaborata " + L.fmtDate(rec.generated_at) + " · prezzi al " + L.fmtDate(rec.prices_as_of, false));

    // B
    var b = section("B · In breve — cosa devo sapere?");
    if (rec.demo) b.body.appendChild(demoBanner());
    if (rec.last_failed_attempt) b.body.appendChild(h("div", { class: "banner warn" }, "L'ultimo tentativo di nuova analisi (" + L.fmtDate(rec.last_failed_attempt.at) + ") è fallito; resta valida questa del " + L.fmtDate(rec.generated_at) + ". Motivo: " + rec.last_failed_attempt.error));
    b.body.appendChild(h("p", { class: "lead" }, a.in_breve || "Evidenze insufficienti per una sintesi."));
    b.body.appendChild(stamp);
    out.push(b);

    // C
    var c = section("C · Che cosa è successo?", "Ultimi " + (rec.news_window_days || 7) + " giorni.");
    if (a.cosa_e_successo && a.cosa_e_successo.length) {
      a.cosa_e_successo.forEach(function (e) {
        var first = reg[e.fonti[0]] || {};
        c.body.appendChild(h("article", { class: "news" },
          h("h3", null, first.url ? link(first.url, e.titolo || first.title) : (e.titolo || first.title)),
          h("div", { class: "meta" }, h("span", { class: "src" }, first.source || ""), h("span", null, " · pubblicata " + (first.published_at ? L.fmtDate(first.published_at) : "data non disponibile")), refsEl(e.fonti, reg)),
          e.sintesi ? h("p", null, e.sintesi) : null,
          e.rilevanza ? h("p", { class: "why" }, h("span", { class: "label" }, "Perché conta: "), e.rilevanza) : null,
          e.impatto_osservato ? h("p", { class: "small" }, h("span", { class: "label" }, "Prezzo osservato: "), e.impatto_osservato) : null));
      });
    } else {
      var checked = (rec.sources_checked || []).join(", ") || "fonti configurate";
      c.body.appendChild(empty("Non sono state trovate notizie recenti sufficientemente rilevanti nelle fonti consultate (" + checked + "; ultimi " + (rec.news_window_days || 7) + " giorni)."));
    }
    if (news.length) {
      c.body.appendChild(h("details", null, h("summary", null, "Tutte le notizie raccolte (" + news.length + ")"),
        news.map(function (n) { return newsCard(n); })));
    }
    out.push(c);

    // D
    var pm = a.perche_mosso || {};
    var d = section("D · Perché il prezzo potrebbe essersi mosso?");
    d.body.appendChild(h("h3", null, badge("FATTO", "fact"), " Fatti confermati"));
    d.body.appendChild(pm.fatti && pm.fatti.length ? h("ul", { class: "plain" }, pm.fatti.map(function (f) { return h("li", null, f.testo, " ", refsEl(f.fonti, reg)); })) : empty("Nessun fatto verificabile disponibile."));
    d.body.appendChild(h("h3", null, badge("INTERPRETAZIONE", "interp"), " Possibili spiegazioni"));
    d.body.appendChild(pm.possibili_spiegazioni && pm.possibili_spiegazioni.length ? h("ul", { class: "plain" }, pm.possibili_spiegazioni.map(function (f) { return h("li", null, f.testo, " ", refsEl(f.fonti, reg)); })) : empty("Nessuna spiegazione supportata da evidenze."));
    d.body.appendChild(h("h3", null, badge("DA VERIFICARE", "warn"), " Fattori non verificati o informazioni mancanti"));
    d.body.appendChild(pm.non_verificati && pm.non_verificati.length ? h("ul", { class: "plain" }, pm.non_verificati.map(function (t) { return h("li", null, t); })) : empty("—"));
    if (!pm.causa_determinabile) d.body.appendChild(h("p", { class: "small" }, "La causa del movimento non è determinabile con le informazioni disponibili."));
    out.push(d);

    // E
    var p = a.prospettive || {};
    var e = section("E · Prospettive future", "Analisi speculativa: scenari ipotetici, non previsioni né raccomandazioni.");
    e.body.appendChild(h("div", { class: "outlook o-" + (p.valutazione || "non_valutabile") },
      h("div", { class: "outlook-label" }, p.valutazione_label || "Prospettive non valutabili"),
      h("div", { class: "small" }, "Orizzonte: " + (p.orizzonte || "—")),
      h("div", { class: "small" }, "Qualità delle evidenze: ", h("strong", null, p.qualita_evidenze || "bassa"), p.motivazione_qualita ? " — " + p.motivazione_qualita : ""),
      h("div", { class: "tiny muted" }, "La qualità delle evidenze misura quanto sono solide le fonti, non la probabilità che uno scenario si avveri.")));
    if (p.spiegazione) e.body.appendChild(h("p", null, p.spiegazione));
    var sc = p.scenari || {};
    var LABELS = { rialzista: "Scenario rialzista", centrale: "Scenario centrale", ribassista: "Scenario ribassista" };
    var FIELDS = { fattori: "Cosa potrebbe favorirlo", rischi: "Rischi", segnali: "Segnali da monitorare", invalidazione: "Cosa lo invaliderebbe", eventi_spostamento: "Eventi che potrebbero spostarlo" };
    var any = false;
    ["rialzista", "centrale", "ribassista"].forEach(function (k) {
      var s = sc[k];
      if (!s) return;
      any = true;
      e.body.appendChild(h("div", { class: "scenario s-" + k },
        h("h3", null, badge("SCENARIO IPOTETICO", "scen"), " " + LABELS[k], " ", refsEl(s.fonti, reg)),
        s.descrizione ? h("p", null, s.descrizione) : null,
        Object.keys(FIELDS).filter(function (f) { return s[f] && s[f].length; }).map(function (f) {
          return h("div", null, h("div", { class: "label small" }, FIELDS[f]), h("ul", { class: "plain small" }, s[f].map(function (t) { return h("li", null, t); })));
        })));
    });
    if (!any) e.body.appendChild(empty(rec.kind === "ai" ? "Le informazioni disponibili non bastano per costruire scenari in modo responsabile." : "Scenari non disponibili: richiedono un modello AI. Premi «Rigenera analisi» quando un modello è configurato."));
    out.push(e);

    // F
    var f = section("F · Cosa tenere d'occhio");
    var watch = (a.da_monitorare || []);
    var list = h("ul", { class: "events" });
    watch.forEach(function (w) {
      list.appendChild(h("li", { class: "event" }, h("div", { class: "ev-date" }, w.data ? L.fmtDate(w.data) : "data n.d."),
        h("div", null, h("strong", null, w.evento), " ", refsEl(w.fonti, reg), w.perche ? h("div", { class: "small" }, w.perche) : null,
          h("div", { class: "small" }, badge(w.data ? (w.data_confermata ? "data confermata" : "data non confermata") : "senza data verificata", w.data_confermata ? "ok" : "warn")))));
    });
    events.forEach(function (ev) {
      if (watch.some(function (w) { return w.data === ev.date && w.evento && ev.title && w.evento.toLowerCase().indexOf(ev.title.toLowerCase().slice(0, 12)) >= 0; })) return;
      list.appendChild(eventRow(ev));
    });
    f.body.appendChild(list.childNodes.length ? list : empty("Nessun evento futuro verificato nelle fonti consultate."));
    out.push(f);
    out.push({ late: true, rec: rec, reg: reg, status: status, newsMeta: newsMeta });
    return out;
  }

  function sourcesSection(inst, rec, q, status, newsMeta, history) {
    var g = section("G · Fonti e aggiornamento");
    if (rec) {
      g.body.appendChild(h("ol", { class: "sources" }, (rec.sources || []).map(function (s) {
        return h("li", null, h("span", { class: "ref" }, s.ref), " ", s.url ? link(s.url, s.title) : s.title,
          h("span", { class: "muted small" }, " — " + (s.source || "") + (s.published_at ? ", " + L.fmtDate(s.published_at) : "")));
      })));
      if (rec.warnings && rec.warnings.length) {
        g.body.appendChild(h("details", null, h("summary", null, "Controlli automatici sull'analisi (" + rec.warnings.length + ")"),
          h("ul", { class: "plain small" }, rec.warnings.map(function (w) { return h("li", null, w); }))));
      }
      if (rec.analysis && rec.analysis.limiti && rec.analysis.limiti.length) {
        g.body.appendChild(h("h3", null, "Limiti dell'analisi"));
        g.body.appendChild(h("ul", { class: "plain small" }, rec.analysis.limiti.map(function (t) { return h("li", null, t); })));
      }
    }
    var comps = (status && status.components) || {};
    g.body.appendChild(h("table", { class: "kv small" },
      h("tr", null, h("th", null, "Analisi elaborata"), h("td", null, rec ? L.fmtDate(rec.generated_at) : "—")),
      h("tr", null, h("th", null, "Prezzi aggiornati"), h("td", null, q ? L.fmtDate(q.fetched_at) + " (dato del " + L.fmtDate(q.as_of) + ")" : "—")),
      h("tr", null, h("th", null, "Notizie raccolte"), h("td", null, newsMeta && newsMeta.updated_at ? L.fmtDate(newsMeta.updated_at) : "—")),
      h("tr", null, h("th", null, "Ultimo errore"), h("td", null, ["prices", "news", "analysis"].map(function (k) { return comps[k] && comps[k].errors && comps[k].errors.length ? k + ": " + comps[k].errors.length + " errori" : null; }).filter(Boolean).join(" · ") || "nessuno"))));
    if (newsMeta && newsMeta.sources_checked) {
      g.body.appendChild(h("details", null, h("summary", null, "Fonti di notizie consultate"),
        h("ul", { class: "plain small" }, newsMeta.sources_checked.map(function (s) { return h("li", null, (s.ok ? "✓ " : "✗ ") + s.name + (s.ok ? " (" + s.items + " elementi)" : " — non raggiungibile: " + (s.error || ""))); }))));
    }
    if (history && history.items && history.items.length > 1) {
      var hist = h("details", null, h("summary", null, "Storico analisi (" + history.items.length + ")"));
      var view = h("div");
      hist.appendChild(h("ul", { class: "plain small" }, history.items.map(function (it) {
        return h("li", null, h("button", { type: "button", class: "linklike", onclick: function () {
          load("analysis/" + inst.id + "/" + it.file).then(function (old) {
            view.textContent = "";
            view.appendChild(h("div", { class: "history-view" }, h("strong", null, "Analisi del " + L.fmtDate(old.generated_at) + " — " + old.analysis.prospettive.valutazione_label),
              h("p", null, old.analysis.in_breve), h("p", { class: "tiny muted" }, "Prezzi al " + L.fmtDate(old.prices_as_of, false) + " · " + (old.kind === "ai" ? old.provider : "senza AI"))));
          });
        } }, L.fmtDate(it.generated_at)), " — " + it.valutazione + " (" + (it.kind === "ai" ? (it.model || it.provider) : "senza AI") + ")");
      })));
      hist.appendChild(view);
      g.body.appendChild(hist);
    }
    return g;
  }

  function pageDetail(id) {
    var base = "analysis/" + id + "/";
    return Promise.all([load("instruments.json"), load("quotes/" + id + ".json"), load(base + "latest.json"), load("news.json"),
      load("events.json"), load("status.json"), load(base + "history.json")]).then(function (r) {
      var inst = ((r[0] && r[0].instruments) || []).filter(function (i) { return i.id === id; })[0];
      if (!inst) return [empty("Strumento non trovato."), h("a", { href: "#/strumenti" }, "← Torna all'elenco")];
      var q = r[1], rec = r[2], newsMeta = r[3] || {}, evs = (r[4] && r[4].items) || [], status = r[5], history = r[6];
      var news = (newsMeta.items || []).filter(function (n) { return n.instrument_ids.indexOf(id) >= 0; });
      var today = new Date().toISOString().slice(0, 10);
      var events = evs.filter(function (e) { return e.instrument_id === id && e.date >= today; });
      var fundP = inst.type === "etf" ? load("funds/" + id + ".json").catch(function () { return null; }) : Promise.resolve(null);
      return fundP.then(function (fund) {
        var out = [h("p", { class: "crumbs" }, h("a", { href: "#/strumenti" }, "← I miei strumenti")),
          h("header", { class: "page-head detail" },
            h("div", null, h("h1", null, inst.name), h("p", { class: "muted small" }, [inst.symbol, inst.type === "etf" ? "ETF" : "Azione", inst.isin, inst.exchange, inst.currency].filter(Boolean).join(" · "))),
            h("div", { class: "actions" },
              refreshAction({ components: ["prices", "news", "events"], instrument: id, force: true }, "Aggiorna dati", "ghost"),
              refreshAction({ components: ["analysis"], instrument: id, force: true }, "Rigenera analisi", "primary"),
              h("a", { class: "btn ghost", href: "#/modifica/" + encodeURIComponent(id) }, "Modifica")))];
        out.push(marketSection(inst, q));
        var parts = analysisSections(inst, rec, news, events, status, newsMeta);
        parts.forEach(function (p) { if (!p.late) out.push(p); });
        if (inst.type === "etf") out.splice(3, 0, etfSection(inst, fund));
        out.push(sourcesSection(inst, rec, q, status, newsMeta, history));
        out.push(disclaimer());
        return out;
      });
    });
  }

  // ---------------------------------------------------------------- PAGINA: eventi e notizie
  function pageNews() {
    return Promise.all([load("news.json"), load("events.json"), load("instruments.json")]).then(function (r) {
      var nm = r[0] || { items: [] }, ev = r[1] || { items: [] }, insts = (r[2] && r[2].instruments) || [];
      var names = {};
      insts.forEach(function (i) { names[i.id] = i.name; });
      var current = Prefs.get("newsFilter", "");
      if (current && !names[current]) current = "";
      var listEl = h("div");
      var chips = h("div", { class: "chips filter" });
      function draw() {
        chips.textContent = "";
        [["", "Tutti"]].concat(insts.map(function (i) { return [i.id, i.name]; })).forEach(function (c) {
          chips.appendChild(h("button", { type: "button", class: "chip" + (current === c[0] ? " on" : ""), onclick: function () { current = c[0]; Prefs.set("newsFilter", current); draw(); } }, c[1]));
        });
        listEl.textContent = "";
        var items = nm.items.filter(function (n) { return !current || n.instrument_ids.indexOf(current) >= 0; });
        if (!items.length) listEl.appendChild(empty("Non sono state trovate notizie recenti sufficientemente rilevanti nelle fonti consultate."));
        items.slice(0, 60).forEach(function (n) { listEl.appendChild(newsCard(Object.assign({}, n, { instrument_names: n.instrument_ids.map(function (i) { return names[i] || i; }) }), { showInstruments: true })); });
      }
      draw();
      var today = new Date().toISOString().slice(0, 10);
      var es = section("Calendario eventi");
      var upcoming = ev.items.filter(function (e) { return e.date >= today; }).map(function (e) { return Object.assign({}, e, { instrument_name: names[e.instrument_id] || "Generale" }); });
      es.body.appendChild(upcoming.length ? h("ul", { class: "events" }, upcoming.map(eventRow)) : empty("Nessun evento futuro verificato nelle fonti consultate."));
      (ev.notes || []).forEach(function (n) { es.body.appendChild(h("p", { class: "tiny muted" }, n)); });
      var ns = section("Notizie", "Raccolte il " + L.fmtDate(nm.updated_at) + " · finestra " + (nm.window_days || 7) + " giorni · deduplicate per link e titolo.");
      ns.body.appendChild(chips);
      ns.body.appendChild(listEl);
      (nm.notes || []).forEach(function (n) { ns.body.appendChild(h("p", { class: "tiny muted" }, n)); });
      return [h("header", { class: "page-head" }, h("div", null, h("h1", null, "Eventi e notizie")), refreshAction({ components: ["news", "events"] }, "Aggiorna notizie")), es, ns];
    });
  }

  // ---------------------------------------------------------------- PAGINA 4: impostazioni
  function pageSettings() {
    return load("status.json").catch(function () { return null; }).then(function (status) {
      var out = [h("header", { class: "page-head" }, h("div", null, h("h1", null, "Impostazioni e fonti")))];
      var modeTxt = { local: "Server locale attivo: le azioni vengono eseguite su questo computer.", github: "Modalità remota: i dati sono letti da GitHub e le azioni avviano i workflow GitHub Actions (funziona anche a PC spento).", static: "Sola lettura: nessun server locale e nessun collegamento GitHub configurato." }[Backend.mode];
      var ms = section("Modalità di funzionamento");
      ms.body.appendChild(h("p", null, modeTxt));
      if (Backend.health) ms.body.appendChild(h("p", { class: "small muted" }, "AI locale: " + (Backend.health.ai_provider === "none" ? "nessun modello disponibile (sintesi senza AI)" : Backend.health.ai_provider + " " + (Backend.health.ai_model || "")) + " · prezzi: " + Backend.health.price_provider));
      out.push(ms);

      var st = section("Stato degli aggiornamenti");
      var comps = (status && status.components) || {};
      var NAMES = { prices: "Prezzi", events: "Eventi", funds: "Dati ETF", news: "Notizie", analysis: "Analisi" };
      st.body.appendChild(h("table", { class: "kv small" }, Object.keys(NAMES).map(function (k) {
        var c = comps[k];
        return h("tr", null, h("th", null, NAMES[k]),
          h("td", null, c ? badge(c.status, "st-" + c.status) : "—"),
          h("td", null, c ? (c.message || "") + " · ultimo successo " + (c.last_success ? L.fmtDate(c.last_success) : "mai") : "mai eseguito",
            c && c.errors && c.errors.length ? h("details", null, h("summary", null, c.errors.length + " errori"), h("ul", { class: "plain tiny" }, c.errors.map(function (e) { return h("li", null, (e.symbol || e.id || "") + ": " + e.error); }))) : null));
      })));
      out.push(st);

      var g = gh();
      var gs = section("Collegamento GitHub (uso da telefono a PC spento)", "Il token resta solo in questo browser. Crea un token «fine-grained» limitato a questo repository con permessi Contents: read e Actions: read and write. Non usare mai la password di GitHub.");
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

      out.push(csvSection());

      var info = section("Fonti e limiti");
      info.body.appendChild(h("ul", { class: "plain small" },
        h("li", null, "Prezzi: Yahoo Finance tramite la libreria non ufficiale yfinance. Dati ritardati, mai tempo reale; possibili buchi o errori."),
        h("li", null, "Notizie: feed RSS di Google News (per strumento) e feed configurati in config/sources.json. Nessuno scraping, nessun aggiramento di paywall."),
        h("li", null, "Eventi: date indicate dal provider (non verificate su fonti ufficiali) ed eventi inseriti a mano con fonte."),
        h("li", null, "Analisi: modello AI locale (Ollama) o API cloud configurata (es. Google Gemini, livello gratuito). L'output dell'AI non è una fonte: ogni affermazione rimanda alle fonti raccolte."),
        h("li", null, "Aggiornamenti automatici: in cloud tramite GitHub Actions (anche a PC spento); in locale solo mentre il programma è in esecuzione.")));
      out.push(info);
      out.push(disclaimer());
      return out;
    });
  }

  function csvSection() {
    var s = section("Importa da CSV", "Anteprima e conferma prima del salvataggio. Vengono lette solo le colonne che mappi; quantità e importi sono ignorati e non salvati. Il simbolo deve essere quello di Yahoo Finance (es. VWCE.DE).");
    var file = h("input", { type: "file", accept: ".csv,text/csv", class: "input" });
    var mapBox = h("div");
    var prev = h("div");
    var rows = [];
    file.addEventListener("change", function () {
      var fl = file.files[0];
      if (!fl) return;
      if (fl.size > 512 * 1024) { mapBox.textContent = "File troppo grande (max 512 KB)."; return; }
      var reader = new FileReader();
      reader.onload = function () {
        rows = L.parseCsv(reader.result);
        mapBox.textContent = ""; prev.textContent = "";
        if (rows.length < 2) { mapBox.appendChild(empty("Il file non contiene righe di dati.")); return; }
        var header = rows[0];
        var sel = {};
        var GUESS = { symbol: /^(symbol|ticker|simbolo)$/i, isin: /^isin$/i, name: /^(name|nome|strumento|titolo|instrument|descrizione)$/i, exchange: /^(exchange|borsa|mercato)$/i, currency: /^(currency|valuta)$/i, type: /^(type|tipo)$/i };
        var LBL = { symbol: "Simbolo *", isin: "ISIN", name: "Nome", exchange: "Borsa", currency: "Valuta", type: "Tipo" };
        Object.keys(LBL).forEach(function (f) {
          var guess = header.findIndex(function (c) { return GUESS[f].test(c.trim()); });
          sel[f] = h("select", { class: "input" }, h("option", { value: "" }, "— non usare —"), header.map(function (c, i) { return h("option", { value: String(i), selected: i === guess }, c || "colonna " + (i + 1)); }));
          mapBox.appendChild(h("label", { class: "field inline" }, h("span", null, LBL[f]), sel[f]));
        });
        var defType = h("select", { class: "input" }, h("option", { value: "" }, "—"), h("option", { value: "stock" }, "Azione"), h("option", { value: "etf" }, "ETF"));
        mapBox.appendChild(h("label", { class: "field inline" }, h("span", null, "Tipo se assente"), defType));
        mapBox.appendChild(h("button", { class: "btn", type: "button", onclick: function () {
          var mapping = {};
          Object.keys(sel).forEach(function (f) { if (sel[f].value !== "") mapping[f] = sel[f].value; });
          var mapped = L.mapCsvRows(rows, mapping, defType.value);
          prev.textContent = "";
          var ok = mapped.filter(function (m) { return !m.errors.length; });
          prev.appendChild(h("table", { class: "kv small" }, h("tr", null, h("th", null, "Riga"), h("th", null, "Simbolo"), h("th", null, "Nome"), h("th", null, "ISIN"), h("th", null, "Esito")),
            mapped.map(function (m) { return h("tr", null, h("td", null, String(m.line)), h("td", null, m.instrument.symbol), h("td", null, m.instrument.name), h("td", null, m.instrument.isin || ""), h("td", null, m.errors.length ? badge(m.errors.join(", "), "warn") : badge("ok", "ok"))); })));
          if (ok.length) prev.appendChild(actionButton("Conferma importazione di " + ok.length + " strumenti", function () {
            return Backend.manage("add", { instruments: ok.map(function (m) { return m.instrument; }) }).then(function (res) {
              clearCache();
              toast((res.added ? res.added.length : 0) + " importati" + (res.errors && res.errors.length ? ", " + res.errors.length + " scartati (" + res.errors.map(function (e) { return e.symbol + ": " + e.error; }).join("; ") + ")" : "") + ".", res.ok ? "ok" : "warn");
            });
          }, "primary"));
        } }, "Mostra anteprima"));
      };
      reader.readAsText(fl);
    });
    s.body.appendChild(file);
    s.body.appendChild(mapBox);
    s.body.appendChild(prev);
    return s;
  }

  function disclaimer() {
    return h("p", { class: "disclaimer" }, "Strumento informativo personale. Non è consulenza finanziaria né una raccomandazione di acquisto o vendita. Prezzi ritardati e fonti gratuite possono contenere errori: verifica sempre sulle fonti originali.");
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
    [/^#?\/?$/, pageOverview, "overview"],
    [/^#\/strumenti$/, pageList, "list"],
    [/^#\/aggiungi$/, pageAdd, "list"],
    [/^#\/modifica\/(.+)$/, pageEdit, "list"],
    [/^#\/strumento\/(.+)$/, pageDetail, "list"],
    [/^#\/notizie$/, pageNews, "news"],
    [/^#\/impostazioni$/, pageSettings, "settings"]
  ];
  function route() {
    var hash = location.hash || "#/";
    var match = null, fn = pageOverview, tab = "overview";
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
