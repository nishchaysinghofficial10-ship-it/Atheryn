// The hero "hypothesis field": a slowly turning sphere of candidate ideas.
// Scroll progress (0..1) drives the story told in the captions — most points
// disperse and fade (they did not survive an experiment), a few brighten and
// settle into a single trace (the scoped conclusion).

const SIGNAL = "185, 242, 154";
const PAPER = "236, 235, 228";

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function createField(canvas, { reduced = false } = {}) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return { setProgress() {}, destroy() {} };

  const small = window.matchMedia("(max-width: 700px)").matches;
  const N = small ? 1100 : 2600;
  const SURVIVORS = small ? 5 : 7;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  let seed = 1234; // deterministic, like everything else here
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  const pts = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = GOLDEN * i;
    pts.push({
      x: Math.cos(th) * r, y, z: Math.sin(th) * r,
      dir: rnd() * Math.PI * 2, speed: 0.35 + rnd() * 1.25,
      tw: rnd() * Math.PI * 2, survivor: false,
    });
  }
  for (let k = 0; k < SURVIVORS; k++) {
    pts[Math.floor(((k + 0.5) * N) / SURVIVORS)].survivor = true;
  }

  let W = 0, H = 0, cx = 0, cy = 0, R = 0;
  let progress = 0, target = 0;
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  let rot = 0.6, last = 0, raf = 0, running = false, visible = true;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const vh = Math.min(H, window.innerHeight || H);
    cx = small ? W * 0.5 : W * 0.7;
    cy = small ? vh * 0.34 : vh * 0.44;
    R = Math.min(W, vh) * (small ? 0.34 : 0.34);
  }

  function traceTarget(k) {
    const t = SURVIVORS === 1 ? 0.5 : k / (SURVIVORS - 1);
    return {
      x: cx - R * (small ? 0 : 0.18) + (t - 0.5) * R * 2,
      y: cy + R * 0.42 - t * R * 0.95 + Math.sin(t * Math.PI * 1.5) * R * 0.12,
    };
  }

  function draw(t) {
    ctx.clearRect(0, 0, W, H);
    const fall = smooth(0.16, 0.62, progress);
    const glow = smooth(0.1, 0.38, progress);
    const lock = smooth(0.52, 0.94, progress);

    const ry = rot + mx * 0.4;
    const rx = -0.34 + my * 0.22;
    const cY = Math.cos(ry), sY = Math.sin(ry), cX = Math.cos(rx), sX = Math.sin(rx);
    const F = 2.7;

    // orbit ring
    ctx.globalAlpha = 0.07 * (1 - fall);
    ctx.strokeStyle = `rgb(${PAPER})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 1.32, R * 0.36, -0.18, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgb(${PAPER})`;
    const surv = [];
    for (const p of pts) {
      let x = p.x * cY - p.z * sY;
      let z = p.x * sY + p.z * cY;
      const y = p.y * cX - z * sX;
      z = p.y * sX + z * cX;
      const s = F / (F + z);
      let px = cx + x * R * s;
      let py = cy + y * R * s;
      const depth = (1 - z) / 2;
      if (p.survivor) {
        surv.push({ px, py, depth });
        continue;
      }
      if (fall > 0) {
        const d = fall * (50 + p.speed * 170);
        px += Math.cos(p.dir) * d;
        py += Math.sin(p.dir) * d * 0.55 + fall * fall * 140 * p.speed;
      }
      const a = (0.06 + depth * depth * 0.72) * (1 - fall * 0.94) * (0.72 + 0.28 * Math.sin(t * 1.3 + p.tw));
      if (a < 0.012) continue;
      const size = 0.8 + depth * 1.1;
      ctx.globalAlpha = a;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }

    surv.forEach((q, k) => {
      const tg = traceTarget(k);
      q.x = q.px + (tg.x - q.px) * lock;
      q.y = q.py + (tg.y - q.py) * lock;
    });

    if (lock > 0.01) {
      ctx.globalAlpha = 0.6 * lock;
      ctx.strokeStyle = `rgb(${SIGNAL})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      surv.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
      // scope brackets at both ends of the trace
      const a0 = surv[0], a1 = surv[surv.length - 1];
      ctx.globalAlpha = 0.35 * lock;
      ctx.strokeStyle = `rgb(${PAPER})`;
      for (const [q, dir] of [[a0, -1], [a1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(q.x + dir * 18, q.y - 14);
        ctx.lineTo(q.x + dir * 24, q.y - 14);
        ctx.lineTo(q.x + dir * 24, q.y + 14);
        ctx.lineTo(q.x + dir * 18, q.y + 14);
        ctx.stroke();
      }
    }

    for (const q of surv) {
      const r = 1.3 + glow * 1.7 + lock * 0.7;
      if (glow > 0.02) {
        ctx.globalAlpha = 0.13 * glow;
        ctx.fillStyle = `rgb(${SIGNAL})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r * 6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = glow > 0.02 ? 0.45 + 0.55 * glow : 0.25 + q.depth * 0.5;
      ctx.fillStyle = glow > 0.02 ? `rgb(${SIGNAL})` : `rgb(${PAPER})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function frame(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    progress += (target - progress) * Math.min(1, dt * 5);
    mx += (tmx - mx) * Math.min(1, dt * 2.5);
    my += (tmy - my) * Math.min(1, dt * 2.5);
    rot += dt * 0.055 * (1 - progress * 0.7);
    draw(now / 1000);
    raf = running ? requestAnimationFrame(frame) : 0;
  }

  function start() {
    if (running || reduced) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const onPointer = (e) => {
    tmx = (e.clientX / window.innerWidth - 0.5) * 2;
    tmy = (e.clientY / window.innerHeight - 0.5) * 2;
  };
  const onResize = () => {
    resize();
    if (!running) draw(0);
  };
  const onVisibility = () => (document.hidden || !visible ? stop() : start());

  resize();
  draw(0);
  window.addEventListener("resize", onResize);
  if (!reduced && window.matchMedia("(pointer: fine)").matches) {
    window.addEventListener("pointermove", onPointer, { passive: true });
  }
  document.addEventListener("visibilitychange", onVisibility);
  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    visible && !document.hidden ? start() : stop();
  });
  io.observe(canvas);

  return {
    setProgress(v) {
      target = Math.min(1, Math.max(0, v));
      if (reduced) {
        progress = target;
        draw(0);
      }
    },
    destroy() {
      stop();
      io.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
