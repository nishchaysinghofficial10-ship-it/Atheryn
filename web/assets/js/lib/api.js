// Thin client for the ATHERYN HTTP API (atheryn_server). The API base comes
// from <meta name="atheryn-api">; empty means same origin.

const metaTag = document.querySelector('meta[name="atheryn-api"]');
const BASE = ((metaTag && metaTag.content) || "").replace(/\/+$/, "");
const TOKEN_KEY = "atheryn.accessKey";

export function getToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(value) {
  try {
    if (value) window.sessionStorage.setItem(TOKEN_KEY, value);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the key lives only for this page */
  }
}

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body || null;
  }
}

async function request(method, path, body) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = getToken();
  if (token && method !== "GET") headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "The engine is unreachable.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || res.statusText || "Request failed", data);
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request("GET", "/api/health"),
  meta: () => request("GET", "/api/meta"),
  evaluation: () => request("GET", "/api/evaluation"),
  missions: () => request("GET", "/api/missions"),
  mission: (id) => request("GET", `/api/missions/${enc(id)}`),
  events: (id, after = 0, limit = 500) =>
    request("GET", `/api/missions/${enc(id)}/events?after=${after}&limit=${limit}`),
  results: (id) => request("GET", `/api/missions/${enc(id)}/results`),
  dossier: (id) => request("GET", `/api/missions/${enc(id)}/dossier`),
  experiment: (id, exp) => request("GET", `/api/missions/${enc(id)}/experiments/${enc(exp)}`),
  create: (payload) => request("POST", "/api/missions", payload),
  run: (id, steps) => request("POST", `/api/missions/${enc(id)}/run`, steps ? { steps } : {}),
  pause: (id) => request("POST", `/api/missions/${enc(id)}/pause`, {}),
  cancel: (id) => request("POST", `/api/missions/${enc(id)}/cancel`, {}),
  verify: (id) => request("POST", `/api/missions/${enc(id)}/verify`, {}),
  replay: (id, exp) => request("POST", `/api/missions/${enc(id)}/experiments/${enc(exp)}/replay`, {}),
};

export function engineStatus(el, health) {
  if (!el) return;
  const label = el.querySelector("[data-engine-label]");
  if (!health) {
    el.dataset.state = "offline";
    if (label) label.textContent = "Engine offline";
    return;
  }
  el.dataset.state = health.can_execute ? "online" : "readonly";
  if (label) label.textContent = health.can_execute ? `Engine online · v${health.version}` : `Read-only · v${health.version}`;
  el.title = health.can_execute
    ? "This server can run new missions."
    : "This server can show missions but cannot execute experiments (POSIX required).";
}
