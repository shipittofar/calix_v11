import { clamp, eio, eo, lerp, rng, seg } from "./math";
import { identity, mkPath, type Path, type Pt } from "./paths";
import { filament, glow, taperedFilament } from "./light";
import { resetCtx, type World } from "./world";

/**
 * 03 Foundation (scroll 2.8–4.4): the poured strands become roots growing down from the same
 * points into the ground (the owner's soil-and-strata image with the olive sapling, full-bleed).
 * Each root lights its process step where it enters the soil, one after another up the slope
 * towards the sapling, then runs on through the strata; the ground recedes as the roots settle into
 * a ground line where five points ignite, the hand-off to Services.
 */

/** The ground image's soil surface, measured from the image: [x, y] as fractions of the image. */
const SURFACE: Pt[] = [
  [0, 0.73], [0.1, 0.71], [0.2, 0.67], [0.3, 0.64], [0.4, 0.61], [0.5, 0.545],
  [0.6, 0.485], [0.7, 0.435], [0.8, 0.38], [0.9, 0.335], [1, 0.31],
];
const GROUND_ASPECT = 941 / 1671;

/** Where the ground image rests on screen. Desktop and tablet: full-bleed, anchored right so the
 *  sapling stays in view. Phones: a wide crop of the slope across the lower half. */
function groundRect(w: World) {
  const { W, H } = w;
  if (w.mobile) {
    const dw = W * 2.2, dh = dw * GROUND_ASPECT;
    return { x: W - dw * 0.9, y: H * 0.27, dw, dh };
  }
  const s = Math.max(W, H / GROUND_ASPECT), dw = s, dh = s * GROUND_ASPECT;
  return { x: W - dw, y: (H - dh) * 0.5, dw, dh };
}

/** Screen y of the soil surface at screen x, with the image at rest. */
function surfaceY(w: World, sx: number) {
  const r = groundRect(w), fx = clamp((sx - r.x) / r.dw);
  let k = 0;
  while (k < SURFACE.length - 2 && SURFACE[k + 1][0] < fx) k++;
  const [x0, y0] = SURFACE[k], [x1, y1] = SURFACE[k + 1];
  return r.y + r.dh * lerp(y0, y1, clamp((fx - x0) / (x1 - x0)));
}

type Root = { path: Path; t0: number; w: number };
export type Node = { x: number; y: number; t: number };
let roots: Root[] = [];
export let nodes: Node[] = [];
let maxT = 1;
/** Growth timeline: [chapter progress, growth] keys, so each step lights at a set moment. */
let growK: Pt[] = [];

export function layoutFoundation(w: World) {
  const { W, H } = w, GY = w.groundY, r = rng(42);
  roots = [];
  nodes = [];
  const step = H * 0.01;
  const branch = (x: number, y: number, ang: number, t: number, depth: number) => {
    let a = ang + (r() < 0.5 ? -1 : 1) * (0.35 + r() * 0.5), av = 0;
    const pts: Pt[] = [[x, y]], st = H * 0.008;
    const n = Math.floor((depth === 1 ? 14 : 8) + r() * (depth === 1 ? 26 : 14));
    for (let k = 0; k < n; k++) {
      av = av * 0.9 + (r() - 0.5) * 0.05 + (Math.PI / 2 - a) * 0.012;
      a += av;
      x += Math.cos(a) * st;
      y += Math.sin(a) * st;
      if (y > GY) break;
      pts.push([x, y]);
      const deeper = clamp(y / GY);
      if (depth < 3 && k > 3 && r() < (depth === 1 ? 0.04 + 0.05 * deeper : 0.03 + 0.03 * deeper)) branch(x, y, a, t + ((pts.length - 1) * st) / H, depth + 1);
    }
    if (pts.length > 3) roots.push({ path: mkPath(pts), t0: t, w: [0, 0.6, 0.38, 0.26][depth] });
  };
  // Each step's node sits where its root enters the soil; where the slope is gentle, a node sinks a
  // little into the soil so each desktop card (which hangs above its node) clears the next one.
  const nxs = w.rootX.map((fx) => fx * W + (r() - 0.5) * W * 0.02);
  const nys = nxs.map((nx) => surfaceY(w, nx) + H * 0.008), gap = Math.max(52, H * 0.066);
  for (let i = nys.length - 2; i >= 0; i--) nys[i] = Math.max(nys[i], nys[i + 1] + gap);
  w.rootX.forEach((fx, i) => {
    let x = fx * W, y = -H * 0.02, ang = Math.PI / 2, av = 0, t = 0;
    const meanderF = 5 + r() * 5, meanderP = r() * 6.28;
    const pts: Pt[] = [[x, y]];
    const node: Node = { x: nxs[i], y: clamp(nys[i], H * 0.24, GY - H * 0.06), t: 0 };
    const first = roots.length;
    let target = { x: node.x, y: node.y }, reached = false;
    const gx = fx * W + (r() - 0.5) * W * 0.06;
    for (let guard = 0; guard < 1000; guard++) {
      let da = Math.atan2(target.y - y, target.x - x) - ang;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const near = clamp(1 - Math.hypot(target.x - x, target.y - y) / (H * 0.12));
      av = av * (0.86 - 0.3 * near) + ((r() - 0.5) * 0.07 + Math.sin(t * meanderF + meanderP) * 0.012) * (1 - near) + da * (0.025 + 0.12 * near);
      ang += av;
      x += Math.cos(ang) * step;
      y += Math.sin(ang) * step;
      t += step / H;
      pts.push([x, y]);
      if (!reached && Math.hypot(target.x - x, target.y - y) < step * 1.5) {
        // The node stays exactly where it was placed (the cards are spaced from it); the root has
        // arrived within a hair of it.
        reached = true;
        node.t = t;
        target = { x: gx, y: GY };
      }
      if (reached && y >= GY - step * 0.5) break;
      if (guard > 4 && r() < (w.mobile ? 0.035 : 0.07) * (0.6 + 0.8 * clamp(y / GY))) branch(x, y, ang, t, 1);
    }
    // Roots start one after another so the steps light in order up the slope, whatever each
    // root's length to the soil; its rootlets start with it.
    const t0 = Math.max(0, (nodes.length ? nodes[nodes.length - 1].t + 0.1 : node.t) - node.t);
    for (let k = first; k < roots.length; k++) roots[k].t0 += t0;
    node.t += t0;
    roots.push({ path: mkPath(pts), t0, w: 1.25 });
    nodes.push(node);
  });
  maxT = Math.max(...roots.map((o) => o.t0 + o.path.len / H));
  // Steps light at chapter progress 0.25, 0.42, 0.59 and 0.76, so each card is read in turn.
  growK = [[-0.03, 0], ...nodes.map((n, i): Pt => [0.25 + 0.17 * i, n.t + 0.05]), [1.05, maxT * 1.02]];
}

function growth(f: number) {
  if (f <= growK[0][0]) return 0;
  for (let k = 1; k < growK.length; k++) {
    const [f1, g1] = growK[k];
    if (f <= f1) {
      const [f0, g0] = growK[k - 1];
      return lerp(g0, g1, (f - f0) / (f1 - f0));
    }
  }
  return growK[growK.length - 1][1];
}

/** Draws the chapter; returns how far each process step has been reached (0–1, before the chapter's fade). */
export function drawFoundation(w: World, f: number, fade: number): number[] {
  const { cx, lx, W, H } = w;
  const g = growth(f), lw = Math.max(1, H * 0.0014);
  for (const o of roots) {
    const d1 = (g - o.t0) * H;
    if (d1 > 0) taperedFilament(cx, o.path, Math.min(d1, o.path.len), identity, lw * o.w * 1.35, lw * o.w * 0.3, fade, d1 < o.path.len ? H * 0.011 : 0);
  }
  // The ground settles in as the roots arrive, and recedes as they gather into the ground line.
  const rise = eo(seg(f, -0.1, 0.3)), recede = 1 - 0.62 * seg(f, 1.15, 1.4), im = w.imgs.foundation;
  if (im && rise > 0) {
    const r = groundRect(w), x = r.x, y = r.y + H * 0.06 * (1 - rise), dw = r.dw, dh = r.dh;
    resetCtx(w, lx);
    lx.clearRect(0, 0, W, H);
    lx.drawImage(im, x, y, dw, dh);
    // The image's own edges never show: it falls off softly at its top and bottom, and on phones
    // (where its left edge can be close) along its left side too.
    lx.globalCompositeOperation = "destination-in";
    const v = lx.createLinearGradient(0, y, 0, y + dh);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(0.12, "rgba(0,0,0,1)");
    v.addColorStop(w.mobile ? 0.8 : 0.9, "rgba(0,0,0,1)");
    v.addColorStop(1, "rgba(0,0,0,0)");
    lx.fillStyle = v;
    lx.fillRect(0, 0, W, H);
    if (w.mobile) {
      const hz = lx.createLinearGradient(x + dw * 0.3, 0, x + dw * 0.45, 0);
      hz.addColorStop(0, "rgba(0,0,0,0)");
      hz.addColorStop(1, "rgba(0,0,0,1)");
      lx.fillStyle = hz;
      lx.fillRect(0, 0, W, H);
    }
    // Where the headline sits, the shaft of light in the image is calmed so the copy keeps contrast.
    lx.globalCompositeOperation = "source-atop";
    if (!w.mobile) {
      const s = lx.createRadialGradient(W * 0.1, H * 0.14, 0, W * 0.1, H * 0.14, Math.max(W * 0.42, 520));
      s.addColorStop(0, "rgba(46,30,20,0.92)");
      s.addColorStop(0.5, "rgba(46,30,20,0.76)");
      s.addColorStop(1, "rgba(46,30,20,0)");
      lx.fillStyle = s;
      lx.fillRect(0, 0, W, H);
    }
    // "lighten" keeps the brighter of image and page per channel: the image's dark sky becomes the
    // page itself (no edge, no veil), and the roots already drawn stay visible through it, woven into
    // the soil wherever the strata are darker than the light.
    cx.globalCompositeOperation = "lighten";
    cx.globalAlpha = rise * recede * fade;
    cx.drawImage(w.layer, 0, 0, W, H);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = "source-over";
  }
  return nodes.map((n) => {
    const on = seg(g, n.t, n.t + 0.05);
    if (on > 0) glow(cx, n.x, n.y, H * 0.032 * (1 + 0.6 * (1 - on)), on * fade);
    return on;
  });
}

/** The ground line and its five points: born at the end of Foundation; Services grows from them. */
export function groundPoints(w: World): Pt[] {
  return [0, 1, 2, 3, 4].map((j) => [w.W * lerp(w.mobile ? 0.1 : 0.14, w.mobile ? 0.9 : 0.94, j / 4), w.groundY]);
}

export function drawGround(w: World, u: number, active: number[] = []) {
  const { cx, W, H } = w, GY = w.groundY, lw = Math.max(1, H * 0.0014);
  const grow = eio(seg(u, 3.75, 4.1)), fade = 1 - seg(u, 7.4, 7.7);
  if (grow > 0 && fade > 0) {
    const x0 = W * (w.mobile ? 0.5 : 0.54), half = grow * W * (w.mobile ? 0.46 : 0.42);
    filament(cx, mkPath([[x0 - half, GY], [x0 + half, GY]]), 0, 2 * half, identity, lw, fade);
  }
  if (u < 7.42)
    groundPoints(w).forEach((p, j) => {
      const on = seg(u, 4.0 + j * 0.06, 4.1 + j * 0.06), act = active[j] ?? 0;
      if (on > 0) glow(cx, p[0], GY, H * 0.026 * (1 + 0.7 * act), on * (0.65 + 0.35 * act));
    });
}
