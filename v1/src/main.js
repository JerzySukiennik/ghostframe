// Ghostframe: app core (scene, state, undo, storage, playback and generated frames)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createRobot, makeMaterials, boneIndex, BODY_NAMES } from './optimus.js';
import { applyPose, standPose, buildPreset, mirrorPose, clonePose, HAND_PRESETS } from './pose.js';
import { buildPlan, evaluate, frameTimes, groundPath, footprints } from './anim.js';
import { initEditor, GROUPS } from './editor.js';
import { initUI } from './ui.js';

const STORE = 'ghostframe.v1';
const MOBILE = matchMedia('(pointer: coarse)').matches;
const MAX_ONION = MOBILE ? 24 : 36;
const THEMES = {
  light: {
    bg: 0xe9eaec, floor: 0xf6f6f7, line: 0x171a20, lineA: 0.075, shadow: 0.2, env: 0.95, hemi: 0.55, key: 2.3, rim: 1.0,
    ghost: { a: 0x8ea6cc, b: 0x2f3a4a, rim: 0x3e6ae1 }, sel: 0x3e6ae1, path: 0x171a20, meta: '#e9eaec',
  },
  dark: {
    bg: 0x0e0f11, floor: 0x1e2024, line: 0xffffff, lineA: 0.06, shadow: 0.5, env: 0.6, hemi: 0.3, key: 2.7, rim: 1.7,
    ghost: { a: 0xb9cdf2, b: 0x4a5770, rim: 0x9fbaff }, sel: 0x6f97ff, path: 0xffffff, meta: '#0e0f11',
  },
};
const GHOST_STYLE = {
  sel: { o: 0.52, k: 1.5 }, key: { o: 0.26, k: 0.8 }, play: { o: 0.13, k: 0.6 }, onion: { o: 0.07, k: 0.45 },
};

const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const container = document.getElementById('app');
const canvas = document.getElementById('c');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
camera.position.set(0.9, 1.9, 6.2);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.85, 0.3);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.minDistance = 0.8;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.495;
controls.zoomToCursor = true;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemi = new THREE.HemisphereLight(0xffffff, 0xb9bcc2, 0.55);
const key = new THREE.DirectionalLight(0xffffff, 2.3);
key.castShadow = true;
key.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 4;
const rim = new THREE.DirectionalLight(0xdfe8ff, 1.0);
rim.position.set(-4, 3.5, -5);
scene.add(hemi, key, key.target, rim);

const floorMat = new THREE.ShaderMaterial({
  uniforms: {
    uCenter: { value: new THREE.Color() }, uEdge: { value: new THREE.Color() }, uLine: { value: new THREE.Color() },
    uLineA: { value: 0.07 }, uFocus: { value: new THREE.Vector2() },
  },
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    uniform vec3 uCenter; uniform vec3 uEdge; uniform vec3 uLine; uniform float uLineA; uniform vec2 uFocus;
    varying vec3 vW;
    float grid(vec2 q) { vec2 g = abs(fract(q - 0.5) - 0.5) / fwidth(q); return 1.0 - min(min(g.x, g.y), 1.0); }
    void main() {
      float d = length(vW.xz - uFocus);
      vec3 c = mix(uCenter, uEdge, smoothstep(1.5, 16.0, d));
      float l = max(grid(vW.xz * 2.0) * 0.55, grid(vW.xz * 0.5));
      c = mix(c, uLine, l * uLineA * (1.0 - smoothstep(2.5, 12.0, d)));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), floorMat);
floor.renderOrder = -3;
const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false }));
shadowPlane.position.y = 0.001;
shadowPlane.receiveShadow = true;
shadowPlane.renderOrder = -2;
scene.add(floor, shadowPlane);

const pathMat = new THREE.LineDashedMaterial({ color: 0x171a20, dashSize: 0.07, gapSize: 0.06, transparent: true, opacity: 0.3, depthWrite: false });
const pathLine = new THREE.Line(new THREE.BufferGeometry(), pathMat);
pathLine.position.y = 0.003;
pathLine.renderOrder = -1;
const printShape = new THREE.Shape();
printShape.absellipse(0, 0, 0.043, 0.1, 0, Math.PI * 2, false, 0);
const printMat = new THREE.MeshBasicMaterial({ color: 0x171a20, transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide });
const prints = new THREE.InstancedMesh(new THREE.ShapeGeometry(printShape, 12).rotateX(-Math.PI / 2), printMat, 600);
prints.count = 0;
prints.renderOrder = -1;
prints.frustumCulled = false;
scene.add(pathLine, prints);

const mats = makeMaterials();
const solid = createRobot('solid', mats);
scene.add(solid.root);
const scratch = createRobot('none');
const onion = [];

const BONE_INDEX = boneIndex();

const app = {
  renderer, scene, camera, controls, container,
  keys: [], ghosts: [], sel: -1, joint: null, time: 0, playing: false,
  settings: { onion: true, fps: 60, follow: false, loop: true, theme: 'light' },
  plan: buildPlan([], scratch), frameCount: 0, showHint: false,
};

let nextId = 1, planDirty = true, needs = true, endWait = 0, saveT = 0, tween = null;
const history = [];
let hIndex = -1;
const tmp = new THREE.Vector3();

function sanitize(p) {
  const s = standPose(p);
  const out = { ...s, ...p, q: { ...s.q, ...(p.q || {}) }, hands: { L: p.hands?.L || s.hands.L, R: p.hands?.R || s.hands.R } };
  out.hip = Array.isArray(p.hip) ? p.hip : [0, 0, 0];
  for (const n of BODY_NAMES) if (!Array.isArray(out.q[n]) || out.q[n].length !== 4) out.q[n] = s.q[n];
  return out;
}

function mk(x, z, yaw, preset, extra = {}) {
  return { id: nextId++, pose: buildPreset(scratch, preset, { x, z, yaw }), hold: 0, mode: 'auto', dur: null, ...extra };
}

function demo() {
  return [
    mk(-1.9, 0.3, Math.PI / 2, 'stand'),
    mk(0, 0.7, 0.25, 'wave', { hold: 0.6, mode: 'jump' }),
    mk(1.35, 0.15, -0.35, 'cheer', { hold: 0.3 }),
    mk(1.35, 0.15, 0, 'bow', { hold: 0.8 }),
  ];
}

function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ keys: app.keys, settings: app.settings, hintSeen: !app.showHint })); } catch {}
  }, 300);
}

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE));
    if (d && Array.isArray(d.keys)) return d;
  } catch {}
  return null;
}

function syncGhosts() {
  while (app.ghosts.length < app.keys.length) {
    const g = createRobot('ghost', mats);
    scene.add(g.root);
    app.ghosts.push(g);
  }
  while (app.ghosts.length > app.keys.length) {
    const g = app.ghosts.pop();
    scene.remove(g.root);
    g.body.material.dispose();
    g.skeleton.dispose();
  }
  app.keys.forEach((k, i) => applyPose(app.ghosts[i], k.pose));
}

function nearKey(t) {
  const p = app.plan;
  for (let i = 0; i < p.n; i++) if (t > p.t[i] - 0.06 && t < p.t[i] + p.hold[i] + 0.06) return true;
  return false;
}

function syncOnion() {
  const p = app.plan;
  let times = [];
  app.frameCount = p.n >= 2 ? frameTimes(p, app.settings.fps, 1).total : 0;
  if (app.settings.onion && p.n >= 2) times = frameTimes(p, app.settings.fps, MAX_ONION).times.filter(t => !nearKey(t));
  while (onion.length < times.length) {
    const g = createRobot('ghost', mats);
    scene.add(g.root);
    onion.push(g);
  }
  onion.forEach((g, k) => {
    g.active = k < times.length;
    g.root.visible = g.active;
    if (g.active) evaluate(p, times[k], g);
  });
}

function updatePath() {
  const pts = groundPath(app.plan);
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(pts.length > 1 ? pts : [new THREE.Vector3(), new THREE.Vector3()]);
  pathLine.computeLineDistances();
  pathLine.visible = pts.length > 1;
  const list = footprints(app.plan);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1);
  prints.count = Math.min(list.length, 600);
  for (let i = 0; i < prints.count; i++) {
    const f = list[i];
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, f.yaw);
    m.compose(tmp.set(f.x + Math.sin(f.yaw) * 0.035, 0.002, f.z + Math.cos(f.yaw) * 0.035), q, s);
    prints.setMatrixAt(i, m);
  }
  prints.instanceMatrix.needsUpdate = true;
}

function fitShadow() {
  const box = new THREE.Box3();
  for (const k of app.keys) box.expandByPoint(tmp.set(k.pose.x, 0, k.pose.z));
  if (box.isEmpty()) box.expandByPoint(tmp.set(0, 0, 0));
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const h = Math.max(size.x, size.z) / 2 + 2.2;
  key.position.copy(c).add(tmp.set(3, 6, 4));
  key.target.position.copy(c);
  const cam = key.shadow.camera;
  cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h; cam.near = 0.5; cam.far = 20;
  cam.updateProjectionMatrix();
  floorMat.uniforms.uFocus.value.set(c.x, c.z);
}

function shownTime() {
  const f = app.settings.fps;
  return app.playing && f < 60 ? Math.floor(app.time * f + 1e-6) / f : app.time;
}

function poseSolid() {
  solid.root.visible = app.plan.n > 0;
  if (!solid.root.visible) return;
  if (app.sel >= 0 && !app.playing) applyPose(solid, app.keys[app.sel].pose);
  else evaluate(app.plan, shownTime(), solid);
}

function highlight(group, level = 0.3) {
  const arr = mats.hi.level.value;
  arr.fill(0);
  if (group && app.sel >= 0 && !app.playing) for (const n of GROUPS[group]) arr[BONE_INDEX[n]] = level;
  needs = true;
}

function rebuild() {
  planDirty = false;
  syncGhosts();
  app.plan = buildPlan(app.keys, scratch);
  app.time = clamp(app.time, 0, app.plan.T);
  syncOnion();
  updatePath();
  fitShadow();
  poseSolid();
  ui.refresh();
}

function changed() {
  planDirty = true;
  needs = true;
}

function styleGhost(g, kind, fade = 1) {
  const T = THEMES[app.settings.theme], st = GHOST_STYLE[kind], u = g.body.material.uniforms;
  u.uA.value.setHex(T.ghost.a);
  u.uB.value.setHex(T.ghost.b);
  u.uRim.value.setHex(kind === 'sel' ? T.sel : T.ghost.rim);
  u.uOpacity.value = st.o * fade;
  u.uRimK.value = st.k;
}

function styleAll() {
  const p = app.plan, t = app.time;
  const editing = app.sel >= 0 && !app.playing;
  app.ghosts.forEach((g, i) => {
    let fade = 1;
    if (!editing && solid.root.visible && p.n) {
      const a = p.t[i], b = p.t[i] + p.hold[i];
      fade = sstep(0.03, 0.45, t < a ? a - t : t > b ? t - b : 0);
    }
    g.root.visible = fade >= 0.01;
    const own = editing && i === app.sel;
    g.body.visible = g.depth.visible = !own;
    styleGhost(g, app.playing ? 'play' : 'key', fade);
  });
  for (const g of onion) {
    g.root.visible = !!g.active && !app.playing;
    if (g.root.visible) styleGhost(g, 'onion');
  }
  const list = [...app.ghosts, ...onion].filter(g => g.root.visible);
  for (const g of list) g._d = camera.position.distanceToSquared(g.root.position);
  list.sort((a, b) => b._d - a._d);
  list.forEach((g, k) => { g.depth.renderOrder = 2 * k + 1; g.body.renderOrder = 2 * k + 2; });
}

function applyTheme() {
  const T = THEMES[app.settings.theme];
  document.documentElement.dataset.theme = app.settings.theme;
  document.querySelector('meta[name="theme-color"]').content = T.meta;
  scene.background = new THREE.Color(T.bg);
  floorMat.uniforms.uEdge.value.setHex(T.bg);
  floorMat.uniforms.uCenter.value.setHex(T.floor);
  floorMat.uniforms.uLine.value.setHex(T.line);
  floorMat.uniforms.uLineA.value = T.lineA;
  shadowPlane.material.opacity = T.shadow;
  scene.environmentIntensity = T.env;
  hemi.intensity = T.hemi;
  key.intensity = T.key;
  rim.intensity = T.rim;
  pathMat.color.setHex(T.path);
  printMat.color.setHex(T.path);
  app.discMat?.color.setHex(T.sel);
  needs = true;
}

function snapshot() { return JSON.stringify(app.keys); }

function commit() {
  const s = snapshot();
  if (history[hIndex] !== s) {
    history.splice(hIndex + 1);
    history.push(s);
    if (history.length > 150) history.shift();
    hIndex = history.length - 1;
  }
  save();
  ui.refresh();
}

function restore(s) {
  app.keys = JSON.parse(s);
  if (app.sel >= app.keys.length) app.sel = app.keys.length - 1;
  app.joint = null;
  changed();
  save();
}

function select(i) {
  if (i < 0 || i >= app.keys.length) return;
  setPlaying(false);
  app.sel = i;
  app.joint = null;
  app.time = app.plan.t[i] ?? 0;
  highlight(null);
  if (app.showHint) dismissHint();
  poseSolid();
  ui.refresh();
  needs = true;
}

function deselect() {
  app.sel = -1;
  app.joint = null;
  highlight(null);
  poseSolid();
  ui.refresh();
  needs = true;
}

function setPlaying(p) {
  app.playing = p;
  endWait = 0;
  ui?.setPlaying(p);
}

function togglePlay() {
  if (app.playing) { setPlaying(false); poseSolid(); ui.refresh(); needs = true; return; }
  if (app.keys.length < 2) { ui.toast('Dodaj co najmniej 2 ghosty'); return; }
  app.sel = -1;
  app.joint = null;
  highlight(null);
  if (app.time >= app.plan.T - 1e-3) app.time = 0;
  setPlaying(true);
  ui.closePop();
  poseSolid();
  ui.refresh();
  needs = true;
}

function scrub(t) {
  setPlaying(false);
  app.sel = -1;
  app.joint = null;
  app.time = clamp(t, 0, app.plan.T);
  poseSolid();
  ui.refresh();
  needs = true;
}

function addKey(copy = false) {
  const base = app.sel >= 0 ? app.keys[app.sel] : app.keys[app.keys.length - 1];
  const pose = base ? clonePose(base.pose) : standPose();
  if (base && !copy) { pose.x += Math.sin(pose.yaw) * 1.0; pose.z += Math.cos(pose.yaw) * 1.0; }
  const at = app.sel >= 0 ? app.sel + 1 : app.keys.length;
  app.keys.splice(at, 0, { id: nextId++, pose, hold: 0, mode: 'auto', dur: null });
  rebuild();
  select(at);
  commit();
}

function deleteKey(i) {
  if (i < 0) return;
  app.keys.splice(i, 1);
  app.sel = -1;
  app.joint = null;
  rebuild();
  if (app.keys.length) select(Math.max(0, i - 1));
  commit();
  ui.toast('Usunięto ghosta. ⌘Z cofa.');
}

function editSel(fn) {
  if (app.sel < 0) return;
  fn(app.keys[app.sel]);
  changed();
  commit();
}

function frameAll(animate = true) {
  const box = new THREE.Box3();
  for (const k of app.keys) {
    box.expandByPoint(tmp.set(k.pose.x - 0.6, 0, k.pose.z - 0.6));
    box.expandByPoint(tmp.set(k.pose.x + 0.6, 1.8, k.pose.z + 0.6));
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.6, 0, -0.6), new THREE.Vector3(0.6, 1.8, 0.6));
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2;
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const aspect = Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1;
  const half = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect)) / 2;
  const dist = clamp((r / Math.sin(half)) * 0.92, 2.5, 28);
  const dir = camera.position.clone().sub(controls.target).normalize();
  const target = new THREE.Vector3(c.x, 0.8, c.z);
  const pos = target.clone().addScaledVector(dir, dist);
  if (!animate) { controls.target.copy(target); camera.position.copy(pos); needs = true; return; }
  tween = { t: 0, ft: controls.target.clone(), fp: camera.position.clone(), tt: target, tp: pos };
}

function rotateSel(a) {
  editSel(k => { k.pose.yaw += a; });
}

function dismissHint() {
  app.showHint = false;
  save();
  ui.refresh();
}

Object.assign(app, {
  render: () => { needs = true; },
  highlight,
  select, deselect, togglePlay, scrub, frameAll, deleteKey,
  addKey: () => addKey(false),
  duplicate: () => addKey(true),
  selectJoint(name) { app.joint = name; needs = true; },
  dragging(on) { controls.enabled = !on; },
  livePose(i, fromKey) {
    if (fromKey) applyPose(app.ghosts[i], app.keys[i].pose);
    changed();
  },
  commit,
  undo() { if (hIndex > 0) { hIndex--; restore(history[hIndex]); ui.toast('Cofnięto'); } },
  redo() { if (hIndex < history.length - 1) { hIndex++; restore(history[hIndex]); ui.toast('Ponowiono'); } },
  canUndo: () => hIndex > 0,
  canRedo: () => hIndex < history.length - 1,
  applyPreset(name) { editSel(k => { const h = k.pose.hands; k.pose = buildPreset(scratch, name, k.pose); if (name === 'stand') k.pose.hands = h; }); },
  setHand(side, name) { editSel(k => { k.pose.hands[side] = [...HAND_PRESETS[name]]; }); },
  setHold(v) { editSel(k => { k.hold = v; }); },
  mirror() { editSel(k => { k.pose = mirrorPose(k.pose); }); },
  setTransition(i, patch, liveOnly) {
    const k = app.keys[i];
    if (!k) return;
    if ('mode' in patch) k.mode = patch.mode;
    if ('dur' in patch) k.dur = patch.dur;
    changed();
    rebuild();
    if (!liveOnly) commit();
  },
  setSetting(name, v) {
    app.settings[name] = v;
    if (name === 'onion' || name === 'fps') changed();
    save();
    ui.refresh();
    needs = true;
  },
  toggleTheme() { app.setSetting('theme', app.settings.theme === 'light' ? 'dark' : 'light'); applyTheme(); },
  clearAll() {
    app.keys = [mk(0, 0, 0, 'stand')];
    app.sel = -1;
    app.time = 0;
    setPlaying(false);
    rebuild();
    select(0);
    commit();
    frameAll();
    ui.toast('Nowa animacja. ⌘Z cofa.');
  },
  dismissHint,
});

const ui = initUI(app);
const editor = initEditor(app);

const saved = load();
if (saved && saved.keys.length) {
  app.keys = saved.keys.map(k => ({ id: k.id ?? nextId, pose: sanitize(k.pose || {}), hold: +k.hold || 0, mode: k.mode || 'auto', dur: k.dur ?? null }));
  nextId = Math.max(0, ...app.keys.map(k => k.id)) + 1;
} else app.keys = demo();
Object.assign(app.settings, saved?.settings || {});
app.showHint = !saved?.hintSeen;
applyTheme();

function resize() {
  const w = container.clientWidth, h = container.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  needs = true;
}
window.addEventListener('resize', resize);
resize();
rebuild();
frameAll(false);
commit();

window.addEventListener('keydown', e => {
  if (e.target.closest?.('input')) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); app.redo(); return; }
  if (mod || e.altKey) return;
  if (k === ' ') { e.preventDefault(); togglePlay(); }
  else if (k === 'escape') { ui.closePop(); ui.closeMenu(); if (app.joint) app.selectJoint(null); else deselect(); }
  else if (k === 'delete' || k === 'backspace') { if (app.sel >= 0) deleteKey(app.sel); }
  else if (k === 'n') app.addKey();
  else if (k === 'd') { if (app.sel >= 0) app.duplicate(); }
  else if (k === 'm') { if (app.sel >= 0) app.mirror(); }
  else if (k === 'f') frameAll();
  else if (k === 'q') rotateSel(Math.PI / 12);
  else if (k === 'e') rotateSel(-Math.PI / 12);
  else if (k === 'arrowleft' || k === 'arrowright') {
    const n = app.keys.length;
    if (n) select(((app.sel < 0 ? 0 : app.sel + (k === 'arrowright' ? 1 : -1)) + n) % n);
  }
});

controls.addEventListener('change', () => { needs = true; });

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.45);
    const e = 1 - Math.pow(1 - tween.t, 3);
    controls.target.lerpVectors(tween.ft, tween.tt, e);
    camera.position.lerpVectors(tween.fp, tween.tp, e);
    if (tween.t >= 1) tween = null;
    needs = true;
  }
  if (controls.update()) needs = true;
  if (planDirty) { rebuild(); needs = true; }
  if (app.playing) {
    app.time += dt;
    const T = app.plan.T;
    if (app.time >= T) {
      if (app.settings.loop && T > 0) {
        endWait += dt;
        app.time = T;
        if (endWait > 0.8) { app.time = 0; endWait = 0; }
      } else { app.time = T; setPlaying(false); ui.refresh(); }
    }
    poseSolid();
    if (app.settings.follow && solid.root.visible) {
      solid.bones.hips.getWorldPosition(tmp);
      const dx = (tmp.x - controls.target.x) * 0.08, dz = (tmp.z - controls.target.z) * 0.08;
      controls.target.x += dx; controls.target.z += dz;
      camera.position.x += dx; camera.position.z += dz;
    }
    ui.updatePlayhead();
    needs = true;
  }
  if (!needs) return;
  needs = false;
  camera.updateMatrixWorld();
  styleAll();
  editor.update();
  ui.updateLabels();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.__ghostframe = app;
