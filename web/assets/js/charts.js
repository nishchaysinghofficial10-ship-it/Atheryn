// Ranked bar charts for one experiment's results, one block per regime.
// Plain DOM so text stays crisp and selectable; bars animate with GSAP.

import { h, clear, fmtMetric } from "./lib/dom.js";
import { motionEnabled } from "./lib/motion.js";

function unique(list) {
  return [...new Set(list)];
}

export function hasMetric(result, metric) {
  return (result.rows || []).some((r) => Number.isFinite(r[metric]));
}

export function renderResult(container, result, { metric = "mean_s" } = {}) {
  clear(container);
  const rows = (result.rows || []).filter((r) => Number.isFinite(r[metric]));
  if (!rows.length) {
    container.append(h("p", { class: "empty" }, "No measurements for this metric."));
    return;
  }
  const timing = metric === "mean_s";
  const designed = (result.design && result.design.regimes) || [];
  const regimes = unique([...designed, ...rows.map((r) => r.regime)]).filter((g) =>
    rows.some((r) => r.regime === g)
  );
  const bars = [];

  for (const regime of regimes) {
    const inRegime = rows.filter((r) => r.regime === regime);
    const n = Math.max(...inRegime.map((r) => r.n));
    const cells = inRegime.filter((r) => r.n === n).sort((a, b) => a[metric] - b[metric]);
    const max = Math.max(...cells.map((r) => r[metric] + (timing ? r.stdev_s || 0 : 0))) || 1;
    const best = cells.find((r) => r.correct !== false);

    const block = h("div", { class: "chart__block" },
      h("h4", null, h("span", null, regime), h("span", null, `n = ${n}`)));
    const list = h("div", { class: "chart__rows" });
    for (const r of cells) {
      const bad = r.correct === false;
      const v = r[metric];
      const bar = h("span", { class: "crow__bar" });
      bar.style.width = `${Math.max(0.6, (v / max) * 100)}%`;
      const track = h("span", { class: "crow__track" }, bar);
      if (timing && Number.isFinite(r.stdev_s) && r.stdev_s > 0) {
        const err = h("span", { class: "crow__err" });
        const lo = Math.max(0, v - r.stdev_s);
        const hi = v + r.stdev_s;
        err.style.left = `${(lo / max) * 100}%`;
        err.style.width = `${((hi - lo) / max) * 100}%`;
        track.append(err);
      }
      const cls = ["crow", bad ? "is-bad" : "", r === best ? "is-best" : ""].join(" ").trim();
      const title = bad
        ? `${r.algorithm}: incorrect output on ${regime} — excluded from ranking`
        : `${r.algorithm}: ${fmtMetric(v, metric)}${r.trials ? ` over ${r.trials} trials` : ""}`;
      list.append(h("div", { class: cls, title },
        h("span", { class: "crow__name" }, r.algorithm),
        track,
        h("span", { class: "crow__val" }, bad ? "incorrect" : fmtMetric(v, metric))));
      bars.push(bar);
    }
    block.append(list);
    container.append(block);
  }

  if (motionEnabled() && bars.length) {
    window.gsap.fromTo(bars, { scaleX: 0 }, { scaleX: 1, duration: 1.2, stagger: 0.015, ease: "expo.out" });
  }
}
