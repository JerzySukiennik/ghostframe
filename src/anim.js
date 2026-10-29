// Ghostframe: generates the in-between frames (spline interpolation, procedural walk and jump)
import * as THREE from 'three';
import { BODY_NAMES, REST_HIPS_Y, ANKLE_Y as ANKLE } from './optimus.js';
import { applyPose, captureFeet, solveLimb, clampHips, isGrounded, boneAxis } from './pose.js';

const NQ = BODY_NAMES.length;
const SIZE = 6 + NQ * 4 + 12;
const HOFF = 6 + NQ * 4;
const TENSION = 0.85;
const TOE = new THREE.Vector3(0, -0.085, 0.13);
const HEEL = new THREE.Vector3(0, -0.085, -0.065);
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

const clamp = THREE.MathUtils.clamp;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function pack(p, prev) {
  const v = new Float64Array(SIZE);
  v[0] = p.x; v[1] = p.z;
  v[2] = prev ? prev[2] + wrap(p.yaw - prev[2]) : p.yaw;
  v[3] = p.hip[0]; v[4] = p.hip[1]; v[5] = p.hip[2];
  BODY_NAMES.forEach((n, j) => {
    const q = p.q[n], o = 6 + j * 4;
    let s = 1;
    if (prev && prev[o] * q[0] + prev[o + 1] * q[1] + prev[o + 2] * q[2] + prev[o + 3] * q[3] < 0) s = -1;
    for (let c = 0; c < 4; c++) v[o + c] = s * q[c];
  });
  for (let c = 0; c < 6; c++) { v[HOFF + c] = p.hands.L[c]; v[HOFF + 6 + c] = p.hands.R[c]; }
  return v;
}

function unpack(v, P) {
  P.x = v[0]; P.z = v[1]; P.yaw = v[2];
  P.hip[0] = v[3]; P.hip[1] = v[4]; P.hip[2] = v[5];
  BODY_NAMES.forEach((n, j) => {
    const o = 6 + j * 4, q = P.q[n];
    const l = Math.hypot(v[o], v[o + 1], v[o + 2], v[o + 3]) || 1;
    for (let c = 0; c < 4; c++) q[c] = v[o + c] / l;
  });
  for (let c = 0; c < 6; c++) { P.hands.L[c] = clamp(v[HOFF + c], -0.2, 1.2); P.hands.R[c] = clamp(v[HOFF + 6 + c], -0.2, 1.2); }
}

export function scratchPose() {
  const q = {};
  for (const n of BODY_NAMES) q[n] = [0, 0, 0, 1];
  return { x: 0, z: 0, yaw: 0, hip: [0, 0, 0], q, hands: { L: [0, 0, 0, 0, 0, 0], R: [0, 0, 0, 0, 0, 0] } };
}

const HV = new Float64Array(SIZE);

function hermite(plan, i, u, out = HV) {
  const a = plan.val[i], b = plan.val[i + 1], ma = plan.tan[i], mb = plan.tan[i + 1], d = plan.dur[i];
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * d, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * d;
  for (let k = 0; k < SIZE; k++) out[k] = h00 * a[k] + h10 * ma[k] + h01 * b[k] + h11 * mb[k];
  return out;
}

function autoDur(mode, dist, dyaw) {
  if (mode === 'walk') return Math.max(0.9, 0.3 + dist / 0.8 + dyaw * 0.35);
  if (mode === 'jump') return 1.15 + Math.min(dist, 3) * 0.22;
  return Math.max(0.8, 0.8 + dist * 0.8);
}

export function locate(plan, t) {
  const { n } = plan;
  for (let i = n - 1; i >= 0; i--) {
    if (t >= plan.t[i] || i === 0) {
      const s = plan.t[i] + plan.hold[i];
      if (t <= s || i === n - 1) return { i, u: 0, hold: true };
      return { i, u: clamp((t - s) / plan.dur[i], 0, 1), hold: false };
    }
  }
  return { i: 0, u: 0, hold: true };
}

function baseRootXZ(plan, t, out) {
  const L = locate(plan, t);
  if (L.hold) { const v = plan.val[L.i]; return out.set(v[0], v[2], v[1]); }
  const v = hermite(plan, L.i, L.u, HV);
  return out.set(v[0], v[2], v[1]);
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

function planRun(plan, run) {
  const { t0, t1 } = run, T = t1 - t0;
  const N = Math.max(8, Math.ceil(T * 60));
  const dt = T / N;
  const raw = [];
  let len = 0;
  for (let k = 0; k <= N; k++) {
    const r = baseRootXZ(plan, t0 + k * dt, new THREE.Vector3());
    if (k) len += Math.hypot(r.x - raw[k - 1].x, r.z - raw[k - 1].z);
    raw.push(r);
  }
  run.len = len;
  const turnable = sstep(1.0, 1.6, len);
  run.samples = [];
  let prevDiff = 0, dyaw = 0;
  for (let k = 0; k <= N; k++) {
    const a = raw[Math.max(0, k - 1)], b = raw[Math.min(N, k + 1)];
    const span = (Math.min(N, k + 1) - Math.max(0, k - 1)) * dt;
    const vx = (b.x - a.x) / span, vz = (b.z - a.z) / span, sp = Math.hypot(vx, vz);
    const t = t0 + k * dt;
    const edge = sstep(t0, t0 + 0.35, t) * (1 - sstep(t1 - 0.35, t1, t));
    const beta = sstep(0.15, 0.45, sp) * turnable * edge;
    let diff = sp > 1e-4 ? wrap(Math.atan2(vx, vz) - raw[k].y) : prevDiff;
    diff = prevDiff + wrap(diff - prevDiff);
    prevDiff = diff;
    const yaw = raw[k].y + diff * beta;
    if (k) dyaw += Math.abs(yaw - run.samples[k - 1].yaw);
    run.samples.push({ x: raw[k].x, z: raw[k].z, yaw });
  }
  run.dt = dt;
  run.start = plan.feet[run.i0];
  run.end = plan.feet[run.i1];
  const vAvg = len / T;
  const Tp = clamp(0.56 - 0.08 * vAvg, 0.4, 0.6);
  let n = Math.max(2, Math.round(T / Tp), Math.ceil(len / 0.6) + 1, Math.ceil(dyaw / 0.6) + 1);
  n = Math.min(n, Math.max(2, Math.floor(T / 0.28)));
  const slot = T / n;
  run.slot = slot;
  run.nSteps = n;
  const need = s => run.start[s].p.distanceTo(homeAt(plan, run, s, Math.min(t1, t0 + 1.5 * slot)).p);
  run.first = need('L') >= need('R') ? 'L' : 'R';
  const other = run.first === 'L' ? 'R' : 'L';
  const planted = { L: run.start.L, R: run.start.R };
  run.steps = { L: [], R: [] };
  for (let k = 0; k < n; k++) {
    const s = k % 2 === 0 ? run.first : other;
    const ta = t0 + (k + 0.06) * slot, tb = t0 + (k + 0.94) * slot;
    const to = k >= n - 2 ? run.end[s] : homeAt(plan, run, s, Math.min(t1, tb + 0.5 * slot));
    const from = planted[s];
    const dist = Math.hypot(to.p.x - from.p.x, to.p.z - from.p.z);
    const ang = from.q.angleTo(to.q);
    const h = dist < 0.012 && ang < 0.06 && Math.abs(to.p.y - from.p.y) < 0.01 ? 0 : Math.min(0.11, 0.03 + 0.15 * dist);
    run.steps[s].push({ ta, tb, from, to, h, roll: h ? Math.min(0.42, 0.12 + 0.5 * dist) : 0 });
    planted[s] = to;
  }
}

function rootAt(run, t) {
  const f = clamp((t - run.t0) / run.dt, 0, run.samples.length - 1);
  const k = Math.min(run.samples.length - 2, Math.floor(f)), u = f - k;
  const a = run.samples[k], b = run.samples[k + 1];
  return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u, yaw: a.yaw + (b.yaw - a.yaw) * u };
}

function homeAt(plan, run, s, t) {
  const r = rootAt(run, t);
  const L = locate(plan, t);
  const v = L.hold ? plan.val[L.i] : hermite(plan, L.i, L.u, new Float64Array(SIZE));
  const side = s === 'L' ? 1 : -1;
  const lx = v[3] + side * 0.1, lz = v[5] + 0.01;
  const c = Math.cos(r.yaw), sn = Math.sin(r.yaw);
  const p = new THREE.Vector3(r.x + lx * c + lz * sn, ANKLE, r.z - lx * sn + lz * c);
  const q = new THREE.Quaternion().setFromAxisAngle(Y, r.yaw + side * 0.06);
  return { p, q };
}

const _rq = new THREE.Quaternion(), _ax = new THREE.Vector3(), _pv = new THREE.Vector3();

function rollAbout(p, q, pivotLocal, angle) {
  if (!angle) return;
  _ax.copy(X).applyQuaternion(q);
  _pv.copy(pivotLocal).applyQuaternion(q).add(p);
  _rq.setFromAxisAngle(_ax, angle);
  p.sub(_pv).applyQuaternion(_rq).add(_pv);
  q.premultiply(_rq);
}

function footAt(run, s, t, P, Qt) {
  let planted = run.start[s];
  for (const st of run.steps[s]) {
    if (t < st.ta) {
      P.copy(planted.p); Qt.copy(planted.q);
      const rt = Math.min(0.14, (st.tb - st.ta) * 0.3);
      const phi = st.roll * sstep(st.ta - rt, st.ta, t);
      rollAbout(P, Qt, TOE, phi);
      return -phi;
    }
    if (t < st.tb) {
      const tau = (t - st.ta) / (st.tb - st.ta);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * tau);
      P.lerpVectors(st.from.p, st.to.p, e);
      P.y += st.h * Math.sin(Math.PI * Math.pow(tau, 0.9));
      Qt.slerpQuaternions(st.from.q, st.to.q, e);
      const phi = st.roll * (1 - sstep(0, 0.45, tau));
      rollAbout(P, Qt, TOE, phi);
      const strike = st.h ? -0.24 * (tau > 0.62 ? Math.sin(Math.PI * (tau - 0.62) / 0.38) : 0) : 0;
      rollAbout(P, Qt, HEEL, strike);
      return -phi * 0.8;
    }
    planted = st.to;
  }
  P.copy(planted.p); Qt.copy(planted.q);
  return 0;
}

function prepJump(plan, i) {
  const A = plan.keys[i].pose, B = plan.keys[i + 1].pose;
  const dist = Math.hypot(B.x - A.x, B.z - A.z);
  const J = {
    dist, c: 0.17 + 0.03 * Math.min(dist, 2), H: 0.3 + 0.1 * Math.min(dist, 3),
    hA: REST_HIPS_Y + A.hip[1], hB: REST_HIPS_Y + B.hip[1], local: { A: {}, B: {} },
  };
  for (const [tag, P, feet] of [['A', A, plan.feet[i]], ['B', B, plan.feet[i + 1]]]) {
    const c = Math.cos(-P.yaw), s = Math.sin(-P.yaw);
    for (const sd of ['L', 'R']) {
      const d = feet[sd].p.clone().sub(_v1.set(P.x, 0, P.z));
      J.local[tag][sd] = new THREE.Vector3(d.x * c + d.z * s, d.y, -d.x * s + d.z * c);
    }
  }
  return J;
}

export function buildPlan(keys, scratch) {
  const n = keys.length;
  const plan = { keys, n, t: [], hold: [], dur: [], mode: [], val: [], tan: [], feet: [], grounded: [], runs: [], runOf: [], jumps: [], T: 0 };
  if (!n) return plan;
  for (let i = 0; i < n; i++) {
    plan.val.push(pack(keys[i].pose, i ? plan.val[i - 1] : null));
    applyPose(scratch, keys[i].pose);
    plan.feet.push(captureFeet(scratch));
    plan.grounded.push(isGrounded(scratch));
    plan.hold.push(keys[i].hold || 0);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = keys[i].pose, b = keys[i + 1].pose;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const dyaw = Math.abs(plan.val[i + 1][2] - plan.val[i][2]);
    let mode = keys[i].mode || 'auto';
    if (mode === 'auto') mode = (dist > 0.22 || dyaw > 0.5) && plan.grounded[i] && plan.grounded[i + 1] ? 'walk' : 'smooth';
    plan.mode.push(mode);
    plan.dur.push(keys[i].dur ?? autoDur(mode, dist, dyaw));
  }
  let t = 0;
  for (let i = 0; i < n; i++) {
    plan.t.push(t);
    t += plan.hold[i] + (i < n - 1 ? plan.dur[i] : 0);
  }
  plan.T = t;
  for (let i = 0; i < n; i++) {
    const m = new Float64Array(SIZE);
    const stop = i === 0 || i === n - 1 || plan.hold[i] > 0 || plan.mode[i - 1] === 'jump' || plan.mode[i] === 'jump';
    if (!stop) {
      const k = TENSION / (plan.dur[i - 1] + plan.dur[i]);
      const a = plan.val[i - 1], b = plan.val[i + 1];
      for (let c = 0; c < SIZE; c++) m[c] = (b[c] - a[c]) * k;
    }
    plan.tan.push(m);
  }
  let run = null;
  for (let i = 0; i < n - 1; i++) {
    plan.jumps.push(plan.mode[i] === 'jump' ? prepJump(plan, i) : null);
    if (plan.mode[i] !== 'walk') { run = null; plan.runOf.push(null); continue; }
    if (!run || plan.hold[i] > 0) {
      run = { i0: i, i1: i + 1, t0: plan.t[i] + plan.hold[i], t1: plan.t[i + 1] };
      plan.runs.push(run);
    } else {
      run.i1 = i + 1;
      run.t1 = plan.t[i + 1];
    }
    plan.runOf.push(run);
  }
  for (const r of plan.runs) planRun(plan, r);
  return plan;
}

const P0 = scratchPose();
const _fp = { L: new THREE.Vector3(), R: new THREE.Vector3() };
const _fq = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
const _zp = { L: new THREE.Vector3(), R: new THREE.Vector3() };
const _feet = { L: { p: _fp.L, q: _fq.L }, R: { p: _fp.R, q: _fq.R } };
const _sq = new THREE.Quaternion();

export function evaluate(plan, t, robot) {
  if (!plan.n) return;
  t = clamp(t, 0, plan.T);
  const L = locate(plan, t);
  if (L.hold) { applyPose(robot, plan.keys[L.i].pose); return; }
  const mode = plan.mode[L.i];
  if (mode === 'jump') return evalJump(plan, L.i, L.u, robot);
  unpack(hermite(plan, L.i, L.u), P0);
  if (mode === 'walk') return evalWalk(plan.runOf[L.i], t, robot);
  applyPose(robot, P0);
}

function legsTo(robot, toe) {
  const b = robot.bones;
  for (const s of ['L', 'R']) boneAxis(b['thigh' + s], Z, _zp[s]);
  clampHips(robot, _feet);
  for (const s of ['L', 'R']) {
    solveLimb(robot, 'leg' + s, _fp[s], _zp[s], _fq[s]);
    if (toe) b['toe' + s].quaternion.setFromAxisAngle(X, toe[s]);
  }
  robot.root.updateMatrixWorld(true);
}

function swingArms(robot, amount, elbow) {
  const b = robot.bones;
  for (const s of ['L', 'R']) {
    const ua = b['upperArm' + s];
    const down = -_v2.set(0, -1, 0).applyQuaternion(ua.quaternion).y;
    const k = sstep(0.5, 0.9, down);
    if (!k) continue;
    ua.quaternion.premultiply(_sq.setFromAxisAngle(X, amount[s] * k));
    if (elbow) b['forearm' + s].quaternion.multiply(_sq.setFromAxisAngle(X, -elbow * k));
  }
}

const _toe = { L: 0, R: 0 };
const _arm = { L: 0, R: 0 };

function evalWalk(run, t, robot) {
  const r = rootAt(run, t);
  P0.x = r.x; P0.z = r.z; P0.yaw = r.yaw;
  applyPose(robot, P0);
  const b = robot.bones;
  const w = sstep(run.t0, run.t0 + 0.5 * run.slot, t) * (1 - sstep(run.t1 - 0.5 * run.slot, run.t1, t));
  const f = (t - run.t0) / run.slot;
  const k = Math.min(run.nSteps - 1, Math.floor(f));
  const ph = clamp(f - k, 0, 1);
  const swing = (k % 2 === 0) === (run.first === 'L') ? 1 : -1;
  const sp = Math.sin(Math.PI * ph);
  b.hips.position.y += w * (-0.035 - 0.012 * Math.cos(2 * Math.PI * ph));
  b.hips.position.x += w * -swing * 0.02 * sp;
  b.hips.quaternion.multiply(_sq.setFromAxisAngle(Y, -0.07 * swing * sp * w));
  b.chest.quaternion.multiply(_sq.setFromAxisAngle(Y, 0.05 * swing * sp * w));
  const leg = -Math.cos(Math.PI * f);
  for (const s of ['L', 'R']) _arm[s] = -(s === run.first ? -1 : 1) * leg * 0.3 * w;
  swingArms(robot, _arm, 0.2 * w);
  robot.root.updateMatrixWorld(true);
  for (const s of ['L', 'R']) _toe[s] = footAt(run, s, t, _fp[s], _fq[s]);
  legsTo(robot, _toe);
}

function evalJump(plan, i, u, robot) {
  const J = plan.jumps[i], A = plan.keys[i].pose, B = plan.keys[i + 1].pose;
  const c1 = 0.3, c2 = 0.72;
  unpack(hermite(plan, i, sstep(c1 - 0.08, c2 + 0.1, u)), P0);
  let x, z, yaw, hy, f = 0, g = 0, phase;
  const yawB = A.yaw + wrap(B.yaw - A.yaw);
  if (u < c1) {
    phase = 0;
    const k = sstep(0, c1, u);
    x = A.x; z = A.z; yaw = A.yaw;
    hy = J.hA - J.c * k;
  } else if (u <= c2) {
    phase = 1;
    f = (u - c1) / (c2 - c1);
    x = A.x + (B.x - A.x) * f; z = A.z + (B.z - A.z) * f;
    yaw = A.yaw + (yawB - A.yaw) * sstep(0, 1, f);
    hy = (J.hA - J.c) + (J.hB - J.hA) * f + 4 * J.H * f * (1 - f);
  } else {
    phase = 2;
    g = (u - c2) / (1 - c2);
    x = B.x; z = B.z; yaw = yawB;
    hy = J.hB - J.c * (1 - sstep(0, 1, g)) - 0.06 * Math.sin(Math.PI * Math.min(1, g / 0.5)) * (1 - g);
  }
  P0.x = x; P0.z = z; P0.yaw = yaw;
  applyPose(robot, P0);
  const b = robot.bones;
  b.hips.position.y = hy;
  let arm = 0, lean = 0;
  if (phase === 0) { const k = sstep(0, c1, u); arm = 0.75 * k; lean = 0.32 * k; }
  else if (phase === 1) { arm = 0.75 * (1 - sstep(0, 0.3, f)) - 1.15 * Math.sin(Math.PI * f); lean = 0.32 * (1 - sstep(0, 0.3, f)) - 0.08 * Math.sin(Math.PI * f); }
  else { arm = -0.3 * (1 - g) * Math.sin(Math.PI * Math.min(1, g * 1.5)); lean = 0.28 * Math.sin(Math.PI * g) * (1 - g * 0.5); }
  _arm.L = arm; _arm.R = arm;
  swingArms(robot, _arm, phase === 1 ? 0.3 : 0.15);
  b.spine.quaternion.premultiply(_sq.setFromAxisAngle(X, lean * 0.5));
  b.chest.quaternion.premultiply(_sq.setFromAxisAngle(X, lean * 0.5));
  robot.root.updateMatrixWorld(true);
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (const s of ['L', 'R']) {
    _toe[s] = 0;
    if (phase === 0) {
      _fp[s].copy(plan.feet[i][s].p); _fq[s].copy(plan.feet[i][s].q);
      const phi = 0.55 * sstep(c1 * 0.7, c1, u);
      rollAbout(_fp[s], _fq[s], TOE, phi);
      _toe[s] = -phi;
    } else if (phase === 1) {
      const la = J.local.A[s], lb = J.local.B[s];
      const lx = la.x + (lb.x - la.x) * f, lz = la.z + (lb.z - la.z) * f;
      const tuck = Math.sin(Math.PI * f);
      _fp[s].set(x + lx * cs + (lz + 0.05 * tuck) * sn, la.y + (lb.y - la.y) * f + 4 * J.H * f * (1 - f) + 0.17 * tuck, z - lx * sn + (lz + 0.05 * tuck) * cs);
      _fq[s].slerpQuaternions(plan.feet[i][s].q, plan.feet[i + 1][s].q, sstep(0, 1, f));
      const phi = 0.55 * (1 - sstep(0, 0.35, f)) + 0.3 * tuck;
      _fq[s].multiply(_sq.setFromAxisAngle(X, phi));
      _toe[s] = -0.3 * (1 - sstep(0, 0.35, f));
    } else {
      _fp[s].copy(plan.feet[i + 1][s].p); _fq[s].copy(plan.feet[i + 1][s].q);
    }
  }
  legsTo(robot, _toe);
}

export function frameTimes(plan, fps, max) {
  const total = Math.floor(plan.T * fps + 1e-6) + 1;
  const step = Math.max(1, Math.ceil(total / max));
  const out = [];
  for (let k = 0; k < total; k += step) out.push(k / fps);
  return { times: out, total };
}

export function groundPath(plan, perSecond = 30) {
  const pts = [];
  if (!plan.n) return pts;
  const N = Math.max(2, Math.ceil(plan.T * perSecond));
  for (let k = 0; k <= N; k++) {
    const t = (plan.T * k) / N;
    const L = locate(plan, t);
    let x, z;
    if (L.hold) { x = plan.keys[L.i].pose.x; z = plan.keys[L.i].pose.z; }
    else if (plan.mode[L.i] === 'walk') { const r = rootAt(plan.runOf[L.i], t); x = r.x; z = r.z; }
    else if (plan.mode[L.i] === 'jump') {
      const A = plan.keys[L.i].pose, B = plan.keys[L.i + 1].pose, f = clamp((L.u - 0.3) / 0.42, 0, 1);
      x = A.x + (B.x - A.x) * f; z = A.z + (B.z - A.z) * f;
    } else { const v = hermite(plan, L.i, L.u); x = v[0]; z = v[1]; }
    pts.push(new THREE.Vector3(x, 0, z));
  }
  return pts;
}

export function footprints(plan) {
  const out = [];
  const add = (tr, side) => {
    const f = _v3.set(0, 0, 1).applyQuaternion(tr.q);
    out.push({ x: tr.p.x, z: tr.p.z, yaw: Math.atan2(f.x, f.z), side });
  };
  for (const run of plan.runs) {
    for (const s of ['L', 'R']) for (const st of run.steps[s]) if (st.h) add(st.to, s);
  }
  return out;
}
