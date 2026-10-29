// Ghostframe: procedural Tesla Optimus (Gen 2 look), rigid-skinned rig and robot instances
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, sphere, cylX, cylY, capsuleY, rbox } from './geo.js';

export const BODY = [
  ['hips', null, [0, 0.98, 0]],
  ['spine', 'hips', [0, 0.08, 0]],
  ['chest', 'spine', [0, 0.14, 0]],
  ['neck', 'chest', [0, 0.27, 0]],
  ['head', 'neck', [0, 0.085, 0]],
  ['upperArmL', 'chest', [0.205, 0.23, 0]],
  ['forearmL', 'upperArmL', [0, -0.285, 0]],
  ['handL', 'forearmL', [0, -0.25, 0]],
  ['upperArmR', 'chest', [-0.205, 0.23, 0]],
  ['forearmR', 'upperArmR', [0, -0.285, 0]],
  ['handR', 'forearmR', [0, -0.25, 0]],
  ['thighL', 'hips', [0.095, -0.06, 0]],
  ['shinL', 'thighL', [0, -0.42, 0]],
  ['footL', 'shinL', [0, -0.415, 0]],
  ['toeL', 'footL', [0, -0.07, 0.13]],
  ['thighR', 'hips', [-0.095, -0.06, 0]],
  ['shinR', 'thighR', [0, -0.42, 0]],
  ['footR', 'shinR', [0, -0.415, 0]],
  ['toeR', 'footR', [0, -0.07, 0.13]],
];

export const BODY_NAMES = BODY.map(b => b[0]);

export const FINGERS = {
  t: { base: [-0.012, -0.024, 0.036], len: [0.034, 0.028, 0.023], r: 0.0095 },
  i: { base: [0, -0.09, 0.027], len: [0.04, 0.026, 0.021], r: 0.0088 },
  m: { base: [0, -0.09, 0.009], len: [0.043, 0.028, 0.022], r: 0.009 },
  r: { base: [0, -0.09, -0.009], len: [0.04, 0.026, 0.021], r: 0.0086 },
  p: { base: [0, -0.088, -0.026], len: [0.032, 0.021, 0.018], r: 0.0078 },
};

export const REST_HIPS_Y = 0.98;
export const LEG_LEN = 0.42 + 0.415;
export const ANKLE_Y = 0.085;

const TONE = { white: 0, black: 1, joint: 0.85, metal: 0.7, visor: 1 };

function boneDefs() {
  const defs = BODY.map(([name, parent, pos]) => ({ name, parent, pos }));
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    for (const [f, d] of Object.entries(FINGERS)) {
      let parent = 'hand' + side;
      d.len.forEach((_, k) => {
        const name = `${side}_${f}${k}`;
        const pos = k === 0 ? [d.base[0] * s, d.base[1], d.base[2]] : [0, -d.len[k - 1], 0];
        defs.push({ name, parent, pos });
        parent = name;
      });
    }
  }
  return defs;
}

function buildBones(defs) {
  const bones = {}, list = [];
  for (const d of defs) {
    const b = new THREE.Bone();
    b.name = d.name;
    b.position.fromArray(d.pos);
    bones[d.name] = b;
    list.push(b);
    if (d.parent) bones[d.parent].add(b);
  }
  return { bones, list };
}

function parts(hi) {
  const S = hi ? 28 : 12, ST = hi ? 4 : 2, C = hi ? 7 : 3, SW = hi ? 22 : 9, SH = hi ? 16 : 6;
  const L = (keys, o = {}) => loft(keys, { seg: S, steps: ST, capN: C, ...o });
  const B = (w, h, d, r, x, y, z) => rbox(w, h, d, r, x, y, z, hi ? 2 : 1);
  const out = [];
  const add = (bone, mat, geo) => out.push({ bone, mat, geo });

  add('hips', 'joint', L([
    { y: 0.05, rx: 0.125, rz: 0.088, n: 2.6 }, { y: -0.02, rx: 0.15, rz: 0.1, n: 2.6 },
    { y: -0.085, rx: 0.12, rz: 0.095, n: 2.4 }, { y: -0.14, rx: 0.05, rz: 0.07, n: 2.2 },
  ], { capStartH: 0.015, capEndH: 0.03 }));
  for (const s of [1, -1]) {
    add('hips', 'metal', cylX(0.05, 0.07, s * 0.135, -0.06, 0, SW));
    add('hips', 'joint', sphere(0.052, s * 0.095, -0.06, 0, SW, SH));
    add('hips', 'metal', cylY(0.028, 0.028, 0.1, s * 0.07, -0.02, 0.06, SW));
  }

  add('spine', 'joint', L([
    { y: -0.04, rx: 0.122, rz: 0.088, n: 2.4 }, { y: -0.01, rx: 0.116, rz: 0.084, n: 2.4 },
    { y: 0.02, rx: 0.122, rz: 0.088, n: 2.4 }, { y: 0.05, rx: 0.115, rz: 0.083, n: 2.4 },
    { y: 0.08, rx: 0.121, rz: 0.087, n: 2.4 }, { y: 0.11, rx: 0.117, rz: 0.085, n: 2.5 },
    { y: 0.16, rx: 0.13, rz: 0.092, n: 2.6 },
  ], { capStartH: 0.01, capEndH: 0.01 }));

  const chest = [
    { y: -0.035, rx: 0.148, rz: 0.104, cz: 0.006, n: 3 }, { y: 0.03, rx: 0.158, rz: 0.115, cz: 0.01, n: 3.2 },
    { y: 0.12, rx: 0.168, rz: 0.12, cz: 0.01, n: 3.4 }, { y: 0.2, rx: 0.163, rz: 0.114, n: 3.2 },
    { y: 0.235, rx: 0.148, rz: 0.1, n: 3 },
  ];
  add('chest', 'black', L(chest.map(k => ({ ...k, rx: k.rx - 0.004, rz: k.rz - 0.004 })), { capStartH: 0.02, capEndH: 0.025 }));
  add('chest', 'white', L(chest, { t0: Math.PI / 2 - 1.12, tl: 2.24, offset: 0.001, capStart: false, capEnd: false }));
  add('chest', 'white', L(chest.slice(1, 4), { t0: Math.PI * 1.5 - 0.95, tl: 1.9, offset: 0.001, capStart: false, capEnd: false }));
  add('chest', 'black', L([
    { y: 0.19, rx: 0.162, rz: 0.112, n: 2.6 }, { y: 0.24, rx: 0.13, rz: 0.092, n: 2.3 },
    { y: 0.285, rx: 0.052, rz: 0.048, n: 2 },
  ], { capStartH: 0.01, capEnd: false }));
  for (const s of [1, -1]) add('chest', 'joint', cylX(0.045, 0.08, s * 0.165, 0.23, 0, SW));

  add('neck', 'black', L([
    { y: -0.03, rx: 0.045, rz: 0.043 }, { y: 0.03, rx: 0.037, rz: 0.036 }, { y: 0.1, rx: 0.035, rz: 0.034 },
  ], { capStart: false, capEnd: false }));

  const head = [
    { y: -0.045, rx: 0.04, rz: 0.05, cz: 0.012, n: 2.15 }, { y: -0.015, rx: 0.062, rz: 0.078, cz: 0.016, n: 2.15 },
    { y: 0.03, rx: 0.075, rz: 0.094, cz: 0.01, n: 2.15 }, { y: 0.08, rx: 0.08, rz: 0.1, cz: 0, n: 2.15 },
    { y: 0.125, rx: 0.077, rz: 0.097, cz: -0.006, n: 2.15 },
  ];
  add('head', 'black', L(head, { capStartH: 0.018, capEndH: 0.05 }));
  add('head', 'visor', L([
    { y: -0.028, rx: 0.058, rz: 0.074, cz: 0.016, n: 2.15 }, { y: 0.03, rx: 0.075, rz: 0.094, cz: 0.01, n: 2.15 },
    { y: 0.08, rx: 0.08, rz: 0.1, cz: 0, n: 2.15 }, { y: 0.1, rx: 0.0795, rz: 0.099, cz: -0.002, n: 2.15 },
  ], { t0: Math.PI / 2 - 0.85, tl: 1.7, offset: 0.0009, capStart: false, capEnd: false }));

  const thigh = [
    { y: -0.01, rx: 0.076, rz: 0.086, cz: 0.012, n: 2.4 }, { y: -0.1, rx: 0.075, rz: 0.083, cz: 0.014, n: 2.4 },
    { y: -0.25, rx: 0.063, rz: 0.067, cz: 0.008, n: 2.4 }, { y: -0.35, rx: 0.052, rz: 0.056, cz: 0.004, n: 2.4 },
  ];
  const shin = [
    { y: -0.005, rx: 0.051, rz: 0.057, cz: 0.012, n: 2.3 }, { y: -0.09, rx: 0.051, rz: 0.055, cz: 0.004, n: 2.3 },
    { y: -0.22, rx: 0.042, rz: 0.044, cz: -0.004, n: 2.3 }, { y: -0.34, rx: 0.032, rz: 0.033, n: 2.3 },
  ];

  for (const [side, s] of [['L', 1], ['R', -1]]) {
    add('upperArm' + side, 'white', L([
      { y: 0.01, rx: 0.056, rz: 0.058, n: 2.3 }, { y: -0.08, rx: 0.053, rz: 0.055, n: 2.3 },
      { y: -0.17, rx: 0.047, rz: 0.049, n: 2.3 }, { y: -0.232, rx: 0.044, rz: 0.046, n: 2.3 },
    ], { capStartH: 0.045, capEndH: 0.012 }));
    add('upperArm' + side, 'joint', sphere(0.04, 0, -0.255, 0, SW, SH, 1, 0.8, 1));

    add('forearm' + side, 'joint', cylX(0.038, 0.082, 0, 0, 0, SW));
    add('forearm' + side, 'white', L([
      { y: -0.015, rx: 0.046, rz: 0.049, n: 2.3 }, { y: -0.09, rx: 0.044, rz: 0.046, n: 2.3 },
      { y: -0.175, rx: 0.036, rz: 0.038, n: 2.3 }, { y: -0.215, rx: 0.033, rz: 0.035, n: 2.3 },
    ], { capStartH: 0.03, capEndH: 0.01 }));
    add('forearm' + side, 'joint', sphere(1, s * 0.04, -0.075, 0, SW, SH, 0.01, 0.045, 0.026));
    add('forearm' + side, 'joint', cylY(0.029, 0.027, 0.03, 0, -0.232, 0, SW));

    add('hand' + side, 'white', B(0.028, 0.014, 0.058, 0.005, 0, -0.006, 0));
    add('hand' + side, 'joint', B(0.022, 0.085, 0.072, 0.009, 0, -0.047, 0.002));
    for (const [f, d] of Object.entries(FINGERS)) {
      d.len.forEach((len, k) => {
        const r = d.r * (1 - 0.1 * k);
        add(`${side}_${f}${k}`, k < 2 ? 'white' : 'joint', capsuleY(r, len + r * 0.6, 0, r * 0.3, 0, hi ? 8 : 4, hi ? 4 : 2));
      });
    }

    const back = Math.PI * (side === 'L' ? 1.25 : 1.75);
    add('thigh' + side, 'white', L(thigh, { capStartH: 0.05, capEndH: 0.022 }));
    add('thigh' + side, 'joint', L(thigh.slice(1, 4), { t0: back - Math.PI * 0.42, tl: Math.PI * 0.84, offset: 0.0028, capStart: false, capEnd: false }));

    add('shin' + side, 'joint', cylX(0.04, 0.085, 0, 0, 0, SW));
    add('shin' + side, 'white', L(shin, { capStartH: 0.045, capEndH: 0.018 }));
    add('shin' + side, 'joint', cylY(0.03, 0.026, 0.1, 0, -0.36, 0, SW));
    for (const dx of [0.022, -0.022]) add('shin' + side, 'joint', capsuleY(0.017, 0.13, dx, -0.075, -0.044, hi ? 12 : 5, hi ? 4 : 2));

    add('foot' + side, 'joint', sphere(0.033, 0, 0, 0, SW, SH));
    add('foot' + side, 'joint', B(0.09, 0.06, 0.2, 0.026, 0, -0.055, 0.035));
    add('foot' + side, 'joint', B(0.066, 0.075, 0.105, 0.024, 0, -0.035, -0.005));
    add('toe' + side, 'joint', B(0.088, 0.035, 0.068, 0.015, 0, 0.0025, 0.03));
  }
  return out;
}

let TEMPLATE = null;

function template() {
  if (TEMPLATE) return TEMPLATE;
  const defs = boneDefs();
  const { bones, list } = buildBones(defs);
  const root = new THREE.Group();
  root.add(bones.hips);
  root.updateMatrixWorld(true);
  const index = Object.fromEntries(list.map((b, i) => [b.name, i]));
  const inverses = list.map(b => b.matrixWorld.clone().invert());
  const build = (hi, byMat) => {
    const groups = {};
    for (const p of parts(hi)) {
      const g = p.geo;
      g.applyMatrix4(bones[p.bone].matrixWorld);
      const n = g.attributes.position.count;
      const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), tone = new Float32Array(n);
      const bi = index[p.bone];
      for (let i = 0; i < n; i++) { si[i * 4] = bi; sw[i * 4] = 1; tone[i] = TONE[p.mat]; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
      if (!byMat) g.setAttribute('tone', new THREE.Float32BufferAttribute(tone, 1));
      (groups[byMat ? p.mat : 'all'] ||= []).push(g);
    }
    return Object.fromEntries(Object.entries(groups).map(([k, gs]) => [k, mergeGeometries(gs)]));
  };
  TEMPLATE = { defs, index, inverses, solid: build(true, true), ghost: build(false, false).all };
  return TEMPLATE;
}

function withHighlight(mat, hi) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uHi = hi.level;
    sh.uniforms.uHiColor = hi.color;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uHi[64];\nvarying float vHi;')
      .replace('#include <skinbase_vertex>', '#include <skinbase_vertex>\nvHi = uHi[int(skinIndex.x + 0.5)];');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHiColor;\nvarying float vHi;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uHiColor, vHi * 0.55);\ntotalEmissiveRadiance += uHiColor * vHi * 0.9;');
  };
  mat.customProgramCacheKey = () => 'ghostframe-hi';
  return mat;
}

export function makeMaterials() {
  const hi = { level: { value: new Float32Array(64) }, color: { value: new THREE.Color(0x3e6ae1) } };
  const m = {
    white: new THREE.MeshPhysicalMaterial({ color: 0xf1f1ef, roughness: 0.34, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0d, roughness: 0.28, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 }),
    joint: new THREE.MeshStandardMaterial({ color: 0x1d1e21, roughness: 0.62, metalness: 0.2 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x34363a, roughness: 0.38, metalness: 0.85 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x030304, roughness: 0.06, metalness: 0.4, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6 }),
  };
  for (const k in m) withHighlight(m[k], hi);
  m.hi = hi;
  m.ghostDepth = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  return m;
}

export function ghostMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(0x8fa8cc) },
      uB: { value: new THREE.Color(0x34404f) },
      uRim: { value: new THREE.Color(0x5a7fc0) },
      uOpacity: { value: 0.3 },
      uRimK: { value: 0.8 },
    },
    vertexShader: /* glsl */`
      #include <common>
      #include <skinning_pars_vertex>
      attribute float tone;
      varying float vTone;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        vN = normalize(transformedNormal);
        vV = -mvPosition.xyz;
        vTone = tone;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uRim;
      uniform float uOpacity;
      uniform float uRimK;
      varying float vTone;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(vV);
        float f = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.2);
        float l = 0.55 + 0.45 * max(dot(n, normalize(vec3(0.35, 0.75, 0.55))), 0.0);
        vec3 c = mix(uA, uB, clamp(vTone, 0.0, 1.0)) * l + uRim * f * uRimK;
        gl_FragColor = vec4(c, clamp(uOpacity * (0.6 + 0.7 * f), 0.0, 1.0));
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthFunc: THREE.LessEqualDepth,
  });
}

export function createRobot(kind, mats) {
  const T = template();
  const { bones, list } = buildBones(T.defs);
  const root = new THREE.Group();
  root.add(bones.hips);
  const robot = { root, bones, list, kind, meshes: [] };
  if (kind === 'none') return robot;
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list, T.inverses);
  robot.skeleton = skeleton;
  const mk = (geo, mat) => {
    const m = new THREE.SkinnedMesh(geo, mat);
    m.frustumCulled = false;
    root.add(m);
    m.bind(skeleton);
    robot.meshes.push(m);
    return m;
  };
  if (kind === 'solid') {
    for (const [k, g] of Object.entries(T.solid)) {
      const m = mk(g, mats[k]);
      m.castShadow = true;
      m.receiveShadow = true;
    }
  } else {
    robot.depth = mk(T.ghost, mats.ghostDepth);
    robot.depth.raycast = () => {};
    robot.body = mk(T.ghost, ghostMaterial());
    robot.body.userData.robot = robot;
  }
  return robot;
}

export function boneIndex() {
  return template().index;
}
