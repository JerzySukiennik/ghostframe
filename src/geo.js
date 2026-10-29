// Ghostframe: geometry helpers (lofted superellipse shells and small primitives)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const cr = (a, b, c, d, t) => {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
};

const norm = k => ({ y: k.y, rx: k.rx, rz: k.rz ?? k.rx, cx: k.cx ?? 0, cz: k.cz ?? 0, n: k.n ?? 2 });

function sampleKeys(keys, steps) {
  const K = keys.map(norm);
  const out = [];
  for (let i = 0; i < K.length - 1; i++) {
    const a = K[Math.max(0, i - 1)], b = K[i], c = K[i + 1], d = K[Math.min(K.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        y: b.y + (c.y - b.y) * t,
        rx: Math.max(1e-4, cr(a.rx, b.rx, c.rx, d.rx, t)),
        rz: Math.max(1e-4, cr(a.rz, b.rz, c.rz, d.rz, t)),
        cx: cr(a.cx, b.cx, c.cx, d.cx, t),
        cz: cr(a.cz, b.cz, c.cz, d.cz, t),
        n: b.n + (c.n - b.n) * t,
      });
    }
  }
  out.push(K[K.length - 1]);
  return out;
}

function dome(ring, dir, h, count) {
  const rings = [];
  for (let i = 1; i <= count; i++) {
    const a = (i / count) * Math.PI / 2;
    const s = Math.cos(a);
    rings.push({ ...ring, y: ring.y + dir * h * Math.sin(a), rx: ring.rx * s, rz: ring.rz * s, pole: i === count });
  }
  return rings;
}

export function loft(keys, o = {}) {
  const seg = o.seg ?? 24, steps = o.steps ?? 4;
  const t0 = o.t0 ?? 0, tl = o.tl ?? Math.PI * 2;
  const closed = tl >= Math.PI * 2 - 1e-6;
  const off = o.offset ?? 0;
  const capN = o.capN ?? Math.max(3, Math.round(seg / 4));
  let rings = sampleKeys(keys, steps);
  if (o.capStart !== false && closed) {
    const r = rings[0], dir = Math.sign(r.y - rings[1].y) || 1;
    rings = dome(r, dir, o.capStartH ?? Math.min(r.rx, r.rz) * 0.85, capN).reverse().concat(rings);
  }
  if (o.capEnd !== false && closed) {
    const r = rings[rings.length - 1], dir = Math.sign(r.y - rings[rings.length - 2].y) || -1;
    rings = rings.concat(dome(r, dir, o.capEndH ?? Math.min(r.rx, r.rz) * 0.85, capN));
  }
  const per = closed ? seg : seg + 1;
  const pos = [], idx = [], start = [], count = [];
  for (const r of rings) {
    start.push(pos.length / 3);
    if (r.pole) { pos.push(r.cx, r.y, r.cz); count.push(1); continue; }
    const e = 2 / r.n;
    for (let j = 0; j < per; j++) {
      const th = t0 + (j / seg) * tl;
      const c = Math.cos(th), s = Math.sin(th);
      pos.push(
        r.cx + Math.sign(c) * Math.pow(Math.abs(c), e) * (r.rx + off),
        r.y,
        r.cz + Math.sign(s) * Math.pow(Math.abs(s), e) * (r.rz + off),
      );
    }
    count.push(per);
  }
  const down = keys[keys.length - 1].y < keys[0].y;
  const tri = (a, b, c) => (down ? idx.push(a, c, b) : idx.push(a, b, c));
  for (let i = 0; i < rings.length - 1; i++) {
    const a = start[i], b = start[i + 1], na = count[i], nb = count[i + 1];
    if (na === 1 && nb === 1) continue;
    for (let j = 0; j < seg; j++) {
      const j1 = closed ? (j + 1) % seg : j + 1;
      if (na === 1) tri(a, b + j, b + j1);
      else if (nb === 1) tri(a + j, b, a + j1);
      else { tri(a + j, b + j, b + j1); tri(a + j, b + j1, a + j1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function clean(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  out.setAttribute('normal', g.getAttribute('normal'));
  if (g.index) out.setIndex(g.index);
  else out.setIndex([...Array(g.getAttribute('position').count).keys()]);
  return out;
}

export function sphere(r, x, y, z, ws = 16, hs = 12, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return clean(g);
}

export function cylX(r, len, x, y, z, seg = 16) {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return clean(g);
}

export function cylY(r0, r1, len, x, y, z, seg = 16) {
  const g = new THREE.CylinderGeometry(r0, r1, len, seg, 1);
  g.translate(x, y, z);
  return clean(g);
}

export function capsuleY(r, len, x, y, z, seg = 8, capSeg = 4) {
  const g = new THREE.CapsuleGeometry(r, Math.max(1e-4, len - 2 * r), capSeg, seg);
  g.translate(x, y - len / 2, z);
  return clean(g);
}

export function rbox(w, h, d, r, x, y, z, segs = 3) {
  const g = new RoundedBoxGeometry(w, h, d, segs, r);
  g.translate(x, y, z);
  return clean(g);
}
