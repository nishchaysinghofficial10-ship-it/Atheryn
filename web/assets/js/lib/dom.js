// Small DOM and formatting helpers. Every piece of mission data reaches the
// page through textContent — never innerHTML — because mission text can
// include ingested, untrusted documents.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

const STATUS = {
  accepted_with_scope: "Accepted · scoped",
  provisionally_supported: "Supported",
  under_test: "Under test",
  proposed: "Proposed",
  weakened: "Weakened",
  rejected: "Rejected",
  confirmed: "Confirmed",
  refuted: "Refuted",
  inconclusive: "Inconclusive",
  unstable: "Unstable",
  untested: "Untested",
  survived: "Survived",
  failed: "Failed",
};

export function statusLabel(s) {
  if (!s) return "—";
  return STATUS[s] || String(s).replace(/_/g, " ").toLowerCase();
}

export function pill(status, label) {
  return h("span", { class: "pill", "data-status": status }, label || statusLabel(status));
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function fmtInt(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—";
}

export function fmtSeconds(s) {
  if (!Number.isFinite(s)) return "—";
  if (s < 1) return `${(s * 1000).toFixed(0)} ms`;
  if (s < 90) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${pad2(Math.round(s % 60))}s`;
}

export function fmtMetric(v, metric) {
  if (!Number.isFinite(v)) return "—";
  if (metric === "relaxations") return fmtInt(v);
  const ms = v * 1000;
  if (ms < 1) return `${ms.toFixed(3)} ms`;
  if (ms < 100) return `${ms.toFixed(2)} ms`;
  return `${ms.toFixed(0)} ms`;
}

export function fmtDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function fmtClock(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleTimeString("en-GB", { hour12: false });
}

export function phaseLabel(phase) {
  return String(phase || "").replace(/_/g, " ").toLowerCase();
}

export function debounce(fn, ms = 150) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function params() {
  return new URLSearchParams(window.location.search);
}
