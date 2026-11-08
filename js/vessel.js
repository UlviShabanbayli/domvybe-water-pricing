// DV75 WATER PRICING · the vessel: a thick clear glass cylinder with a heavy base, filled with dyed water, on a pale
// studio floor. One fragment shader traces each pixel ANALYTICALLY (ray–cylinder and ray–plane roots; only the water
// surface, a height field, is searched, and only inside the thin slab it can occupy): outer wall → glass → inner wall →
// air or water → surface → far wall → base → floor, with Fresnel, refraction (n 1.5 / 1.333), total internal
// reflection, Beer–Lambert absorption and in-scatter in the water, a silvery waterline, a soft glass shadow with a teal
// caustic, etched graduations, a hover ghost line, the focus glow and the success light band.
// The canvas covers only the vessel and its shadow. Pixels that miss the glass are transparent (premultiplied), with
// the shadow/caustic composited over the page, so the page colour is the CSS colour. The app redraws only while
// something moves, scissored to what changed; at rest it refines changed areas once at 4 spp, in small strips.
import { createGL, program } from './gl.js';

export const HV = 580, RO = 128, RI = 120, BASE = 34, YMIN = 50, YMAX = 546, MAXS = 50, YTOP = 562;
export const CAM = [0, 900, 2300], TG = [0, 255, 0];
export const SH = [0.3, -0.65];                       // floor shadow direction per unit of height (light from front-left)
export const levelOf = (s) => (s > MAXS ? YTOP : YMIN + (YMAX - YMIN) * s / MAXS);

const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform vec2 uC; uniform float uFl, uPix, uSeed;
uniform vec3 uRo, uFw, uRt, uUp, uBg;
uniform float uLevel, uTx, uTz, uSwirl, uPhase, uRip, uRipT, uAmp;
uniform float uFocus, uGhost, uGhostY, uBloom, uDis;
uniform int uSpp;
const float HV = ${HV}., RO = ${RO}., RI = ${RI}., BASE = ${BASE}., YMIN = ${YMIN}., STEP = ${(YMAX - YMIN) / MAXS};
const float PI = 3.14159265;
const vec2 SHD = vec2(${SH[0]}, ${SH[1]});

float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y)*p3.z); }

// tone: identity below 0.8 (so the page colour maps to itself exactly), a soft shoulder above
vec3 tone(vec3 c){
  c = max(c, 0.);
  vec3 k = 0.8 + 0.2*(1. - exp(-(c - 0.8)/0.2));
  c = mix(c, k, step(0.8, c));
  return pow(c, vec3(1./2.2));
}

// the studio the glass reflects. az 0 = toward the viewer (behind the camera), +-PI = behind the vessel
vec3 env(vec3 d){
  float az = atan(d.x, d.z), el = d.y;
  vec3 c = uBg*mix(0.9, 1.12, smoothstep(-0.4, 0.8, el));
  // two tall soft boxes behind the camera: the long highlights down the front of the glass
  float tall = smoothstep(-0.66, -0.52, el)*smoothstep(0.98, 0.86, el);
  c += vec3(5.2, 5.3, 5.4)*smoothstep(0.085, 0.055, abs(az + 0.74))*tall;
  c += vec3(3.3, 3.45, 3.6)*smoothstep(0.05, 0.028, abs(az - 0.58))*tall;
  // dark flags at the sides: crisp silhouettes and a darker inner edge
  c *= 1. - 0.6*smoothstep(0.36, 0.1, abs(abs(az) - 1.66))*smoothstep(-0.75, -0.45, el);
  // a wide soft panel low behind the vessel: the water surface mirrors it as a bright sheen
  float back = abs(abs(az) - PI);
  c *= 1. - 0.32*smoothstep(0.9, 0.3, back)*smoothstep(0.02, 0.15, el)*smoothstep(0.75, 0.45, el);
  c += vec3(2.2, 2.25, 2.3)*smoothstep(0.2, 0.1, abs(back - 0.34))*smoothstep(0.1, 0.18, el)*smoothstep(0.5, 0.38, el);
  c += vec3(1.4, 1.45, 1.5)*smoothstep(0.12, 0.05, abs(back - 0.62))*smoothstep(0.1, 0.18, el)*smoothstep(0.5, 0.38, el);
  // the ceiling
  c += vec3(1.2)*smoothstep(0.8, 0.95, el);
  return c;
}

// the floor (a seamless sweep in the page colour) with the glass shadow and the caustic the water focuses
vec3 floorCol(vec2 p){
  vec2 A = SHD*HV;
  float t = clamp(dot(p, A)/dot(A, A), 0., 1.);
  float d = length(p - A*t);
  float pw = 8. + 64.*t;
  float inS = smoothstep(RO + pw, RO - pw, d);
  float wt = 0.52;   // fixed: the shadow must not depend on the level (it is seen through the top of the glass too)
  float wPart = smoothstep(wt + 0.035, wt - 0.035, t);
  float rim = exp(-pow((d - RO*0.9)/(9. + 36.*t), 2.));
  vec3 c = uBg;
  c *= 1. - inS*(0.06 + 0.07*rim)*(1. - 0.6*t);
  c *= mix(vec3(1.), vec3(0.66, 0.89, 0.92), inS*wPart*(0.25 + 0.75*smoothstep(0.12, 0.4, t))*(1. - 0.5*t));
  float ca = exp(-pow(d/(14. + 40.*t), 2.))*wPart*smoothstep(0.04, 0.3, t);
  float crest = exp(-pow((t - wt + 0.06)/0.05, 2.))*exp(-pow(d/(30. + 30.*t), 2.));
  c += vec3(0.32, 0.86, 0.95)*(ca*0.42 + crest*0.42)*(1. - 0.6*uDis);
  float r = length(p);
  c *= 1. - 0.3*exp(-pow((r - RO)/4., 2.)) - 0.04*smoothstep(RO + 2., RO - 10., r);
  return c;
}

float surfY(vec2 q){
  float r2 = dot(q, q)/(RI*RI), r = sqrt(r2);
  float y = uLevel + uTx*q.x + uTz*q.y;
  y -= uSwirl*14.*(0.5 - r2);                                 // the vortex funnel (volume kept)
  y += uSwirl*2.4*sin(3.*atan(q.y, q.x) + r*7. - uPhase)*r;   // spiral arms
  y += uRip*cos(r*17. - uRipT)*(1. - 0.45*r);                 // a ring wave from a touch
  y += 2.6*exp(-(1. - r)*RI/3.);                              // the meniscus climbing the glass
  return y;
}
vec3 surfN(vec2 q){
  float e = 0.7, h = surfY(q);
  return normalize(vec3(-(surfY(q + vec2(e, 0.)) - h)/e, 1., -(surfY(q + vec2(0., e)) - h)/e));
}
// the first crossing of the surface along p + d t, t in (0, tmax). sgn: +1 starting above, -1 below. Only the slab
// the surface can occupy is searched.
float surfHit(vec3 p, vec3 d, float tmax, float sgn){
  float y0 = uLevel - uAmp - 1., y1 = uLevel + uAmp + 3.;
  float ta = 0., tb = tmax;
  if (abs(d.y) > 1e-5) {
    float t0 = (y0 - p.y)/d.y, t1 = (y1 - p.y)/d.y;
    ta = max(0., min(t0, t1)); tb = min(tmax, max(t0, t1));
  } else if (p.y < y0 || p.y > y1) return -1.;
  if (tb <= ta) return -1.;
  float tp = ta;
  for (int i = 1; i <= 10; i++) {
    float t = mix(ta, tb, float(i)/10.);
    vec3 q = p + d*t;
    if ((q.y - surfY(q.xz))*sgn < 0.) {
      float a = tp, b = t;
      for (int k = 0; k < 6; k++) { float m = 0.5*(a + b); vec3 qq = p + d*m; if ((qq.y - surfY(qq.xz))*sgn < 0.) b = m; else a = m; }
      return b;
    }
    tp = t;
  }
  return -1.;
}

float cylT(vec3 p, vec3 d, float r, bool far){
  float a = dot(d.xz, d.xz), b = dot(p.xz, d.xz), c = dot(p.xz, p.xz) - r*r;
  float disc = b*b - a*c;
  if (disc < 0. || a < 1e-9) return -1.;
  float s = sqrt(disc);
  return far ? (-b + s)/a : (-b - s)/a;
}
float iorOf(int m){ return m == 1 ? 1.5 : m == 3 ? 1.333 : 1.; }

// cross an interface; on total internal reflection the ray reflects and the medium stays
void crossI(inout vec3 rd, inout int med, int nm, vec3 n, inout vec3 col, inout vec3 thr, float rk){
  if (dot(n, rd) > 0.) n = -n;
  float n1 = iorOf(med), n2 = iorOf(nm);
  float ci = clamp(-dot(rd, n), 0., 1.);
  float r0 = (n1 - n2)/(n1 + n2); r0 *= r0;
  float F = r0 + (1. - r0)*pow(1. - ci, 5.);
  vec3 rf = refract(rd, n, n1/n2);
  if (dot(rf, rf) < 1e-4) { rd = reflect(rd, n); return; }
  col += thr*F*env(reflect(rd, n))*rk;
  thr *= 1. - F;
  rd = normalize(rf); med = nm;
}

// returns premultiplied display colour + alpha
vec4 shade(vec2 frag){
  vec2 q = frag - uC;
  vec3 rd = normalize(uFw*uFl + uRt*q.x + uUp*q.y), ro = uRo;
  vec3 col = vec3(0.), thr = vec3(1.);
  // ---- primary hit: the rim, the opening, the outer wall, or nothing ----
  int med = 0; vec3 p = ro; bool hit = false; vec3 n = vec3(0.); bool side = false;
  float tTop = (HV - ro.y)/rd.y;
  vec3 pt = ro + rd*tTop; float rt = length(pt.xz);
  if (rd.y < 0. && rt < RO) {
    p = pt; hit = true;
    if (rt < RI) { med = 2; }   // straight into the open top
    else {
      float u = (rt - RI)/(RO - RI);
      n = normalize(vec3(pt.x/rt*(u - 0.5)*2.4, 1., pt.z/rt*(u - 0.5)*2.4));
    }
  } else {
    float ts = cylT(ro, rd, RO, false);
    if (ts > 0.) { p = ro + rd*ts; if (p.y >= 0. && p.y <= HV) { hit = true; side = true; n = vec3(p.x/RO, 0., p.z/RO); n.y += 1.1*smoothstep(HV - 7., HV, p.y); n = normalize(n); } }
  }
  if (!hit) {
    if (rd.y >= 0.) return vec4(0.);
    float t = -ro.y/rd.y; vec3 f = ro + rd*t;
    vec3 T = tone(floorCol(f.xz)), P = tone(uBg);
    vec3 m = T/max(P, vec3(1e-3));
    float a = clamp(1. - min(min(m.r, m.g), m.b), 0., 1.);
    return vec4(max(T - P*(1. - a), 0.), a);
  }
  if (med == 0) {
    // entering the glass from the air: the studio reflection, the etched scale, the hover ghost line
    if (side) {
      float th = atan(p.x, p.z);
      float s = (p.y - YMIN)/STEP, si = floor(s + 0.5), dy = abs(s - si)*STEP;
      if (si >= 1. && si <= 50.) {
        float m10 = mod(si, 10.), m5 = mod(si, 5.);
        bool major = m10 < 0.5 || m10 > 9.5, mid = m5 < 0.5 || m5 > 4.5;
        float len = major ? 0.34 : mid ? 0.22 : 0.13, hw = major ? 1.05 : 0.72;
        float th0 = 0.33, aa = uPix/RO;
        float inU = smoothstep(th0 - aa, th0 + aa, th)*smoothstep(th0 + len + aa, th0 + len - aa, th);
        float line = inU*clamp((hw - dy)/uPix + 0.5, 0., 1.);
        col += vec3(0.96, 0.98, 1.)*line*0.62*(1. - 0.5*uDis); thr *= 1. - line*0.55;
      }
      float g = uGhost*clamp((1.1 - abs(p.y - uGhostY))/uPix + 0.5, 0., 1.)*smoothstep(1.5, 1.15, abs(th));
      col = mix(col, vec3(0.004, 0.17, 0.22), g*0.85); thr *= 1. - g*0.85;
    }
    crossI(rd, med, 1, n, col, thr, 1.1);
    p += rd*0.05;
  }
  // ---- follow the transmitted path ----
  vec3 absW = vec3(0.0088, 0.0024, 0.0016), absG = vec3(0.0011, 0.00035, 0.0006);
  for (int ev = 0; ev < 11; ev++) {
    float best = 1e9; vec3 bn = vec3(0.); int bm = -1;   // bm: 0 air outside, 1 glass, 2 inner air, 3 water, 4 floor, 5 out the top
    if (med == 1) {
      float t = cylT(p, rd, RO, true);
      if (t > 1e-3) { vec3 q = p + rd*t; if (q.y >= 0. && q.y <= HV) { best = t; bn = vec3(q.x/RO, 0., q.z/RO); bm = 0; } }
      if (rd.y < 0.) { t = -p.y/rd.y; if (t > 1e-3 && t < best) { vec3 q = p + rd*t; if (dot(q.xz, q.xz) < RO*RO) { best = t; bn = vec3(0., -1., 0.); bm = 4; } } }
      if (rd.y > 0.) { t = (HV - p.y)/rd.y; if (t > 1e-3 && t < best) { vec3 q = p + rd*t; float r = length(q.xz); if (r > RI && r < RO) { best = t; bn = vec3(0., 1., 0.); bm = 0; } } }
      t = cylT(p, rd, RI, false);
      if (t > 1e-3 && t < best) { vec3 q = p + rd*t; if (q.y > BASE && q.y < HV) { best = t; bn = vec3(q.x/RI, 0., q.z/RI); bm = q.y < surfY(q.xz) ? 3 : 2; } }
      if (rd.y > 0. && p.y < BASE) { t = (BASE - p.y)/rd.y; if (t > 1e-3 && t < best) { vec3 q = p + rd*t; if (dot(q.xz, q.xz) < RI*RI) { best = t; bn = vec3(0., 1., 0.); bm = 3; } } }
    } else if (med == 2) {
      float t = cylT(p, rd, RI, true);
      vec3 q = p + rd*t;
      if (q.y < HV) { best = t; bn = vec3(q.x/RI, 0., q.z/RI); bm = 1; }
      else { best = (HV - p.y)/max(rd.y, 1e-4); bm = 5; }
      float ts = surfHit(p, rd, best, 1.);
      if (ts > 0.) { best = ts; bm = 3; bn = surfN((p + rd*ts).xz); }
    } else if (med == 3) {
      float t = cylT(p, rd, RI, true);
      best = t; vec3 q = p + rd*t; bn = vec3(q.x/RI, 0., q.z/RI); bm = 1;
      if (rd.y < 0.) { float tb = (BASE - p.y)/rd.y; if (tb > 0. && tb < best) { best = tb; bn = vec3(0., -1., 0.); bm = 1; } }
      float ts = surfHit(p, rd, best, -1.);
      if (ts > 0.) { best = ts; bm = 2; bn = surfN((p + rd*ts).xz); }
    }
    if (bm < 0) break;
    // the medium this segment ran through
    if (med == 3) {
      vec3 tr = exp(-absW*best);
      vec3 mid = p + rd*best*0.5;
      float depth = smoothstep(BASE, BASE + 320., mid.y);   // absolute, so the column below the surface never changes with the level
      vec3 glow = vec3(0.05, 0.2, 0.235)*(0.75 + 0.45*depth);
      col += thr*glow*(1. - exp(-best*0.0045))*(1. - 0.75*uDis);
      if (uBloom > 0.) {
        float yb = BASE - 30. + (uLevel - BASE + 60.)*uBloom;
        float bl = 0.;
        for (int k = 0; k < 3; k++) { vec3 s3 = p + rd*best*(0.2 + 0.3*float(k)); bl += exp(-pow((s3.y - yb)/24., 2.)); }
        col += thr*vec3(0.55, 1.0, 1.0)*bl*0.3*sin(PI*uBloom)*(1. - exp(-best*0.012));
      }
      thr *= mix(tr, vec3(dot(tr, vec3(0.3, 0.5, 0.2))), 0.85*uDis);
    } else if (med == 1) thr *= exp(-absG*best);
    p += rd*best;
    if (bm == 4) { col += thr*floorCol(p.xz)*1.06; return vec4(tone(col), 1.); }
    if (bm == 5) { col += thr*env(rd); return vec4(tone(col), 1.); }
    // the waterline: where the water meets the glass, the meniscus mirrors the room in a thin silver line
    if (med == 1 && (bm == 2 || bm == 3) && bn.y == 0.) {
      float dd = p.y - surfY(p.xz);
      float band = smoothstep(-4.2, -1.6, dd)*smoothstep(2.2, 0.2, dd);
      float under = exp(-pow((dd + 6.)/2.6, 2.));
      col += thr*band*(vec3(0.85, 0.95, 0.98)*0.8 + vec3(0.1, 0.75, 0.85)*uFocus*1.6);
      thr *= (1. - band*0.82)*(1. - under*0.28*vec3(1., 0.55, 0.5));
    }
    int prev = med;
    crossI(rd, med, bm == 0 ? 0 : bm, bn, col, thr, 1.0);
    if (med == 0) {
      // out of the glass into the studio: the floor or the sweep
      if (rd.y < 0.) { float t = -p.y/rd.y; vec3 f = p + rd*t; col += thr*floorCol(f.xz); }
      else col += thr*mix(uBg, env(rd), 0.25)*1.035;
      return vec4(tone(col), 1.);
    }
    p += rd*0.04;
  }
  col += thr*uBg;
  return vec4(tone(col), 1.);
}

void main(){
  vec4 acc = vec4(0.);
  for (int s = 0; s < 4; s++) {
    if (s >= uSpp) break;
    vec2 j = uSpp == 1 ? vec2(0.) : vec2(fract(0.25 + 0.5*float(s) + 0.125*float(s/2)), fract(0.125 + 0.25*float(s) + 0.5*float(s/2))) - 0.5;
    acc += shade(gl_FragCoord.xy + j);
  }
  acc /= float(uSpp);
  vec4 c = acc;
  if (uDis > 0. && c.a > 0.99) {
    float g = dot(c.rgb, vec3(0.3, 0.55, 0.15));
    c.rgb = mix(c.rgb, vec3(g)*0.82 + 0.16, uDis*0.55);
  }
  c.rgb += (h12(gl_FragCoord.xy + uSeed) - 0.5)/255.*c.a;
  o = c;
}`;

const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => { const l = Math.hypot(...a); return a.map((v) => v / l); };

// the camera, shared by the shader, the DOM overlays, the pointer mapping and the CSS fallback
export class View {
  constructor() {
    this.fw = nrm(sub(TG, CAM)); this.rt = nrm(crs(this.fw, [0, 1, 0])); this.up = crs(this.rt, this.fw);
    this.cx = 0; this.cy = 0; this.fl = 1;
  }
  set(cx, cy, fl) { this.cx = cx; this.cy = cy; this.fl = fl; return this; }
  // world → css px in the stage
  project(P) {
    const d = sub(P, CAM), z = dot(d, this.fw);
    return [this.cx + dot(d, this.rt) / z * this.fl, this.cy - dot(d, this.up) / z * this.fl];
  }
  // screen box of a slice of a cylinder (y0..y1, radius r)
  cylBox(y0, y1, r, pad = 3) {
    let x0 = 1e9, ya = 1e9, x1 = -1e9, yb = -1e9;
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, x = Math.sin(a) * r, z = Math.cos(a) * r;
      for (const y of [y0, y1]) { const s = this.project([x, y, z]); x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]); ya = Math.min(ya, s[1]); yb = Math.max(yb, s[1]); }
    }
    return [x0 - pad, ya - pad, x1 + pad, yb + pad];
  }
  // screen box of the floor shadow
  shadowBox(pad = 6) {
    const A = [SH[0] * HV, SH[1] * HV], R = RO + 80;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of [[0, 0], A]) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, s = this.project([c[0] + Math.sin(a) * R, 0, c[1] + Math.cos(a) * R]);
      x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]); y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1]);
    }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }
  // stage y of the surface at the glass, at world (x, z)
  levelY(lev, x = 0, z = RO) { return this.project([x, lev, z])[1]; }
  // inverse of levelY at the front of the glass (monotonic): which level is under stage y
  levelAt(sy) {
    let a = -200, b = HV + 200;
    for (let i = 0; i < 28; i++) { const m = (a + b) / 2; if (this.levelY(m) > sy) a = m; else b = m; }
    return (a + b) / 2;
  }
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = createGL(canvas);
    if (!gl) throw new Error('no webgl2');
    this.prog = program(gl, FS).use();
    this.draws = 0; this.px = 0; this.dpr = 1; this.ox = 0; this.oy = 0; this.w = 1; this.h = 1;
    this.bg = [0.716, 0.73, 0.745];
  }
  // the canvas covers stage box [ox, oy, ox + w, oy + h] (css px)
  size(ox, oy, w, h, dpr) {
    const c = this.canvas, W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    this.ox = ox; this.oy = oy; this.w = w; this.h = h; this.dpr = W / w;
  }
  // rects: null = everything, else stage css boxes [x0, y0, x1, y1]; spp 1 or 4
  render(view, s, rects, spp = 1) {
    const gl = this.gl, p = this.prog, d = this.dpr, c = this.canvas;
    if (gl.isContextLost()) return 0;
    gl.viewport(0, 0, c.width, c.height);
    const cx = (view.cx - this.ox) * d, cy = c.height - (view.cy - this.oy) * d;
    p.f('uC', cx, cy).f('uFl', view.fl * d).f('uPix', (2350 / (view.fl * d)) * 1.0).f('uSeed', (this.draws % 64) * 1.7)
      .f('uRo', ...CAM).f('uFw', ...view.fw).f('uRt', ...view.rt).f('uUp', ...view.up).f('uBg', ...this.bg)
      .f('uLevel', s.lev).f('uTx', s.tx).f('uTz', s.tz).f('uSwirl', s.swirl).f('uPhase', s.phase).f('uRip', s.rip).f('uRipT', s.ripT)
      .f('uAmp', amp(s)).f('uFocus', s.focus).f('uGhost', s.ghost).f('uGhostY', s.ghostY).f('uBloom', s.bloom).f('uDis', s.dis)
      .i('uSpp', spp);
    let px = 0;
    if (!rects) { gl.disable(gl.SCISSOR_TEST); p.draw(); px = c.width * c.height; }
    else {
      gl.enable(gl.SCISSOR_TEST);
      for (const r of rects) {
        const x0 = Math.max(0, Math.floor((r[0] - this.ox) * d)), x1 = Math.min(c.width, Math.ceil((r[2] - this.ox) * d));
        const y0 = Math.max(0, Math.floor((r[1] - this.oy) * d)), y1 = Math.min(c.height, Math.ceil((r[3] - this.oy) * d));
        if (x1 <= x0 || y1 <= y0) continue;
        gl.scissor(x0, c.height - y1, x1 - x0, y1 - y0); p.draw(); px += (x1 - x0) * (y1 - y0);
      }
    }
    this.px += px * spp; this.draws++;
    return px;
  }
}

// how far the surface can stray from the mean level (the shader searches only that slab)
export function amp(s) { return Math.abs(s.tx) * RI + Math.abs(s.tz) * RI + s.swirl * 9.6 + Math.abs(s.rip) + 3.2; }
