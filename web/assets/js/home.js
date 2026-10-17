import { api, ApiError, engineStatus, setToken, getToken } from "./lib/api.js";
import { $, $$, h, clear, pill, statusLabel, pad2, fmtInt, params } from "./lib/dom.js";
import {
  initMotion, motionEnabled, reduced, revealLines, scrubWords, rise, countUp,
  bindNav, magnetic, fontsReady, refresh,
} from "./lib/motion.js";
import { createField } from "./field.js";

const STORY_MISSION = "graph_mission";
const state = { meta: null, health: null };

boot();

async function boot() {
  initMotion();
  bindNav($("[data-nav]"));
  await fontsReady();

  const field = createField($("[data-field]"), { reduced });
  hero(field);
  scrubWords($(".statement [data-scrub-words]"));
  scrubWords($(".rule [data-scrub-words]"));
  method();
  evidenceMotion();
  limitsStrike();
  wordmark();
  $$("[data-split]").forEach((el) => revealLines(el));
  rise();
  magnetic();

  // Live data. Each section degrades to its static, README-sourced copy.
  const [health, meta] = await Promise.all([
    api.health().catch(() => null),
    api.meta().catch(() => null),
  ]);
  state.health = health;
  state.meta = meta;
  engineStatus($("[data-engine-status]"), health);
  if (health) $$("[data-version]").forEach((el) => (el.textContent = `v${health.version}`));

  await Promise.allSettled([evidenceData(), insideStory(), archive(), rules(meta)]);
  lab(meta, health);
  refresh();
}

/* ------------------------------------------------------------------ hero */
function hero(field) {
  const section = $("[data-hero]");
  const title = $("[data-hero-title]");
  const captions = $$("[data-caption]");
  let current = 0;
  const setCaption = (p) => {
    const idx = p < 0.3 ? 0 : p < 0.64 ? 1 : 2;
    if (idx === current) return;
    current = idx;
    captions.forEach((c, i) => c.classList.toggle("is-on", i === idx));
  };

  if (!motionEnabled()) {
    title.classList.add("is-split");
    const onScroll = () => {
      const p = Math.min(1, window.scrollY / (section.offsetHeight || 1));
      field.setProgress(p);
      setCaption(p);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return;
  }

  const g = window.gsap;
  if (window.SplitText) {
    window.SplitText.create(title, {
      type: "lines",
      mask: "lines",
      linesClass: "split-line",
      autoSplit: true,
      onSplit(self) {
        title.classList.add("is-split");
        return g.from(self.lines, { yPercent: 112, duration: 1.6, stagger: 0.11, delay: 0.15 });
      },
    });
  } else {
    title.classList.add("is-split");
    g.from(title, { opacity: 0, y: 40, duration: 1.4 });
  }
  g.to("[data-hero-in]", { opacity: 1, y: 0, duration: 1.3, stagger: 0.09, delay: 0.75 });

  const mm = g.matchMedia();
  mm.add({ wide: "(min-width: 700px)", narrow: "(max-width: 699px)" }, (ctx) => {
    const { wide } = ctx.conditions;
    g.timeline({
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: wide ? "+=120%" : "bottom top",
        pin: wide,
        scrub: true,
        onUpdate: (self) => {
          field.setProgress(self.progress);
          setCaption(self.progress);
        },
      },
    })
      .to(".hero__inner", { yPercent: wide ? -10 : -6, opacity: wide ? 0.22 : 0.4, ease: "none" }, 0)
      .to(".hero__meta", { opacity: 0, ease: "none" }, 0.1);
  });
}

/* ---------------------------------------------------------------- method */
function prepareGlyph(stage) {
  const shapes = $$(".stage__glyph circle:not(.fill), .stage__glyph path:not(.dash), .stage__glyph rect:not(.fill)", stage);
  shapes.forEach((s) => {
    const len = typeof s.getTotalLength === "function" ? Math.ceil(s.getTotalLength()) : 400;
    s.style.strokeDasharray = `${len}`;
    s.style.strokeDashoffset = `${len}`;
  });
  const extras = $$(".stage__glyph .fill, .stage__glyph .dash", stage);
  window.gsap.set(extras, { opacity: 0 });
  return { shapes, extras };
}

function drawGlyph({ shapes, extras }, scrollTrigger) {
  const g = window.gsap;
  const tl = g.timeline({ scrollTrigger });
  tl.to(shapes, { strokeDashoffset: 0, duration: 1.8, ease: "power2.inOut", stagger: 0.12 })
    .to(extras, { opacity: 1, duration: 0.8, ease: "power2.out" }, "-=0.8");
  return tl;
}

function method() {
  if (!motionEnabled()) return;
  const g = window.gsap;
  const section = $("[data-method]");
  const track = $("[data-method-track]");
  const stages = $$(".stage", track);
  const bar = $("[data-method-progress]");
  const count = $("[data-method-count]");
  const total = stages.length;

  const mm = g.matchMedia();
  mm.add("(min-width: 900px)", () => {
    const distance = () => Math.max(0, track.scrollWidth - window.innerWidth);
    const tween = g.to(track, {
      x: () => -distance(),
      ease: "none",
      scrollTrigger: {
        trigger: section,
        start: "top top",
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 1,
        anticipatePin: 1,
        invalidateOnRefresh: true,
        onUpdate: (self) => {
          const n = Math.min(total, 1 + Math.floor(self.progress * total * 0.999));
          count.textContent = `${pad2(n)} / ${pad2(total)}`;
          bar.style.transform = `scaleX(${Math.max(1 / total, self.progress)})`;
        },
      },
    });
    stages.forEach((stage) => {
      const parts = prepareGlyph(stage);
      drawGlyph(parts, { trigger: stage, containerAnimation: tween, start: "left 82%", once: true });
      g.from(stage, {
        opacity: 0.25, y: 30, duration: 1,
        scrollTrigger: { trigger: stage, containerAnimation: tween, start: "left 95%", once: true },
      });
    });
  });
  mm.add("(max-width: 899px)", () => {
    stages.forEach((stage) => {
      const parts = prepareGlyph(stage);
      drawGlyph(parts, { trigger: stage, start: "top 80%", once: true });
    });
  });
}

/* -------------------------------------------------------------- evidence */
function evidenceMotion() {
  if (!motionEnabled()) return;
  const sheet = $("[data-evidence-sheet]");
  window.gsap.fromTo(
    sheet,
    { clipPath: "inset(9% 6% 0% 6% round 56px)" },
    {
      clipPath: "inset(0% 0% 0% 0% round 40px)",
      ease: "none",
      scrollTrigger: { trigger: "[data-evidence]", start: "top 96%", end: "top 12%", scrub: true },
    }
  );
}

function parseConclusion(text) {
  const m = /^(.*?)\s*\[scope:\s*(.*)\]\s*$/.exec(text || "");
  if (!m) return { claim: text, scope: "" };
  const scope = m[2]
    .replace(/\[|\]|'/g, "")
    .replace(/n<=/g, "n ≤ ")
    .replace(/2x/g, "2×")
    .replace(/does NOT/g, "does not");
  return { claim: m[1], scope: scope.charAt(0).toUpperCase() + scope.slice(1) };
}

async function evidenceData() {
  let data = null;
  try {
    data = await api.evaluation();
  } catch {
    data = null;
  }
  const res = data && data.results;
  const workflows = res && res.workflows;
  if (workflows) {
    const pick = {
      experiments: (w) => w.experiments,
      conclusions: (w) => (w.conclusions || []).length,
      scoped_conclusions: (w) => w.scoped_conclusions,
      replications: (w) => w.replications,
      incorrect: (w) => (w.incorrect_candidates_reported_as_winners || []).length,
    };
    $$("[data-compare]").forEach((row) => {
      const get = pick[row.dataset.compare];
      $$("[data-v]", row).forEach((cell) => {
        const w = workflows[cell.dataset.v];
        const v = w && get ? Number(get(w)) : NaN;
        if (Number.isFinite(v)) cell.textContent = String(v);
      });
    });
    const pre = res.pre_registration || {};
    if (pre.registered_at) $("[data-prereg-date]").textContent = pre.registered_at.slice(0, 10);
    if (pre.question) $("[data-eval-question]").textContent = pre.question;
    const ours = workflows.atheryn_full;
    if (ours && Array.isArray(ours.conclusions) && ours.conclusions.length) {
      const list = clear($("[data-eval-conclusions]"));
      ours.conclusions.forEach((c) => {
        const { claim, scope } = parseConclusion(c);
        list.append(h("li", null, h("p", { class: "conclusions__claim" }, claim),
          scope ? h("p", { class: "conclusions__scope" }, scope) : null));
      });
    }
  }
  $$("[data-compare] [data-v]").forEach((cell) => {
    countUp(cell, Number(cell.textContent), { trigger: cell.parentElement, duration: 1.4 });
  });
}

/* ---------------------------------------------------------------- inside */
const BEAT_KINDS = new Set([
  "init", "hypothesis", "counterargument", "decision", "experiment_completed",
  "correctness_boundary", "analysis", "replicated", "falsification", "accepted",
  "critic_review", "stopped",
]);
const GROUPED = new Set(["hypothesis", "correctness_boundary"]);

function stripId(msg) {
  return String(msg || "").replace(/^(hyp|exp|prop)_[0-9a-f]+(\s*\([^)]*\))?:\s*/i, "");
}

function beatCopy(kind, events, mission) {
  const first = events[0];
  const msg = first.msg || "";
  switch (kind) {
    case "init":
      return { label: "Registered", title: "A question and a budget", body: mission.question };
    case "hypothesis":
      return { label: "Hypotheses", title: `${events.length} competing explanations`, list: events.map((e) => stripId(e.msg)) };
    case "counterargument":
      return { label: "Proposal layer", title: "A counterargument is filed as a caution — not as evidence", body: msg.replace(/^prop_[0-9a-f]+ against hyp_[0-9a-f]+:\s*/, "") };
    case "decision": {
      const ctx = (/^\[(\w+)\]/.exec(msg) || [])[1] || "";
      const reason = msg.split(" — ").slice(1).join(" — ");
      const title = ctx === "critic_replication" ? "The critic refuses single-experiment support"
        : ctx === "critic_falsification" ? "The critic designs an attack"
        : "Choose the most informative test";
      return { label: "Decision", title, body: reason || msg };
    }
    case "experiment_completed": {
      const m = /^(exp_[0-9a-f]+) completed in ([\d.]+)s \((\d+) measurements\)/.exec(msg);
      return m
        ? { label: "Experiment", title: `${m[3]} measurements in ${m[2]} s`, body: `${m[1]} — generated code, seed and raw results stored with the mission.` }
        : { label: "Experiment", title: "An experiment completes", body: msg };
    }
    case "correctness_boundary":
      return { label: "Correctness", title: "The fastest candidate is caught returning wrong answers", list: events.map((e) => e.msg) };
    case "analysis":
      return { label: "Analysis", title: "Winners are named only where the data is decisive", body: msg };
    case "replicated":
      return { label: "Replication", title: "Survives an independent replication", body: msg };
    case "falsification": {
      const survived = /probe survived/.test(msg);
      const failed = /probe failed/.test(msg);
      return {
        label: "Falsification",
        title: survived ? "Survives an attack at 2× size and unseen topologies" : failed ? "Fails a falsification probe" : "A probe is inconclusive — and recorded as such",
        body: msg,
      };
    }
    case "accepted":
      return { label: "Accepted", title: "Accepted — with its scope written down", body: msg.replace(/^hyp_[0-9a-f]+ ACCEPTED_WITH_SCOPE — /, "") };
    case "critic_review":
      return { label: "Critic", title: "Final review of every conclusion", body: msg };
    case "stopped":
      return { label: "Stopped", title: "Complete, with an explicit stop reason", body: msg.replace(/^Mission COMPLETED:\s*/, "") };
    default:
      return { label: kind, title: msg };
  }
}

function buildBeats(events, mission) {
  const beats = [];
  for (const e of events) {
    if (!BEAT_KINDS.has(e.kind)) continue;
    const prev = beats[beats.length - 1];
    if (prev && GROUPED.has(e.kind) && prev.kind === e.kind) {
      prev.events.push(e);
      prev.ts = e.ts;
      continue;
    }
    // A decision and the experiment it launched read as one beat.
    if (prev && prev.kind === "decision" && e.kind === "experiment_completed" && !prev.ran) {
      prev.ran = e;
      prev.ts = e.ts;
      continue;
    }
    beats.push({ kind: e.kind, events: [e], ts: e.ts });
  }
  return beats.map((b) => {
    const copy = beatCopy(b.kind, b.events, mission);
    if (b.ran) copy.body = `${copy.body ? copy.body + " " : ""}→ ${b.ran.msg}`;
    return { ...b, ...copy };
  });
}

function statusAt(hyp, T, expStart) {
  if (T < hyp.created_at - 1e-6) return null;
  const changes = (hyp.revisions || []).map((r) => ({ ts: r.ts, to: r.to }));
  const firstTest = (hyp.tested_in || []).map((id) => expStart[id]).filter(Number.isFinite).sort((a, b) => a - b)[0];
  const firstRev = changes.length ? Math.min(...changes.map((c) => c.ts)) : Infinity;
  if (Number.isFinite(firstTest) && firstTest < firstRev) changes.push({ ts: firstTest, to: "under_test" });
  changes.sort((a, b) => a.ts - b.ts);
  let s = "proposed";
  for (const c of changes) if (c.ts <= T + 1e-6) s = c.to;
  return s;
}

async function insideStory() {
  const beatsEl = $("[data-beats]");
  const list = $("[data-ledger-list]");
  let mission, events;
  try {
    [mission, events] = await Promise.all([api.mission(STORY_MISSION), api.events(STORY_MISSION, 0, 1000)]);
  } catch {
    clear(list).append(h("li", { class: "ledger__empty" }, "The mission record is unavailable right now."));
    return;
  }
  const evs = events.events || [];
  if (!evs.length) return;
  const t0 = evs[0].ts;
  const expStart = Object.fromEntries((mission.experiments || []).map((x) => [x.id, x.created_at]));
  const beats = buildBeats(evs, mission);

  clear(list);
  const rows = mission.hypotheses.map((hyp) => {
    const p = pill("untested", "Not yet");
    const li = h("li", { class: "ledger__item is-dormant" }, h("p", { class: "ledger__text" }, hyp.statement), p);
    list.append(li);
    return { hyp, li, pill: p, status: undefined };
  });

  clear(beatsEl);
  beats.forEach((b, i) => {
    beatsEl.append(
      h("li", { class: "beat", "data-beat": i },
        h("p", { class: "beat__meta" },
          h("span", { class: "beat__kind" }, b.label),
          h("span", null, `+${(b.ts - t0).toFixed(1)} s`)),
        h("h3", { class: "beat__title" }, b.title),
        b.list ? h("ul", { class: "beat__list" }, b.list.map((x) => h("li", null, x))) : null,
        b.body && b.body !== b.title ? h("p", { class: "beat__msg" }, b.body) : null)
    );
  });

  const clock = $("[data-ledger-clock]");
  const cExp = $("[data-ledger-exp]");
  const cRep = $("[data-ledger-rep]");
  const cFal = $("[data-ledger-fal]");
  const count = (kind, T) => evs.filter((e) => e.kind === kind && e.ts <= T + 1e-6).length;

  const apply = (i) => {
    const b = beats[i];
    const T = b.ts;
    clock.textContent = `+${(T - t0).toFixed(1)} s`;
    cExp.textContent = count("experiment_completed", T);
    cRep.textContent = count("replicated", T);
    cFal.textContent = count("falsification", T);
    const touched = new Set(b.events.map((e) => (e.refs && e.refs.hypothesis) || (/(hyp_[0-9a-f]+)/.exec(e.msg) || [])[1]).filter(Boolean));
    rows.forEach((r) => {
      const s = statusAt(r.hyp, T, expStart);
      r.li.classList.toggle("is-dormant", !s);
      r.li.classList.toggle("is-focus", touched.has(r.hyp.id));
      if (s === r.status) return;
      r.status = s;
      r.pill.dataset.status = s || "untested";
      r.pill.textContent = s ? statusLabel(s) : "Not yet";
      if (motionEnabled()) window.gsap.fromTo(r.pill, { scale: 0.8, opacity: 0.2 }, { scale: 1, opacity: 1, duration: 0.6 });
    });
    $$(".beat", beatsEl).forEach((el, k) => el.classList.toggle("is-active", k === i));
  };

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) apply(Number(entry.target.dataset.beat));
      });
    },
    { rootMargin: "-48% 0px -48% 0px" }
  );
  $$(".beat", beatsEl).forEach((el) => io.observe(el));
  apply(0);
}

/* ------------------------------------------------------------------ rule */
async function rules(meta) {
  const rule = (meta && meta.decisive_rule) || { min_trials: 5, k_sem: 3, min_rel_margin: 0.1 };
  const values = {
    min_trials: rule.min_trials,
    k_sem: rule.k_sem,
    min_rel_margin: Math.round(rule.min_rel_margin * 100),
  };
  $$("[data-rule]").forEach((el) => countUp(el, Number(values[el.dataset.rule]), { duration: 1.8 }));
}

/* --------------------------------------------------------------- archive */
async function archive() {
  const list = $("[data-archive]");
  let missions;
  try {
    missions = (await api.missions()).missions || [];
  } catch {
    clear(list).append(h("li", { class: "archive__empty" }, "The archive is unavailable right now."));
    return;
  }
  const shipped = missions.filter((m) => m.source === "example").length;
  $$('[data-stat="missions"]').forEach((el) => (el.textContent = String(shipped)));
  clear(list);
  if (!missions.length) {
    list.append(h("li", { class: "archive__empty" }, "No missions yet."));
    return;
  }
  const LIMIT = 8;
  const row = (m, i) => {
    const c = m.counts || {};
    return h("li", { class: "mrow", "data-rise": "" },
      h("a", { href: `/missions/${encodeURIComponent(m.id)}` },
        h("span", { class: "mrow__n" }, pad2(i + 1)),
        h("div", null,
          h("p", { class: "mrow__q" }, m.question || m.id),
          h("p", { class: "mrow__id" }, m.id)),
        h("div", { class: "mrow__meta" },
          h("span", { class: m.source === "user" ? "tag tag--user" : "tag" }, m.source === "user" ? "This server" : "Shipped"),
          h("span", null, m.domain),
          pill(m.phase, m.run && m.run.running ? "Running" : statusLabel(m.phase)),
          h("span", null, "hyp ", h("b", null, fmtInt(c.hypotheses))),
          h("span", null, "exp ", h("b", null, fmtInt(c.experiments))),
          h("span", null, "accepted ", h("b", null, fmtInt(m.accepted)))),
        h("span", { class: "mrow__arrow", "aria-hidden": "true" }, "→")));
  };
  missions.slice(0, LIMIT).forEach((m, i) => list.append(row(m, i)));
  if (missions.length > LIMIT) {
    const more = h("li", { class: "archive__empty" },
      h("button", {
        class: "btn btn--ghost btn--sm", type: "button",
        onclick: () => {
          more.remove();
          missions.slice(LIMIT).forEach((m, i) => list.append(row(m, i + LIMIT)));
          $$(".mrow", list).forEach((el) => { el.style.opacity = 1; el.style.transform = "none"; });
          refresh();
        },
      }, `Show all ${missions.length} missions`));
    list.append(more);
  }
  rise(".archive [data-rise]");
}

/* ------------------------------------------------------------------- lab */
function lab(meta, health) {
  const form = $("[data-lab-form]");
  const status = $("[data-lab-status]");
  const submit = $("[data-submit]");
  const notice = $("[data-lab-notice]");
  const q = form.elements.question;
  const chars = $("[data-chars]");
  const limits = (meta && meta.limits) || null;

  const say = (text, tone) => {
    status.textContent = text || "";
    if (tone) status.dataset.tone = tone;
    else delete status.dataset.tone;
  };

  if (limits) {
    $$("[data-limit]").forEach((el) => {
      const v = limits[el.dataset.limit];
      el.textContent = Array.isArray(v) ? v.join(", ") : String(v);
    });
    form.elements.max_experiments.max = String(limits.max_experiments);
    form.elements.compute_minutes.max = String(limits.max_compute_minutes);
    $$('input[name="brain"]', form).forEach((input) => {
      const ok = (limits.brains || []).includes(input.value);
      input.disabled = !ok;
      input.closest("label").style.opacity = ok ? "" : "0.4";
    });
  }
  if (meta && meta.write_requires_token) $("[data-token-field]").hidden = false;
  if (getToken()) form.elements.token.value = getToken();

  const canRun = !!(health && health.can_execute);
  if (!health) {
    notice.hidden = false;
    notice.textContent = "The engine is unreachable, so missions cannot be started from this page right now.";
  } else if (!canRun) {
    notice.hidden = false;
    notice.textContent =
      "This server can show missions but cannot execute experiments: ATHERYN confines every experiment with POSIX rlimits, so the engine must run on Linux or macOS. Deploy it to start missions here.";
  }
  submit.disabled = !canRun;

  // Domain-appropriate placeholder, prefill from ?q= / ?domain=.
  const domains = Object.fromEntries(((meta && meta.domains) || []).map((d) => [d.name, d]));
  const syncPlaceholder = () => {
    const d = domains[form.elements.domain.value];
    if (d && d.example_question) q.placeholder = d.example_question;
  };
  $$('input[name="domain"]', form).forEach((r) => r.addEventListener("change", syncPlaceholder));
  const p = params();
  if (p.get("domain") && domains[p.get("domain")]) form.elements.domain.value = p.get("domain");
  if (p.get("q")) q.value = p.get("q").slice(0, 300);
  syncPlaceholder();

  const syncChars = () => (chars.textContent = String(q.value.length));
  q.addEventListener("input", syncChars);
  syncChars();

  const ranges = [
    ["max_experiments", (v) => String(v)],
    ["compute_minutes", (v) => `${v} min`],
  ];
  ranges.forEach(([name, fmt]) => {
    const input = form.elements[name];
    const out = $(`[data-out="${name}"]`, form);
    const sync = () => {
      const pct = ((input.value - input.min) / (input.max - input.min || 1)) * 100;
      input.style.setProperty("--fill", `${pct}%`);
      out.textContent = fmt(input.value);
    };
    input.addEventListener("input", sync);
    sync();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const question = q.value.trim() || q.placeholder;
    if (question.length < 8) {
      say("Write a question of at least 8 characters.", "error");
      q.focus();
      return;
    }
    if (form.elements.token.value) setToken(form.elements.token.value.trim());
    submit.disabled = true;
    say("Registering the mission…");
    try {
      const m = await api.create({
        question,
        domain: form.elements.domain.value,
        max_experiments: Number(form.elements.max_experiments.value),
        compute_minutes: Number(form.elements.compute_minutes.value),
        brain: form.querySelector('input[name="brain"]:checked').value,
        autostart: true,
      });
      say("Mission registered. Opening mission control…");
      window.location.href = `/missions/${encodeURIComponent(m.id)}`;
    } catch (err) {
      submit.disabled = !canRun;
      if (err instanceof ApiError && err.status === 401) {
        $("[data-token-field]").hidden = false;
        setToken("");
        say("This server needs an access key for new missions.", "error");
        form.elements.token.focus();
        return;
      }
      say(err.message || "Could not start the mission.", "error");
    }
  });
}

/* ---------------------------------------------------------------- limits */
function limitsStrike() {
  $$("[data-strike]").forEach((item) => {
    const span = $(".limits__line span", item);
    if (!motionEnabled()) {
      span.style.setProperty("--strike", "100%");
      return;
    }
    span.style.setProperty("--strike", "0%");
    window.gsap.to(span, {
      "--strike": "100%",
      ease: "none",
      scrollTrigger: { trigger: item, start: "top 78%", end: "top 42%", scrub: 0.5 },
    });
  });
}

/* -------------------------------------------------------------- wordmark */
function wordmark() {
  const mark = $("[data-wordmark]");
  if (!mark) return;
  const text = mark.textContent.trim();
  clear(mark);
  [...text].forEach((ch) => mark.append(h("span", { class: "ch" }, ch)));
  if (!motionEnabled()) return;
  window.gsap.from($$(".ch", mark), {
    yPercent: 60,
    opacity: 0,
    stagger: 0.06,
    ease: "power3.out",
    scrollTrigger: { trigger: mark, start: "top 98%", end: "bottom bottom", scrub: 1 },
  });
}
