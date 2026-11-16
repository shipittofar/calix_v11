import { lerp } from "./math";

export type Pt = [number, number];
export type MapFn = (x: number, y: number) => Pt;
export type Path = { pts: Pt[]; L: number[]; len: number };

export const identity: MapFn = (x, y) => [x, y];

/** A polyline with its cumulative lengths, so it can be drawn up to any distance along it. */
export function mkPath(pts: Pt[]): Path {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, L, len: L[L.length - 1] };
}

function interp(path: Path, i: number, d: number): Pt {
  const { pts, L } = path;
  if (i <= 0) return pts[0];
  if (i >= pts.length) return pts[pts.length - 1];
  const t = (d - L[i - 1]) / (L[i] - L[i - 1] || 1);
  return [lerp(pts[i - 1][0], pts[i][0], t), lerp(pts[i - 1][1], pts[i][1], t)];
}

export function pointAt(path: Path, d: number): Pt {
  let i = 1;
  while (i < path.pts.length && path.L[i] < d) i++;
  return interp(path, i, d);
}

/** Strokes the part of `path` between distances d0 and d1, through `map`. */
export function strokeRange(c: CanvasRenderingContext2D, path: Path, d0: number, d1: number, map: MapFn) {
  const { pts, L } = path;
  let i = 1;
  while (i < pts.length && L[i] < d0) i++;
  let m = map(...interp(path, i, d0));
  c.beginPath();
  c.moveTo(m[0], m[1]);
  for (; i < pts.length && L[i] < d1; i++) {
    m = map(pts[i][0], pts[i][1]);
    c.lineTo(m[0], m[1]);
  }
  m = map(...interp(path, Math.min(i, pts.length - 1), d1));
  c.lineTo(m[0], m[1]);
  c.stroke();
}

export function cubicPts(a: Pt, c1: Pt, c2: Pt, b: Pt, n = 32): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, m = 1 - t;
    out.push([
      m * m * m * a[0] + 3 * m * m * t * c1[0] + 3 * m * t * t * c2[0] + t * t * t * b[0],
      m * m * m * a[1] + 3 * m * m * t * c1[1] + 3 * m * t * t * c2[1] + t * t * t * b[1],
    ]);
  }
  return out;
}
