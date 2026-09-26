// Dashboard hero: a slow gradient shader behind three particle rings.
// Each ring is a stream of particles flowing clockwise; the arc that's been eaten glows solid,
// the planned-but-not-eaten arc is dimmer, and the rest is loose drifting dust.
// Falls back to the page's SVG rings if WebGL isn't available (the particles are 2D canvas).

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
const FRAG = `precision mediump float;
uniform vec2 r;uniform float t;uniform float p;
float h(vec2 q){return fract(sin(dot(q,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 q){vec2 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 q){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(q);q=q*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv=gl_FragCoord.xy/r;vec2 q=uv*vec2(r.x/r.y,1.)*1.5;float T=t*.045;
  vec2 w=vec2(fbm(q+vec2(0.,T)),fbm(q+vec2(5.2,1.3)-T));
  float f=fbm(q+2.2*w+vec2(T*.6,-T*.3));
  vec3 col=vec3(.06,.05,.1);
  col=mix(col,vec3(.40,.30,.92),smoothstep(.3,.8,f)*.85);
  col=mix(col,vec3(.10,.62,.70),smoothstep(.35,.85,w.x)*.6);
  col=mix(col,vec3(1.,.48,.30),smoothstep(.45,.9,w.y)*(.35+.5*p));
  col=mix(col,vec3(.95,.35,.65),smoothstep(.62,.95,f*w.x*1.6)*.45);
  col*=.78+.35*smoothstep(1.25,.15,length(uv-vec2(.5,.62)));
  col+=(h(gl_FragCoord.xy+fract(t))-.5)*.035;
  gl_FragColor=vec4(col,1.);
}`;

function shaderLayer(canvas) {
  const gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false, powerPreference: "low-power" });
  if (!gl) return null;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const ur = gl.getUniformLocation(prog, "r"), ut = gl.getUniformLocation(prog, "t"), up = gl.getUniformLocation(prog, "p");
  return (time, prog01) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(ur, canvas.width, canvas.height); gl.uniform1f(ut, time); gl.uniform1f(up, prog01);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

const COUNT = 120;
function makeRing(seed) {
  let s = seed * 9301 + 49297; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const ps = [];
  for (let i = 0; i < COUNT; i++) ps.push({ a: i / COUNT + rnd() * 0.004, rj: rnd() * 2 - 1, sp: 0.018 + rnd() * 0.01, ph: rnd() * 6.28, st: 0, sz: 0.7 + rnd() * 0.6 });
  return { ps, e: 0, p: 0, te: 0, tp: 0, sparks: [], cx: 0, cy: 0, R: 0 };
}

export function createDashFx(hero, { reduceMotion = false } = {}) {
  const bg = document.createElement("canvas"), pt = document.createElement("canvas");
  bg.className = "fx-bg"; pt.className = "fx-pt"; bg.setAttribute("aria-hidden", "true"); pt.setAttribute("aria-hidden", "true");
  hero.prepend(bg, pt);
  let drawBg = null;
  try { drawBg = shaderLayer(bg); } catch (e) { drawBg = null; }
  if (!drawBg) bg.remove();
  const ctx = pt.getContext("2d");
  const rings = [makeRing(1), makeRing(2), makeRing(3)];
  const halo = document.createElement("canvas"); halo.width = halo.height = 32; // soft glow sprite for eaten particles
  { const h = halo.getContext("2d"), gr = h.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,244,230,1)"); gr.addColorStop(0.35, "rgba(255,232,210,.35)"); gr.addColorStop(1, "rgba(255,220,200,0)");
    h.fillStyle = gr; h.fillRect(0, 0, 32, 32); }
  let W = 0, H = 0, dpr = 1, running = false, visible = true, raf = 0, last = 0, clock = Math.random() * 100;

  function measure() {
    const hb = hero.getBoundingClientRect(); W = hb.width; H = hb.height; dpr = Math.min(window.devicePixelRatio || 1, 2);
    pt.width = Math.round(W * dpr); pt.height = Math.round(H * dpr);
    if (drawBg) { const k = Math.min(dpr, 1.5) * 0.5; bg.width = Math.max(2, Math.round(W * k)); bg.height = Math.max(2, Math.round(H * k)); }
    hero.querySelectorAll(".dial").forEach((d, i) => {
      const r = d.getBoundingClientRect(), g = rings[i]; if (!g) return;
      g.cx = r.left - hb.left + r.width / 2; g.cy = r.top - hb.top + r.height / 2; g.R = r.width * 0.43;
    });
  }

  function step(dt) {
    clock += dt;
    for (const g of rings) {
      const k = 1 - Math.exp(-dt * 3); g.e += (g.te - g.e) * k; g.p += (g.tp - g.p) * k;
      for (const q of g.ps) {
        q.a = (q.a + q.sp * dt) % 1;
        const tgt = q.a < g.e ? 1 : q.a < g.p ? 0.5 : 0;
        q.st += (tgt - q.st) * (1 - Math.exp(-dt * 6));
      }
      // sparks shed from the leading edge of the eaten arc
      if (g.e > 0.01 && g.e < 0.995 && Math.random() < dt * 9) {
        const th = g.e * Math.PI * 2 - Math.PI / 2;
        g.sparks.push({ th, r: g.R, vr: 6 + Math.random() * 14, vt: 0.25 + Math.random() * 0.5, life: 0, max: 0.9 + Math.random() * 0.8 });
      }
      for (const s of g.sparks) { s.life += dt; s.r += s.vr * dt; s.th += s.vt * dt; }
      g.sparks = g.sparks.filter(s => s.life < s.max);
    }
  }

  function draw() {
    const prog = rings[0].e;
    if (drawBg) drawBg(clock, Math.min(1, prog));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    for (const g of rings) {
      if (!g.R) continue;
      const head = g.e;
      for (const q of g.ps) {
        const th = q.a * Math.PI * 2 - Math.PI / 2, st = q.st;
        const loose = 1 - Math.min(1, st * 2);                   // 1 for dust, 0 once planned or eaten
        const wob = Math.sin(clock * 0.9 + q.ph) * (0.03 + loose * 0.09);
        const R = g.R * (1 + q.rj * (0.035 + loose * 0.1) + wob);
        let d = Math.abs(q.a - head); d = Math.min(d, 1 - d);
        const glow = head > 0.01 && head < 0.995 ? Math.exp(-((d / 0.035) ** 2)) : 0;
        const lit = Math.max(0, st * 2 - 1);                     // 0 below planned, 1 when eaten
        const a = 0.1 + Math.min(1, st * 2) * 0.2 + lit * 0.7, size = (0.55 + st * 0.35 + lit * 0.45 + glow * 0.9) * q.sz;
        const x = g.cx + Math.cos(th) * R, y = g.cy + Math.sin(th) * R;
        if (lit > 0.05) { const hs = (5 + glow * 7) * q.sz; ctx.globalAlpha = lit * (0.22 + glow * 0.35); ctx.drawImage(halo, x - hs, y - hs, hs * 2, hs * 2); ctx.globalAlpha = 1; }
        ctx.fillStyle = `rgba(255,255,255,${Math.min(1, a).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(x, y, size, 0, 6.2832); ctx.fill();
      }
      for (const s of g.sparks) {
        const f = 1 - s.life / s.max;
        ctx.fillStyle = `rgba(255,236,214,${(f * 0.8).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(g.cx + Math.cos(s.th) * s.r, g.cy + Math.sin(s.th) * s.r, 0.6 + f, 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
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
  const settle = () => { // one still frame with the rings at their final state
    for (const g of rings) { g.e = g.te; g.p = g.tp; for (const q of g.ps) q.st = q.a < g.e ? 1 : q.a < g.p ? 0.5 : 0; g.sparks = []; }
    draw();
  };

  const ro = new ResizeObserver(() => { measure(); if (!running) settle(); }); ro.observe(hero);
  const io = new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; sync(); }); io.observe(hero);
  document.addEventListener("visibilitychange", sync);
  hero.classList.add("fx-on");
  measure();

  return {
    update(data) { // [{e: eaten 0..1, p: planned 0..1}] for each ring
      data.forEach((d, i) => { const g = rings[i]; if (!g) return; g.te = Math.max(0, Math.min(1, d.e)); g.tp = Math.max(g.te, Math.min(1, d.p)); });
      measure();
      if (reduceMotion) settle(); else sync();
    },
  };
}
