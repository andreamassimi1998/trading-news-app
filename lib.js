/* Funzioni pure condivise (browser + test Node). Nessun accesso al DOM qui. */
(function (root) {
  "use strict";

  /** Solo URL http(s) assoluti: javascript:, data:, relativi e simili vengono scartati. */
  function safeUrl(value) {
    if (typeof value !== "string") return null;
    var v = value.trim();
    if (!v || v.length > 2000 || /[\u0000-\u001f\s]/.test(v)) return null;
    var u;
    try { u = new URL(v); } catch (e) { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href;
  }

  /** Escape per i rari casi in cui serve una stringa HTML (la dashboard usa textContent). */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var nf2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function fmtPrice(v, currency) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    var digits = v < 1 ? 4 : 2;
    var s = new Intl.NumberFormat("it-IT", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
    return currency ? s + " " + currency : s;
  }

  function fmtPct(v) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "") + nf2.format(Math.abs(v)) + "%";
  }

  function fmtAbs(v) {
    if (typeof v !== "number" || !isFinite(v)) return "—";
    return (v > 0 ? "+" : v < 0 ? "−" : "") + nf2.format(Math.abs(v));
  }

  function trend(v) {
    if (typeof v !== "number" || !isFinite(v) || v === 0) return "flat";
    return v > 0 ? "up" : "down";
  }

  /** Data ISO → testo italiano. Le date "AAAA-MM-GG" restano giorni di calendario (nessun fuso). */
  function fmtDate(iso, withTime) {
    if (!iso) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      var p = iso.split("-");
      return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1] + " " + p[0];
    }
    var d = new Date(iso);
    if (isNaN(d)) return "—";
    var opts = { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" };
    if (withTime !== false) { opts.hour = "2-digit"; opts.minute = "2-digit"; }
    return d.toLocaleString("it-IT", opts);
  }
  var MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

  function timeAgo(iso, now) {
    if (!iso) return "data non disponibile";
    var t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00Z") : new Date(iso);
    if (isNaN(t)) return "data non disponibile";
    var s = ((now || new Date()) - t) / 1000;
    if (s < 0) return fmtDate(iso);
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min fa";
    if (s < 86400) return Math.round(s / 3600) + " h fa";
    if (s < 86400 * 7) { var g = Math.round(s / 86400); return g + (g === 1 ? " giorno fa" : " giorni fa"); }
    return fmtDate(iso, false);
  }

  /** Validazione ISIN (stessa logica del backend). */
  function isinOk(isin) {
    if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
    var digits = "";
    for (var i = 0; i < 11; i++) digits += parseInt(isin[i], 36).toString();
    var total = 0;
    for (var j = 0; j < digits.length; j++) {
      var n = Number(digits[digits.length - 1 - j]);
      if (j % 2 === 0) { n *= 2; if (n > 9) n -= 9; }
      total += n;
    }
    return (10 - (total % 10)) % 10 === Number(isin[11]);
  }

  /** Parser CSV minimale (virgolette, separatore , ; o tab) per l'anteprima d'importazione. */
  function parseCsv(text) {
    text = String(text || "").replace(/^﻿/, "");
    var first = text.split(/\r?\n/)[0] || "";
    var sep = [";", "\t", ","].sort(function (a, b) { return first.split(b).length - first.split(a).length; })[0];
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell.trim()); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell.trim()); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x !== ""; }); });
  }

  /** Righe CSV → strumenti, leggendo SOLO le colonne mappate (le altre non vengono mai lette). */
  function mapCsvRows(rows, mapping, defaultType) {
    var out = [];
    for (var i = 1; i < rows.length && i <= 300; i++) {
      var r = rows[i], inst = {}, errors = [];
      ["symbol", "isin", "name", "exchange", "currency", "type"].forEach(function (f) {
        if (mapping[f] != null && mapping[f] !== "") inst[f] = (r[Number(mapping[f])] || "").trim();
      });
      var t = (inst.type || defaultType || "").toLowerCase();
      inst.type = /^(etf|etc|etp|fund|fondo)$/.test(t) ? "etf" : /^(stock|azion[ei]|share|equity|aktie)$/.test(t) ? "stock" : t;
      inst.symbol = (inst.symbol || "").toUpperCase();
      if (inst.isin) inst.isin = inst.isin.toUpperCase();
      if (!inst.name) inst.name = inst.symbol;
      if (!/^[A-Z0-9^=][A-Z0-9.\-^=]{0,24}$/.test(inst.symbol)) errors.push("simbolo non valido");
      if (inst.isin && !isinOk(inst.isin)) errors.push("ISIN non valido");
      if (inst.type !== "stock" && inst.type !== "etf") errors.push("tipo mancante (azione/ETF)");
      out.push({ line: i + 1, instrument: inst, errors: errors });
    }
    return out;
  }

  /** Riduce una serie di barre all'intervallo richiesto (1M, 3M, 6M, 1Y). */
  function sliceRange(bars, range) {
    if (!bars || !bars.length) return [];
    var months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 }[range] || 3;
    var last = new Date(bars[bars.length - 1].date + "T00:00:00Z");
    last.setUTCMonth(last.getUTCMonth() - months);
    var cut = last.toISOString().slice(0, 10);
    return bars.filter(function (b) { return b.date >= cut && typeof b.close === "number"; });
  }

  var api = { safeUrl: safeUrl, escapeHtml: escapeHtml, fmtPrice: fmtPrice, fmtPct: fmtPct, fmtAbs: fmtAbs,
    trend: trend, fmtDate: fmtDate, timeAgo: timeAgo, isinOk: isinOk, parseCsv: parseCsv,
    mapCsvRows: mapCsvRows, sliceRange: sliceRange };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PII = api;
})(typeof window !== "undefined" ? window : globalThis);
