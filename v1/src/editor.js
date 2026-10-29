// Ghostframe: direct manipulation (pull body parts with highlight, joint rings, move and turn ghosts)
import * as THREE from 'three';
import { solveLimb, lookHead, bendChest, captureFeet, plantFeet, readPose, boneAxis } from './pose.js';
import { ANKLE_Y, FINGERS } from './optimus.js';

const AX = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
const RING_COLORS = { x: 0x3e6ae1, y: 0x12a594, z: 0xc98a1b };
const AXES = { shinL: ['x'], shinR: ['x'], toeL: ['x'], toeR: ['x'], forearmL: ['x', 'y'], forearmR: ['x', 'y'] };
const LIMITS = {
  shinL: { x: [0, 2.6] }, shinR: { x: [0, 2.6] },
  toeL: { x: [-0.8, 0.5] }, toeR: { x: [-0.8, 0.5] },
  forearmL: { x: [-2.6, 0.05], y: [-1.7, 1.7] }, forearmR: { x: [-2.6, 0.05], y: [-1.7, 1.7] },
};

const fingers = s => Object.keys(FINGERS).flatMap(f => [0, 1, 2].map(k => `${s}_${f}${k}`));
export const GROUPS = {
  armL: ['upperArmL', 'forearmL', 'handL', ...fingers('L')],
  armR: ['upperArmR', 'forearmR', 'handR', ...fingers('R')],
  legL: ['thighL', 'shinL', 'footL', 'toeL'],
  legR: ['thighR', 'shinR', 'footR', 'toeR'],
  head: ['neck', 'head'],
  torso: ['spine', 'chest'],
  pelvis: ['hips'],
};

const clamp = THREE.MathUtils.clamp;
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function orient(g, a) {
  if (a === 'x') g.rotateY(Math.PI / 2);
  if (a === 'y') g.rotateX(Math.PI / 2);
  return g;
}

export function jointOf(name) {
  const m = /^([LR])_/.exec(name);
  return m ? 'hand' + m[1] : name;
}

export function groupOf(name) {
  const f = /^([LR])_/.exec(name);
  if (f) return 'arm' + f[1];
  if (/^(upperArm|forearm|hand)[LR]$/.test(name)) return 'arm' + name.slice(-1);
  if (/^(thigh|shin|foot|toe)[LR]$/.test(name)) return 'leg' + name.slice(-1);
  if (name === 'head' || name === 'neck') return 'head';
  if (name === 'chest' || name === 'spine') return 'torso';
  return 'pelvis';
}

function actionOf(name) {
  if (/^[LR]_/.test(name) || /^(hand|forearm)[LR]$/.test(name)) return 'hand';
  if (/^(upperArm|thigh)[LR]$/.test(name)) return 'swing';
  if (/^(shin|foot|toe)[LR]$/.test(name)) return 'foot';
  if (name === 'head' || name === 'neck') return 'look';
  if (name === 'chest' || name === 'spine') return 'bend';
  return 'pelvis';
}

const sideOf = name => (/^([LR])_/.exec(name)?.[1] ?? name.slice(-1));

export function initEditor(app) {
  const { camera, container } = app;
  const canvas = app.renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), hit = new THREE.Vector3();
  const eul = new THREE.Euler(), rq = new THREE.Quaternion(), q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion();
  let drag = null, press = null, ringHover = null, partHover = null, hoverQueued = false, lastMove = null;

  const rings = new THREE.Group();
  rings.visible = false;
  const ringMeshes = {}, pickMeshes = {};
  for (const a of ['x', 'y', 'z']) {
    const m = new THREE.Mesh(orient(new THREE.TorusGeometry(1, 0.016, 8, 80), a),
      new THREE.MeshBasicMaterial({ color: RING_COLORS[a], transparent: true, opacity: 0.85, depthTest: false, depthWrite: false }));
    m.renderOrder = 10000;
    const p = new THREE.Mesh(orient(new THREE.TorusGeometry(1, 0.12, 6, 48), a), new THREE.MeshBasicMaterial({ visible: false }));
    p.userData.axis = a;
    rings.add(m, p);
    ringMeshes[a] = m;
    pickMeshes[a] = p;
  }
  app.scene.add(rings);

  const disc = new THREE.Group();
  disc.visible = false;
  const discMat = new THREE.MeshBasicMaterial({ color: 0x3e6ae1, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.37, 0.4, 80).rotateX(-Math.PI / 2), discMat);
  ring.position.y = 0.004;
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.1); shape.lineTo(0.07, -0.02); shape.lineTo(-0.07, -0.02); shape.closePath();
  const knob = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), discMat);
  knob.position.set(0, 0.005, 0.5);
  disc.add(ring, knob);
  app.scene.add(disc);
  app.discMat = discMat;

  const setNDC = e => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  };
  const toScreen = (v, out) => {
    const r = canvas.getBoundingClientRect();
    tmp3.copy(v).project(camera);
    out.x = (tmp3.x * 0.5 + 0.5) * r.width;
    out.y = (-tmp3.y * 0.5 + 0.5) * r.height;
    return out;
  };
  const sel = () => (app.sel >= 0 ? app.ghosts[app.sel] : null);
  const live = () => { readPose(sel(), app.keys[app.sel].pose); app.livePose(app.sel); };
  const stop = e => { e.stopPropagation(); e.preventDefault(); };
  const activeRings = () => Object.values(pickMeshes).filter(m => ringMeshes[m.userData.axis].visible);

  function pickOne(g) {
    tmp.set(g.root.position.x, 0.9, g.root.position.z);
    if (ray.ray.distanceSqToPoint(tmp) > 1.3) return null;
    g.body.boundingSphere = null;
    g.body.boundingBox = null;
    const h = ray.intersectObject(g.body, false)[0];
    if (!h) return null;
    return { distance: h.distance, point: h.point.clone(), bone: g.list[g.body.geometry.attributes.skinIndex.getX(h.face.a)].name };
  }

  function pickGhost() {
    let best = null;
    app.ghosts.forEach((g, i) => {
      if (!g.root.visible) return;
      const h = pickOne(g);
      if (h && (!best || h.distance < best.distance)) best = { ...h, index: i };
    });
    return best;
  }

  function floorPoint(out) {
    return ray.ray.intersectPlane(floor, out);
  }

  function knobHit(e) {
    if (!disc.visible) return false;
    const s = toScreen(knob.getWorldPosition(tmp), {});
    const r = canvas.getBoundingClientRect();
    return Math.hypot(e.clientX - r.left - s.x, e.clientY - r.top - s.y) < 26;
  }

  function setPartHover(group) {
    if (group === partHover) return;
    partHover = group;
    if (!drag) app.highlight(group, 0.2);
    canvas.style.cursor = group ? 'grab' : '';
  }

  function onDown(e) {
    if (e.target !== canvas || drag) return;
    if (e.button !== undefined && e.button !== 0) return;
    setNDC(e);
    if (rings.visible) {
      const h = ray.intersectObjects(activeRings(), false)[0];
      if (h) { stop(e); startRing(e, h.object.userData.axis); return; }
    }
    if (knobHit(e)) { stop(e); startYaw(); return; }
    const g = pickGhost();
    if (g) {
      stop(e);
      press = { kind: g.index === app.sel ? 'part' : 'ghost', ...g, x: e.clientX, y: e.clientY };
      return;
    }
    if (disc.visible && floorPoint(hit)) {
      const r = sel().root.position;
      if (Math.hypot(hit.x - r.x, hit.z - r.z) < 0.48) { stop(e); startMove(app.sel); return; }
    }
    press = { kind: 'empty', x: e.clientX, y: e.clientY };
  }

  function startMove(i) {
    const g = app.ghosts[i];
    if (!floorPoint(hit)) return;
    drag = { kind: 'move', i, ox: g.root.position.x - hit.x, oz: g.root.position.z - hit.z };
    canvas.style.cursor = 'grabbing';
    app.dragging(true);
  }

  function startYaw() {
    const g = sel();
    if (!floorPoint(hit)) return;
    const p = g.root.position;
    drag = { kind: 'yaw', a0: Math.atan2(hit.x - p.x, hit.z - p.z), yaw0: app.keys[app.sel].pose.yaw, acc: 0, last: 0 };
    app.dragging(true);
  }

  function startRing(e, a) {
    const g = sel(), bone = g.bones[app.joint];
    const center = bone.getWorldPosition(new THREE.Vector3());
    const axisW = AX[a].clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
    plane.setFromNormalAndCoplanarPoint(axisW, center);
    const v0 = ray.ray.intersectPlane(plane, new THREE.Vector3())?.sub(center) ?? null;
    drag = {
      kind: 'ring', a, bone, q0: bone.quaternion.clone(), center, axisW, v0, x0: e.clientX, y0: e.clientY,
      edge: !v0 || Math.abs(ray.ray.direction.dot(axisW)) < 0.15,
      feet: app.joint === 'hips' ? captureFeet(g) : null,
    };
    app.highlight(groupOf(app.joint), 0.4);
    app.dragging(true);
  }

  function startPart(p) {
    const g = sel();
    g.root.updateMatrixWorld(true);
    const b = g.bones, s = sideOf(p.bone), action = actionOf(p.bone);
    camera.getWorldDirection(tmp);
    plane.setFromNormalAndCoplanarPoint(tmp, p.point);
    drag = { kind: 'part', action, bone: p.bone, s, start: p.point.clone() };
    if (action === 'hand') {
      drag.wrist = b['hand' + s].getWorldPosition(new THREE.Vector3());
      drag.zp = boneAxis(b['upperArm' + s], AX.z, new THREE.Vector3());
    } else if (action === 'swing') {
      const bone = b[p.bone];
      drag.pivot = bone.getWorldPosition(new THREE.Vector3());
      drag.v0 = p.point.clone().sub(drag.pivot).normalize();
      drag.q0 = bone.getWorldQuaternion(new THREE.Quaternion());
    } else if (action === 'foot') {
      drag.ankle = b['foot' + s].getWorldPosition(new THREE.Vector3());
      drag.fq = b['foot' + s].getWorldQuaternion(new THREE.Quaternion());
      drag.zp = boneAxis(b['thigh' + s], AX.z, new THREE.Vector3());
    } else if (action === 'look') {
      drag.base = b.head.getWorldPosition(new THREE.Vector3()).add(boneAxis(b.head, AX.z, tmp2).multiplyScalar(0.6));
    } else if (action === 'bend') {
      drag.base = b.spine.getWorldPosition(new THREE.Vector3()).add(boneAxis(b.chest, AX.y, tmp2).multiplyScalar(0.45));
    } else {
      drag.hips = b.hips.getWorldPosition(new THREE.Vector3());
      drag.feet = captureFeet(g);
      drag.zps = { L: boneAxis(b.thighL, AX.z, new THREE.Vector3()), R: boneAxis(b.thighR, AX.z, new THREE.Vector3()) };
    }
    app.highlight(groupOf(p.bone), 0.42);
    canvas.style.cursor = 'grabbing';
    app.dragging(true);
  }

  function movePart() {
    const g = sel(), b = g.bones, { action, s } = drag;
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const delta = tmp2.subVectors(hit, drag.start);
    if (action === 'hand') solveLimb(g, 'arm' + s, tmp.copy(drag.wrist).add(delta), drag.zp, null);
    else if (action === 'swing') {
      const bone = b[drag.bone];
      const v1 = tmp.copy(drag.start).add(delta).sub(drag.pivot);
      if (v1.lengthSq() < 1e-6) return;
      q1.setFromUnitVectors(drag.v0, v1.normalize()).multiply(drag.q0);
      bone.parent.getWorldQuaternion(q2);
      bone.quaternion.copy(q2.invert().multiply(q1));
      g.root.updateMatrixWorld(true);
    } else if (action === 'foot') {
      tmp.copy(drag.ankle).add(delta);
      tmp.y = Math.max(tmp.y, ANKLE_Y - 0.015);
      solveLimb(g, 'leg' + s, tmp, drag.zp, drag.fq);
    } else if (action === 'look') lookHead(g, tmp.copy(drag.base).addScaledVector(delta, 1.6));
    else if (action === 'bend') bendChest(g, tmp.copy(drag.base).addScaledVector(delta, 1.2));
    else {
      const w = tmp.copy(drag.hips).add(delta);
      g.root.worldToLocal(w);
      b.hips.position.copy(w);
      g.root.updateMatrixWorld(true);
      plantFeet(g, drag.feet, { zPref: drag.zps });
    }
    live();
  }

  function limit(name, q) {
    const L = LIMITS[name];
    if (!L) return;
    eul.setFromQuaternion(q, 'XYZ');
    eul.set(clamp(eul.x, L.x[0], L.x[1]), L.y ? clamp(eul.y, L.y[0], L.y[1]) : 0, 0, 'XYZ');
    q.setFromEuler(eul);
  }

  function moveRing(e) {
    let ang;
    if (!drag.edge && ray.ray.intersectPlane(plane, hit)) {
      const v = hit.sub(drag.center);
      ang = Math.atan2(drag.axisW.dot(tmp.crossVectors(drag.v0, v)), drag.v0.dot(v));
    } else ang = (e.clientX - drag.x0 - (e.clientY - drag.y0)) * 0.012;
    const q = drag.bone.quaternion.copy(drag.q0).multiply(rq.setFromAxisAngle(AX[drag.a], ang));
    limit(app.joint, q);
    const g = sel();
    g.root.updateMatrixWorld(true);
    if (drag.feet) plantFeet(g, drag.feet);
    live();
  }

  function hoverCheck() {
    hoverQueued = false;
    const e = lastMove;
    if (!e || drag || press || app.playing) return;
    setNDC(e);
    if (rings.visible) {
      const h = ray.intersectObjects(activeRings(), false)[0];
      const a = h ? h.object.userData.axis : null;
      if (a !== ringHover) {
        ringHover = a;
        for (const k in ringMeshes) ringMeshes[k].material.opacity = !a || k === a ? 0.95 : 0.4;
        app.render();
      }
      if (a) { setPartHover(null); canvas.style.cursor = 'grab'; return; }
    }
    const g = sel();
    const h = g && e.target === canvas ? pickOne(g) : null;
    setPartHover(h ? groupOf(h.bone) : null);
    if (!h && e.target === canvas) canvas.style.cursor = knobHit(e) ? 'grab' : '';
  }

  function onMove(e) {
    if (press && !drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 4) {
      const p = press;
      press = null;
      setNDC(e);
      if (p.kind === 'part') startPart(p);
      else if (p.kind === 'ghost') { app.select(p.index); setNDC(e); startMove(p.index); }
    }
    if (drag) {
      setNDC(e);
      if (drag.kind === 'part') movePart();
      else if (drag.kind === 'ring') moveRing(e);
      else if (drag.kind === 'move' && floorPoint(hit)) {
        const k = app.keys[drag.i].pose;
        k.x = hit.x + drag.ox;
        k.z = hit.z + drag.oz;
        app.livePose(drag.i, true);
      } else if (drag.kind === 'yaw' && floorPoint(hit)) {
        const p = sel().root.position;
        const a = wrap(Math.atan2(hit.x - p.x, hit.z - p.z) - drag.a0);
        drag.acc += wrap(a - drag.last);
        drag.last = a;
        app.keys[app.sel].pose.yaw = drag.yaw0 + drag.acc;
        app.livePose(app.sel, true);
      }
      drag.moved = true;
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons && app.sel >= 0) {
      lastMove = e;
      if (!hoverQueued) { hoverQueued = true; requestAnimationFrame(hoverCheck); }
    }
  }

  function onUp(e) {
    if (drag) {
      const moved = drag.moved;
      drag = null;
      app.dragging(false);
      partHover = null;
      app.highlight(null);
      canvas.style.cursor = '';
      if (e.pointerType === 'mouse') { lastMove = e; hoverCheck(); }
      if (moved) app.commit();
      return;
    }
    if (!press) return;
    const p = press;
    press = null;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 4) return;
    if (p.kind === 'ghost') app.select(p.index);
    else if (p.kind === 'part') app.selectJoint(app.joint === jointOf(p.bone) ? null : jointOf(p.bone));
    else if (app.joint) app.selectJoint(null);
    else if (app.sel >= 0) app.deselect();
  }

  container.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', () => { if (!drag) { lastMove = null; setPartHover(null); } });

  function update() {
    const g = sel();
    const show = !!g && !app.playing;
    disc.visible = show;
    if (show) {
      disc.position.set(g.root.position.x, 0, g.root.position.z);
      disc.rotation.y = g.root.rotation.y;
    }
    rings.visible = show && !!app.joint;
    if (rings.visible) {
      const bone = g.bones[app.joint];
      bone.getWorldPosition(rings.position);
      bone.getWorldQuaternion(rings.quaternion);
      const dist = camera.position.distanceTo(rings.position);
      const small = /^(hand|foot|toe|forearm|shin)/.test(app.joint);
      rings.scale.setScalar(dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (small ? 0.13 : 0.17));
      const axes = AXES[app.joint] ?? ['x', 'y', 'z'];
      for (const a of ['x', 'y', 'z']) ringMeshes[a].visible = axes.includes(a);
    }
    if (!show && partHover) setPartHover(null);
  }

  return { update, busy: () => !!drag };
}
