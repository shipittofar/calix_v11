import { clamp, eio, lerp, seg } from "./math";
import { cubicPts, identity, mkPath, type Path, type Pt } from "./paths";
import { filament, glow } from "./light";
import { groundPoints } from "./foundation";
import type { World } from "./world";

/**
 * 05 Work (scroll 7.4–8.9) and the first half of 06 Identity (to 9.5): the five service points
 * rise off the ground line into three distinct luminous forms (a lens of nested loops, an orb that
 * turns with the scroll, a spiral vortex), each at its own depth. Then the forms spiral into one
 * composite form at the logo's place, flash, and give way to the real logo (a DOM image, never
 * drawn or lit on the canvas).
 */

const GROUPS = [0, 0, 1, 2, 2]; // which form each service point flows into
let formPos: Pt[] = [];
let formR = 0;
export let logoCentre: Pt = [0, 0];

export function layoutWork(w: World) {
  const { W, H } = w;
  formPos = (w.mobile ? [[0.24, 0.52], [0.5, 0.44], [0.76, 0.54]] : [[0.5, 0.54], [0.68, 0.4], [0.86, 0.56]]).map(([x, y]) => [x * W, y * H] as Pt);
  formR = Math.min(H * 0.11, W * (w.mobile ? 0.1 : 0.11));
  logoCentre = w.mobile ? [W * 0.5, H * 0.31] : [W * 0.3, H * 0.5];
}

/** Where a form label sits (below the form), for the text layer. */
export const slotAnchor = (k: number): Pt => [formPos[k]?.[0] ?? 0, (formPos[k]?.[1] ?? 0) + formR * 1.3];

export function formState(u: number, k: number) {
  const c = eio(seg(u, 8.75, 9.42)), depth = [0.6, 1, 1.4][k], drift = (u - 8.15) * (formR / 0.11) * 0.05 * depth * (1 - c);
  const p = formPos[k] ?? [0, 0];
  return { x: lerp(p[0], logoCentre[0], c), y: lerp(p[1] + drift, logoCentre[1], c), s: formR * lerp(1, 0.62, eio(c)), c, drift };
}

function formCurves(type: number, rot: number): Path[] {
  const c: Pt[][] = [];
  const wob = (t: number, i: number) => 1 + 0.07 * Math.sin(3 * t + i * 1.7 + rot) + 0.04 * Math.sin(5 * t - i);
  const turn = (x: number, y: number, a: number): Pt => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  if (type === 0)
    for (let i = 0; i < 7; i++) {
      const rx = 0.2 + 0.05 * i, a = -0.32 + i * 0.1 + Math.sin(rot + i) * 0.1, pts: Pt[] = [];
      for (let k = 0; k <= 64; k++) { const t = (k / 64) * Math.PI * 2, wv = wob(t, i); pts.push(turn(rx * Math.cos(t) * wv, Math.sin(t) * wv, a)); }
      c.push(pts);
    }
  else if (type === 1)
    for (let i = 0; i < 6; i++) {
      const rx = 0.04 + 0.88 * Math.abs(Math.cos((i / 6) * Math.PI + rot)), pts: Pt[] = [];
      for (let k = 0; k <= 64; k++) { const t = (k / 64) * Math.PI * 2, wv = wob(t, i); pts.push(turn(rx * Math.cos(t) * wv, 0.92 * Math.sin(t) * wv, 0.18)); }
      c.push(pts);
    }
  else
    for (let i = 0; i < 5; i++) {
      const base = (i / 5) * Math.PI * 2 + rot * 0.6, pts: Pt[] = [];
      for (let k = 0; k <= 60; k++) {
        const t = k / 60, rr = (0.08 + 0.92 * Math.pow(t, 1.3)) * (1 + 0.05 * Math.sin(t * 9 + i)), th = base + t * 3.4;
        pts.push([Math.cos(th) * rr, Math.sin(th) * rr]);
      }
      c.push(pts);
    }
  return c.map(mkPath);
}

export function drawWork(w: World, u: number) {
  const { cx, W, H } = w, lw = Math.max(1, H * 0.0012);
  const bd = 0.3 * seg(u, 7.6, 8.0) * (1 - seg(u, 8.5, 8.9)), im = w.imgs.p05;
  if (im && bd > 0) {
    const sc = Math.max(W / im.width, H / im.height) * lerp(1.1, 1, seg(u, 7.6, 8.9)), dw = im.width * sc, dh = im.height * sc;
    cx.globalAlpha = bd;
    cx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    cx.globalAlpha = 1;
  }
  const tr = seg(u, 7.4, 7.82);
  if (tr > 0 && tr < 1)
    groundPoints(w).forEach((a, j) => {
      const f = formState(u, GROUPS[j]), p = mkPath(cubicPts(a, [a[0], a[1] - H * 0.12], [f.x, f.y + H * 0.15], [f.x, f.y], 24)), d = p.len * eio(tr);
      filament(cx, p, Math.max(0, d - p.len * 0.3), d, identity, lw * 1.2, 1, H * 0.014);
    });
  const hide = 1 - seg(u, 9.4, 9.5), rot = (u - 7.4) * 1.3;
  for (let k = 0; k < 3; k++) {
    const bloom = seg(u, 7.7 + k * 0.07, 8.2 + k * 0.07);
    if (bloom <= 0 || hide <= 0) continue;
    const f = formState(u, k), map = (x: number, y: number): Pt => [f.x + x * f.s, f.y + y * f.s];
    formCurves(k, rot + f.c * f.c * 7).forEach((p, i) => {
      const g = eio(clamp(bloom * 1.5 - i * 0.07));
      if (g > 0) filament(cx, p, 0, p.len * g, map, lw * lerp(0.8, 1.15, f.c), lerp(0.85, 0.6, f.c) * hide, 0);
    });
    glow(cx, f.x, f.y, f.s * 0.8 + H * 0.02, (0.3 * bloom + 0.25 * f.c) * hide);
  }
  const flash = seg(u, 9.34, 9.46) * (1 - seg(u, 9.46, 9.6));
  if (flash > 0) glow(cx, logoCentre[0], logoCentre[1], H * (0.1 + 0.2 * flash), flash * 0.9);
}
