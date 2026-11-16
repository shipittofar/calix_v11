import { palette } from "@/lib/palette";
import { clamp, ei, eio, eo, lerp, rng, seg } from "./math";
import { mkPath, type Path, type Pt } from "./paths";
import { filament, glow } from "./light";
import { resetCtx, type World } from "./world";
import veinData from "./veins.json";

/**
 * 02 Awakening (scroll 1.2–2.8): awakening-veins arrives out of the seed's light (match cut on the
 * vein centre). Light grows along the real veins, traced from the photograph by
 * prototypes/cinematic-scroll/build_assets.py, and pulses run along them with the scroll. Then
 * strands pour downward, the camera follows them and the image dissolves through grain.
 * The photograph is only moved, scaled and graded; its files are never changed.
 */

type Vein = { path: Path; delay: number; speed: number; off: number };
type Fall = { path: Path; w: number; delay: number };
const VC = veinData.centre as unknown as Pt;
let veins: Vein[] = [];
let falls: Fall[] = [];

{
  const r = rng(3);
  veins = (veinData.paths as unknown as { p: Pt[] }[]).flatMap((p) => {
    const pts = p.p.slice();
    const rd = Math.hypot(pts[0][0] - VC[0], pts[0][1] - VC[1]);
    if (rd > 0.3) return [];
    if (rd < 0.22) pts.unshift([VC[0], VC[1]]); // pulses start in the bright core
    return [{ path: mkPath(pts), delay: rd * 1.8, speed: 0.55 + r() * 0.5, off: r() }];
  });
}

export function veinsCam(w: World, a: number) {
  const { W, H } = w;
  const iw = 2048, base = Math.max(W / iw, H / iw);
  const z = lerp(1.75, 1.12, eo(seg(a, -0.02, 0.45))) * lerp(1, 0.94, eio(seg(a, 0.45, 1.3)));
  const k = eio(seg(a, 0.22, 0.62));
  const cxs = lerp(W / 2, w.mobile ? W * 0.5 : W * 0.63, k) + W * 0.02 * eio(seg(a, 0.62, 1.3));
  const cy0 = lerp(H / 2, w.mobile ? H * 0.38 : H * 0.5, k), cys = cy0 - H * 1.15 * ei(seg(a, 1.2, 1.6));
  // Always cover the screen, even after the pan.
  const need = Math.max(cxs / VC[0], (W - cxs) / (1 - VC[0]), cy0 / VC[1], (H - cy0) / (1 - VC[1])) * 1.02;
  const s = Math.max(base * z * iw, need) / iw;
  return { s, ox: cxs - VC[0] * iw * s, oy: cys - VC[1] * iw * s };
}

/** Strands that pour out of the veins and arrive exactly where Foundation's roots begin. */
export function layoutAwakening(w: World) {
  const r = rng(11), e = veinsCam(w, 1.6), S = 2048 * e.s;
  falls = [];
  w.rootX.forEach((fx) => {
    const ix = (fx * w.W - e.ox) / S, tipY = (w.H * 0.03 - e.oy) / S;
    for (let c = 0; c < (w.mobile ? 2 : 3); c++) {
      const main = c === 0, x0 = lerp(VC[0], ix, 0.35 + r() * 0.4) + (r() - 0.5) * 0.08, y0 = VC[1] + 0.18 + r() * 0.14;
      const amp = (main ? 0.005 : 0.01) + r() * 0.01, fq = 2 + r() * 3.5, ph = r() * 6;
      const end = main ? tipY : lerp(y0, tipY, 0.55 + r() * 0.35), dx = main ? 0 : (r() - 0.5) * 0.05;
      const pts: Pt[] = [];
      for (let k = 0; k <= 48; k++) {
        const t = k / 48;
        pts.push([lerp(x0, ix + dx * t, eio(t)) + Math.sin(ph + t * fq) * amp * (1 - t * 0.8), lerp(y0, end, t)]);
      }
      falls.push({ path: mkPath(pts), w: main ? 1.3 : 0.6, delay: main ? 0 : r() * 0.25 });
    }
  });
}

/**
 * The dissolve from Awakening into Foundation: the photograph clears from the top down along a soft,
 * smoke-like edge (smooth noise plus a vertical bias, a feathered threshold, smoothly upscaled), as
 * the camera follows the light down. No pixels, no straight front.
 */
function buildMask(w: World, t: number) {
  const width = w.maskC.width, h = w.maskC.height, d = w.maskData.data;
  const th = 1.15 - t * 1.45, soft = 0.14;
  for (let y = 0; y < h; y++) {
    const b = (1 - y / h) * 0.6;
    for (let x = 0; x < width; x++) {
      const i = y * width + x, v = w.noise[i] * 0.4 + b;
      const k = clamp((v - (th - soft)) / (2 * soft));
      d[i * 4 + 3] = Math.round(255 * (1 - k * k * (3 - 2 * k)));
    }
  }
  w.mx.putImageData(w.maskData, 0, 0);
}

export function drawAwakening(w: World, a: number) {
  const { cx, lx, W, H } = w;
  const im = w.imgs.veins;
  if (!im) return;
  const cam = veinsCam(w, a), S = 2048 * cam.s;
  const map = (x: number, y: number): Pt => [cam.ox + x * S, cam.oy + y * S];
  const lw = Math.max(1, H * 0.0013), dis = seg(a, 1.22, 1.58);
  if (dis < 1) {
    resetCtx(w, lx);
    lx.clearRect(0, 0, W, H);
    lx.drawImage(im, cam.ox, cam.oy, S, S);
    lx.globalAlpha = 0.3;
    lx.fillStyle = palette.espresso;
    lx.fillRect(0, 0, W, H);
    lx.globalAlpha = 1;
    const gv = seg(a, 0.1, 1.0), env = seg(a, 0.22, 0.45) * (1 - seg(a, 1.12, 1.32));
    for (const v of veins) {
      const f = eio(clamp(gv * 1.6 - v.delay));
      if (f <= 0) continue;
      const d1 = v.path.len * f;
      filament(lx, v.path, 0, d1, map, lw * 0.8, 0.26);
      if (env > 0) {
        const s = (((a * v.speed + v.off) % 1) + 1) % 1, d = s * d1;
        filament(lx, v.path, Math.max(0, d - v.path.len * 0.14), d, map, lw * 1.4, env, H * 0.012);
      }
    }
    const c = map(VC[0], VC[1]);
    glow(lx, c[0], c[1], H * 0.32, 0.22 + 0.4 * env);
    // The text scrim goes over the light as well as the photograph, so no filament crosses the text.
    const sc = seg(a, 0.2, 0.5) * (1 - seg(a, 1.15, 1.4));
    if (sc > 0) {
      // Text scrim (WCAG 1.4.3): an even band of espresso under the whole text column, then a fade,
      // so text keeps at least 4.5:1 even over the brightest part of the photograph.
      // Phones: the band reaches just above the measured top of the text column.
      const top = Math.max(0.05, w.bands.awakeningTop - 0.03), end = Math.max(0, top - 0.15);
      const g = w.mobile ? lx.createLinearGradient(0, H, 0, H * end) : lx.createLinearGradient(0, 0, W * 0.75, 0);
      g.addColorStop(0, "rgba(46,30,20,0.95)");
      g.addColorStop(w.mobile ? (1 - top) / (1 - end) : 0.78, "rgba(46,30,20,0.93)");
      g.addColorStop(1, "rgba(46,30,20,0)");
      lx.globalCompositeOperation = "source-over";
      lx.globalAlpha = sc;
      lx.fillStyle = g;
      lx.fillRect(0, 0, W, H);
      lx.globalAlpha = 1;
    }
    if (dis > 0) {
      buildMask(w, dis);
      lx.globalCompositeOperation = "destination-in";
      lx.imageSmoothingEnabled = true;
      lx.imageSmoothingQuality = "high";
      lx.drawImage(w.maskC, 0, 0, W, H);
    }
    cx.drawImage(w.layer, 0, 0, W, H);
  }
  const fall = seg(a, 1.08, 1.55), fa = 1 - seg(a, 1.7, 2.0);
  if (fall > 0 && fa > 0)
    for (const p of falls) {
      const f = eo(clamp((fall - p.delay) / (1 - p.delay)));
      if (f > 0) filament(cx, p.path, 0, p.path.len * f, map, lw * p.w, fa * (p.w > 1 ? 1 : 0.7), f < 1 ? H * 0.012 : 0);
    }
}

/** The seed's light filling the screen between Origin and Awakening. Returns its strength. */
export function drawWhiteout(w: World, u: number) {
  const k = u < 1.2 ? eio(seg(u, 0.9, 1.2)) : 1 - eo(seg(u, 1.2, 1.52));
  if (k <= 0) return 0;
  w.cx.globalAlpha = k;
  w.cx.fillStyle = palette.ivory;
  w.cx.fillRect(0, 0, w.W, w.H);
  w.cx.globalAlpha = k * 0.3;
  w.cx.fillStyle = palette.gold;
  w.cx.fillRect(0, 0, w.W, w.H);
  w.cx.globalAlpha = 1;
  return k;
}
