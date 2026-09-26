// Dashboard rings drawn as a sequence of dots, after the "sequence" and "matrix" shapes in Dovetail's
// Thinking component: every dot stays faintly visible so the ring reads as a track, eaten dots are lit in
// the ring's colour, planned ones half lit, and one soft glint steps slowly round the eaten arc.
// The page's SVG rings stay underneath as the fallback.

const K = 44;          // dots per ring
const TAU = Math.PI * 2;

export function createDashFx(hero, { reduceMotion = false } = {}) {
  const cv = document.createElement("canvas");
  cv.className = "fx-pt"; cv.setAttribute("aria-hidden", "true");
  hero.prepend(cv);
  const ctx = cv.getContext("2d");
  const rings = [0, 1, 2].map(() => ({ e: 0, p: 0, te: 0, tp: 0, cx: 0, cy: 0, R: 0, rgb: "20,20,20" }));
  let W = 0, H = 0, dpr = 1, running = false, visible = true, raf = 0, last = 0, clock = 0;

  function measure() {
    const hb = hero.getBoundingClientRect(); W = hb.width; H = hb.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    hero.querySelectorAll(".dial").forEach((d, i) => {
      const r = d.getBoundingClientRect(), g = rings[i]; if (!g) return;
      g.cx = r.left - hb.left + r.width / 2; g.cy = r.top - hb.top + r.height / 2; g.R = r.width * 0.43;
    });
  }

  function step(dt) {
    clock += dt;
    const k = 1 - Math.exp(-dt * 2.4); // fills ease in, so the dots light up in order
    for (const g of rings) { g.e += (g.te - g.e) * k; g.p += (g.tp - g.p) * k; }
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    for (const g of rings) {
      if (!g.R) continue;
      const dot = g.R * 0.052, head = g.e > 0.02 ? (clock * 0.07 % 1) * g.e : -1;
      for (let i = 0; i < K; i++) {
        const f = i / K, lit = f < g.e - 0.0001, planned = f < g.p - 0.0001;
        const b = lit ? 1 : planned ? 0.42 : 0;
        let glint = 0;
        if (lit && head >= 0) { const d = (head - f + 1) % 1; glint = d < 0.12 ? Math.pow(1 - d / 0.12, 1.6) : 0; }
        const a = f * TAU - Math.PI / 2;
        ctx.fillStyle = b ? `rgba(${g.rgb},${(0.2 + 0.8 * b).toFixed(3)})` : "rgba(0,0,0,.09)";
        ctx.beginPath();
        ctx.arc(g.cx + Math.cos(a) * g.R, g.cy + Math.sin(a) * g.R, dot * (0.5 + 0.5 * b + 0.35 * glint), 0, TAU);
        ctx.fill();
      }
    }
  }

  function frame(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016; last = t;
    step(dt); draw();
    raf = running ? requestAnimationFrame(frame) : 0;
  }
  function sync() {
    const want = !reduceMotion && visible && document.visibilityState === "visible";
    if (want && !running) { running = true; last = 0; raf = requestAnimationFrame(frame); }
    else if (!want && running) { running = false; cancelAnimationFrame(raf); raf = 0; }
  }
  const settle = () => { for (const g of rings) { g.e = g.te; g.p = g.tp; } draw(); };

  new ResizeObserver(() => { measure(); if (!running) settle(); }).observe(hero);
  new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; sync(); }).observe(hero);
  document.addEventListener("visibilitychange", sync);
  hero.classList.add("fx-on");
  measure();

  return {
    update(data) { // [{e: eaten 0..1, p: planned 0..1, rgb: "r,g,b"}] for each ring
      data.forEach((d, i) => { const g = rings[i]; if (!g) return; if (d.rgb) g.rgb = d.rgb;
        g.te = Math.max(0, Math.min(1, d.e)); g.tp = Math.max(g.te, Math.min(1, d.p)); });
      measure();
      if (reduceMotion) settle(); else sync();
    },
  };
}
