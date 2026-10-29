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
  /** Giorno breve per i calendari: "17 nov" (con l'anno solo se diverso da quello corrente). */
  function fmtDay(iso, now) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso || "")) return "—";
    var p = iso.slice(0, 10).split("-");
    var s = Number(p[2]) + " " + MONTHS[Number(p[1]) - 1];
    return Number(p[0]) === (now || new Date()).getFullYear() ? s : s + " " + p[0];
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

  /** Riduce una serie di barre all'intervallo richiesto (1M, 3M, 6M, 1Y). */
  function sliceRange(bars, range) {
    if (!bars || !bars.length) return [];
    var months = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 }[range] || 3;
    var last = new Date(bars[bars.length - 1].date + "T00:00:00Z");
    last.setUTCMonth(last.getUTCMonth() - months);
    var cut = last.toISOString().slice(0, 10);
    return bars.filter(function (b) { return b.date >= cut && typeof b.close === "number"; });
  }

  var api = { safeUrl: safeUrl, fmtPrice: fmtPrice, fmtPct: fmtPct,
    trend: trend, fmtDate: fmtDate, fmtDay: fmtDay, timeAgo: timeAgo, isinOk: isinOk, sliceRange: sliceRange };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PII = api;
})(typeof window !== "undefined" ? window : globalThis);
