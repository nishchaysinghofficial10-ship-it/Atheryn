// Motion layer: Lenis smooth scrolling driven by the GSAP ticker, plus the
// reveal primitives every page shares. When GSAP is unavailable or the
// visitor prefers reduced motion, every helper degrades to "already shown".

const root = document.documentElement;
export const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const finePointer = window.matchMedia("(pointer: fine)").matches;

let lenis = null;
let enabled = false;

export function motionEnabled() {
  return enabled;
}

export function initMotion() {
  const g = window.gsap;
  if (reduced || !g || !window.ScrollTrigger) {
    root.classList.remove("has-motion");
    window.__atherynMotion = "static";
    bindAnchors();
    return null;
  }
  const plugins = [window.ScrollTrigger];
  if (window.SplitText) plugins.push(window.SplitText);
  g.registerPlugin(...plugins);
  g.defaults({ ease: "expo.out", duration: 1.1 });
  enabled = true;
  window.__atherynMotion = "gsap";

  if (window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.09, smoothWheel: true, wheelMultiplier: 1 });
    lenis.on("scroll", window.ScrollTrigger.update);
    g.ticker.add((time) => lenis.raf(time * 1000));
    g.ticker.lagSmoothing(0);
  }
  bindAnchors();
  return lenis;
}

export function getLenis() {
  return lenis;
}

export function scrollToTarget(target, offset = 0) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (lenis) {
    lenis.scrollTo(el || 0, { offset, duration: 1.6, easing: (t) => 1 - Math.pow(1 - t, 4) });
  } else if (el) {
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  } else {
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  }
}

function bindAnchors() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute("href");
    if (!id || id.length < 2) return;
    const el = document.getElementById(id.slice(1));
    if (!el) return;
    e.preventDefault();
    scrollToTarget(el, id === "#top" ? 0 : -8);
    history.replaceState(null, "", id);
  });
}

// Masked line reveal for headings.
export function revealLines(el, { delay = 0, start = "top 86%", stagger = 0.09 } = {}) {
  if (!enabled || !el) return;
  const g = window.gsap;
  if (!window.SplitText) {
    g.from(el, { opacity: 0, y: 40, delay, scrollTrigger: { trigger: el, start, once: true } });
    return;
  }
  window.SplitText.create(el, {
    type: "lines",
    mask: "lines",
    linesClass: "split-line",
    autoSplit: true,
    onSplit(self) {
      return g.from(self.lines, {
        yPercent: 108,
        duration: 1.25,
        stagger,
        delay,
        scrollTrigger: { trigger: el, start, once: true },
      });
    },
  });
}

// Words brighten as the paragraph crosses the viewport.
export function scrubWords(el) {
  if (!el) return;
  const words = el.textContent.trim().split(/\s+/);
  el.textContent = "";
  words.forEach((w, i) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = w;
    el.append(span);
    if (i < words.length - 1) el.append(" ");
  });
  if (!enabled) return;
  window.gsap.fromTo(
    el.querySelectorAll(".word"),
    { opacity: 0.13 },
    {
      opacity: 1,
      ease: "none",
      stagger: 0.12,
      scrollTrigger: { trigger: el, start: "top 82%", end: "bottom 48%", scrub: 0.6 },
    }
  );
}

// Fade-and-rise for blocks, batched for cheap scroll work.
export function rise(selector = "[data-rise]") {
  const items = document.querySelectorAll(selector);
  if (!items.length) return;
  if (!enabled) {
    items.forEach((el) => {
      el.style.opacity = 1;
      el.style.transform = "none";
    });
    return;
  }
  window.ScrollTrigger.batch(items, {
    start: "top 90%",
    once: true,
    onEnter: (batch) =>
      window.gsap.to(batch, { opacity: 1, y: 0, duration: 1.2, stagger: 0.1, overwrite: true }),
  });
}

export function countUp(el, to, { decimals = 0, duration = 1.6, trigger = el, suffix = "" } = {}) {
  if (!el) return;
  const fmt = (v) =>
    (decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString("en-US")) + suffix;
  if (!enabled || !Number.isFinite(to)) {
    el.textContent = Number.isFinite(to) ? fmt(to) : "—";
    return;
  }
  const state = { v: 0 };
  el.textContent = fmt(0);
  window.gsap.to(state, {
    v: to,
    duration,
    ease: "power3.out",
    scrollTrigger: trigger ? { trigger, start: "top 88%", once: true } : undefined,
    onUpdate: () => (el.textContent = fmt(state.v)),
  });
}

// Navigation: tint once scrolled, hide while scrolling down, return on up.
export function bindNav(nav) {
  if (!nav) return;
  let lastY = window.scrollY;
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    nav.classList.toggle("is-scrolled", y > 24);
    const down = y > lastY + 4;
    const up = y < lastY - 4;
    if (down && y > 320) nav.classList.add("is-hidden");
    else if (up || y < 120) nav.classList.remove("is-hidden");
    lastY = y;
    ticking = false;
  };
  window.addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true }
  );
  nav.addEventListener("focusin", () => nav.classList.remove("is-hidden"));
  update();
}

// Buttons lean toward the pointer, a little.
export function magnetic(selector = "[data-magnetic]") {
  if (!enabled || !finePointer) return;
  const g = window.gsap;
  document.querySelectorAll(selector).forEach((el) => {
    const xTo = g.quickTo(el, "x", { duration: 0.6, ease: "power3.out" });
    const yTo = g.quickTo(el, "y", { duration: 0.6, ease: "power3.out" });
    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      xTo((e.clientX - (r.left + r.width / 2)) * 0.22);
      yTo((e.clientY - (r.top + r.height / 2)) * 0.32);
    });
    el.addEventListener("pointerleave", () => {
      xTo(0);
      yTo(0);
    });
  });
}

export async function fontsReady(timeout = 1600) {
  if (!document.fonts || !document.fonts.ready) return;
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, timeout))]);
}

export function refresh() {
  if (enabled) window.ScrollTrigger.refresh();
}
