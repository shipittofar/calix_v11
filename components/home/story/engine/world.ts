import { rng } from "./math";

/**
 * The canvas world of the scroll story: the visible canvas, an offscreen layer for masked images,
 * a low-resolution mask for the grain dissolve, the loaded images and the layout every chapter
 * shares. Sizes are in CSS pixels; the canvases are scaled by DPR.
 */
export type World = {
  W: number;
  H: number;
  DPR: number;
  /** Highest pixel density the canvas may use (lowered to 1 when the device cannot keep up). */
  dprCap: number;
  /** Phone composition (text below, visual above): phones and portrait tablets. Mirrors app/cinema.css. */
  mobile: boolean;
  /** Narrower than a desktop: process steps and work labels use their compact forms. */
  compact: boolean;
  canvas: HTMLCanvasElement;
  cx: CanvasRenderingContext2D;
  layer: HTMLCanvasElement;
  lx: CanvasRenderingContext2D;
  maskC: HTMLCanvasElement;
  mx: CanvasRenderingContext2D;
  maskData: ImageData;
  noise: Float32Array;
  imgs: Partial<Record<string, HTMLImageElement>>;
  /** 0–1: the seed's ignition on load (time-based, never gates the headline). */
  intro: number;
  /** Shared layout, set on resize. */
  seed: [number, number];
  heroH: number;
  rootX: number[];
  nodeY: number[];
  groundY: number;
  /** Where the text columns sit (fractions of the stage height), measured on resize, so the
   *  text scrims always cover the text: hero bottom, Awakening top and Ecosystem top (phone composition). */
  bands: { heroBottom: number; awakeningTop: number; ecosystemTop: number };
};

/** Keep in sync with the phone-composition media query in app/cinema.css. */
export const STACK_QUERY = "(max-width: 759px), (max-width: 1099px) and (orientation: portrait)";

export function createWorld(canvas: HTMLCanvasElement): World {
  const layer = document.createElement("canvas");
  const maskC = document.createElement("canvas");
  const mx = maskC.getContext("2d")!;
  return {
    W: 0, H: 0, DPR: 1, dprCap: 1.5, mobile: false, compact: false,
    canvas, cx: canvas.getContext("2d")!, layer, lx: layer.getContext("2d")!,
    maskC, mx, maskData: mx.createImageData(1, 1), noise: new Float32Array(1),
    imgs: {}, intro: 0,
    seed: [0, 0], heroH: 0, rootX: [], nodeY: [], groundY: 0,
    bands: { heroBottom: 0.6, awakeningTop: 0.45, ecosystemTop: 0.5 },
  };
}

/** Two octaves of bilinear value noise in 0..1: large soft shapes with a little finer detail. */
function smoothNoise(width: number, height: number, seed: number) {
  const r = rng(seed), out = new Float32Array(width * height);
  const octave = (cells: number, weight: number) => {
    const gw = cells + 2, gh = Math.ceil((cells * height) / width) + 2, grid = Float32Array.from({ length: gw * gh }, () => r());
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const gx = (x / width) * cells, gy = (y / width) * cells, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
        const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), i = iy * gw + ix;
        const top = grid[i] + (grid[i + 1] - grid[i]) * sx, bottom = grid[i + gw] + (grid[i + gw + 1] - grid[i + gw]) * sx;
        out[y * width + x] += (top + (bottom - top) * sy) * weight;
      }
  };
  octave(5, 0.7);
  octave(13, 0.3);
  return out;
}

/** Sizes the canvases to the stage and recomputes the shared layout. */
export function sizeWorld(w: World, width: number, height: number) {
  w.W = width;
  w.H = height;
  w.mobile = window.matchMedia(STACK_QUERY).matches;
  w.compact = width < 1100;
  w.DPR = Math.min(window.devicePixelRatio || 1, width < 760 ? 1.25 : 1.5, w.dprCap);
  for (const c of [w.canvas, w.layer]) {
    c.width = Math.round(width * w.DPR);
    c.height = Math.round(height * w.DPR);
  }
  // The dissolve mask is coarse and smoothly upscaled: a soft, smoke-like edge, never pixels.
  w.maskC.width = Math.ceil(width / 8);
  w.maskC.height = Math.ceil(height / 8);
  w.maskData = w.mx.createImageData(w.maskC.width, w.maskC.height);
  w.noise = smoothNoise(w.maskC.width, w.maskC.height, 9);
  w.seed = w.mobile ? [width * 0.5, height * 0.72] : [width * 0.68, height * 0.54];
  w.heroH = w.mobile ? Math.max(height, width / 0.598) * 1.04 : height * 1.06;
  w.rootX = w.mobile ? [0.16, 0.38, 0.6, 0.82] : [0.37, 0.49, 0.61, 0.73];
  w.nodeY = w.mobile ? [0.3, 0.4, 0.5, 0.6] : [0.36, 0.47, 0.58, 0.69];
  w.groundY = height * (w.mobile ? 0.7 : 0.82);
}

export function resetCtx(w: World, c: CanvasRenderingContext2D) {
  c.setTransform(w.DPR, 0, 0, w.DPR, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.globalAlpha = 1;
}

/** An image through the Next.js optimizer at a given width (AVIF or WebP, quality 85). */
export function optimized(src: string, width: number) {
  return `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=85`;
}
