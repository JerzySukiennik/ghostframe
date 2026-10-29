// Ghostframe: pose data, forward and inverse kinematics, pose and hand presets, mirroring
import * as THREE from 'three';
import { BODY_NAMES, REST_HIPS_Y, LEG_LEN, ANKLE_Y } from './optimus.js';

const D = Math.PI / 180;
const clamp = THREE.MathUtils.clamp;
export const SIDES = ['L', 'R'];

export const HAND_PRESETS = {
  relaxed: [0.3, 0.22, 0.28, 0.34, 0.4, 0.1],
  open: [0, 0, 0, 0, 0, 0.75],
  fist: [0.85, 1, 1, 1, 1, 0],
  point: [0.8, 0, 1, 1, 1, 0],
  thumb: [0, 1, 1, 1, 1, 0],
  peace: [0.85, 0, 0, 1, 1, 1],
};

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export function eq(x, y = 0, z = 0, order = 'XYZ') {
  _q.setFromEuler(_e.set(x * D, y * D, z * D, order));
  return [_q.x, _q.y, _q.z, _q.w];
}

const mirrorQ = a => [a[0], -a[1], -a[2], a[3]];
const sideQ = (side, a) => (side === 'L' ? a : mirrorQ(a));

export function emptyPose() {
  const q = {};
  for (const n of BODY_NAMES) q[n] = [0, 0, 0, 1];
  return { x: 0, z: 0, yaw: 0, hip: [0, 0, 0], q, hands: { L: [...HAND_PRESETS.relaxed], R: [...HAND_PRESETS.relaxed] } };
}

export const clonePose = p => JSON.parse(JSON.stringify(p));

export function setArm(p, side, a) {
  p.q['upperArm' + side] = sideQ(side, eq(a.flex ?? 0, a.twist ?? 0, a.abd ?? 0, 'ZXY'));
  p.q['forearm' + side] = sideQ(side, eq(a.elbow ?? 0, a.fore ?? 0, 0, 'XYZ'));
  p.q['hand' + side] = sideQ(side, eq(a.wx ?? 0, a.wy ?? 0, a.wz ?? 0, 'XYZ'));
}

export function setLeg(p, side, l) {
  p.q['thigh' + side] = sideQ(side, eq(l.flex ?? 0, l.twist ?? 0, l.abd ?? 0, 'ZXY'));
  p.q['shin' + side] = eq(l.knee ?? 0, 0, 0);
  p.q['foot' + side] = sideQ(side, eq(l.foot ?? 0, l.fy ?? 0, l.roll ?? 0, 'XYZ'));
  p.q['toe' + side] = eq(l.toe ?? 0, 0, 0);
}

export function setTorso(p, name, x = 0, y = 0, z = 0) {
  p.q[name] = eq(x, y, z, 'YXZ');
}

export function standPose(base) {
  const p = emptyPose();
  if (base) { p.x = base.x; p.z = base.z; p.yaw = base.yaw; }
  for (const s of SIDES) {
    setArm(p, s, { flex: -4, abd: 7, elbow: -12 });
    setLeg(p, s, { flex: -1.5, knee: 3, foot: -1.5 });
  }
  return p;
}

function applyHand(robot, side, h) {
  const s = side === 'L' ? 1 : -1;
  const b = robot.bones;
  const spread = { i: -0.16, m: -0.03, r: 0.08, p: 0.2 };
  ['i', 'm', 'r', 'p'].forEach((f, k) => {
    const c = h[k + 1];
    b[`${side}_${f}0`].quaternion.setFromEuler(_e.set(spread[f] * h[5], 0, -s * c * 1.45, 'XYZ'));
    b[`${side}_${f}1`].quaternion.setFromEuler(_e.set(0, 0, -s * c * 1.7, 'XYZ'));
    b[`${side}_${f}2`].quaternion.setFromEuler(_e.set(0, 0, -s * c * 1.15, 'XYZ'));
  });
  const t = h[0];
  b[`${side}_t0`].quaternion.setFromEuler(_e.set(-0.55 + 0.95 * t, s * 0.3, -s * (0.25 + 0.45 * t), 'XYZ'));
  b[`${side}_t1`].quaternion.setFromEuler(_e.set(0.5 * t, 0, -s * 0.45 * t, 'XYZ'));
  b[`${side}_t2`].quaternion.setFromEuler(_e.set(0.6 * t, 0, -s * 0.3 * t, 'XYZ'));
}

export function applyPose(robot, p) {
  const b = robot.bones;
  robot.root.position.set(p.x, 0, p.z);
  robot.root.rotation.set(0, p.yaw, 0);
  b.hips.position.set(p.hip[0], REST_HIPS_Y + p.hip[1], p.hip[2]);
  for (const n of BODY_NAMES) {
    const a = p.q[n];
    b[n].quaternion.set(a[0], a[1], a[2], a[3]);
  }
  applyHand(robot, 'L', p.hands.L);
  applyHand(robot, 'R', p.hands.R);
  robot.root.updateMatrixWorld(true);
}

export function applyHands(robot, hands) {
  applyHand(robot, 'L', hands.L);
  applyHand(robot, 'R', hands.R);
}

export function readPose(robot, p) {
  const b = robot.bones;
  p.x = robot.root.position.x;
  p.z = robot.root.position.z;
  p.yaw = robot.root.rotation.y;
  p.hip = [b.hips.position.x, b.hips.position.y - REST_HIPS_Y, b.hips.position.z];
  for (const n of BODY_NAMES) {
    const q = b[n].quaternion.normalize();
    p.q[n] = [q.x, q.y, q.z, q.w];
  }
  return p;
}

export function mirrorPose(p) {
  const m = clonePose(p);
  for (const n of BODY_NAMES) {
    const o = /L$/.test(n) ? n.slice(0, -1) + 'R' : /R$/.test(n) ? n.slice(0, -1) + 'L' : n;
    m.q[n] = mirrorQ(p.q[o]);
  }
  m.hip = [-p.hip[0], p.hip[1], p.hip[2]];
  m.hands = { L: [...p.hands.R], R: [...p.hands.L] };
  return m;
}

export const LIMBS = {
  armL: ['upperArmL', 'forearmL', 'handL', -1],
  armR: ['upperArmR', 'forearmR', 'handR', -1],
  legL: ['thighL', 'shinL', 'footL', 1],
  legR: ['thighR', 'shinR', 'footR', 1],
};

const _a = new THREE.Vector3(), _t = new THREE.Vector3(), _dir = new THREE.Vector3(), _f = new THREE.Vector3();
const _m = new THREE.Vector3(), _k = new THREE.Vector3(), _u = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _z2 = new THREE.Vector3();
const _mat = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _wq = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export function boneAxis(bone, axis, out) {
  return out.copy(axis).applyQuaternion(bone.getWorldQuaternion(_q3));
}

export function solveLimb(robot, limb, target, zPref, endWorldQuat) {
  const [nA, nB, nC, sgn] = LIMBS[limb];
  const b = robot.bones, A = b[nA], B = b[nB], C = b[nC];
  A.getWorldPosition(_a);
  const l1 = B.position.length(), l2 = C.position.length();
  _dir.subVectors(target, _a);
  let d = _dir.length();
  if (d < 1e-6) { _dir.set(0, -1, 0); d = 1e-6; } else _dir.divideScalar(d);
  d = clamp(d, Math.abs(l1 - l2) + 1e-4, (l1 + l2) * 0.99995);
  _f.copy(zPref).addScaledVector(_dir, -zPref.dot(_dir));
  if (_f.lengthSq() < 1e-8) {
    A.parent.getWorldQuaternion(_pq);
    _f.set(0, 0, 1).applyQuaternion(_pq);
    if (Math.abs(_f.dot(_dir)) > 0.98) _f.set(0, 1, 0).applyQuaternion(_pq);
    _f.addScaledVector(_dir, -_f.dot(_dir));
  }
  _f.normalize();
  _m.copy(_f).multiplyScalar(sgn);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _k.copy(_a).addScaledVector(_dir, l1 * cosA).addScaledVector(_m, l1 * sinA);
  _u.subVectors(_k, _a).normalize();
  _z.copy(_f).addScaledVector(_u, -_f.dot(_u)).normalize();
  _y.copy(_u).negate();
  _x.crossVectors(_y, _z).normalize();
  _z.crossVectors(_x, _y);
  _mat.makeBasis(_x, _y, _z);
  _wq.setFromRotationMatrix(_mat);
  A.parent.getWorldQuaternion(_pq);
  A.quaternion.copy(_pq.invert().multiply(_wq));
  _t.copy(_a).addScaledVector(_dir, d).sub(_k).normalize();
  const theta = Math.acos(clamp(_u.dot(_t), -1, 1));
  _e.setFromQuaternion(B.quaternion, 'XYZ');
  B.quaternion.setFromEuler(_e.set(sgn * theta, _e.y, 0, 'XYZ'));
  if (endWorldQuat) {
    B.getWorldQuaternion(_pq);
    C.quaternion.copy(_pq.invert().multiply(endWorldQuat));
  }
  A.updateMatrixWorld(true);
}

export function lookHead(robot, target) {
  const b = robot.bones;
  b.head.getWorldPosition(_a);
  _dir.subVectors(target, _a);
  if (_dir.lengthSq() < 1e-6) return;
  b.chest.getWorldQuaternion(_pq);
  _dir.applyQuaternion(_pq.invert()).normalize();
  const yaw = clamp(Math.atan2(_dir.x, _dir.z), -1.3, 1.3);
  const pitch = clamp(Math.asin(clamp(-_dir.y, -1, 1)), -0.75, 0.9);
  b.neck.quaternion.setFromEuler(_e.set(pitch * 0.4, yaw * 0.45, 0, 'YXZ'));
  b.head.quaternion.setFromEuler(_e.set(pitch * 0.6, yaw * 0.55, 0, 'YXZ'));
  b.neck.updateMatrixWorld(true);
}

export function bendChest(robot, target) {
  const b = robot.bones;
  b.spine.getWorldPosition(_a);
  _dir.subVectors(target, _a);
  if (_dir.lengthSq() < 1e-6) return;
  b.hips.getWorldQuaternion(_pq);
  _dir.applyQuaternion(_pq.invert()).normalize();
  const fwd = clamp(Math.atan2(_dir.z, _dir.y), -0.6, 1.45);
  const side = clamp(-Math.atan2(_dir.x, _dir.y), -0.7, 0.7);
  const ts = _e.setFromQuaternion(b.spine.quaternion, 'YXZ').y;
  const tc = _e.setFromQuaternion(b.chest.quaternion, 'YXZ').y;
  b.spine.quaternion.setFromEuler(_e.set(fwd * 0.45, ts, side * 0.45, 'YXZ'));
  b.chest.quaternion.setFromEuler(_e.set(fwd * 0.55, tc, side * 0.55, 'YXZ'));
  b.spine.updateMatrixWorld(true);
}

export function footWorld(robot, side) {
  const f = robot.bones['foot' + side];
  return { p: f.getWorldPosition(new THREE.Vector3()), q: f.getWorldQuaternion(new THREE.Quaternion()) };
}

export function captureFeet(robot) {
  return { L: footWorld(robot, 'L'), R: footWorld(robot, 'R') };
}

export function clampHips(robot, feet, sides = SIDES) {
  const b = robot.bones;
  const max = LEG_LEN * 0.995;
  let drop = 0;
  for (const s of sides) {
    b['thigh' + s].getWorldPosition(_a);
    const f = feet[s].p;
    const h2 = (_a.x - f.x) ** 2 + (_a.z - f.z) ** 2;
    if (h2 >= max * max) continue;
    drop = Math.max(drop, _a.y - (f.y + Math.sqrt(max * max - h2)));
  }
  if (drop > 0) {
    b.hips.position.y -= drop;
    robot.root.updateMatrixWorld(true);
  }
  return drop;
}

export function plantFeet(robot, feet, opts = {}) {
  const sides = opts.sides ?? SIDES;
  if (opts.clamp !== false) clampHips(robot, feet, sides);
  for (const s of sides) {
    const zp = opts.zPref?.[s] ?? boneAxis(robot.bones['thigh' + s], _z2.set(0, 0, 1), new THREE.Vector3());
    solveLimb(robot, 'leg' + s, feet[s].p, zp, feet[s].q);
  }
}

export function isGrounded(robot) {
  for (const s of SIDES) {
    const f = robot.bones['foot' + s];
    f.getWorldPosition(_a);
    boneAxis(f, _y.set(0, 1, 0), _u);
    if (_a.y > ANKLE_Y + 0.05 || _u.y < 0.9) return false;
  }
  return true;
}

export const PRESETS = {
  stand: { label: 'Stoi', set() {} },
  tpose: {
    label: 'T-poza', hands: ['open', 'open'],
    set(p) { for (const s of SIDES) setArm(p, s, { abd: 88, elbow: -3 }); },
  },
  wave: {
    label: 'Macha', hands: ['relaxed', 'open'],
    set(p) {
      setArm(p, 'R', { flex: -12, abd: 72, twist: 90, elbow: -108, fore: -20, wz: 8 });
      setTorso(p, 'head', -4, -12, 0);
      setTorso(p, 'chest', 0, -4, -2);
    },
  },
  cheer: {
    label: 'Hura', hands: ['fist', 'fist'],
    set(p) {
      for (const s of SIDES) setArm(p, s, { flex: -22, abd: 148, elbow: -18 });
      setTorso(p, 'head', -14, 0, 0);
      setTorso(p, 'chest', -5, 0, 0);
    },
  },
  squat: {
    label: 'Przysiad', hands: ['open', 'open'], plant: true, knees: 0.35,
    set(p) {
      p.hip = [0, -0.36, -0.1];
      setTorso(p, 'spine', 22, 0, 0);
      setTorso(p, 'chest', 14, 0, 0);
      setTorso(p, 'head', -18, 0, 0);
      for (const s of SIDES) setArm(p, s, { flex: -82, abd: 10, elbow: -8 });
    },
  },
  bow: {
    label: 'Ukłon', plant: true,
    set(p) {
      p.hip = [0, -0.01, -0.06];
      setTorso(p, 'spine', 26, 0, 0);
      setTorso(p, 'chest', 22, 0, 0);
      setTorso(p, 'neck', 8, 0, 0);
      for (const s of SIDES) setArm(p, s, { flex: -14, abd: 4, elbow: -8 });
    },
  },
  think: {
    label: 'Myśli', hands: ['relaxed', 'point'],
    set(p) {
      setArm(p, 'R', { flex: -38, abd: 16, twist: -10, elbow: -148, fore: 60, wz: -10 });
      setArm(p, 'L', { flex: -38, abd: -26, twist: -40, elbow: -92, fore: 20 });
      setTorso(p, 'head', 14, -14, 4);
      setTorso(p, 'neck', 6, -4, 0);
    },
  },
  kick: {
    label: 'Kopnięcie', hands: ['fist', 'fist'], plant: ['L'],
    set(p) {
      p.hip = [0, -0.04, 0];
      setLeg(p, 'R', { flex: -84, knee: 14, foot: 24 });
      setLeg(p, 'L', { flex: -6, knee: 12, foot: -6 });
      setTorso(p, 'spine', -8, 0, 0);
      setTorso(p, 'chest', -4, 0, 0);
      setArm(p, 'L', { flex: -30, abd: 42, elbow: -40 });
      setArm(p, 'R', { flex: 18, abd: 40, elbow: -30 });
    },
  },
  flex: {
    label: 'Biceps', hands: ['fist', 'fist'],
    set(p) {
      for (const s of SIDES) setArm(p, s, { flex: -4, abd: 86, twist: 90, elbow: -122, fore: -15 });
      setTorso(p, 'head', -4, 0, 0);
    },
  },
  dab: {
    label: 'Dab', hands: ['open', 'open'],
    set(p) {
      setArm(p, 'L', { flex: -18, abd: 125, elbow: -4 });
      setArm(p, 'R', { flex: -98, abd: -14, twist: 30, elbow: -112, fore: 30 });
      setTorso(p, 'head', 32, 34, 0);
      setTorso(p, 'neck', 10, 10, 0);
      setTorso(p, 'chest', 6, 10, 4);
    },
  },
};

const _kp = new THREE.Vector3();

export function buildPreset(robot, name, base) {
  const def = PRESETS[name];
  const p = standPose(base);
  applyPose(robot, p);
  const feet = captureFeet(robot);
  def.set(p);
  if (def.hands) p.hands = { L: [...HAND_PRESETS[def.hands[0]]], R: [...HAND_PRESETS[def.hands[1]]] };
  applyPose(robot, p);
  if (def.plant) {
    const sides = def.plant === true ? SIDES : def.plant;
    const zPref = {};
    for (const s of sides) {
      const out = (s === 'L' ? 1 : -1) * (def.knees ?? 0.08);
      zPref[s] = _kp.set(out, 0, 1).normalize().applyQuaternion(robot.root.quaternion).clone();
    }
    plantFeet(robot, feet, { sides, zPref });
    readPose(robot, p);
  }
  return p;
}
