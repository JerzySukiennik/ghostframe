// Ghostframe: DOM interface (timeline, ghost panel, transition editor, settings, labels)
import * as THREE from 'three';
import { PRESETS, HAND_PRESETS } from './pose.js';

const ICON = {
  auto: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 2.5l1.9 5.4 5.4 1.9-5.4 1.9L11 17.1l-1.9-5.4-5.4-1.9 5.4-1.9z"/><path d="M18.5 14l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/></svg>',
  walk: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4.5" y="3.5" width="5.5" height="9" rx="2.75"/><rect x="14" y="11.5" width="5.5" height="9" rx="2.75"/></svg>',
  smooth: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M3 14c3-6.5 6-6.5 9 0s6 6.5 9 0"/></svg>',
  jump: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"><path d="M3 20c3-15 15-15 18 0"/><circle cx="12" cy="8.6" r="1.8" fill="currentColor" stroke="none"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.4 0-1.8L8.6 3.9C7.9 3.5 7 4 7 4.8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="4" width="4.6" height="16" rx="1.4"/><rect x="13.9" y="4" width="4.6" height="16" rx="1.4"/></svg>',
};
const MODE_LABEL = { auto: 'Auto', walk: 'Chód', smooth: 'Płynnie', jump: 'Skok' };
const HAND_LABEL = { relaxed: 'Luźna', open: 'Otwarta', fist: 'Pięść', point: 'Wskazuje', thumb: 'Kciuk', peace: 'Peace' };
const HOLDS = [[0, 'Brak'], [0.5, '0,5 s'], [1, '1 s'], [2, '2 s']];
const FPS = [60, 24, 12];

const $ = id => document.getElementById(id);
const fmt = v => v.toFixed(1).replace('.', ',');

export function initUI(app) {
  const nodes = $('nodes'), track = $('track'), playhead = $('playhead'), fill = $('fill');
  const panel = $('panel'), pop = $('pop'), menu = $('menu');
  let popIndex = -1;
  let nodeEls = [], trEls = [];

  $('play').innerHTML = ICON.play;
  $('play').onclick = () => app.togglePlay();
  $('add').onclick = () => app.addKey();
  $('undo').onclick = () => app.undo();
  $('redo').onclick = () => app.redo();
  $('frame').onclick = () => app.frameAll();
  $('theme').onclick = () => app.toggleTheme();
  $('clear').onclick = () => app.clearAll();
  $('onion').onclick = () => app.setSetting('onion', !app.settings.onion);
  $('pclose').onclick = () => app.deselect();
  $('mirror').onclick = () => app.mirror();
  $('dup').onclick = () => app.duplicate();
  $('del').onclick = () => app.deleteKey(app.sel);
  $('hintX').onclick = () => app.dismissHint();
  $('more').onclick = e => { e.stopPropagation(); toggleMenu(); };

  const presets = $('presets');
  for (const [name, def] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = def.label;
    b.onclick = () => app.applyPreset(name);
    presets.appendChild(b);
  }
  for (const side of ['L', 'R']) {
    const box = $('hand' + side);
    for (const name of Object.keys(HAND_PRESETS)) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.h = name;
      b.textContent = HAND_LABEL[name];
      b.onclick = () => app.setHand(side, name);
      box.appendChild(b);
    }
  }
  const hold = $('hold');
  for (const [v, l] of HOLDS) {
    const b = document.createElement('button');
    b.textContent = l;
    b.dataset.v = v;
    b.onclick = () => app.setHold(v);
    hold.appendChild(b);
  }
  const fps = $('fps');
  for (const f of FPS) {
    const b = document.createElement('button');
    b.textContent = f === 60 ? 'Płynnie' : f;
    b.dataset.v = f;
    b.onclick = () => app.setSetting('fps', f);
    fps.appendChild(b);
  }
  $('follow').onclick = () => app.setSetting('follow', !app.settings.follow);
  $('loop').onclick = () => app.setSetting('loop', !app.settings.loop);

  const modes = $('modes');
  for (const m of Object.keys(MODE_LABEL)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.m = m;
    b.innerHTML = ICON[m] + `<span>${MODE_LABEL[m]}</span>`;
    b.onclick = () => app.setTransition(popIndex, { mode: m });
    modes.appendChild(b);
  }
  const durR = $('durR'), durO = $('durO'), durAuto = $('durAuto');
  durR.oninput = () => { durO.textContent = fmt(+durR.value) + ' s'; app.setTransition(popIndex, { dur: +durR.value }, true); };
  durR.onchange = () => app.commit();
  durAuto.onclick = () => app.setTransition(popIndex, { dur: app.keys[popIndex].dur == null ? app.plan.dur[popIndex] : null });

  document.addEventListener('pointerdown', e => {
    if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.tr')) closePop();
    if (!menu.hidden && !menu.contains(e.target) && e.target !== $('more')) menu.hidden = true;
  }, true);

  function place(el, anchor) {
    const r = anchor.getBoundingClientRect();
    el.hidden = false;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
    el.style.top = Math.max(8, r.top - h - 12) + 'px';
  }

  function toggleMenu() {
    if (!menu.hidden) { menu.hidden = true; return; }
    refreshMenu();
    place(menu, $('more'));
  }

  function refreshMenu() {
    for (const b of fps.children) b.classList.toggle('on', +b.dataset.v === app.settings.fps);
    $('follow').classList.toggle('on', !!app.settings.follow);
    $('loop').classList.toggle('on', !!app.settings.loop);
  }

  function openPop(i) {
    popIndex = i;
    refreshPop();
    place(pop, trEls[i]);
    trEls.forEach((t, k) => t.classList.toggle('open', k === i));
  }

  function closePop() {
    pop.hidden = true;
    popIndex = -1;
    trEls.forEach(t => t.classList.remove('open'));
  }

  function refreshPop() {
    if (popIndex < 0 || popIndex >= app.keys.length - 1) { closePop(); return; }
    const k = app.keys[popIndex], plan = app.plan;
    const mode = k.mode || 'auto';
    for (const b of modes.children) {
      b.classList.toggle('on', b.dataset.m === mode);
      if (b.dataset.m === 'auto') b.querySelector('span').textContent = mode === 'auto' ? `Auto: ${MODE_LABEL[plan.mode[popIndex]].toLowerCase()}` : 'Auto';
    }
    durR.value = plan.dur[popIndex];
    durO.textContent = fmt(plan.dur[popIndex]) + ' s';
    durAuto.classList.toggle('on', k.dur == null);
  }

  function buildTrack() {
    for (const el of [...nodeEls, ...trEls]) el.remove();
    nodeEls = []; trEls = [];
    const n = app.keys.length;
    app.keys.forEach((k, i) => {
      const b = document.createElement('button');
      b.className = 'node';
      b.textContent = i + 1;
      b.title = `Ghost ${i + 1}`;
      b.onclick = () => app.select(i);
      nodes.appendChild(b);
      nodeEls.push(b);
      if (i < n - 1) {
        const t = document.createElement('button');
        t.className = 'tr';
        t.onclick = e => { e.stopPropagation(); popIndex === i && !pop.hidden ? closePop() : openPop(i); };
        nodes.appendChild(t);
        trEls.push(t);
      }
    });
  }

  function refreshTrack() {
    if (nodeEls.length !== app.keys.length) buildTrack();
    const plan = app.plan;
    app.keys.forEach((k, i) => {
      nodeEls[i].classList.toggle('sel', i === app.sel);
      nodeEls[i].classList.toggle('hold', (k.hold || 0) > 0);
      if (i < trEls.length) {
        const m = plan.mode[i], auto = (k.mode || 'auto') === 'auto';
        trEls[i].innerHTML = ICON[m] + `${fmt(plan.dur[i])} s` + (auto ? '' : ' <i>•</i>');
        trEls[i].title = `${MODE_LABEL[m]}${auto ? ' (auto)' : ''}, ${fmt(plan.dur[i])} s`;
      }
    });
    if (!pop.hidden) refreshPop();
  }

  function centers() {
    return nodeEls.map(el => el.offsetLeft + el.offsetWidth / 2);
  }

  function timeToX(t) {
    const plan = app.plan, c = centers();
    if (!c.length) return 0;
    for (let i = 0; i < c.length - 1; i++) {
      if (t <= plan.t[i + 1]) {
        const a = plan.t[i], b = plan.t[i + 1];
        return c[i] + (c[i + 1] - c[i]) * THREE.MathUtils.clamp((t - a) / Math.max(1e-6, b - a), 0, 1);
      }
    }
    return c[c.length - 1];
  }

  function xToTime(x) {
    const plan = app.plan, c = centers();
    if (c.length < 2) return 0;
    if (x <= c[0]) return 0;
    for (let i = 0; i < c.length - 1; i++) {
      if (x <= c[i + 1]) return plan.t[i] + (plan.t[i + 1] - plan.t[i]) * (x - c[i]) / (c[i + 1] - c[i]);
    }
    return plan.T;
  }

  let scrubbing = false;
  const scrubAt = e => {
    const r = nodes.getBoundingClientRect();
    app.scrub(xToTime(e.clientX - r.left));
  };
  $('scrub').addEventListener('pointerdown', e => {
    scrubbing = true;
    e.target.setPointerCapture(e.pointerId);
    scrubAt(e);
  });
  $('scrub').addEventListener('pointermove', e => { if (scrubbing) scrubAt(e); });
  $('scrub').addEventListener('pointerup', () => { scrubbing = false; });
  $('scrub').addEventListener('pointercancel', () => { scrubbing = false; });

  function updatePlayhead() {
    const x = timeToX(app.time);
    playhead.style.left = x + 'px';
    const c0 = nodeEls.length ? nodeEls[0].offsetLeft + 16 : 22;
    fill.style.left = c0 + 'px';
    fill.style.width = Math.max(0, x - c0) + 'px';
    const rail = $('rail');
    rail.style.left = c0 + 'px';
    rail.style.right = c0 + 'px';
    $('time').textContent = `${fmt(app.time)} / ${fmt(app.plan.T || 0)} s`;
    if (app.playing) {
      const left = x - track.scrollLeft;
      if (left > track.clientWidth - 40 || left < 20) track.scrollLeft = x - track.clientWidth / 2;
    }
  }

  function refreshPanel() {
    const i = app.sel;
    panel.hidden = i < 0;
    if (i < 0) return;
    const k = app.keys[i];
    $('ptitle').textContent = `Ghost ${i + 1}`;
    for (const side of ['L', 'R']) {
      const h = k.pose.hands[side];
      for (const b of $('hand' + side).children) {
        const p = HAND_PRESETS[b.dataset.h];
        b.classList.toggle('on', p.every((v, c) => Math.abs(v - h[c]) < 1e-3));
      }
    }
    for (const b of hold.children) b.classList.toggle('on', Math.abs(+b.dataset.v - (k.hold || 0)) < 1e-3);
  }

  const labelBox = $('labels');
  let labelEls = [];
  const tmp = new THREE.Vector3();
  function updateLabels() {
    while (labelEls.length < app.keys.length) {
      const el = document.createElement('button');
      el.className = 'glabel';
      const idx = labelEls.length;
      el.onclick = () => app.select(idx);
      labelBox.appendChild(el);
      labelEls.push(el);
    }
    while (labelEls.length > app.keys.length) labelEls.pop().remove();
    const r = app.renderer.domElement.getBoundingClientRect();
    app.keys.forEach((k, i) => {
      const el = labelEls[i], g = app.ghosts[i];
      g.bones.head.localToWorld(tmp.set(0, 0.32, 0));
      tmp.project(app.camera);
      const vis = tmp.z < 1 && !app.playing;
      el.style.display = vis ? '' : 'none';
      if (!vis) return;
      el.textContent = i + 1;
      el.classList.toggle('sel', i === app.sel);
      el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * r.width}px, ${(-tmp.y * 0.5 + 0.5) * r.height}px)`;
    });
  }

  function refresh() {
    refreshTrack();
    refreshPanel();
    refreshMenu();
    $('onion').classList.toggle('on', !!app.settings.onion);
    $('fcount').textContent = app.frameCount ? `· ${app.frameCount}` : '';
    $('undo').disabled = !app.canUndo();
    $('redo').disabled = !app.canRedo();
    $('hint').hidden = !app.showHint;
    updatePlayhead();
  }

  let toastT = 0;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('show'), 1800);
  }

  function setPlaying(p) {
    $('play').innerHTML = p ? ICON.pause : ICON.play;
    $('play').title = p ? 'Pauza (spacja)' : 'Odtwórz (spacja)';
  }

  return { refresh, updatePlayhead, updateLabels, toast, setPlaying, closePop, closeMenu: () => { menu.hidden = true; } };
}
