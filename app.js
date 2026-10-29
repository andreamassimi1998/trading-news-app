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
  function pctNum(v) { return String(v).replace(".", ","); }
  function eventIds(e) { return e.instrument_ids || (e.instrument_id ? [e.instrument_id] : []); }
  function namesOf(ids, names, max) {
    var who = ids.map(function (i) { return names[i]; }).filter(Boolean);
    max = max || 2;
    return who.length > max ? who.slice(0, max).join(", ") + " +" + (who.length - max) : who.join(", ");
  }
  /** Notizia in due righe: titolo e "fonte · quando · tipo". opts.forId = scheda di uno strumento; opts.names = elenco generale. */
  function newsCard(n, opts) {
    opts = opts || {};
    var bits = [n.source || "Fonte non indicata", n.published_at ? L.timeAgo(n.published_at) : null, (n.category_labels || [])[0]];
    var via = n.via_holdings || {};
    if (opts.names) {  // prima gli strumenti citati direttamente, poi gli ETF che li contengono
      var ids = n.instrument_ids || [];
      bits.push(namesOf(ids.filter(function (i) { return !via[i]; }).concat(ids.filter(function (i) { return via[i]; })), opts.names, 1));
    }
    var viaTxt = opts.forId ? via[opts.forId] : null;
    return h("article", { class: "news" },
      h("h3", null, link(n.url, n.title)),
      h("div", { class: "meta" }, bits.filter(Boolean).join(" · ")),
      viaTxt ? h("div", { class: "via" }, "Tramite " + viaTxt) : null);
  }
  function eventRow(e, opts) {
    opts = opts || {};
    var sub = [];
    if (opts.forId && e.weights && e.weights[opts.forId]) sub.push("pesa il " + pctNum(e.weights[opts.forId]) + "% del fondo");
    if (opts.names) sub.push(namesOf(eventIds(e), opts.names, 3) || "Generale");
    if (!e.confirmed) sub.push("data da confermare");
    return h("li", { class: "event" },
      h("div", { class: "ev-date" }, L.fmtDay(e.date)),
      h("div", null, e.url ? link(e.url, e.title) : e.title, sub.length ? h("div", { class: "tiny muted" }, sub.join(" · ")) : null));
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
  function errorBox(e) {
    return h("div", { class: "card error-card" }, h("h2", null, "Dati non disponibili"), h("p", null, e.message || String(e)),
      h("p", { class: "small" }, Backend.mode === "static"
        ? ["Per leggere i dati dal repository privato inserisci il token GitHub nelle ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."]
        : ["Riprova più tardi o controlla le ", h("a", { href: "#/impostazioni" }, "Impostazioni"), "."]));
  }
  function instRow(r) {
    var hot = r.flags.filter(function (f) { return f === "Nuova notizia" || f === "Evento imminente"; });
    return h("a", { class: "inst", href: "#/strumento/" + encodeURIComponent(r.id) },
      h("div", { class: "inst-main" },
        h("div", { class: "inst-name" }, r.short || r.name, r.demo ? badge("DEMO", "demo") : null,
          hot.length ? h("span", { class: "dot", title: hot.join(", "), "aria-label": hot.join(", ") }) : null),
        h("div", { class: "tiny muted" }, (r.type === "etf" ? "ETF" : "Azione") + " · " + r.symbol)),
      h("div", { class: "inst-px" },
        h("div", { class: "px" }, L.fmtPrice(r.price, r.currency)),
        r.stale || r.price == null ? h("div", { class: "tiny muted" }, r.price == null ? "non disponibile" : "non aggiornato") : pctEl(r.daily && r.daily.pct)));
  }
  function nameMap(ov) {
    var names = {};
    ((ov && ov.instruments) || []).forEach(function (r) { names[r.id] = r.short || r.name; });
    return names;
  }

  // ---------------------------------------------------------------- PAGINA 1: panoramica
  function pageOverview() {
    return Promise.all([load("overview.json"), load("status.json")]).then(function (r) {
      var ov = r[0], st = r[1] || {};
      var out = [h("header", { class: "page-head" },
        h("div", null, h("h1", null, "Panoramica"),
          h("p", { class: "tiny muted" }, "Aggiornata " + L.timeAgo(st.last_refresh_at || (ov && ov.generated_at)))),
        refreshAction({}, "Aggiorna", "ghost"))];
      if (!ov) { out.push(empty("Nessun dato ancora: premi «Aggiorna» oppure aggiungi strumenti.")); return out; }
      if (ov.demo) out.push(demoBanner());
      if (ov.problems && ov.problems.length) {
        out.push(h("details", { class: "notice" }, h("summary", null, ov.problems.length === 1 ? "1 avviso sugli aggiornamenti" : ov.problems.length + " avvisi sugli aggiornamenti"),
          h("ul", { class: "plain small" }, ov.problems.map(function (p) { return h("li", null, p); }))));
      }
      if (ov.context && ov.context.length) {
        out.push(h("div", { class: "ctx-row", "aria-label": "Mercati oggi" }, ov.context.map(function (c) {
          return h("div", { class: "ctx" + (c.stale ? " stale" : "") }, h("span", { class: "ctx-name" }, c.name.replace(/\s*\(.*\)$/, "")), pctEl(c.daily && c.daily.pct));
        })));
      }
      var names = nameMap(ov);
      var is = section("I tuoi strumenti");
      is.body.appendChild((ov.instruments || []).length ? h("div", { class: "inst-list" }, ov.instruments.map(instRow)) : empty("Non segui ancora nessuno strumento."));
      out.push(is);
      var ns = section("Notizie principali");
      if (ov.top_news && ov.top_news.length) ov.top_news.slice(0, 5).forEach(function (n) { ns.body.appendChild(newsCard(n, { names: names })); });
      else ns.body.appendChild(empty("Nessuna notizia rilevante negli ultimi giorni."));
      ns.body.appendChild(h("a", { class: "more-link", href: "#/notizie" }, "Tutte le notizie →"));
      out.push(ns);
      var es = section("Prossimi eventi");
      if (ov.upcoming_events && ov.upcoming_events.length) es.body.appendChild(h("ul", { class: "events" }, ov.upcoming_events.slice(0, 5).map(function (e) { return eventRow(e, { names: names }); })));
      else es.body.appendChild(empty("Nessun evento nei prossimi 30 giorni."));
      out.push(es);
      out.push(disclaimer());
      return out;
    });
  }

  // ---------------------------------------------------------------- PAGINA 2: elenco strumenti
  function pageList() {
    return load("overview.json").then(function (ov) {
      var rows = (ov && ov.instruments) || [];
      var listEl = h("div", { class: "inst-list" });
      var filter = h("input", { type: "search", class: "input", placeholder: "Cerca…", "aria-label": "Cerca strumento" });
      function draw() {
        var q = filter.value.trim().toLowerCase();
        listEl.textContent = "";
        var shown = rows.filter(function (r) { return !q || (r.name + " " + r.symbol + " " + (r.short || "")).toLowerCase().indexOf(q) >= 0; });
        if (!shown.length) listEl.appendChild(empty(rows.length ? "Nessuno strumento corrisponde alla ricerca." : "Non segui ancora nessuno strumento. Aggiungine uno."));
        shown.forEach(function (r) { listEl.appendChild(instRow(r)); });
      }
      filter.addEventListener("input", draw);
      draw();
      return [h("header", { class: "page-head" }, h("h1", null, "I miei strumenti"), h("a", { class: "btn primary", href: "#/aggiungi" }, "+ Aggiungi")),
        ov && ov.demo ? demoBanner() : null, rows.length > 6 ? filter : null, listEl];
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
      var W = 600, H = 160, P = 6;
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
        h("span", null, L.fmtDay(pts[0].date)), h("span", null, "min " + L.fmtPrice(min) + " · max " + L.fmtPrice(max)), h("span", null, L.fmtDay(pts[pts.length - 1].date))));
    }
    draw();
    holder.appendChild(btns);
    holder.appendChild(svgBox);
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
  function bullets(list, reg) {
    return h("ul", { class: "plain" }, list.map(function (f) { return typeof f === "string" ? h("li", null, f) : h("li", null, f.testo, " ", refsEl(f.fonti, reg)); }));
  }

  /** In alto nella scheda: prezzo, variazione e poche cifre essenziali. */
  function priceCard(q) {
    var s = h("section", { class: "card" });
    if (!q) { s.appendChild(empty("Prezzi non disponibili per questo strumento.")); return s; }
    var m = q.metrics || {};
    if (q.demo) s.appendChild(demoBanner());
    if (q.stale) s.appendChild(h("div", { class: "banner warn" }, "Ultimo prezzo disponibile: " + L.fmtDate(q.last_bar_date) + "."));
    s.appendChild(h("div", { class: "price-hero" },
      h("span", { class: "px-big" }, L.fmtPrice(q.price, q.currency)),
      m.daily ? h("span", { class: "pct-big " + L.trend(m.daily.pct) }, L.fmtPct(m.daily.pct)) : null,
      h("div", { class: "tiny muted" }, q.session && q.session.price_kind === "intraday" ? "In seduta, ritardato" : "Chiusura del " + L.fmtDay(q.last_bar_date))));
    s.appendChild(h("div", { class: "periods" }, [["1 settimana", m.d5], ["1 mese", m.m1], ["Da inizio anno", m.ytd]].map(function (p) {
      return h("div", null, h("div", { class: "tiny muted" }, p[0]), p[1] ? pctEl(p[1].pct) : h("span", { class: "muted" }, "—"));
    })));
    var det = more("Grafico", chart(q.bars || [], q.currency), window.innerWidth >= 700);
    s.appendChild(det);
    return s;
  }

  function marketDetails(q) {
    var m = q.metrics || {};
    function row(label, c) {
      return h("tr", null, h("th", null, label), h("td", null, c ? pctEl(c.pct) : "—"), h("td", { class: "tiny muted" }, c ? "dal " + L.fmtDay(c.from_date) + " al " + L.fmtDay(c.to_date) : ""));
    }
    return [h("table", { class: "kv" },
      row("1 seduta", m.daily), row("5 sedute", m.d5), row("1 mese", m.m1), row("Da inizio anno", m.ytd),
      m.w52 ? h("tr", null, h("th", null, "52 settimane"), h("td", { colspan: "2" }, "max " + L.fmtPrice(m.w52.high) + " · min " + L.fmtPrice(m.w52.low))) : null,
      m.volume ? h("tr", null, h("th", null, "Volume"), h("td", { colspan: "2" }, pctNum(m.volume.ratio) + "× la media")) : null),
      q.last_error ? h("p", { class: "small" }, "Ultimo aggiornamento non riuscito (" + L.fmtDate(q.last_error_at) + "): mostro l'ultimo dato valido.") : null,
      h("p", { class: "tiny muted" }, "Fonte: ", q.provider_url ? link(q.provider_url, q.provider_label) : q.provider_label, " · " + L.fmtDate(q.fetched_at) + ". " + (q.disclaimer || ""))];
  }

  function bar(pct) {
    var fill = h("i");
    fill.style.width = Math.max(0, Math.min(100, pct)) + "%"; // proprietà CSSOM: consentita dalla CSP, l'attributo style no
    return h("span", { class: "bar" }, fill);
  }

  function etfDetails(inst, fund, index) {
    var out = [h("table", { class: "kv" },
      h("tr", null, h("th", null, "Indice"), h("td", null, inst.index_name || index || "—")),
      h("tr", null, h("th", null, "Emittente"), h("td", null, inst.issuer || (fund && fund.fund_family) || "—")),
      h("tr", null, h("th", null, "Costi (TER)"), h("td", null, fund && fund.ter_pct != null ? pctNum(fund.ter_pct) + "%" : "—")),
      h("tr", null, h("th", null, "ISIN"), h("td", null, inst.isin || "—")))];
    if (fund && fund.top_holdings && fund.top_holdings.length) {
      out.push(h("h3", null, "Principali posizioni"));
      out.push(h("div", { class: "bars" }, fund.top_holdings.slice(0, 10).map(function (x) {
        return h("div", { class: "barrow" }, h("span", null, x.name), bar(x.weight_pct * 6), h("span", { class: "muted" }, pctNum(x.weight_pct) + "%"));
      })));
    }
    if (fund && fund.sectors && fund.sectors.length) {
      var SECT = { technology: "Tecnologia", financial_services: "Finanza", healthcare: "Salute", consumer_cyclical: "Consumi ciclici", industrials: "Industria", communication_services: "Comunicazioni", consumer_defensive: "Consumi difensivi", energy: "Energia", basic_materials: "Materie prime", utilities: "Servizi pubblici", realestate: "Immobiliare" };
      out.push(h("h3", null, "Settori"));
      out.push(h("div", { class: "bars" }, fund.sectors.slice(0, 6).map(function (x) {
        return h("div", { class: "barrow" }, h("span", null, SECT[x.name] || x.name), bar(x.weight_pct), h("span", { class: "muted" }, pctNum(x.weight_pct) + "%"));
      })));
    }
    out.push(h("p", { class: "tiny muted" }, "Dati non ufficiali (", fund && fund.url ? link(fund.url, fund.source) : "provider", "): verifica sempre KID e factsheet dell'emittente."));
    return out;
  }

  function storyDetails(a, reg) {
    return a.cosa_e_successo.map(function (e) {
      var first = reg[e.fonti[0]] || {};
      return h("div", { class: "story" },
        h("strong", null, first.url ? link(first.url, e.titolo || first.title) : (e.titolo || first.title)), " ", refsEl(e.fonti, reg),
        e.sintesi ? h("p", { class: "small" }, e.sintesi) : null,
        e.rilevanza ? h("p", { class: "small muted" }, e.rilevanza) : null);
    });
  }

  function whyDetails(pm, reg) {
    var out = [];
    if (pm.fatti && pm.fatti.length) out.push(h("h3", null, "Fatti"), bullets(pm.fatti, reg));
    if (pm.possibili_spiegazioni && pm.possibili_spiegazioni.length) out.push(h("h3", null, "Possibili spiegazioni"), bullets(pm.possibili_spiegazioni, reg));
    if (pm.non_verificati && pm.non_verificati.length) out.push(h("h3", null, "Da verificare"), bullets(pm.non_verificati, reg));
    if (!pm.causa_determinabile) out.push(h("p", { class: "small muted" }, "La causa del movimento non è determinabile con certezza."));
    return out;
  }

  function scenarioDetails(p, reg) {
    var out = [h("div", { class: "outlook o-" + (p.valutazione || "non_valutabile") },
      h("div", { class: "outlook-label" }, p.valutazione_label || "Prospettive non valutabili"),
      h("div", { class: "tiny muted" }, [p.orizzonte ? "Orizzonte " + p.orizzonte : null, "evidenze " + (p.qualita_evidenze || "basse")].filter(Boolean).join(" · ")))];
    if (p.spiegazione) out.push(h("p", { class: "small" }, p.spiegazione));
    var sc = p.scenari || {};
    var LABELS = { rialzista: "Se va meglio", centrale: "Scenario centrale", ribassista: "Se va peggio" };
    ["rialzista", "centrale", "ribassista"].forEach(function (k) {
      var s = sc[k];
      if (!s) return;
      var pts = (s.fattori || []).concat(s.rischi || []).slice(0, 3);
      out.push(h("div", { class: "scenario s-" + k }, h("strong", null, LABELS[k]), " ", refsEl(s.fonti, reg),
        s.descrizione ? h("p", { class: "small" }, s.descrizione) : null,
        pts.length ? h("ul", { class: "plain small" }, pts.map(function (t) { return h("li", null, t); })) : null));
    });
    out.push(h("p", { class: "tiny muted" }, "Scenari ipotetici, non previsioni né raccomandazioni."));
    return out;
  }

  function sourcesDetails(inst, rec, history) {
    var out = [];
    if (rec) {
      out.push(h("p", { class: "small" }, (rec.kind === "ai" ? "Analisi AI (" + (rec.model || rec.provider) + ")" : "Sintesi automatica senza AI") + " del " + L.fmtDate(rec.generated_at) + "."));
      out.push(h("ol", { class: "sources" }, (rec.sources || []).map(function (s) {
        return h("li", null, h("span", { class: "ref" }, s.ref), " ", s.url ? link(s.url, s.title) : s.title, h("span", { class: "muted tiny" }, " — " + (s.source || "")));
      })));
      if (rec.analysis && rec.analysis.limiti && rec.analysis.limiti.length) out.push(h("h3", null, "Limiti"), bullets(rec.analysis.limiti));
      if (rec.warnings && rec.warnings.length) out.push(h("h3", null, "Controlli automatici"), bullets(rec.warnings));
    }
    if (history && history.items && history.items.length > 1) {
      var view = h("div");
      out.push(h("h3", null, "Analisi precedenti"));
      out.push(h("ul", { class: "plain small" }, history.items.slice(0, 10).map(function (it) {
        return h("li", null, h("button", { type: "button", class: "linklike", onclick: function () {
          load("analysis/" + inst.id + "/" + it.file).then(function (old) {
            view.textContent = "";
            view.appendChild(h("div", { class: "history-view" }, h("strong", null, L.fmtDate(old.generated_at) + " — " + old.analysis.prospettive.valutazione_label), h("p", null, old.analysis.in_breve)));
          });
        } }, L.fmtDate(it.generated_at)), " — " + it.valutazione);
      })));
      out.push(view);
    }
    return out;
  }

  function pageDetail(id) {
    var base = "analysis/" + id + "/";
    return Promise.all([load("instruments.json"), load("quotes/" + id + ".json"), load(base + "latest.json"), load("news.json"),
      load("events.json"), load(base + "history.json"), load("overview.json")]).then(function (r) {
      var inst = ((r[0] && r[0].instruments) || []).filter(function (i) { return i.id === id; })[0];
      if (!inst) return [empty("Strumento non trovato."), h("a", { href: "#/strumenti" }, "← Torna all'elenco")];
      var q = r[1], rec = r[2], newsMeta = r[3] || {}, evs = (r[4] && r[4].items) || [], history = r[5];
      var row = (((r[6] || {}).instruments) || []).filter(function (x) { return x.id === id; })[0] || {};
      var news = (newsMeta.items || []).filter(function (n) { return n.instrument_ids.indexOf(id) >= 0; });
      // per un ETF prima le notizie su indice e mercato, poi quelle sulle singole partecipazioni
      news = news.filter(function (n) { return !(n.via_holdings || {})[id]; }).concat(news.filter(function (n) { return (n.via_holdings || {})[id]; }));
      var today = new Date().toISOString().slice(0, 10);
      var events = evs.filter(function (e) { return eventIds(e).indexOf(id) >= 0 && e.date >= today; });
      var fundP = inst.type === "etf" ? load("funds/" + id + ".json").catch(function () { return null; }) : Promise.resolve(null);
      return fundP.then(function (fund) {
        var a = (rec && rec.analysis) || {};
        var reg = {};
        ((rec && rec.sources) || []).forEach(function (s) { reg[s.ref] = s; });
        var out = [h("p", { class: "crumbs" }, h("a", { href: "#/strumenti" }, "← Strumenti")),
          h("header", { class: "page-head" },
            h("div", null, h("h1", null, row.short || inst.name),
              h("p", { class: "tiny muted" }, [inst.type === "etf" ? "ETF" : "Azione", inst.symbol, row.short && row.short !== inst.name ? inst.name : null].filter(Boolean).join(" · "))),
            refreshAction({ components: ["prices", "funds", "events", "news", "analysis"], instrument: id }, "Aggiorna", "ghost"))];
        out.push(priceCard(q));

        var b = section("In breve");
        if (rec && rec.demo) b.body.appendChild(demoBanner());
        var lead = h("p", { class: "lead clamp" }, a.in_breve || "Analisi non ancora disponibile.");
        b.body.appendChild(lead);
        if ((a.in_breve || "").length > 320) {
          b.body.appendChild(h("button", { type: "button", class: "linklike small", onclick: function (ev) {
            var open = lead.classList.toggle("clamp");
            ev.target.textContent = open ? "Leggi tutto" : "Riduci";
          } }, "Leggi tutto"));
        }
        if (rec) b.body.appendChild(h("p", { class: "tiny muted" }, (rec.kind === "ai" ? "Analisi AI" : "Sintesi automatica") + " · " + L.timeAgo(rec.generated_at)));
        out.push(b);

        var ns = section("Notizie");
        if (news.length) {
          news.slice(0, 5).forEach(function (n) { ns.body.appendChild(newsCard(n, { forId: id })); });
          if (news.length > 5) ns.body.appendChild(more("Altre " + (news.length - 5) + " notizie", news.slice(5).map(function (n) { return newsCard(n, { forId: id }); })));
        } else ns.body.appendChild(empty("Nessuna notizia rilevante negli ultimi giorni."));
        out.push(ns);

        if (events.length) {
          var es = section("Prossimi eventi");
          es.body.appendChild(h("ul", { class: "events" }, events.slice(0, 6).map(function (e) { return eventRow(e, { forId: id }); })));
          out.push(es);
        }

        var deep = [];
        if (a.cosa_e_successo && a.cosa_e_successo.length) deep.push(more("Cosa è successo", storyDetails(a, reg)));
        if (a.perche_mosso) deep.push(more("Perché si è mosso il prezzo", whyDetails(a.perche_mosso, reg)));
        if (a.prospettive) deep.push(more("Scenari", scenarioDetails(a.prospettive, reg)));
        if (a.da_monitorare && a.da_monitorare.length) {
          deep.push(more("Cosa tenere d'occhio", h("ul", { class: "plain" }, a.da_monitorare.map(function (w) {
            return h("li", null, w.data ? h("strong", null, L.fmtDay(w.data) + " ") : null, w.evento, " ", refsEl(w.fonti, reg), w.perche ? h("div", { class: "small muted" }, w.perche) : null);
          }))));
        }
        if (inst.type === "etf") deep.push(more("Composizione dell'ETF", etfDetails(inst, fund, row.index)));
        if (q) deep.push(more("Dati di mercato", marketDetails(q)));
        deep.push(more("Fonti e storico", sourcesDetails(inst, rec, history)));
        var dc = section("Approfondisci");
        dc.body.appendChild(h("div", { class: "deep" }, deep));
        dc.body.appendChild(h("div", { class: "row" },
          refreshAction({ components: ["analysis"], instrument: id, force: true }, "Rigenera analisi", "ghost small"),
          h("a", { class: "btn ghost small", href: "#/modifica/" + encodeURIComponent(id) }, "Modifica strumento")));
        out.push(dc);
        out.push(disclaimer());
        return out;
      });
    });
  }

  // ---------------------------------------------------------------- PAGINA: eventi e notizie
  function pageNews() {
    return Promise.all([load("news.json"), load("events.json"), load("overview.json")]).then(function (r) {
      var nm = r[0] || { items: [] }, ev = r[1] || { items: [] };
      var names = nameMap(r[2]);
      var ids = Object.keys(names);
      var current = Prefs.get("newsFilter", "");
      if (current && !names[current]) current = "";
      var today = new Date().toISOString().slice(0, 10);
      var evBox = h("div"), listEl = h("div");
      var chips = h("div", { class: "chips filter", role: "group", "aria-label": "Filtra per strumento" });
      function draw() {
        chips.textContent = "";
        [["", "Tutti"]].concat(ids.map(function (i) { return [i, names[i]]; })).forEach(function (c) {
          chips.appendChild(h("button", { type: "button", class: "chip" + (current === c[0] ? " on" : ""), "aria-pressed": current === c[0] ? "true" : "false",
            onclick: function () { current = c[0]; Prefs.set("newsFilter", current); draw(); } }, c[1]));
        });
        var opts = current ? { forId: current } : { names: names };
        var upcoming = ev.items.filter(function (e) { return e.date >= today && (!current || eventIds(e).indexOf(current) >= 0); });
        evBox.textContent = "";
        if (upcoming.length) {
          evBox.appendChild(h("ul", { class: "events" }, upcoming.slice(0, 5).map(function (e) { return eventRow(e, opts); })));
          if (upcoming.length > 5) evBox.appendChild(more("Altri " + (upcoming.length - 5) + " eventi", h("ul", { class: "events" }, upcoming.slice(5).map(function (e) { return eventRow(e, opts); }))));
        } else evBox.appendChild(empty("Nessun evento in calendario."));
        listEl.textContent = "";
        var items = nm.items.filter(function (n) { return !current || n.instrument_ids.indexOf(current) >= 0; });
        if (!items.length) listEl.appendChild(empty("Nessuna notizia rilevante negli ultimi giorni."));
        items.slice(0, 15).forEach(function (n) { listEl.appendChild(newsCard(n, opts)); });
        if (items.length > 15) listEl.appendChild(more("Altre " + (Math.min(items.length, 60) - 15) + " notizie", items.slice(15, 60).map(function (n) { return newsCard(n, opts); })));
      }
      draw();
      var es = section("Calendario");
      es.body.appendChild(evBox);
      var ns = section("Notizie");
      ns.body.appendChild(listEl);
      return [h("header", { class: "page-head" }, h("h1", null, "Eventi e notizie"), refreshAction({ components: ["news", "events"] }, "Aggiorna", "ghost")),
        chips, es, ns,
        h("p", { class: "tiny muted" }, "Notizie raccolte " + L.timeAgo(nm.updated_at) + " da Google News e dai comunicati di BCE e Fed. I link portano all'articolo originale.")];
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
      var modeTxt = { local: "Server locale attivo: le azioni vengono eseguite su questo computer.", github: "Collegata a GitHub: i dati arrivano dal repository e gli aggiornamenti girano su GitHub Actions, anche a PC spento.", static: "Sola lettura: nessun server locale e nessun collegamento GitHub configurato." }[Backend.mode];
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
      if (Backend.health) advanced.unshift(more("Server locale", h("p", { class: "small" }, "AI: " + (Backend.health.ai_provider === "none" ? "nessun modello disponibile (sintesi senza AI)" : Backend.health.ai_provider + " " + (Backend.health.ai_model || "")) + " · prezzi: " + Backend.health.price_provider)));
      advanced.push(more("Fonti e limiti", h("ul", { class: "plain small" },
        h("li", null, "Prezzi: Yahoo Finance tramite la libreria non ufficiale yfinance. Dati ritardati, mai tempo reale; possibili buchi o errori."),
        h("li", null, "Notizie: Google News (per le azioni il nome della società; per gli ETF l'indice, il mercato e le principali partecipazioni) e i comunicati di BCE e Fed. Nessuno scraping, nessun aggiramento di paywall."),
        h("li", null, "Eventi: date dei risultati indicate dal provider (non verificate) e riunioni delle banche centrali da config/manual_events.json."),
        h("li", null, "Analisi: modello AI locale (Ollama) o API cloud configurata. L'output dell'AI non è una fonte: ogni affermazione rimanda alle fonti raccolte."))));

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

      out.push(csvSection());
      var adv = section("Avanzate");
      adv.body.appendChild(h("div", { class: "deep" }, advanced));
      out.push(adv);
      out.push(disclaimer());
      return out;
    });
  }

  function csvSection() {
    var s = section("Importa da CSV", "Si leggono solo le colonne che scegli; quantità e importi non vengono mai salvati.");
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
