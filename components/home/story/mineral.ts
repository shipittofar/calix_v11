import { progress, through } from "./beats";

/**
 * The story's renderer (direction B, "Mineral"): a frosted, translucent stone, lit from within by
 * gold veins, that grows through the seven stages of beats.ts. Origin: it condenses. Awakening:
 * growth rings spread and blades unfold. Foundation: roots spread across the ground. Expansion:
 * five branches carry the blades out into fans. Differentiation: each branch takes its own shape,
 * surface and tone. Identity: the branches align, the veins meet and a shared gold rim unites
 * them. Ecosystem: the camera steps back and new stones accrete around it, linked by gold veins.
 *
 * Rendered by one fragment shader (signed distance fields, raymarched) on a transparent WebGL
 * canvas, so the page's own ground shows through; only the form, its shadow and the ground veins
 * are drawn. No library.
 *
 * Stateless: a frame is a pure function of the timeline position t, so the scroll-driven stage
 * and the still frames of the static layout come from the same code (see StoryPlayer).
 *
 * Colours: the five CALIX colours plus four earthy additions used only inside this artwork
 * (owner's brief, 13 November 2026; docs/motion-art-direction.md): muted sage #9AA58A, deep forest
 * #2F3A2A, mineral grey #8E877C and smoky rose #B79A92.
 */

const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform vec4 uA; // emerge, veins, rings, blades
uniform vec4 uB; // rootsDown, rootsSpread, expand, fans
uniform vec4 uC; // shape, tone, align, converge
uniform vec4 uD; // unify, satellites, links, -
uniform vec4 uCam; // yaw, elevation, distance, target height

const vec3 IVORY = vec3(0.965, 0.945, 0.910);
const vec3 TRAV = vec3(0.851, 0.788, 0.659);
const vec3 GOLD = vec3(0.690, 0.553, 0.341);
const vec3 SAGE = vec3(0.604, 0.647, 0.541);
const vec3 OLIVE_C = vec3(0.294, 0.322, 0.212);
const vec3 FOREST = vec3(0.184, 0.227, 0.165);
const vec3 MINERAL = vec3(0.557, 0.529, 0.486);
const vec3 ROSE = vec3(0.718, 0.604, 0.573);
const float GROUND = -0.44;
const vec3 KEY = vec3(-0.6, 0.7, 0.5);

float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5; float s = 0.0; for (int i = 0; i < 3; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
float sdEllipsoid(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a; vec3 ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h) - r; }

// ---------- The five branches ----------
float armAngle(float i) { return i * 1.2566 + 0.3 + 0.35 * sin(i * 2.7 + 1.0) * (1.0 - uC.z); }
float armElev(float i) { return mix(mix(1.05 + 0.12 * sin(i * 2.3), 0.42 + 0.2 * sin(i * 1.9 + 0.4), uB.z), 0.64, uC.z * 0.85); }
float armLen(float i) { return mix(0.6 + 0.16 * sin(i * 3.3 + 2.0), 0.58, uC.z) * uB.z; }
// Differentiation: width, height and thickness of each branch's blades.
vec3 shapeOf(float i) {
  if (i < 0.5) return vec3(1.7, 0.8, 1.0);   // broad leaf
  if (i < 1.5) return vec3(0.6, 1.5, 0.8);   // tall and narrow
  if (i < 2.5) return vec3(1.3, 0.55, 3.2);  // rounded nodules
  if (i < 3.5) return vec3(0.9, 1.2, 1.0);   // curled
  return vec3(1.0, 1.05, 0.5);               // thin ribbon
}
vec3 toneOf(float i) {
  if (i < 0.5) return SAGE;
  if (i < 1.5) return FOREST;
  if (i < 2.5) return MINERAL;
  if (i < 3.5) return ROSE;
  return GOLD;
}
// Ecosystem: where each satellite stone settles.
vec3 satellite(float i) {
  float a = i * 1.0472 + 0.5 + 0.3 * sin(i * 2.3);
  float r = 1.35 + 0.35 * fract(i * 0.71);
  return vec3(cos(a) * r, GROUND, sin(a) * r);
}

vec3 crownOf(float emerge, float grow) { return vec3(0.0, 0.24 * grow * emerge, 0.0); }

vec2 map(vec3 p) {
  float emerge = max(uA.x, 0.03);
  float grow = 1.0 + 0.16 * uA.z;
  vec3 q = p;

  // The stone: three lobes melted together, growing outward in rings.
  float body = length(q) - 0.75;
  if (body < 0.2) {
    float d = sdEllipsoid(q - vec3(0.0, -0.05, 0.0), vec3(0.33, 0.38, 0.31) * emerge * grow);
    d = smin(d, sdEllipsoid(q - vec3(0.12, 0.08, 0.05) * emerge, vec3(0.22, 0.26, 0.20) * emerge * grow), 0.12);
    d = smin(d, sdEllipsoid(q - vec3(-0.10, 0.02, -0.08) * emerge, vec3(0.20, 0.24, 0.22) * emerge * grow), 0.12);
    d += (0.03 + 0.06 * (1.0 - uA.x)) * (fbm(q * 3.5 + vec3(0.0, uTime * 0.04, 0.0)) - 0.5);
    body = d;
  }
  vec2 res = vec2(body, 1.0);

  // Foundation: roots grow out from the base and spread across the ground as flat mineral flows.
  if (uB.x > 0.001) {
    float rb = max(length(q.xz) - 1.5, q.y - (GROUND + 0.16));
    if (rb < 0.15) {
      float rd = 1e5;
      // Flattened space: heights doubled about the ground, so the roots lie low and wide.
      vec3 fq = vec3(q.x, GROUND + (q.y - GROUND) * 2.0, q.z);
      for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float grow = clamp(uB.x * 1.3 - fract(fi * 0.37) * 0.3, 0.0, 1.0);
        if (grow <= 0.0) continue;
        float spread = clamp(uB.y * 1.25 - fract(fi * 0.61) * 0.25, 0.0, 1.0);
        float a = fi * 0.6981 + 0.15 + 0.22 * sin(fi * 3.7);
        vec3 dir = vec3(cos(a), 0.0, sin(a));
        vec3 side = vec3(-dir.z, 0.0, dir.x);
        float bend = 0.6 * sin(fi * 2.1 + 0.7);
        float L = (0.35 + 0.55 * fract(fi * 0.53 + 0.2)) * (0.4 * grow + 0.6 * spread);
        vec3 p0 = dir * 0.16 + vec3(0.0, GROUND + 0.03, 0.0);
        vec3 p1 = p0 + (dir + side * bend * 0.5) * L * 0.45;
        vec3 p2 = p1 + (dir + side * bend) * L * 0.35;
        vec3 p3 = p2 + (dir + side * bend * 1.4) * L * 0.25;
        vec3 pf = p1 + (dir - side * sign(bend) * 0.9) * L * 0.3 * spread;
        p1.y = GROUND + 0.012; p2.y = GROUND + 0.01; p3.y = GROUND + 0.008; pf.y = GROUND + 0.008;
        float c = smin(sdCapsule(fq, p0, p1, 0.065 * grow + 0.002), sdCapsule(fq, p1, p2, 0.038 * grow + 0.002), 0.05);
        c = smin(c, sdCapsule(fq, p2, p3, 0.018 * spread + 0.002), 0.03);
        c = smin(c, sdCapsule(fq, p1, pf, 0.016 * spread + 0.002), 0.03);
        rd = smin(rd, c * 0.5, 0.03);
      }
      float j = smin(res.x, rd, 0.08);
      res = vec2(j, rd < res.x ? 3.0 : res.y);
    }
  }

  // Awakening and onwards: blades at the crown, carried out on five branches into fans.
  if (uA.w > 0.001) {
    float ab = length(q - vec3(0.0, 0.55, 0.0)) - 1.25;
    if (ab < 0.2) {
      vec3 crown = crownOf(emerge, grow);
      for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float a = armAngle(fi);
        float el = armElev(fi);
        float len = armLen(fi);
        vec3 dir = vec3(cos(a) * cos(el), sin(el), sin(a) * cos(el));
        vec3 tip = crown + dir * len;
        // A branch accretes as a run of soft lobes, thick at the stone and finer towards the fan.
        float armD = 1e5;
        if (len > 0.01) {
          for (int k = 0; k < 6; k++) {
            float fk = float(k);
            vec3 c = crown + dir * len * (fk + 0.5) / 6.0 + vec3(0.0, 0.035 * sin(fk * 1.3 + fi) * uB.z, 0.0);
            float r = mix(0.085, 0.045, fk / 5.0) * uB.z + 0.002;
            armD = smin(armD, sdEllipsoid(q - c, vec3(r * 1.15, r, r * 1.05)), 0.06);
          }
        }
        vec3 sh = mix(vec3(1.0), shapeOf(fi), uC.x * (1.0 - 0.45 * uC.z));
        // At the tip: one petal along the branch from Awakening, then a rosette of five once the fans open.
        vec3 ax = normalize(cross(dir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
        vec3 ay = cross(ax, dir);
        float baseH = mix(0.56, 0.42, uB.z) * uA.w * (0.75 + 0.35 * fract(fi * 0.618)) * sh.y;
        float curl = 0.35 + (fi > 2.5 && fi < 3.5 ? 0.9 * uC.x : 0.0);
        float fan = 1e5;
        for (int k = 0; k < 5; k++) {
          float fk = float(k);
          float on = k == 0 ? 1.0 : uB.w;
          if (on <= 0.001) continue;
          float phi = fk * 1.5708 + fi * 0.7;
          float tilt = k == 0 ? 0.0 : 0.85 * on;
          vec3 pd = normalize(dir * cos(tilt) + (ax * cos(phi) + ay * sin(phi)) * sin(tilt));
          vec3 e2 = normalize(cross(pd, ay + ax * 0.3));
          vec3 e3 = cross(pd, e2);
          float hgt = baseH * (k == 0 ? 1.0 : 0.72) * on;
          vec3 r = q - tip - pd * hgt * 0.5;
          vec3 l = vec3(dot(r, e2), dot(r, pd), dot(r, e3));
          l.z += curl * l.y * l.y / max(hgt, 0.05) * 0.6 + 0.01 * sin(uTime * 0.5 + fi + fk);
          float w = mix(0.06, 0.08, uB.z) * uA.w * sh.x * on + 0.002;
          float th = mix(0.012, 0.017, uB.z) * uA.w * sh.z * on + 0.002;
          fan = min(fan, sdEllipsoid(l, vec3(w, hgt * 0.5 + 0.002, th)));
        }
        float g = smin(armD, fan, 0.04);
        float j = smin(res.x, g, 0.05);
        res = vec2(j, g < res.x ? 10.0 + fi : res.y);
      }
    }
  }

  // Ecosystem: smaller stones accrete around the first, each with a blade of its own.
  if (uD.y > 0.001) {
    for (int i = 0; i < 6; i++) {
      float fi = float(i);
      float g = clamp(uD.y * 1.4 - fract(fi * 0.43) * 0.4, 0.0, 1.0);
      if (g <= 0.0) continue;
      float size = g * (0.7 + 0.5 * fract(fi * 0.29));
      vec3 c = satellite(fi) + vec3(0.0, 0.1 * size, 0.0);
      float sb = length(q - c) - 0.45;
      if (sb > 0.15) { res = res.x < sb ? res : vec2(sb, 0.0); continue; }
      float sat = sdEllipsoid(q - c, vec3(0.18, 0.13, 0.16) * size + 0.002);
      sat = smin(sat, sdEllipsoid(q - c - vec3(0.1, 0.05, -0.05) * size, vec3(0.1, 0.09, 0.1) * size + 0.002), 0.06);
      if (sat < res.x) res = vec2(sat, 20.0 + mod(fi, 5.0));
    }
  }
  return res;
}

vec2 march(vec3 ro, vec3 rd) {
  float t = 0.0; vec2 res = vec2(-1.0, -1.0);
  for (int i = 0; i < 110; i++) {
    vec2 h = map(ro + rd * t);
    if (h.x < 0.0007 * t + 0.0004 && h.y > 0.5) { res = vec2(t, h.y); break; }
    t += max(h.x * 0.85, 0.0015 * t);
    if (t > 14.0) break;
  }
  return res;
}
vec3 calcN(vec3 p) {
  vec2 e = vec2(0.0015, -0.0015);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}
float softSh(vec3 ro, vec3 rd) {
  float r = 1.0; float t = 0.012 + 0.012 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453); float ph = 1e10;
  for (int i = 0; i < 32; i++) {
    float h = map(ro + rd * t).x;
    float y = h * h / (2.0 * ph);
    float d = sqrt(max(h * h - y * y, 0.0));
    r = min(r, 8.0 * d / max(0.0, t - y));
    ph = h;
    t += clamp(h, 0.01, 0.12);
    if (r < 0.002 || t > 2.5) break;
  }
  r = clamp(r, 0.0, 1.0);
  return r * r * (3.0 - 2.0 * r);
}
float thickness(vec3 p, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < 22; i++) { float d = map(p + rd * t).x; if (d > 0.0 && t > 0.03) break; t += max(0.02, -d * 0.8 + 0.015); }
  return t;
}
float veins(vec3 p, vec3 rd) {
  float g = 0.0; float t = 0.02;
  for (int i = 0; i < 18; i++) {
    vec3 x = p + rd * t;
    float inside = step(map(x).x, 0.0);
    float v = abs(noise(x * 4.2 + vec3(0.0, uTime * 0.05, 0.0)) - 0.5);
    g += inside * smoothstep(0.018, 0.0, v) * 0.08;
    t += 0.034;
  }
  return g;
}

vec3 shade(vec3 p, vec3 rd, float m) {
  vec3 n = calcN(p);
  vec3 K = normalize(KEY);
  float fre = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.5);
  vec3 rr = refract(rd, n, 0.72);
  bool isBody = m < 1.5;
  bool isRoot = m > 2.5 && m < 3.5;
  bool isArm = m > 9.5 && m < 15.0;
  bool isSat = m > 19.5;
  float idx = isArm ? m - 10.0 : (isSat ? m - 20.0 : 0.0);
  vec3 body; float dens;
  if (isBody) { body = mix(SAGE, FOREST, 0.35); dens = 0.85; }
  else if (isRoot) { body = mix(FOREST, OLIVE_C, 0.45); dens = 1.0; }
  else { body = mix(mix(SAGE, OLIVE_C, 0.22), toneOf(idx), isSat ? 1.0 : uC.y); dens = 0.6; }
  float th = thickness(p - n * 0.01, rr);
  vec3 absorb = exp(-th * vec3(2.2, 1.6, 2.6) * dens);
  vec3 trans = isBody ? mix(body * 0.55, IVORY * 1.04, absorb * 0.92) : mix(body * 0.9, IVORY, absorb * (isRoot ? 0.22 : 0.32));
  float back = pow(clamp(dot(rd, normalize(vec3(0.4, 0.55, -0.75))), 0.0, 1.0), 2.0) * 0.4 + 0.28;
  vec3 col = trans * (0.55 + back);
  // Growth bands: the stone's from Awakening; shared by every branch once the identity forms.
  float bandAmt = isBody ? uA.z * 0.6 : (isArm || isSat ? uD.x * 0.4 : 0.0);
  if (bandAmt > 0.0) {
    float band = 0.5 + 0.5 * sin(length(p * vec3(1.0, 0.85, 1.0)) * 46.0 - fbm(p * 3.0) * 6.0);
    col = mix(col, mix(col, MINERAL, 0.55), band * bandAmt);
  }
  // Differentiation: each branch's own surface.
  if (isArm && uC.y > 0.0) {
    float tex;
    if (idx < 0.5) tex = fbm(p * 18.0);
    else if (idx < 1.5) tex = 0.5 + 0.5 * sin(p.y * 90.0);
    else if (idx < 2.5) tex = noise(p * 30.0);
    else if (idx < 3.5) tex = 0.5 + 0.5 * sin((p.x + p.z) * 60.0);
    else tex = fbm(p * 8.0);
    col *= 1.0 - 0.2 * uC.y * (tex - 0.5);
  }
  col *= 0.75 + 0.35 * clamp(dot(n, K), 0.0, 1.0);
  vec3 h = normalize(K - rd);
  float specK = isArm && idx > 3.5 ? 0.25 + 0.25 * uC.y : 0.25;
  col += IVORY * pow(clamp(dot(n, h), 0.0, 1.0), 12.0) * specK;
  col = mix(col, IVORY, fre * 0.5);
  // Identity: one gold rim unites every part.
  col = mix(col, GOLD, fre * 0.5 * uD.x);
  // Veins inside, brightening as they converge on the crown.
  float near = exp(-length(p - crownOf(max(uA.x, 0.03), 1.0 + 0.16 * uA.z)) * 3.5);
  float vk = isBody || isRoot ? 0.5 + 1.2 * uA.y + 0.8 * uC.w : (isArm ? 0.12 + 0.9 * uC.w : 0.4);
  vk *= 1.0 + 1.5 * uC.w * near;
  col += GOLD * veins(p - n * 0.01, rr) * vk;
  return col;
}

void main() {
  float s = min(uRes.x, uRes.y);
  vec2 sp = (2.0 * gl_FragCoord.xy - uRes) / s;
  float yaw = uCam.x; float el = uCam.y; float dist = uCam.z;
  vec3 ta = vec3(0.0, uCam.w, 0.0);
  vec3 ro = ta + vec3(sin(yaw) * cos(el), sin(el), cos(yaw) * cos(el)) * dist;
  vec3 ww = normalize(ta - ro); vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0))); vec3 vv = cross(uu, ww);
  vec3 rd = normalize(sp.x * uu + sp.y * vv + 2.3 * ww);

  vec2 hit = march(ro, rd);
  if (hit.y > 0.0) {
    gl_FragColor = vec4(clamp(shade(ro + rd * hit.x, rd, hit.y), 0.0, 1.0), 1.0);
    return;
  }
  // Nothing hit: transparent, except the shadow and the ground veins (premultiplied alpha).
  vec4 outc = vec4(0.0);
  if (rd.y < 0.0) {
    float tp = (GROUND - ro.y) / rd.y; vec3 pg = ro + rd * tp;
    float r = length(pg.xz);
    if (r < 2.6 && uA.x > 0.0) {
      float sh = softSh(pg + vec3(0.0, 0.001, 0.0), normalize(KEY));
      float k = (1.0 - sh) * exp(-r * 0.9) * 0.6 * smoothstep(0.0, 0.3, uA.x);
      vec3 shadowCol = mix(vec3(0.42, 0.38, 0.30), SAGE * 0.55, 0.2);
      outc = vec4(shadowCol * k * 0.45, k * 0.45);
    }
    if (uD.z > 0.001) {
      float gl = 0.0;
      float w = 0.0055 * dist;
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float pr = clamp(uD.z * 1.3 - fract(fi * 0.43) * 0.3, 0.0, 1.0);
        if (pr <= 0.0) continue;
        vec2 c = satellite(fi).xz;
        vec2 e = c * pr;
        vec2 pa = pg.xz;
        float hh = clamp(dot(pa, e) / max(dot(e, e), 1e-4), 0.0, 1.0);
        vec2 n2 = normalize(vec2(-e.y, e.x) + 1e-5);
        float sd = (hh > 0.0 && hh < 1.0) ? abs(dot(pa - e * hh, n2) - 0.05 * sin(hh * 11.0 + fi) * hh * (1.0 - hh) * 4.0) : length(pa - e * hh);
        gl += smoothstep(w, 0.0, sd) * smoothstep(0.32, 0.42, length(pa));
      }
      float a = clamp(gl, 0.0, 1.0);
      outc = vec4(GOLD * a + outc.rgb * (1.0 - a), a + outc.a * (1.0 - a));
    }
  }
  gl_FragColor = outc;
}
`;

const VERT = "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }";

type Vec4 = [number, number, number, number];

/** Stage values for frame t: what has grown, and where the camera stands. */
export function frameParams(t: number) {
  const A: Vec4 = [progress(t, "o2"), progress(t, "w1"), progress(t, "w2"), progress(t, "w3")];
  const B: Vec4 = [progress(t, "f1"), progress(t, "f2"), progress(t, "e1", "e2"), progress(t, "e3")];
  const C: Vec4 = [progress(t, "d1"), progress(t, "d2"), progress(t, "i1"), progress(t, "i2")];
  const D: Vec4 = [progress(t, "i3"), progress(t, "c2"), progress(t, "c3"), 0];
  const cam: Vec4 = [
    through(t, CAM_YAW),
    through(t, CAM_ELEV),
    through(t, CAM_DIST),
    through(t, CAM_TARGET),
  ];
  return { A, B, C, D, cam };
}

/** Camera keys: [beat, value], each reached at the end of its beat. Slow drift, never an orbit. */
const CAM_YAW = [["o1", -0.45], ["o3", -0.38], ["w3", -0.22], ["f3", 0.05], ["e3", 0.32], ["d3", 0.55], ["i3", 0.75], ["c3", 1.05]] as const;
const CAM_ELEV = [["o1", 0.2], ["o3", 0.2], ["w3", 0.22], ["f1", 0.3], ["f3", 0.34], ["e3", 0.3], ["d3", 0.27], ["i3", 0.3], ["c1", 0.42], ["c3", 0.5]] as const;
const CAM_DIST = [["o1", 2.5], ["o3", 2.25], ["w3", 2.6], ["f3", 2.95], ["e3", 3.55], ["d3", 3.5], ["i3", 3.6], ["c1", 4.5], ["c3", 5.0]] as const;
const CAM_TARGET = [["o1", -0.05], ["o3", -0.05], ["w3", 0.1], ["f1", -0.1], ["f3", -0.08], ["e3", 0.18], ["d3", 0.18], ["i3", 0.14], ["c3", -0.05]] as const;

export type MineralRenderer = {
  /** Draws frame t at the given CSS size and render scale. Returns false if the context was lost. */
  render: (t: number, cssWidth: number, cssHeight: number, scale: number) => boolean;
  dispose: () => void;
};

/** Creates the renderer on `canvas`, or returns null if WebGL is unavailable or the shader fails. */
export function createMineral(canvas: HTMLCanvasElement, opts: { preserve?: boolean } = {}): MineralRenderer | null {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: Boolean(opts.preserve),
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Story shader:", gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Story shader:", gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name: string) => gl.getUniformLocation(program, name);
  const uRes = u("uRes"), uTime = u("uTime"), uA = u("uA"), uB = u("uB"), uC = u("uC"), uD = u("uD"), uCam = u("uCam");
  gl.clearColor(0, 0, 0, 0);

  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  canvas.addEventListener("webglcontextlost", onLost);

  return {
    render(t, cssWidth, cssHeight, scale) {
      if (lost || gl.isContextLost()) return false;
      const w = Math.max(1, Math.round(cssWidth * scale));
      const h = Math.max(1, Math.round(cssHeight * scale));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const f = frameParams(t);
      gl.viewport(0, 0, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, w, h);
      // Drift (vein flow, blade sway) follows the timeline, so a still frame is always the same.
      gl.uniform1f(uTime, t * 2.2);
      gl.uniform4fv(uA, f.A);
      gl.uniform4fv(uB, f.B);
      gl.uniform4fv(uC, f.C);
      gl.uniform4fv(uD, f.D);
      gl.uniform4fv(uCam, f.cam);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },
    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
