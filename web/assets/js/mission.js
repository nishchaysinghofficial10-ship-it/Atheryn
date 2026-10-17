import { api, ApiError, engineStatus } from "./lib/api.js";
import {
  $, $$, h, clear, pill, statusLabel, fmtInt, fmtSeconds, fmtDate, phaseLabel, params,
} from "./lib/dom.js";
import {
  initMotion, motionEnabled, revealLines, countUp, bindNav, fontsReady, refresh, getLenis,
} from "./lib/motion.js";
import { renderResult, hasMetric } from "./charts.js";

const POLL_MS = 1200;
const STATUS_ORDER = ["accepted_with_scope", "provisionally_supported", "under_test", "proposed", "weakened", "rejected"];
const FALLBACK_LIFECYCLE = [
  "CREATED", "VALIDATING", "PLANNING", "FORMING_HYPOTHESES", "SELECTING_NEXT_ACTION",
  "DESIGNING_EXPERIMENT", "EXECUTING", "ANALYZING", "UPDATING_KNOWLEDGE", "CRITICIZING",
  "REPLICATING", "FALSIFYING", "COMPLETED",
];
const GROUPS = {
  experiment: ["experiment_started", "experiment_completed", "experiment_failed", "experiment_rejected",
    "analysis", "experiment_proposal", "experiment_proposal_used", "experiment_orphaned"],
  critic: ["replicated", "falsification", "accepted", "critic_review", "correctness_boundary",
    "invalidity", "decision"],
  hypothesis: ["hypothesis", "counterargument", "knowledge_gap", "proposals_reviewed", "proposal_rejected"],
  problem: ["warning", "brain_error", "stagnation", "retrieval_refused", "validation_error", "budget",
    "experiment_failed", "experiment_rejected"],
};
const FILTERS = [
  ["all", "All"], ["experiment", "Experiments"], ["critic", "Critic"],
  ["hypothesis", "Hypotheses"], ["lifecycle", "Lifecycle"], ["problem", "Problems"],
];

const missionId = (() => {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const raw = parts[0] === "missions" && parts[1] ? parts[1] : params().get("id") || "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
})();

const S = {
  m: null, meta: null, health: null,
  events: [], next: 0, t0: null, filter: "all",
  results: [], selected: null, metric: "mean_s",
  sig: {}, polling: false, wasRunning: false, firstRender: true,
};

boot();

async function boot() {
  initMotion();
  bindNav($("[data-nav]"));
  bindDrawer();
  bindControls();
  bindToc();
  buildFilters();
  await fontsReady();

  const [health, meta] = await Promise.all([api.health().catch(() => null), api.meta().catch(() => null)]);
  S.health = health;
  S.meta = meta;
  engineStatus($("[data-engine-status]"), health);

  try {
    S.m = await api.mission(missionId);
  } catch (err) {
    notFound(err);
    return;
  }
  render();
  await loadEvents();
  if (!S.m.run.running) await loadResults();
  await loadDossier();
  if (S.m.run.running) startPolling();
  refresh();
}

function notFound(err) {
  document.title = "Mission not found — ATHERYN";
  $("[data-m-question]").textContent = err instanceof ApiError && err.status === 404
    ? "There is no mission with this name."
    : "The mission record could not be loaded.";
  $("[data-m-stop]").textContent = err && err.message ? err.message : "";
  $$(".controls, .kpis, .budgets, .mlayout, .rail").forEach((el) => (el.hidden = true));
}

/* --------------------------------------------------------------- render */
function changed(key, value) {
  const sig = JSON.stringify(value);
  if (S.sig[key] === sig) return false;
  S.sig[key] = sig;
  return true;
}

function render() {
  const m = S.m;
  document.title = `${m.question.slice(0, 70)}${m.question.length > 70 ? "…" : ""} — ATHERYN`;
  if (changed("head", [m.question, m.phase, m.stop_reason, m.run.running, m.run.status])) renderHead(m);
  if (changed("rail", [m.phase, m.run.running])) renderRail(m);
  renderControls(m);
  if (changed("kpis", [m.counts, m.hypotheses.map((x) => x.status)])) renderKpis(m);
  if (changed("budget", m.budget)) renderBudgets(m.budget);
  if (changed("hyps", m.hypotheses)) renderHyps(m.hypotheses);
  if (changed("exps", m.experiments)) renderExperiments(m.experiments);
  if (changed("critic", [m.falsifications, m.invalidities, m.contradictions, m.cautions, m.recommendations])) renderCritic(m);
  if (changed("decisions", m.decisions)) renderDecisions(m.decisions);
  S.firstRender = false;
}

function renderHead(m) {
  const q = $("[data-m-question]");
  q.textContent = m.question;
  $("[data-m-label]").textContent = `${m.source === "example" ? "Shipped mission" : "Mission"} / ${m.id}`;
  const chips = clear($("[data-m-chips]"));
  const live = m.run && m.run.running;
  const phasePill = pill(live ? "running" : m.phase, live ? `Running · ${phaseLabel(m.phase)}` : phaseLabel(m.phase));
  chips.append(
    phasePill,
    h("span", { class: "tag" }, m.domain),
    h("span", { class: "tag" }, m.profile || "profile —"),
    h("span", { class: "tag" }, `brain · ${m.brain}`),
    h("span", { class: "tag" }, fmtDate(m.created_at)),
    m.source === "user" ? h("span", { class: "tag tag--user" }, "This server") : h("span", { class: "tag" }, "Shipped evidence")
  );
  const stop = clear($("[data-m-stop]"));
  if (m.stop_reason) stop.append("Stop reason: ", h("b", null, m.stop_reason));
  else if (live) stop.append(m.current ? `Now: ${m.current}` : "Running…");
  else if (!m.terminal) stop.append("This mission is resumable. Nothing is repeated: it continues from its last checkpoint.");
  if (S.firstRender) revealLines(q, { start: "top 100%" });
}

function renderRail(m) {
  const life = (S.meta && S.meta.lifecycle) || FALLBACK_LIFECYCLE;
  const rail = clear($("[data-rail]"));
  const idx = life.indexOf(m.phase);
  const steps = idx === -1 ? [...life, m.phase] : life;
  const now = idx === -1 ? steps.length - 1 : idx;
  steps.forEach((s, i) => {
    const cls = ["rail__step", i < now ? "is-past" : "", i === now ? "is-now" : "",
      i === now && m.run.running ? "is-live" : ""].join(" ").trim();
    rail.append(h("div", { class: cls, "aria-current": i === now ? "step" : null }, h("i"), phaseLabel(s)));
  });
  const current = rail.children[now];
  if (current) {
    const box = rail.parentElement;
    box.scrollTo({ left: Math.max(0, current.offsetLeft - box.clientWidth / 2), behavior: "smooth" });
  }
}

function renderControls(m) {
  const can = !!(S.health && S.health.can_execute);
  const running = !!(m.run && m.run.running);
  const btn = (name) => $(`[data-act="${name}"]`);
  btn("run").hidden = !(m.writable && !m.terminal && !running);
  btn("run").disabled = !can;
  btn("run").title = can ? "" : "This server cannot execute experiments (POSIX required).";
  btn("run").firstChild.textContent = m.step > 0 ? "Resume mission " : "Run mission ";
  btn("pause").hidden = !(m.writable && running);
  btn("cancel").hidden = !(m.writable && !m.terminal);
  btn("verify").disabled = running;
  const fork = btn("fork");
  fork.hidden = m.source !== "example";
  fork.href = `/?q=${encodeURIComponent(m.question.slice(0, 300))}&domain=${encodeURIComponent(m.domain)}#lab`;

  const status = $("[data-ctl-status]");
  if (running) {
    say(`Running · step ${m.step} · ${m.current || phaseLabel(m.phase)}${m.run.stop_request ? ` · ${m.run.stop_request} requested` : ""}`);
  } else if (m.run && m.run.status === "error") {
    say(`The run stopped with an error: ${m.run.error}`, "error");
  } else if (S.wasRunning && m.terminal) {
    say(`Mission ${phaseLabel(m.phase)} — ${m.stop_reason}`, "ok");
  } else if (!status.dataset.sticky) {
    say("");
  }
}

function say(text, tone) {
  const el = $("[data-ctl-status]");
  el.textContent = text || "";
  if (tone) el.dataset.tone = tone;
  else delete el.dataset.tone;
}

function renderKpis(m) {
  const c = m.counts || {};
  const accepted = m.hypotheses.filter((x) => x.status === "accepted_with_scope").length;
  const rejected = m.hypotheses.filter((x) => x.status === "rejected").length;
  const items = [
    ["Hypotheses", c.hypotheses], ["Experiments", c.experiments],
    ["Accepted with scope", accepted, "signal"], ["Rejected by evidence", rejected, rejected ? "warn" : ""],
    ["Evidence items", c.evidence], ["Falsification probes", c.falsifications],
    ["Contradictions", c.contradictions], ["Failures logged", c.failures],
  ];
  const box = $("[data-kpis]");
  if (!box.children.length) {
    items.forEach(([k, v, tone]) => {
      const val = h("p", { class: "kpi__v" }, "0");
      box.append(h("div", { class: `kpi${tone ? ` kpi--${tone}` : ""}` }, val, h("p", { class: "kpi__k" }, k)));
      countUp(val, Number(v) || 0, { trigger: null, duration: 1.4 });
    });
    return;
  }
  [...box.children].forEach((el, i) => {
    const [, v, tone] = items[i];
    el.className = `kpi${tone ? ` kpi--${tone}` : ""}`;
    $(".kpi__v", el).textContent = fmtInt(Number(v) || 0);
  });
}

function renderBudgets(b) {
  const rows = [
    ["Experiments", b.experiments_used, b.experiments_total, (u, t) => `${u} / ${t}`],
    ["Compute", b.compute_seconds_used, b.compute_seconds_total, (u, t) => `${fmtSeconds(u)} / ${fmtSeconds(t)}`],
  ];
  if (b.elapsed_seconds_total > 0) {
    rows.push(["Active wall time", b.elapsed_seconds_used, b.elapsed_seconds_total, (u, t) => `${fmtSeconds(u)} / ${fmtSeconds(t)}`]);
  } else {
    rows.push(["Retries", b.retries_used, b.retries_total, (u, t) => `${u} / ${t}`]);
  }
  const box = clear($("[data-budgets]"));
  rows.forEach(([k, used, total, fmt]) => {
    const fill = h("i");
    box.append(h("div", { class: "budget" },
      h("p", { class: "budget__top" }, h("span", null, k), h("b", null, fmt(used || 0, total || 0))),
      h("div", { class: "budget__bar" }, fill)));
    const pct = total ? Math.min(100, (100 * (used || 0)) / total) : 0;
    requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = `${pct}%`)));
  });
}

function renderHyps(hyps) {
  const box = clear($("[data-hyps]"));
  if (!hyps.length) {
    box.append(h("p", { class: "empty" }, "No hypotheses yet — the mission is still planning."));
    return;
  }
  const sorted = [...hyps].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  sorted.forEach((x) => {
    const preds = x.predictions.map((p) =>
      h("li", { class: "pred" }, pill(p.outcome),
        h("span", null, p.text, p.detail ? h("span", { class: "pred__detail" }, p.detail) : null)));
    box.append(h("article", { class: "hyp" },
      h("div", { class: "hyp__side" },
        pill(x.status),
        h("p", { class: "hyp__id" }, x.id),
        h("p", { class: "hyp__ledger" },
          `+${x.supporting} / −${x.contradicting} evidence`, h("br"),
          `${x.tested_in.length} experiment${x.tested_in.length === 1 ? "" : "s"}`, h("br"),
          `importance ${Number(x.importance).toFixed(2)}`)),
      h("div", null,
        h("p", { class: "hyp__statement" }, x.statement),
        x.rationale ? h("p", { class: "hyp__rationale" }, x.rationale) : null,
        x.scope ? h("p", { class: "hyp__scope" }, `Scope — ${x.scope}`) : null,
        preds.length ? h("ul", { class: "preds" }, preds) : null,
        x.tags.length ? h("div", { class: "hyp__tags" }, x.tags.map((t) => h("span", { class: "tag" }, t))) : null)));
  });
}

function renderExperiments(exps) {
  const body = clear($("[data-exps]"));
  if (!exps.length) {
    body.append(h("tr", null, h("td", { colspan: "6", class: "empty" }, "No experiments yet.")));
    return;
  }
  exps.forEach((x) => {
    const tr = h("tr", { "data-exp": x.id, tabindex: "0", role: "button", "aria-label": `Open ${x.id}` },
      h("td", { class: "mono" }, x.id),
      h("td", null, x.title),
      h("td", { class: "mono" }, (x.design && x.design.kind) || "—"),
      h("td", null, pill(x.status)),
      h("td", { class: "mono" }, x.duration_s ? fmtSeconds(x.duration_s) : "—"),
      h("td", { class: "mono" }, "Open →"));
    const open = () => openExperiment(x.id);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    body.append(tr);
  });
}

function listInto(sel, items, render, empty) {
  const ul = clear($(sel));
  if (!items || !items.length) {
    ul.append(h("li", null, h("p", { class: "list__sub" }, empty)));
    return;
  }
  items.forEach((it) => ul.append(render(it)));
}

function renderCritic(m) {
  listInto("[data-fals]", m.falsifications, (f) =>
    h("li", null,
      h("p", { class: "list__top" }, pill(f.outcome), h("span", null, f.hypothesis_id), f.experiment_id ? h("span", null, f.experiment_id) : null),
      f.probe ? h("p", { class: "list__main mono" }, f.probe) : null,
      h("p", { class: "list__sub" }, f.detail)),
    "No falsification attempts yet.");
  listInto("[data-invalid]", m.invalidities, (i) =>
    h("li", null,
      h("p", { class: "list__top" }, pill("rejected", "not valid"), h("span", null, i.condition)),
      h("p", { class: "list__main" }, h("code", null, i.candidate), ` — ${i.reason}`)),
    "No candidate was found invalid under any tested condition.");
  listInto("[data-contra]", m.contradictions, (c) => h("li", null, h("p", { class: "list__sub" }, c.description)),
    "None detected.");
  listInto("[data-cautions]", m.cautions, (c) => h("li", null, h("p", { class: "list__sub" }, c)), "No cautions recorded.");
  listInto("[data-recs]", m.recommendations, (r) => h("li", null, h("p", { class: "list__sub" }, r)), "None recorded yet.");
}

function renderDecisions(decisions) {
  listInto("[data-decisions]", [...decisions].reverse(), (d) =>
    h("li", null,
      h("p", { class: "list__top" }, h("span", null, `step ${d.step}`), h("span", null, d.context)),
      h("p", { class: "list__main" }, "Chose ", h("code", null, d.chosen), ` — ${d.reason}`),
      d.options && d.options.length > 1
        ? h("p", { class: "list__sub mono" }, d.options.map((o) => `${o.label} ${o.score}`).join("  ·  "))
        : null),
    "No decisions recorded yet.");
}

/* -------------------------------------------------------------- events */
function groupOf(kind) {
  if (GROUPS.problem.includes(kind) || /fail|error|refused/.test(kind)) return "problem";
  for (const g of ["experiment", "critic", "hypothesis"]) if (GROUPS[g].includes(kind)) return g;
  return "lifecycle";
}

function buildFilters() {
  const box = $("[data-filters]");
  FILTERS.forEach(([key, label]) => {
    box.append(h("button", {
      class: "chip", type: "button", "aria-pressed": key === S.filter ? "true" : "false",
      onclick: () => {
        S.filter = key;
        $$(".chip", box).forEach((b) => b.setAttribute("aria-pressed", b.textContent === label ? "true" : "false"));
        renderEvents(true);
      },
    }, label));
  });
}

async function loadEvents() {
  try {
    const data = await api.events(missionId, S.next, 1000);
    if (data.events.length) {
      if (S.t0 == null) S.t0 = data.events[0].ts;
      S.events.push(...data.events);
      S.next = data.next;
      renderEvents(false, data.events);
    } else if (!S.events.length) {
      renderEvents(true);
    }
  } catch {
    /* the next poll retries */
  }
}

function eventRow(e, fresh) {
  const g = groupOf(e.kind);
  return h("div", { class: `ev${fresh ? " is-new" : ""}` },
    h("span", { class: "ev__t" }, `+${(e.ts - S.t0).toFixed(1)}s`),
    h("span", { class: "ev__k", "data-group": g, title: e.kind }, e.kind),
    h("span", { class: "ev__m" }, e.msg));
}

function visible(e) {
  if (e.kind === "heartbeat") return false;
  return S.filter === "all" || groupOf(e.kind) === S.filter;
}

function renderEvents(full, fresh = []) {
  const box = $("[data-timeline]");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (full || !box.querySelector(".ev")) {
    clear(box);
    const shown = S.events.filter(visible);
    if (!shown.length) {
      box.append(h("p", { class: "empty" }, "No events for this filter."));
      return;
    }
    shown.forEach((e) => box.append(eventRow(e, false)));
  } else {
    fresh.filter(visible).forEach((e) => box.append(eventRow(e, true)));
  }
  if (nearBottom || full) box.scrollTop = box.scrollHeight;
}

/* ------------------------------------------------------------- results */
async function loadResults() {
  try {
    S.results = (await api.results(missionId)).results || [];
  } catch {
    S.results = [];
  }
  renderResultsBar();
}

function renderResultsBar() {
  const bar = $("[data-results-bar]");
  const chart = $("[data-chart]");
  const legend = $("[data-legend]");
  if (!S.results.length) {
    bar.hidden = true;
    legend.hidden = true;
    clear(chart).append(h("p", { class: "empty" },
      S.m && S.m.run.running ? "Results appear once the run pauses or completes." : "No completed experiments yet."));
    return;
  }
  bar.hidden = false;
  legend.hidden = false;
  const select = clear($("[data-results-select]"));
  S.results.forEach((r, i) => select.append(h("option", { value: String(i) }, `${r.experiment_id} — ${r.title}`)));
  if (S.selected == null || S.selected >= S.results.length) {
    // Default to the widest benchmark: the most informative overview.
    let best = 0;
    S.results.forEach((r, i) => {
      if (r.kind === "benchmark" && r.rows.length > S.results[best].rows.length) best = i;
    });
    S.selected = best;
  }
  select.value = String(S.selected);
  select.onchange = () => {
    S.selected = Number(select.value);
    drawResult();
  };
  $$("[data-metric]").forEach((b) => {
    b.onclick = () => {
      S.metric = b.dataset.metric;
      drawResult();
    };
  });
  drawResult();
}

function drawResult() {
  const r = S.results[S.selected];
  const toggle = $("[data-metric-toggle]");
  const exact = hasMetric(r, "relaxations");
  toggle.hidden = !exact;
  if (!exact) S.metric = "mean_s";
  $$("[data-metric]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.metric === S.metric ? "true" : "false"));
  const env = r.environment || {};
  $("[data-results-env]").textContent = env.python_version
    ? `${env.python_implementation || "Python"} ${env.python_version} · ${env.system || ""}/${env.machine || ""} · ${env.cpu_count || "?"} CPU`
    : "";
  renderResult($("[data-chart]"), r, { metric: S.metric });
  refresh();
}

/* ------------------------------------------------------------- dossier */
async function loadDossier() {
  const box = $("[data-dossier]");
  let md = "";
  try {
    md = (await api.dossier(missionId)).markdown || "";
  } catch {
    clear(box).append(h("p", { class: "empty" }, "The dossier is not available yet."));
    return;
  }
  clear(box);
  if (window.marked && window.DOMPurify) {
    const html = window.marked.parse(md, { gfm: true, breaks: false });
    box.innerHTML = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
    $$("a", box).forEach((a) => a.setAttribute("rel", "noopener nofollow"));
  } else {
    box.append(h("pre", { class: "code", style: "white-space: pre-wrap" }, md));
  }
  const wrap = $("[data-dossier-wrap]");
  const more = $("[data-dossier-more]");
  more.hidden = box.scrollHeight < 760;
  more.onclick = () => {
    const open = wrap.classList.toggle("is-open");
    more.textContent = open ? "Collapse the dossier" : "Read the full dossier";
    refresh();
  };
}

/* ------------------------------------------------------------- polling */
function startPolling() {
  if (S.polling) return;
  S.polling = true;
  S.wasRunning = true;
  const tick = async () => {
    try {
      S.m = await api.mission(missionId);
      render();
      await loadEvents();
    } catch {
      /* transient: keep polling */
    }
    if (S.m.run.running) {
      setTimeout(tick, POLL_MS);
      return;
    }
    S.polling = false;
    await loadResults();
    await loadDossier();
    render();
    refresh();
  };
  setTimeout(tick, POLL_MS);
}

/* ------------------------------------------------------------ controls */
function bindControls() {
  const act = async (name, fn) => {
    const btn = $(`[data-act="${name}"]`);
    btn.disabled = true;
    try {
      await fn();
    } catch (err) {
      say(err.status === 401 ? "This server requires an access key for changes. Enter it in the lab on the home page." : err.message, "error");
    } finally {
      btn.disabled = false;
    }
  };
  $('[data-act="run"]').addEventListener("click", () =>
    act("run", async () => {
      say("Starting…");
      await api.run(missionId);
      S.m = await api.mission(missionId);
      render();
      startPolling();
    }));
  $('[data-act="pause"]').addEventListener("click", () =>
    act("pause", async () => {
      const r = await api.pause(missionId);
      say(r.deferred ? "Pause requested — it takes effect at the next checkpoint." : r.detail);
    }));
  $('[data-act="cancel"]').addEventListener("click", () =>
    act("cancel", async () => {
      if (!window.confirm("Cancel this mission? Cancellation is terminal; the record stays inspectable.")) return;
      const r = await api.cancel(missionId);
      say(r.deferred ? "Cancellation requested — it takes effect at the next checkpoint." : r.detail);
      if (!r.deferred) {
        S.m = await api.mission(missionId);
        render();
        await loadDossier();
      }
    }));
  $('[data-act="verify"]').addEventListener("click", () =>
    act("verify", async () => {
      say("Cross-checking state against artifacts and the event log…");
      const r = await api.verify(missionId);
      const status = $("[data-ctl-status]");
      status.dataset.sticky = "1";
      if (r.ok) say("Verified: counts, references, experiment artifacts and event log are consistent.", "ok");
      else say(`${r.problems.length} consistency problem(s): ${r.problems.slice(0, 3).join("; ")}`, "error");
    }));
}

/* -------------------------------------------------------------- drawer */
let lastFocus = null;

function bindDrawer() {
  $$("[data-drawer-close]").forEach((el) => el.addEventListener("click", closeDrawer));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("[data-drawer]").classList.contains("is-open")) closeDrawer();
  });
}

function openDrawerShell() {
  const d = $("[data-drawer]");
  lastFocus = document.activeElement;
  d.classList.add("is-open");
  d.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => d.classList.add("is-visible"));
  const lenis = getLenis();
  if (lenis) lenis.stop();
  document.body.style.overflow = "hidden";
  setTimeout(() => $(".drawer__close", d).focus(), 50);
}

function closeDrawer() {
  const d = $("[data-drawer]");
  d.classList.remove("is-visible");
  d.setAttribute("aria-hidden", "true");
  const lenis = getLenis();
  if (lenis) lenis.start();
  document.body.style.overflow = "";
  setTimeout(() => d.classList.remove("is-open"), 450);
  if (lastFocus) lastFocus.focus();
}

async function openExperiment(expId) {
  const body = clear($("[data-drawer-body]"));
  body.append(h("p", { class: "eyebrow" }, "Experiment"), h("h3", { id: "drawer-title" }, expId), h("p", { class: "empty" }, "Loading…"));
  openDrawerShell();
  let x;
  try {
    x = await api.experiment(missionId, expId);
  } catch (err) {
    clear(body).append(h("p", { class: "eyebrow" }, "Experiment"), h("h3", { id: "drawer-title" }, expId),
      h("p", { class: "empty" }, err.message));
    return;
  }
  const rec = x.record;
  const d = rec.design || {};
  const env = (x.result && x.result.environment) || {};
  const kv = [
    ["Status", pill(rec.status)],
    ["Kind", d.kind || "—"],
    ["Round", d.round ?? "—"],
    ["Seed", d.seed ?? "—"],
    ["Trials / cell", d.trials ?? "—"],
    ["Sizes", (d.sizes || []).join(", ") || "—"],
    ["Candidates", (d.algorithms || []).join(", ") || "—"],
    ["Regimes", (d.regimes || []).join(", ") || "—"],
    ["Hypotheses", rec.hypothesis_ids.join(", ") || "—"],
    ["Duration", rec.duration_s ? fmtSeconds(rec.duration_s) : "—"],
    ["Code digest", (x.result && x.result.code_digest) || "—"],
    ["Environment", env.python_version ? `${env.python_implementation} ${env.python_version} on ${env.system}/${env.machine}, ${env.cpu_count} CPU` : "—"],
  ];
  const canReplay = S.health && S.health.can_execute && rec.status === "completed" && !(S.m.run && S.m.run.running);
  const replayOut = h("div", { class: "replay-out" });
  // h() drops null/false children; native append() would print them.
  clear(body).append(h("div", null,
    h("p", { class: "eyebrow" }, "Experiment"),
    h("h3", { id: "drawer-title" }, rec.title),
    h("p", { class: "hyp__id" }, rec.id),
    h("h4", null, "Record"),
    h("dl", { class: "kvgrid" }, kv.map(([k, v]) => [h("dt", null, k), h("dd", null, v)])),
    rec.error ? [h("h4", null, "Error"), h("pre", { class: "code" }, rec.error)] : null,
    h("h4", null, "Reproduce"),
    h("p", { class: "list__sub" }, canReplay
      ? "Re-execute this experiment from its recorded code and config, then compare against the stored result. Exact reproducibility is asserted; timings are not."
      : "Replay re-executes the stored code in a confined subprocess, so it needs a server that can execute experiments."),
    canReplay
      ? h("button", {
          class: "btn btn--primary btn--sm", type: "button", style: "margin-top:14px",
          onclick: async (e) => {
            const b = e.currentTarget;
            b.disabled = true;
            clear(replayOut).append(h("p", { class: "list__sub" }, "Replaying…"));
            try {
              const r = await api.replay(missionId, rec.id);
              clear(replayOut).append(pill(r.ok ? "ok" : "failed", r.ok ? "Replay passed" : "Replay failed"),
                h("pre", { class: "code", style: "margin-top:12px; white-space:pre-wrap" }, r.lines.join("\n")));
            } catch (err) {
              clear(replayOut).append(h("p", { class: "list__sub" }, err.message));
            } finally {
              b.disabled = false;
            }
          },
        }, "Replay experiment")
      : null,
    replayOut,
    h("h4", null, "Generated code · run.py"),
    h("pre", { class: "code" }, x.code || "(not stored)"),
    x.log ? [h("h4", null, "Process output"), h("pre", { class: "code" }, x.log)] : null
  ));
}

/* ----------------------------------------------------------------- toc */
function bindToc() {
  const links = $$(".toc a");
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("href") === `#${entry.target.id}`));
      });
    },
    { rootMargin: "-40% 0px -55% 0px" }
  );
  $$(".msec").forEach((s) => io.observe(s));
}
