import { palette } from "@/lib/palette";
import { pointAt, strokeRange, type MapFn, type Path } from "./paths";

/**
 * The golden light of the scroll story: soft glows and filaments drawn additively on the canvas.
 * Light falloffs use the palette colours at partial strength; this canvas-only exception was
 * approved by the owner on 14 November 2026 (docs/design-system.md). Page CSS stays pure palette.
 */

let sprite: HTMLCanvasElement | null = null;
let lite = false;
/** Lighter filaments (no outer haze) when the device cannot keep up; set by the stage controller. */
export const setLite = (on: boolean) => { lite = on; };

function glowSprite() {
  if (sprite) return sprite;
  sprite = document.createElement("canvas");
  sprite.width = sprite.height = 256;
  const g = sprite.getContext("2d")!;
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, "rgba(246,241,232,1)"); // ivory
  gr.addColorStop(0.16, "rgba(217,201,168,0.8)"); // travertine
  gr.addColorStop(0.42, "rgba(176,141,87,0.3)"); // gold
  gr.addColorStop(1, "rgba(176,141,87,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return sprite;
}

export function glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  if (a <= 0.003 || r <= 0) return;
  c.save();
  c.globalCompositeOperation = "lighter";
  c.globalAlpha = Math.min(1, a);
  c.drawImage(glowSprite(), x - r, y - r, 2 * r, 2 * r);
  c.restore();
}

/**
 * A tapering filament (roots): drawn in short pieces whose width runs from w0 at the start of the
 * path to w1 at its end, so a root is thick where it begins and fine at its tip.
 */
export function taperedFilament(c: CanvasRenderingContext2D, path: Path, d1: number, map: MapFn, w0: number, w1: number, a: number, headR = 0) {
  if (a <= 0.003 || d1 <= 0) return;
  const pieces = Math.max(2, Math.min(10, Math.ceil(d1 / (path.len / 10))));
  const step = d1 / pieces;
  for (let k = 0; k < pieces; k++) {
    const s0 = k * step, s1 = Math.min(d1, (k + 1) * step + step * 0.15);
    const t = (s0 + s1) / 2 / (path.len || 1);
    filament(c, path, s0, s1, map, w0 + (w1 - w0) * t, a, 0);
  }
  if (headR > 0) {
    const m = map(...pointAt(path, d1));
    glow(c, m[0], m[1], headR, a);
  }
}

/** A filament of light along `path` from d0 to d1: a wide gold haze, a halo and a bright core. */
export function filament(c: CanvasRenderingContext2D, path: Path, d0: number, d1: number, map: MapFn, w: number, a: number, headR = 0) {
  if (a <= 0.003 || d1 <= d0) return;
  c.save();
  c.globalCompositeOperation = "lighter";
  c.lineCap = "round";
  c.lineJoin = "round";
  c.strokeStyle = palette.gold;
  if (!lite) {
    c.globalAlpha = 0.06 * a;
    c.lineWidth = w * 8;
    strokeRange(c, path, d0, d1, map);
  }
  c.globalAlpha = 0.2 * a;
  c.lineWidth = w * 3;
  strokeRange(c, path, d0, d1, map);
  c.strokeStyle = palette.travertine;
  c.globalAlpha = 0.9 * a;
  c.lineWidth = w;
  strokeRange(c, path, d0, d1, map);
  c.restore();
  if (headR > 0) {
    const m = map(...pointAt(path, d1));
    glow(c, m[0], m[1], headR, a);
  }
}
