// DV75 WATER PRICING · Tidal pricing. State, input (mouse, touch, keyboard), layout, water physics and the render
// scheduler. The slider is a real DOM element (role=slider over the glass); the glass and water are drawn in WebGL
// (or a CSS fallback). Text is never inside the canvas.
import { Scene, View, HV, RO, RI, BASE, YMIN, YMAX, YTOP, MAXS, levelOf, amp } from './vessel.js';

const $ = (s) => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const KEY = 'dv75.seats';
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
let reduced = reduceMQ.matches;
const STILL = qs.has('still');

const els = {
  stage: $('#stage'), fx: $('#fx'), vessel: $('#vessel'), tag: $('#tag'), tn: $('#tn'), ts: $('#ts'), ghost: $('#ghost'),
  hint: $('#hint'), locked: $('#locked'), scale: $('#scale'), cv: $('#cv'), cvWater: $('#cv-water'),
  ptotal: $('#ptotal'), pseat: $('#pseat'), pnote: $('#pnote'), tier: $('#tier'), go: $('#go'), goLbl: $('#go-lbl'),
  sales: $('#sales'), undo: $('#undo'), status: $('#status'),
};
const nums = [...els.scale.querySelectorAll('i')], seatsWord = els.scale.querySelector('b');

// ---------- pricing ----------
const perSeat = (s) => (s < 10 ? 14 : s < 25 ? 12 : 10);
const total = (s) => s * perSeat(s);
const fmt = (n) => '$' + Math.round(n).toLocaleString('en-US');
const seatsText = (s) => (s > MAXS ? '50+ seats' : `${s} seat${s === 1 ? '' : 's'}`);
const seatsFromLevel = (lev) => (lev > YMAX + (YTOP - YMAX) * 0.5 ? MAXS + 1 : Math.max(1, Math.min(MAXS, Math.round((lev - YMIN) / (YMAX - YMIN) * MAXS))));

// ---------- state ----------
const disabled = qs.has('disabled');
let saved = NaN; try { saved = parseInt(localStorage.getItem(KEY), 10); } catch (e) {}
const qSeats = parseInt(qs.get('seats'), 10);
let seats = qSeats >= 1 && qSeats <= 51 ? qSeats : saved >= 1 && saved <= 51 ? saved : 24;
let phase = 'idle';             // idle | confirming | done
let pointerAt = -1e9, pouring = false;
let dragging = false, hovering = false, kbFocus = false, ghostSeats = -1, lastPX = 0;
const st = {
  lev: levelOf(seats), vel: 0, tgt: levelOf(seats), tx: 0, tz: 0, vtx: 0, vtz: 0, swirl: 0, phase: 0,
  rip: 0, ripT: 0, ripE: 0, ripAge: 9, focus: 0, ghost: 0, ghostY: levelOf(seats), bloom: 0, dis: disabled ? 1 : 0,
};
let intro = false, introUntil = 0, shown = { total: total(seats) };

// ---------- WebGL (or the CSS fallback) ----------
let scene = null;
const view = new View();
if (!document.documentElement.classList.contains('no-fx')) {
  try { scene = new Scene(els.fx); } catch (e) { scene = null; document.documentElement.classList.add('no-fx'); }
}
els.fx.addEventListener('webglcontextlost', (e) => { e.preventDefault(); document.documentElement.classList.add('no-fx'); scene = null; layout(); });
if (scene) {
  // the shader's floor/sweep must be the page colour exactly
  const m = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().match(/^#(..)(..)(..)$/);
  if (m) scene.bg = [1, 2, 3].map((i) => Math.pow(parseInt(m[i], 16) / 255, 2.2));
}

// ---------- layout ----------
let phone = false, sideRight = false, canvasBox = [0, 0, 1, 1], tagW = 150, tagH = 60, glassBox = [0, 0, 1, 1];
function fitDpr(w, h) {
  const f = parseFloat(qs.get('fxdpr'));
  if (f > 0) return f;
  const dpr = devicePixelRatio || 1, budget = phone ? 0.9e6 : 1.6e6;
  return Math.max(1, Math.min(Math.max(dpr, 1.5), 2, Math.sqrt(budget / (w * h))));
}
function layout() {
  const W = els.stage.clientWidth, H = els.stage.clientHeight, vw = document.documentElement.clientWidth;
  phone = vw < 700; sideRight = getComputedStyle(els.stage.parentNode).display === 'flex';
  els.tag.classList.toggle('r', sideRight);
  tagW = els.tag.offsetWidth; tagH = els.tag.offsetHeight;
  // the glass at fl = 1 around (0, 0): scale it into the stage
  view.set(0, 0, 1);
  const g = view.cylBox(0, HV, RO + 3, 0), gw = g[2] - g[0], gh = g[3] - g[1];
  const hintH = 46, topPad = sideRight ? 16 : 6;
  let fl = (H - hintH - topPad) / gh;
  fl = Math.min(fl, (sideRight ? (W - tagW - 40 - 30) : W * 0.62) / gw, (0.86 * innerHeight) / gh);
  if (!sideRight) fl = Math.min(fl, 900 / gh);
  const gW = gw * fl, gH = gh * fl;
  const left = sideRight ? Math.max(18, Math.min(W * 0.34 - gW / 2, W - tagW - 30 - 18 - gW)) : (W - gW) / 2;
  const top = topPad + Math.max(0, (H - hintH - topPad - gH) * (sideRight ? 0.45 : 0.5));
  view.set(left - g[0] * fl, top - g[1] * fl, fl);
  glassBox = view.cylBox(0, HV, RO + 3, 0);
  // the canvas: the glass and its floor shadow
  const sb = view.shadowBox(0);
  canvasBox = [Math.floor(Math.min(glassBox[0], sb[0]) - 8), Math.floor(Math.min(glassBox[1], sb[1]) - 8), Math.ceil(Math.max(glassBox[2], sb[2]) + 8), Math.ceil(Math.max(glassBox[3], sb[3]) + 8)];
  const [cx0, cy0, cx1, cy1] = canvasBox;
  Object.assign(els.fx.style, { left: cx0 + 'px', top: cy0 + 'px', width: (cx1 - cx0) + 'px', height: (cy1 - cy0) + 'px' });
  // the slider's hit area = the glass (≥ 44 px)
  const vb = view.cylBox(0, HV, RO, 6);
  Object.assign(els.vessel.style, { left: vb[0] + 'px', top: vb[1] + 'px', width: Math.max(44, vb[2] - vb[0]) + 'px', height: Math.max(44, vb[3] - vb[1]) + 'px' });
  // etched numbers: at the end of the major ticks, on the front-right of the glass
  const th = 0.33 + 0.34 + 0.07;
  nums.forEach((n, i) => {
    const y = levelOf((i + 1) * 10), p = view.project([Math.sin(th) * RO, y, Math.cos(th) * RO]);
    n.style.transform = `translate(${p[0].toFixed(1)}px, ${p[1].toFixed(1)}px) translateY(-50%) scaleX(.84)`;
    n.style.fontSize = Math.max(9, Math.min(14, fl * 4.4)).toFixed(1) + 'px';
  });
  const sp = view.project([Math.sin(0.4) * RO, YMAX + 24, Math.cos(0.4) * RO]);
  seatsWord.style.transform = `translate(${sp[0].toFixed(1)}px, ${sp[1].toFixed(1)}px) translateY(-50%) scaleX(.86)`;
  seatsWord.style.fontSize = Math.max(7, Math.min(10, fl * 3.1)).toFixed(1) + 'px';
  const base = view.project([0, 0, RO]);
  const hw = els.hint.offsetWidth / 2;
  els.hint.style.left = Math.max(hw + 8, Math.min(W - hw - 8, view.cx)) + 'px'; els.hint.style.top = (base[1] + 22) + 'px';
  els.locked.style.left = Math.max(138, Math.min(W - 138, view.cx)) + 'px'; els.locked.style.top = (base[1] + 18) + 'px';
  if (scene) { scene.size(cx0, cy0, cx1 - cx0, cy1 - cy0, fitDpr(cx1 - cx0, cy1 - cy0)); lastDrawn = null; hqRects = []; }
  else layoutFallback();
  placeOverlays();
}

// ---------- CSS fallback ----------
function layoutFallback() {
  const b = view.cylBox(0, HV, RO, 0);
  Object.assign(els.cv.style, { left: b[0] + 'px', top: b[1] + 'px', width: (b[2] - b[0]) + 'px', height: (b[3] - b[1]) + 'px' });
  els.cv.classList.toggle('off', disabled);
  moveFallback();
}
function moveFallback() {
  const b = view.cylBox(0, HV, RO, 0), top = view.levelY(st.lev, 0, RO);
  els.cvWater.style.top = Math.max(0, top - b[1]).toFixed(1) + 'px';
}

// ---------- overlays that ride the water: the tag and the ghost label ----------
let tagAt = '', ghostAt = '';
function placeOverlays() {
  const x = sideRight ? RO + 1 : -RO - 1, y = st.lev + st.tx * (sideRight ? RI : -RI) + 2.6;
  const p = view.project([x, y, 0]);
  const tx = sideRight ? p[0] + 3 : p[0] - tagW - 3, ty = p[1] - tagH / 2;
  const k = `${tx.toFixed(1)},${ty.toFixed(1)}`;
  if (k !== tagAt) { tagAt = k; els.tag.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px)`; }
  if (st.ghost > 0.01) {
    const gp = view.project([RO * 0.98, st.ghostY, RO * 0.2]);
    const gk = `${gp[0].toFixed(1)},${gp[1].toFixed(1)}`;
    if (gk !== ghostAt) { ghostAt = gk; els.ghost.style.transform = `translate(${(gp[0] + 12).toFixed(1)}px, ${(gp[1] - 11).toFixed(1)}px)`; }
  }
}

// ---------- the value ----------
const locked = () => disabled || phase !== 'idle';
function syncText() {
  const s = intro || pouring ? Math.min(seats, seatsFromLevel(st.lev)) : seats;
  els.tn.textContent = seatsText(s);
  if (s > MAXS) { els.ts.textContent = 'Custom / month'; }
  else els.ts.textContent = `${fmt(total(s))} / month`;
  if (seats > MAXS) {
    els.pseat.textContent = 'Volume pricing'; els.pnote.textContent = 'for teams of more than 50 · annual or monthly'; els.tier.hidden = true;
  } else {
    els.pseat.textContent = `$${perSeat(seats)} per seat`; els.pnote.textContent = 'billed monthly · cancel any time';
    els.tier.hidden = perSeat(seats) !== 10;
  }
  if (phase === 'idle') els.goLbl.textContent = seats > MAXS ? 'Talk to sales' : 'Start 14-day trial';
  const v = els.vessel;
  v.setAttribute('aria-valuenow', String(seats));
  v.setAttribute('aria-valuetext', seats > MAXS ? 'More than 50 seats, custom pricing' : `${seats} seat${seats === 1 ? '' : 's'}, ${fmt(total(seats))} per month`);
}
function setSeats(s, { target = true, kick = 0 } = {}) {
  s = Math.max(1, Math.min(MAXS + 1, Math.round(s)));
  if (locked()) return;
  const changed = s !== seats;
  if (changed) { seats = s; try { localStorage.setItem(KEY, String(s)); } catch (e) {} }
  if (target) setTarget(levelOf(s));
  if (kick) ripple(kick);
  syncText(); wake();
}
function setTarget(t) {
  const d = Math.abs(t - st.tgt);
  st.tgt = t;
  if (reduced) { st.lev = t; st.vel = 0; return; }
  st.swirl = Math.min(1, st.swirl + d * 0.0026);
}
function ripple(e) { if (reduced) return; st.ripE = Math.max(st.ripE * Math.exp(-st.ripAge * 2.4), e); st.ripAge = 0; }

// ---------- pointer: drag the water ----------
const stageY = (e) => e.clientY - els.stage.getBoundingClientRect().top;
const levelFromPointer = (e) => Math.max(levelOf(1), Math.min(YTOP, view.levelAt(stageY(e))));
els.vessel.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || locked()) return;
  e.preventDefault();
  dragging = true; lastPX = e.clientX; ghostSeats = -1; pointerAt = performance.now();
  els.vessel.setPointerCapture(e.pointerId); els.vessel.focus({ preventScroll: true });
  document.documentElement.classList.add('dragging'); els.stage.classList.add('active');
  kbFocus = false; ripple(1);
  const lev = levelFromPointer(e); setTarget(lev); setSeats(seatsFromLevel(lev), { target: false });
});
els.vessel.addEventListener('pointermove', (e) => {
  if (dragging) {
    const lev = levelFromPointer(e); setTarget(lev); setSeats(seatsFromLevel(lev), { target: false });
    if (!reduced) st.vtx += Math.max(-0.02, Math.min(0.02, -(e.clientX - lastPX) * 0.0016));
    lastPX = e.clientX;
  } else if (e.pointerType !== 'touch' && !locked()) {
    hovering = true;
    const g = seatsFromLevel(levelFromPointer(e));
    if (g !== ghostSeats) {
      ghostSeats = g; st.ghostY = levelOf(g);
      els.ghost.textContent = g > MAXS ? '50+' : `${g} · ${fmt(total(g))}`;
    }
    wake();
  }
});
const endDrag = () => {
  if (!dragging) return;
  dragging = false; document.documentElement.classList.remove('dragging'); els.stage.classList.remove('active');
  setTarget(levelOf(seats)); wake();
};
els.vessel.addEventListener('pointerup', endDrag);
els.vessel.addEventListener('pointercancel', endDrag);
els.vessel.addEventListener('lostpointercapture', endDrag);
els.vessel.addEventListener('pointerleave', () => { hovering = false; wake(); });

// ---------- keyboard ----------
els.vessel.addEventListener('keydown', (e) => {
  const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 }[e.key];
  let to = null;
  if (step) to = seats + step; else if (e.key === 'Home') to = 1; else if (e.key === 'End') to = MAXS + 1;
  if (to === null) return;
  e.preventDefault();
  if (locked()) return;
  kbFocus = true; hovering = false;
  setSeats(to, { kick: 0.6 });
});
els.vessel.addEventListener('focus', () => { requestAnimationFrame(() => { kbFocus = performance.now() - pointerAt > 400 && els.vessel.matches(':focus-visible'); wake(); }); });
els.vessel.addEventListener('blur', () => { kbFocus = false; wake(); });

// ---------- CTA: start the trial (or talk to sales above 50) ----------
els.go.addEventListener('click', () => {
  if (phase !== 'idle' || disabled) return;
  phase = 'confirming';
  els.vessel.setAttribute('aria-disabled', 'true');
  els.go.setAttribute('aria-busy', 'true'); els.go.setAttribute('aria-disabled', 'true');
  els.goLbl.textContent = seats > MAXS ? 'Sending…' : 'Starting trial…'; els.status.textContent = '';
  wake();
  setTimeout(() => {
    phase = 'done';
    els.go.removeAttribute('aria-busy'); els.go.classList.add('is-done');
    if (seats > MAXS) { els.goLbl.textContent = 'Request sent'; els.status.textContent = 'Thanks. Our team will email you within one business day.'; }
    else { els.goLbl.textContent = `Trial started · ${seatsText(seats)}`; els.status.textContent = `Your ${seats}-seat trial is ready. You won't be billed for 14 days.`; }
    els.undo.hidden = false; els.sales.hidden = true;
    if (!reduced) { st.bloom = 0.0001; bloomOn = true; }
    wake();
  }, reduced ? 300 : 950);
});
els.undo.addEventListener('click', () => {
  phase = 'idle';
  els.vessel.removeAttribute('aria-disabled');
  els.go.classList.remove('is-done'); els.go.removeAttribute('aria-disabled');
  els.undo.hidden = true; els.sales.hidden = false; els.status.textContent = '';
  syncText(); els.vessel.focus(); wake();
});
els.sales.addEventListener('click', (e) => e.preventDefault());

// ---------- physics ----------
let bloomOn = false;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function ease(cur, target, rate, dt) { const d = target - cur; return Math.abs(d) < 1e-3 ? target : cur + d * Math.min(1, dt * rate); }
function step(dt, now) {
  let moving = false;
  if (intro && now >= introUntil) { intro = false; setTarget(levelOf(seats)); }
  if (intro) moving = true;
  // the level: a heavy spring (softer while pouring in), integrated in small steps
  const k = intro || (now - introUntil < 2200 && introUntil) ? 15 : dragging ? 120 : 85;
  const c = intro || (now - introUntil < 2200 && introUntil) ? 6.2 : dragging ? 17 : 12.5;
  if (reduced) { st.lev = st.tgt; st.vel = 0; st.tx = st.tz = st.vtx = st.vtz = 0; st.swirl = 0; st.ripE = 0; }
  else {
    const h = 1 / 480; let tt = dt;
    while (tt > 1e-6) {
      const s = Math.min(h, tt); tt -= s;
      const a = k * (st.tgt - st.lev) - c * st.vel;
      st.vel += a * s; st.lev += st.vel * s;
      // slosh: the surface leans with the flow and rocks back (about 1.9 Hz, light damping)
      const tzD = Math.max(-0.03, Math.min(0.03, -st.vel * 0.00006)), txD = Math.max(-0.02, Math.min(0.02, st.vel * 0.00002));
      st.vtz += (-142 * (st.tz - tzD) - 2.3 * st.vtz) * s; st.tz += st.vtz * s;
      st.vtx += (-142 * (st.tx - txD) - 2.3 * st.vtx) * s; st.tx += st.vtx * s;
    }
    st.tx = Math.max(-0.045, Math.min(0.045, st.tx)); st.tz = Math.max(-0.045, Math.min(0.045, st.tz));
    if (Math.abs(st.tgt - st.lev) < 0.03 && Math.abs(st.vel) < 0.05) { st.lev = st.tgt; st.vel = 0; }
    if (st.vel === 0 && st.lev === st.tgt && Math.abs(st.tx) < 4e-4 && Math.abs(st.tz) < 4e-4 && Math.abs(st.vtx) < 6e-3 && Math.abs(st.vtz) < 6e-3) { st.tx = st.tz = st.vtx = st.vtz = 0; }
    st.swirl *= Math.exp(-dt * 1.5); if (st.swirl < 0.012) st.swirl = 0;
    st.phase += dt * (1.2 + 6 * st.swirl);
    st.ripAge += dt; st.ripT += dt * 13;
    st.rip = st.ripE * 2.1 * (1 - Math.exp(-st.ripAge * 12)) * Math.exp(-st.ripAge * 2.4);
    if (st.ripAge > 0.1 && Math.abs(st.rip) < 0.03) { st.rip = 0; st.ripE = 0; }
  }
  if (st.lev !== st.tgt || st.vel || st.tx || st.tz || st.vtx || st.vtz || st.swirl || st.rip) moving = true;
  const r = reduced ? 1000 : 1;
  const fT = kbFocus && !locked() ? 1 : 0, gT = hovering && !dragging && !locked() && ghostSeats > 0 && ghostSeats !== seats ? 1 : 0, dT = disabled ? 1 : 0;
  const f0 = st.focus, g0 = st.ghost, d0 = st.dis;
  st.focus = ease(st.focus, fT, 9 * r, dt); st.ghost = ease(st.ghost, gT, 12 * r, dt); st.dis = ease(st.dis, dT, 6 * r, dt);
  if (st.focus !== f0 || st.ghost !== g0 || st.dis !== d0 || st.focus !== fT || st.ghost !== gT || st.dis !== dT) moving = true;
  els.ghost.classList.toggle('on', gT === 1);
  if (bloomOn) { st.bloom += dt / 1.7; moving = true; if (st.bloom >= 1) { st.bloom = 0; bloomOn = false; } }
  // the big price counts toward the value
  const tot = seats > MAXS ? -1 : total(seats);
  if (tot < 0) { if (els.ptotal.textContent !== 'Custom') els.ptotal.textContent = 'Custom'; shown.total = -1; }
  else {
    if (shown.total < 0 || reduced) shown.total = tot;
    shown.total = Math.abs(tot - shown.total) < 0.5 ? tot : shown.total + (tot - shown.total) * Math.min(1, dt * 14);
    if (shown.total !== tot) moving = true;
    const txt = fmt(shown.total); if (els.ptotal.textContent !== txt) els.ptotal.textContent = txt;
  }
  if (pouring && !intro && (seatsFromLevel(st.lev) >= seats || dragging)) pouring = false;
  if (intro || pouring || now - introUntil < 2200) syncText();
  els.stage.classList.toggle('kb', kbFocus && !locked());
  return moving;
}

// ---------- render scheduler: sleeps at rest, redraws only what changed, refines once at 4 spp ----------
const snap = () => ({ lev: st.lev, tx: st.tx, tz: st.tz, swirl: st.swirl, phase: st.phase, rip: st.rip, ripT: st.ripT, focus: st.focus, ghost: st.ghost, ghostY: st.ghostY, bloom: st.bloom, dis: st.dis });
let lastDrawn = null, hqRects = [], raf = 0, last = 0, lastMoving = true, visible = !document.hidden;
const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const union = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
const ne = (a, b, e = 1e-5) => Math.abs(a - b) > e;
const surfBox = (s) => { const a = amp(s); return view.cylBox(s.lev - a - 4, s.lev + a + 6, RO + 4); };
function dirtyRects(p, c) {
  if (ne(p.dis, c.dis)) return null;   // full
  const rects = [];
  // the success light band lives in the water column (and is piped up the rim)
  if (ne(p.bloom, c.bloom)) { rects.push(view.cylBox(0, Math.max(p.lev, c.lev) + amp(c) + 6, RO + 4)); rects.push(view.cylBox(HV - 10, HV + 2, RO + 4)); }
  const surf = ne(p.lev, c.lev) || ne(p.tx, c.tx, 1e-7) || ne(p.tz, c.tz, 1e-7) || ne(p.swirl, c.swirl) || ne(p.phase, c.phase) && c.swirl > 0 ||
    ne(p.rip, c.rip) || ne(p.ripT, c.ripT) && c.rip !== 0 || ne(p.focus, c.focus);
  // the surface, plus the two places light is piped through the glass to it: the base (seen from below by total
  // internal reflection) and the rim (rays entering the lip run down inside the wall)
  // (those two are thin light paths: while the water moves they are only queued for the refinement pass at rest)
  if (surf) { rects.push(union(surfBox(p), surfBox(c))); deferred.push(view.cylBox(0, BASE + 8, RO + 4), view.cylBox(HV - 10, HV + 2, RO + 4)); }
  if (ne(p.ghost, c.ghost) || (c.ghost > 0 && ne(p.ghostY, c.ghostY))) {
    if (p.ghost > 0) rects.push(view.cylBox(p.ghostY - 4, p.ghostY + 4, RO + 3));
    rects.push(view.cylBox(c.ghostY - 4, c.ghostY + 4, RO + 3));
  }
  return mergeRects(rects);
}
const deferred = [];
function mergeRects(rects) {
  let merged = true;
  while (merged) {
    merged = false;
    for (let a = 0; a < rects.length && !merged; a++) for (let b = a + 1; b < rects.length; b++) if (overlap(rects[a], rects[b])) { rects[a] = union(rects[a], rects[b]); rects.splice(b, 1); merged = true; break; }
  }
  return rects;
}
const clipC = (r) => [Math.max(canvasBox[0], r[0]), Math.max(canvasBox[1], r[1]), Math.min(canvasBox[2], r[2]), Math.min(canvasBox[3], r[3])];
const HQ_BUDGET = 42000;   // device px per frame at 4 spp
const queueHQ = (rs) => { hqRects = mergeRects(hqRects.concat(rs.map(clipC).filter((r) => r[2] > r[0] && r[3] > r[1]))); };
function hqStep() {
  // one horizontal strip of an area that changed, at 4 spp
  const d = scene.dpr, r = hqRects[0], w = Math.max(1, (r[2] - r[0]) * d);
  const rows = Math.max(6, Math.floor(HQ_BUDGET / w)) / d;
  const strip = [r[0], r[1], r[2], Math.min(r[3], r[1] + rows)];
  scene.render(view, st, [strip], 4);
  if (strip[3] >= r[3] - 0.01) hqRects.shift(); else hqRects[0] = [r[0], strip[3], r[2], r[3]];
}
function frame(now) {
  raf = 0;
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 120); last = now;
  const moving = step(dt, now); lastMoving = moving;
  if (scene) {
    const cur = snap();
    if (!lastDrawn) { scene.render(view, st, null, STILL ? 4 : 1); lastDrawn = cur; hqRects = STILL ? [] : [canvasBox.slice()]; deferred.length = 0; }
    else {
      const rects = dirtyRects(lastDrawn, cur);
      if (!rects) { scene.render(view, st, null, 1); hqRects = [canvasBox.slice()]; deferred.length = 0; lastDrawn = cur; }
      else if (rects.length) { const rc = rects.map(clipC); scene.render(view, st, rc, 1); queueHQ(rc.concat(deferred.splice(0))); lastDrawn = cur; }
      else if (!moving && hqRects.length) hqStep();
    }
  } else moveFallback();
  placeOverlays();
  if (moving || (scene && hqRects.length && visible)) raf = requestAnimationFrame(frame); else last = 0;
}
function wake() { lastMoving = true; if (!raf && visible) raf = requestAnimationFrame(frame); }
document.addEventListener('visibilitychange', () => { visible = !document.hidden; if (visible) wake(); });
reduceMQ.addEventListener('change', (e) => { reduced = e.matches; wake(); });
let rz = 0;
addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { layout(); wake(); }); });

// ---------- boot ----------
if (disabled) { els.stage.classList.add('is-disabled'); els.vessel.setAttribute('aria-disabled', 'true'); els.locked.hidden = false; els.go.setAttribute('aria-disabled', 'true'); }
syncText();
try { await document.fonts.ready; } catch (e) {}
// first visit: the water pours in from two seats and settles at the value (skipped for reduced motion / stills)
if (!reduced && !STILL && !disabled) {
  intro = true; pouring = true; introUntil = performance.now() + 320;
  st.lev = st.tgt = levelOf(2); st.swirl = 0.0; st.tz = 0;
}
layout();
let readyResolve; const ready = new Promise((r) => (readyResolve = r));
wake();
requestAnimationFrame(() => requestAnimationFrame(() => readyResolve(true)));

window.__water = {
  ready, levelOf,
  get seats() { return seats; }, get phase() { return phase; },
  get busy() { return raf !== 0; },
  get moving() { return lastMoving; },
  get fx() { return !!scene; },
  set: (n) => setSeats(n),
  state: () => ({ seats, phase, lev: +st.lev.toFixed(3), tgt: +st.tgt.toFixed(3), vel: st.vel, tx: st.tx, tz: st.tz, swirl: st.swirl, rip: st.rip, focus: st.focus, ghost: st.ghost, ghostY: st.ghostY,
    bloom: st.bloom, dis: st.dis, intro, draws: scene ? scene.draws : 0, px: scene ? scene.px : 0, dpr: scene ? scene.dpr : 0,
    canvas: scene ? [els.fx.width, els.fx.height] : null, canvasBox, glassBox, hq: hqRects.length, sleeping: raf === 0, fl: view.fl }),
  view, scene: () => scene, st,
  redraw: (spp = 1) => { if (scene) { scene.render(view, st, null, spp); lastDrawn = snap(); hqRects = []; deferred.length = 0; } },
};
