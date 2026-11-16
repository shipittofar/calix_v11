import { clamp, eio, eo, seg } from "./math";
import { cubicPts, identity, mkPath, type Path, type Pt } from "./paths";
import { filament } from "./light";
import { groundPoints } from "./foundation";
import { resetCtx, type World } from "./world";

/**
 * 04 Services (scroll 4.4–7.4): for each service in turn, a filament climbs from its point on the
 * ground line, traces a window of light and opens it onto a storyboard panel; the window folds back
 * as the next service rises. Panels 07–09 show the invented "MINERAL" brand and are labelled as
 * illustration by the text layer.
 */

export const SV_START = 4.6;
export const SV_STRIDE = 0.55;
const SV_D = 0.62;
/** The image each service window opens onto (files in public/cinema/). */
export const SV_PANEL = ["service-brand-stone", "service-web-glass", "service-marketing-globe", "service-seo-summit", "service-growth-arch"];
/** Horizontal focus of each window's image (0–1): the window crops the sides of wider images. */
const SV_FOCUS = [0.5, 0.52, 0.51, 0.53, 0.56];
export const SV_ILLUSTRATION = [false, true, true, true, true];

export type Rect = { x: number; y: number; w: number; h: number };
export let win: Rect = { x: 0, y: 0, w: 0, h: 0 };
let climbs: Path[] = [];
let frameL: Path | null = null;
let frameR: Path | null = null;

/** Each service's local progress (0–1 while its window is on screen). */
export const serviceK = (u: number) => [0, 1, 2, 3, 4].map((j) => (u - (SV_START + j * SV_STRIDE)) / SV_D);
/** How open service j's window is. */
export const windowOpen = (k: number) => eo(seg(k, 0.2, 0.55)) * (1 - eo(seg(k, 0.84, 1)));

export function layoutServices(w: World) {
  const { W, H } = w;
  const wh = H * (w.mobile ? 0.4 : 0.6), ww = wh * 0.6, wcx = W * (w.mobile ? 0.5 : 0.7), wcy = H * (w.mobile ? 0.34 : 0.43);
  win = { x: wcx - ww / 2, y: wcy - wh / 2, w: ww, h: wh };
  const bc: Pt = [wcx, win.y + wh], tc: Pt = [wcx, win.y];
  climbs = groundPoints(w).map((p) => mkPath(cubicPts(p, [p[0], p[1] - H * 0.08], [bc[0], bc[1] + H * 0.1], bc)));
  frameL = mkPath([bc, [win.x, win.y + wh], [win.x, win.y], tc]);
  frameR = mkPath([bc, [win.x + ww, win.y + wh], [win.x + ww, win.y], tc]);
}

/** Draws `im` cover-fitted into R, revealed by light spreading from point o. */
export function revealInto(w: World, im: HTMLImageElement, R: Rect, o: Pt, t: number, zoom: number, fx = 0.5) {
  const { lx, W, H } = w;
  resetCtx(w, lx);
  lx.clearRect(0, 0, W, H);
  lx.save();
  lx.beginPath();
  lx.rect(R.x, R.y, R.w, R.h);
  lx.clip();
  const sc = Math.max(R.w / im.width, R.h / im.height) * zoom, dw = im.width * sc, dh = im.height * sc;
  const ox = clamp(R.w / 2 - fx * dw, R.w - dw, 0);
  lx.drawImage(im, R.x + ox, R.y + (R.h - dh) / 2, dw, dh);
  lx.restore();
  const rad = Math.max(1, t * Math.hypot(R.w, R.h) * 1.15), g = lx.createRadialGradient(o[0], o[1], 0, o[0], o[1], rad);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(0.75, "rgba(0,0,0,0.9)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  lx.globalCompositeOperation = "destination-in";
  lx.fillStyle = g;
  lx.fillRect(0, 0, W, H);
  w.cx.globalAlpha = t;
  w.cx.drawImage(w.layer, 0, 0, W, H);
  w.cx.globalAlpha = 1;
}

export function drawServices(w: World, ks: number[]) {
  if (!frameL || !frameR) return;
  const { cx, H } = w, lw = Math.max(1, H * 0.0014), bc: Pt = [win.x + win.w / 2, win.y + win.h];
  ks.forEach((k, j) => {
    if (k <= 0 || k >= 1) return;
    const out = seg(k, 0.84, 1), rv = windowOpen(k), im = w.imgs[`p${SV_PANEL[j]}`];
    if (im && rv > 0) revealInto(w, im, win, bc, rv, 1.08 - 0.08 * eo(seg(k, 0.2, 0.84)), SV_FOCUS[j]);
    const cf = eo(seg(k, 0, 0.25)) * (1 - eo(out)), c = climbs[j];
    if (cf > 0 && c) filament(cx, c, 0, c.len * cf, identity, lw, 1, cf < 1 && out === 0 ? H * 0.012 : 0);
    const ff = eio(seg(k, 0.15, 0.45)) * (1 - eio(out)), head = ff < 1 && out === 0 ? H * 0.01 : 0;
    if (ff > 0) {
      filament(cx, frameL!, 0, frameL!.len * ff, identity, lw * 0.8, 0.85, head);
      filament(cx, frameR!, 0, frameR!.len * ff, identity, lw * 0.8, 0.85, head);
    }
  });
}
