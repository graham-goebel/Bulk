// Pantry 3D gallery: every item in the fridge, freezer and pantry as a small procedural model,
// floating in a slowly turning sphere or stacked on shelves. Loaded only when the Pantry tab opens.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const LOCATIONS = ["Fridge", "Freezer", "Pantry"];
const PALETTE = ["#c94f3d", "#e0a33a", "#3d7cc9", "#4f9a5a", "#8a5bb5", "#d9763a", "#2f8f8a", "#b8455f", "#5b6bb5"];

// ---------- materials and geometry caches ----------
const matCache = new Map();
function mat(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({
      color, roughness: o.rough ?? 0.55, metalness: o.metal ?? 0,
      transparent: o.opacity !== undefined, opacity: o.opacity ?? 1, depthWrite: o.opacity === undefined,
    }));
  }
  return matCache.get(key);
}
const geoCache = new Map();
function geo(key, make) { if (!geoCache.has(key)) geoCache.set(key, make()); return geoCache.get(key); }
const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt, rb, h, s = 24) => geo(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s));
const sph = (r) => geo(`s${r}`, () => new THREE.SphereGeometry(r, 20, 14));
const cone = (r, h, s = 16) => geo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));

function hashColor(s) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0; return PALETTE[Math.abs(h) % PALETTE.length]; }
function mesh(g, m, x = 0, y = 0, z = 0) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); return o; }

// ---------- what each item looks like ----------
const KINDS = [
  [/egg/, "eggs"], [/banana/, "banana"], [/rice cake/, "stack"], [/berr|grape/, "berries"], [/carrot/, "carrot"],
  [/broccoli|cauliflower/, "broccoli"], [/spinach|kale|green|lettuce|salad|arugula|herb|cilantro|parsley/, "greens"],
  [/avocado/, "avocado"], [/coconut milk|bean|chickpea|lentil|tuna|sardine|crushed tomato|soup|\bcan\b/, "can"],
  [/peanut butter|almond butter|honey|salsa|marinara|tahini|jam|curry paste|pesto|mayo|mustard|\bjar\b/, "jar"],
  [/milk|kefir|juice|broth/, "carton"], [/yogurt|cottage|ricotta|sour cream|cream cheese|hummus|protein powder|whey/, "tub"],
  [/cheddar|cheese|feta|parmesan|mozzarella/, "cheese"], [/butter/, "butter"],
  [/oil|syrup|tamari|soy sauce|vinegar|sauce|dressing|ketchup/, "bottle"],
  [/salmon|cod|shrimp|fish|tilapia/, "fish"], [/chicken|beef|pork|turkey|steak|sausage|lamb|bacon|ground/, "meat"],
  [/tortilla/, "tortillas"], [/bread|bagel|loaf|bun/, "loaf"], [/chocolate|cocoa/, "bar"],
  [/apple|orange|clementine|tomato|lemon|lime|peach|pear|onion|potato|pineapple|mango|pepper|cucumber|zucchini|squash|plum|kiwi|cherr/, "fruit"],
  [/rice|oat|quinoa|pasta|pancake|granola|cereal|flour|cracker|chip|cookie/, "box"],
  [/nut|almond|walnut|pistachio|seed|chia|hemp|flax|trail mix|raisin|date/, "pouch"],
  [/water|soda|drink|coffee|tea/, "bottle"],
];
const BY_CATEGORY = { "Produce": "fruit", "Dairy & eggs": "tub", "Meat & fish": "meat", "Grains & bread": "box", "Cans & jars": "can",
  "Nuts & snacks": "pouch", "Oils & sauces": "bottle", "Frozen": "frozen", "Drinks": "bottle", "Other": "box" };
export function kindOf(item) {
  const n = String(item.name || "").toLowerCase();
  for (const [re, k] of KINDS) if (re.test(n)) return k;
  return BY_CATEGORY[item.category] || "box";
}
const FRUIT = [[/sweet potato/, "#b5532e"], [/apple/, "#d9352b"], [/clementine|orange/, "#f08a1c"], [/tomato/, "#e0432b"], [/lemon/, "#f2d33b"],
  [/lime/, "#7cc242"], [/peach/, "#f5a37a"], [/pear/, "#b9c94a"], [/onion/, "#caa472"], [/potato/, "#b88a5a"], [/pineapple/, "#e3b43a"],
  [/mango/, "#f2a531"], [/pepper/, "#d93a2b"], [/cucumber|zucchini/, "#3f7d3a"], [/plum/, "#6a2c5f"], [/kiwi/, "#8a6a3c"], [/cherr/, "#a11d2c"]];
const pick = (n, list, dflt) => { for (const [re, c] of list) if (re.test(n)) return c; return dflt; };

function build(item) {
  const n = String(item.name || "").toLowerCase(), k = kindOf(item), g = new THREE.Group(), c = hashColor(n);
  const count = Math.max(1, Math.min(3, Math.round(+item.quantity || 1)));
  const each = (m, dx) => { for (let i = 0; i < count; i++) { const o = m(); o.position.x += (i - (count - 1) / 2) * dx; g.add(o); } };
  switch (k) {
    case "eggs": {
      g.add(mesh(box(0.56, 0.1, 0.3), mat("#d8cdb8", { rough: 0.9 }), 0, 0.05));
      for (let i = 0; i < 6; i++) { const e = mesh(sph(0.07), mat("#f3e9d6", { rough: 0.7 }), -0.18 + (i % 3) * 0.18, 0.15, i < 3 ? -0.07 : 0.07); e.scale.y = 1.3; g.add(e); }
      break;
    }
    case "banana": {
      for (let i = 0; i < 3; i++) {
        const b = mesh(geo("banana", () => new THREE.TorusGeometry(0.22, 0.05, 10, 20, Math.PI * 0.75)), mat("#f1d04b"), 0, 0.28, (i - 1) * 0.09);
        b.rotation.z = Math.PI * 1.15 + i * 0.06; g.add(b);
      }
      break;
    }
    case "berries": {
      g.add(mesh(box(0.38, 0.12, 0.38), mat("#ffffff", { opacity: 0.35, rough: 0.2 }), 0, 0.06));
      const col = /straw|rasp|cherr/.test(n) ? "#c8283a" : /grape/.test(n) ? "#6b3a7a" : "#3b3f8f";
      for (let i = 0; i < 9; i++) g.add(mesh(sph(0.065), mat(col, { rough: 0.35 }), -0.11 + (i % 3) * 0.11, 0.16 + (i % 2) * 0.03, -0.11 + Math.floor(i / 3) * 0.11));
      break;
    }
    case "carrot": {
      each(() => { const t = new THREE.Group(); const cn = mesh(cone(0.07, 0.46), mat("#ef7d1a"), 0, 0.23); cn.rotation.z = Math.PI; t.add(cn);
        t.add(mesh(cone(0.05, 0.14, 8), mat("#4f9a3a"), 0, 0.53)); return t; }, 0.16);
      break;
    }
    case "broccoli": {
      g.add(mesh(cyl(0.05, 0.07, 0.22), mat("#8fb86a"), 0, 0.11));
      [[0, 0.3, 0, 0.12], [0.1, 0.27, 0.05, 0.09], [-0.1, 0.27, 0.04, 0.09], [0.02, 0.26, -0.1, 0.09], [0.05, 0.36, 0.06, 0.08]]
        .forEach(([x, y, z, r]) => g.add(mesh(sph(r), mat("#3f7a2f", { rough: 0.9 }), x, y, z)));
      break;
    }
    case "greens": {
      g.add(mesh(box(0.4, 0.46, 0.14), mat("#7cb35a", { opacity: 0.85, rough: 0.3 }), 0, 0.23));
      g.add(mesh(box(0.41, 0.1, 0.15), mat("#ffffff"), 0, 0.36));
      break;
    }
    case "avocado": { each(() => { const a = mesh(sph(0.12), mat("#3c5a2a", { rough: 0.8 }), 0, 0.15); a.scale.set(1, 1.3, 1); return a; }, 0.2); break; }
    case "fruit": {
      const col = pick(n, FRUIT, "#d9352b");
      if (/pineapple/.test(n)) { const p = mesh(sph(0.15), mat(col, { rough: 0.9 }), 0, 0.2); p.scale.y = 1.4; g.add(p); g.add(mesh(cone(0.1, 0.22, 7), mat("#4f8a3a"), 0, 0.49)); break; }
      const potato = /potato/.test(n);
      each(() => { const t = new THREE.Group(); const f = mesh(sph(0.14), mat(col, { rough: potato ? 0.95 : 0.4 }), 0, 0.14); if (potato) f.scale.set(1.35, 0.8, 0.9); t.add(f);
        if (!potato && !/onion|cucumber|zucchini|pepper/.test(n)) t.add(mesh(cyl(0.01, 0.01, 0.07, 6), mat("#5a3a1e"), 0, 0.3)); return t; }, 0.24);
      break;
    }
    case "carton": {
      const band = /kefir/.test(n) ? "#4f9a5a" : /juice/.test(n) ? "#f08a1c" : /chocolate/.test(n) ? "#6b3e26" : "#3d7cc9";
      g.add(mesh(box(0.24, 0.4, 0.24), mat("#f7f7f4"), 0, 0.2));
      g.add(mesh(box(0.245, 0.14, 0.245), mat(band), 0, 0.22));
      const top = mesh(cone(0.175, 0.12, 4), mat("#f7f7f4"), 0, 0.46); top.rotation.y = Math.PI / 4; g.add(top);
      break;
    }
    case "tub": {
      const big = /protein|whey/.test(n);
      const r = big ? 0.17 : 0.16, h = big ? 0.36 : 0.18;
      g.add(mesh(cyl(r, r * 0.92, h), mat(big ? "#2b2b2b" : "#f7f5ee"), 0, h / 2));
      g.add(mesh(cyl(r + 0.01, r + 0.01, 0.03), mat(c), 0, h + 0.015));
      break;
    }
    case "cheese": {
      const col = /feta|mozz/.test(n) ? "#f4f1e8" : /parm/.test(n) ? "#efd98f" : "#f2b43a";
      const w = mesh(geo("wedge", () => new THREE.CylinderGeometry(0.28, 0.28, 0.16, 16, 1, false, 0, Math.PI / 3)), mat(col, { rough: 0.7 }), 0, 0.08);
      w.rotation.y = -Math.PI / 6 + Math.PI; w.position.z = 0.12; g.add(w);
      break;
    }
    case "butter": { g.add(mesh(box(0.32, 0.1, 0.13), mat("#f6e7a1", { rough: 0.8 }), 0, 0.05)); g.add(mesh(box(0.325, 0.04, 0.135), mat("#ffffff"), 0, 0.05)); break; }
    case "jar": {
      const fill = pick(n, [[/peanut/, "#b07a3c"], [/almond/, "#a26a3a"], [/honey/, "#d9941c"], [/salsa|marinara/, "#c0392b"], [/tahini/, "#d8c09a"],
        [/jam/, "#6b2a4a"], [/curry/, "#d9763a"], [/pesto/, "#5a8a3a"], [/mayo/, "#f5f1e0"], [/mustard/, "#e0b02a"]], c);
      g.add(mesh(cyl(0.12, 0.12, 0.24), mat(fill, /honey/.test(n) ? { opacity: 0.85, rough: 0.2 } : { rough: 0.4 }), 0, 0.12));
      g.add(mesh(cyl(0.125, 0.125, 0.06), mat("#e9e6df", { metal: 0.3, rough: 0.35 }), 0, 0.27));
      break;
    }
    case "bottle": {
      const col = pick(n, [[/olive/, "#9aa63a"], [/sesame/, "#b8862b"], [/maple|syrup/, "#8a4a1c"], [/tamari|soy/, "#3a2a1e"], [/vinegar/, "#7a2a2a"], [/water/, "#bfe0f2"]], c);
      g.add(mesh(cyl(0.09, 0.09, 0.32), mat(col, { opacity: 0.85, rough: 0.15 }), 0, 0.16));
      g.add(mesh(cyl(0.035, 0.07, 0.1), mat(col, { opacity: 0.85, rough: 0.15 }), 0, 0.37));
      g.add(mesh(cyl(0.04, 0.04, 0.05), mat("#2b2b2b"), 0, 0.44));
      break;
    }
    case "can": {
      g.add(mesh(cyl(0.12, 0.12, 0.24), mat("#c9ccd1", { metal: 0.8, rough: 0.3 }), 0, 0.12));
      g.add(mesh(cyl(0.123, 0.123, 0.15), mat(c), 0, 0.12));
      break;
    }
    case "meat": case "fish": {
      const col = k === "fish" ? pick(n, [[/salmon/, "#f48a5c"], [/shrimp/, "#f5a07a"]], "#f1efe6")
        : pick(n, [[/beef|steak/, "#b2393a"], [/pork/, "#e8a0a0"], [/sausage/, "#9c4a3a"], [/bacon/, "#c65a4a"]], "#f1c7b0");
      g.add(mesh(box(0.44, 0.05, 0.3), mat("#ffffff", { rough: 0.9 }), 0, 0.025));
      const s = mesh(k === "fish" ? sph(0.15) : box(0.36, 0.08, 0.24), mat(col, { rough: 0.7 }), 0, 0.09);
      if (k === "fish") s.scale.set(1.3, 0.35, 0.75); g.add(s);
      g.add(mesh(box(0.45, 0.14, 0.31), mat("#ffffff", { opacity: 0.25, rough: 0.1 }), 0, 0.07));
      break;
    }
    case "loaf": {
      g.add(mesh(box(0.42, 0.2, 0.22), mat("#c8904f", { rough: 0.9 }), 0, 0.1));
      const t = mesh(geo("loaftop", () => new THREE.CylinderGeometry(0.11, 0.11, 0.42, 16, 1, false, 0, Math.PI)), mat("#b87a3c", { rough: 0.9 }), 0, 0.2);
      t.rotation.z = Math.PI / 2; t.rotation.x = Math.PI / 2; g.add(t);
      break;
    }
    case "tortillas": { for (let i = 0; i < 5; i++) g.add(mesh(cyl(0.22, 0.22, 0.015), mat(i % 2 ? "#ead7a6" : "#e2c98e", { rough: 0.9 }), 0, 0.01 + i * 0.017)); break; }
    case "stack": { for (let i = 0; i < 5; i++) g.add(mesh(cyl(0.13, 0.13, 0.04), mat("#ede0c4", { rough: 1 }), 0, 0.02 + i * 0.042)); break; }
    case "bar": { g.add(mesh(box(0.34, 0.03, 0.17), mat("#4a2a1a"), 0, 0.015)); g.add(mesh(box(0.2, 0.035, 0.175), mat(c), 0, 0.015)); break; }
    case "pouch": {
      g.add(mesh(box(0.3, 0.36, 0.1), mat(c, { rough: 0.4 }), 0, 0.18));
      g.add(mesh(box(0.14, 0.12, 0.102), mat("#f3e6cf", { rough: 0.9 }), 0, 0.15));
      break;
    }
    case "frozen": {
      g.add(mesh(box(0.38, 0.42, 0.12), mat("#cfe6f5", { opacity: 0.85, rough: 0.25 }), 0, 0.21));
      g.add(mesh(box(0.2, 0.12, 0.122), mat(c), 0, 0.22));
      break;
    }
    default: {
      g.add(mesh(box(0.3, 0.38, 0.12), mat(c, { rough: 0.5 }), 0, 0.19));
      g.add(mesh(box(0.302, 0.12, 0.122), mat("#fbfaf6"), 0, 0.22));
    }
  }
  // center the model on its bounding box so it spins in place
  const bb = new THREE.Box3().setFromObject(g), ctr = bb.getCenter(new THREE.Vector3());
  g.children.forEach((ch) => ch.position.sub(ctr));
  return g;
}

function textSprite(text) {
  const cv = document.createElement("canvas"), s = 2, fs = 44 * s;
  const cx = cv.getContext("2d"); cx.font = `500 ${fs}px Geist, system-ui, sans-serif`;
  cv.width = Math.ceil(cx.measureText(text).width) + 24 * s; cv.height = fs * 1.5;
  cx.font = `500 ${fs}px Geist, system-ui, sans-serif`; cx.fillStyle = "#141414"; cx.textBaseline = "middle"; cx.fillText(text, 12 * s, cv.height / 2);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  sp.scale.set(cv.width / cv.height * 0.34, 0.34, 1); return sp;
}

// A product photo (already cut out) as a flat card that always faces the camera.
function photoSprite(canvas) {
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, toneMapped: false, alphaTest: 0.02 }));
  const a = canvas.width / canvas.height; let h = 0.66, w = h * a; if (w > 0.8) { w = 0.8; h = w / a; }
  sp.scale.set(w, h, 1); sp.userData.h = h; return sp;
}

export function createPantryScene(container, { onPick, onHover, loadImage } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.9;
  const sun = new THREE.DirectionalLight("#ffffff", 1.4); sun.position.set(3, 6, 5); scene.add(sun);
  scene.add(new THREE.HemisphereLight("#ffffff", "#e8e4dc", 0.6));

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  camera.position.set(0, 0.6, 11);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.enablePan = false;
  controls.minDistance = 2.5; controls.maxDistance = 30; controls.autoRotate = true; controls.autoRotateSpeed = 0.5;
  let idle = null;
  controls.addEventListener("start", () => { controls.autoRotate = false; clearTimeout(idle); });
  controls.addEventListener("end", () => { clearTimeout(idle); idle = setTimeout(() => { if (layout === "sphere") controls.autoRotate = true; }, 6000); });

  const root = new THREE.Group(); scene.add(root);
  const shelves = new THREE.Group(); scene.add(shelves); shelves.visible = false;
  const objs = new Map(); // id -> { g, item, sig, pos, scale }
  let layout = "sphere", visible = null, selected = null, camGoal = null, itemScale = 1.7;

  // shelf furniture for the shelves layout
  const SHELF_W = 3.3, SHELF_GAP = 1.0, COLS = 4;
  function buildShelves(rowsBy) {
    shelves.clear();
    LOCATIONS.forEach((loc, li) => {
      const x0 = (li - 1) * (SHELF_W + 0.7), rows = Math.max(2, rowsBy[loc] || 0), h = rows * SHELF_GAP;
      const unit = new THREE.Group(); unit.position.x = x0;
      const frame = mat(loc === "Pantry" ? "#e9e1d3" : "#f4f5f6", { rough: 0.8 });
      unit.add(mesh(box(SHELF_W, h + 0.1, 0.06), frame, 0, h / 2 - 0.05, -0.45));
      unit.add(mesh(box(0.06, h + 0.1, 0.9), frame, -SHELF_W / 2, h / 2 - 0.05, 0));
      unit.add(mesh(box(0.06, h + 0.1, 0.9), frame, SHELF_W / 2, h / 2 - 0.05, 0));
      for (let r = 0; r <= rows; r++) unit.add(mesh(box(SHELF_W, 0.04, 0.9), loc === "Pantry" ? frame : mat("#dfe8ee", { opacity: 0.6, rough: 0.1 }), 0, r * SHELF_GAP - 0.1, 0));
      const lab = textSprite(loc); lab.position.set(0, h + 0.3, 0); unit.add(lab);
      shelves.add(unit);
    });
  }

  // Camera distance that fits a w x h area in view at the current aspect ratio.
  function fitDist(w, h) {
    const v = THREE.MathUtils.degToRad(camera.fov) / 2, hz = Math.atan(Math.tan(v) * camera.aspect);
    return Math.max((h / 2) / Math.tan(v), (w / 2) / Math.tan(hz)) + 0.8;
  }
  function layoutTargets() {
    const list = [...objs.values()].filter((o) => !visible || visible.has(o.item.id));
    list.sort((a, b) => LOCATIONS.indexOf(a.item.location) - LOCATIONS.indexOf(b.item.location) || a.item.category.localeCompare(b.item.category) || a.item.name.localeCompare(b.item.name));
    objs.forEach((o) => { o.scale = 0; });
    if (layout === "sphere") {
      const n = list.length, R = Math.min(6, Math.max(1.6, 0.9 + Math.sqrt(n) * 0.5)), ga = Math.PI * (3 - Math.sqrt(5));
      itemScale = 1.7;
      list.forEach((o, i) => {
        const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
        if (n === 1) o.pos.set(0, 0, 0); else o.pos.set(Math.cos(th) * r * R, y * R, Math.sin(th) * r * R);
        o.scale = 1;
      });
      shelves.visible = false; camGoal = { dist: fitDist(2 * R + 1.4, 2 * R + 1.4), target: new THREE.Vector3(0, 0, 0) };
    } else {
      const by = {}; LOCATIONS.forEach((l) => by[l] = list.filter((o) => o.item.location === l));
      const rowsBy = {}; LOCATIONS.forEach((l) => rowsBy[l] = Math.ceil(by[l].length / COLS));
      buildShelves(rowsBy); shelves.visible = true;
      let maxH = 2;
      LOCATIONS.forEach((l, li) => {
        const x0 = (li - 1) * (SHELF_W + 0.7), rows = Math.max(2, rowsBy[l]); maxH = Math.max(maxH, rows);
        by[l].forEach((o, i) => { const row = Math.floor(i / COLS), col = i % COLS;
          o.pos.set(x0 - SHELF_W / 2 + 0.33 + col * ((SHELF_W - 0.66) / (COLS - 1)), (rows - 1 - row) * SHELF_GAP + 0.22, 0.05); o.scale = 1; });
      });
      const H = maxH * SHELF_GAP; itemScale = 1.25;
      camGoal = { dist: fitDist(3 * SHELF_W + 2 * 0.7 + 0.6, H + 1.2), target: new THREE.Vector3(0, H / 2, 0) };
    }
    controls.autoRotate = layout === "sphere";
    root.rotation.set(0, 0, 0);
  }

  function setItems(items) {
    const seen = new Set();
    items.forEach((it) => {
      seen.add(it.id);
      const sig = [it.name, it.category, it.location, Math.min(3, Math.round(+it.quantity || 1)), it.expires, it.image || ""].join("|");
      let o = objs.get(it.id);
      if (!o || o.sig !== sig) {
        const g = build(it); g.userData.id = it.id;
        const soon = it.expires && (new Date(it.expires + "T23:59:59") - Date.now()) / 864e5 < 3;
        const addDot = (top) => { const dot = mesh(sph(0.045), mat("#d64532", { rough: 0.4 })); dot.position.set(0, top + 0.09, 0); g.add(dot); };
        if (soon) addDot(new THREE.Box3().setFromObject(g).max.y);
        // Swap the generic model for the product photo once it has loaded and been cut out.
        if (it.image && loadImage) {
          const id = it.id;
          loadImage(it.image).then((cv) => {
            const cur = objs.get(id); if (!cv || !cur || cur.sig !== sig) return;
            g.clear(); const sp = photoSprite(cv); g.add(sp); if (soon) addDot(sp.userData.h / 2);
          }).catch(() => {});
        }
        if (o) { g.position.copy(o.g.position); g.scale.copy(o.g.scale); root.remove(o.g); } else g.scale.setScalar(0.001);
        root.add(g);
        o = { g, item: it, sig, pos: o ? o.pos : new THREE.Vector3(), scale: 0 }; objs.set(it.id, o);
      }
      o.item = it;
    });
    [...objs.keys()].forEach((id) => { if (!seen.has(id)) { root.remove(objs.get(id).g); objs.delete(id); } });
    layoutTargets();
  }
  function setVisible(ids) { visible = ids; layoutTargets(); }
  function setLayout(m) { layout = m; layoutTargets(); camGoal.dir = new THREE.Vector3(0, m === "sphere" ? 0.08 : 0.1, 1).normalize(); }
  function select(id) { selected = id; }

  // picking and hover
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hit(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const found = ray.intersectObjects(root.children, true).find((h) => { let p = h.object; while (p && !p.userData.id) p = p.parent; return p && objs.get(p.userData.id).scale > 0; });
    if (!found) return null; let p = found.object; while (!p.userData.id) p = p.parent; return p.userData.id;
  }
  let down = null, hover = null;
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener("pointerup", (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6) { const id = hit(e); if (onPick) onPick(id); } down = null; });
  el.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const id = hit(e); el.style.cursor = id ? "pointer" : "grab";
    if (id !== hover || id) { hover = id; if (onHover) onHover(id, e.clientX, e.clientY); }
  });
  el.addEventListener("pointerleave", () => { hover = null; if (onHover) onHover(null); });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px";
    const was = camera.aspect; camera.aspect = w / h; camera.updateProjectionMatrix();
    if (Math.abs(was - camera.aspect) > 0.05 && objs.size) { const d = camGoal && camGoal.dir; layoutTargets(); if (d) camGoal.dir = d; }
  }
  const ro = new ResizeObserver(resize); ro.observe(container); resize();

  const clock = new THREE.Clock();
  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05), k = 1 - Math.pow(0.001, dt);
    objs.forEach((o, id) => {
      o.g.position.lerp(o.pos, k);
      const s = o.scale * itemScale * (id === selected ? 1.3 : 1), cur = o.g.scale.x + (s - o.g.scale.x) * k;
      o.g.scale.setScalar(Math.max(cur, 0.0001)); o.g.visible = cur > 0.01;
      o.g.rotation.y += dt * (id === selected ? 1.2 : 0.25);
    });
    if (camGoal) {
      controls.target.lerp(camGoal.target, k * 0.6);
      const off = camera.position.clone().sub(controls.target), d = off.length(), nd = d + (camGoal.dist - d) * k * 0.6;
      if (camGoal.dir) off.normalize().lerp(camGoal.dir, k * 0.6);
      off.setLength(nd); camera.position.copy(controls.target).add(off);
      if (Math.abs(nd - camGoal.dist) < 0.02 && controls.target.distanceTo(camGoal.target) < 0.02 && (!camGoal.dir || off.clone().normalize().distanceTo(camGoal.dir) < 0.01)) camGoal = null;
    }
    controls.update(); renderer.render(scene, camera);
  }
  return {
    setItems, setVisible, setLayout, select, resize,
    start() { clock.getDelta(); renderer.setAnimationLoop(tick); },
    stop() { renderer.setAnimationLoop(null); },
    recenter() { layoutTargets(); },
  };
}
