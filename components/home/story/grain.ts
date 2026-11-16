/**
 * Grain dissolve (transition T3, docs/cinematic-direction.md): a stippled edge that rises from the
 * bottom of a canvas. In "image" mode the canvas shows an image only where the grain has arrived
 * (p = 0 nothing, p = 1 all of it); in "cover" mode it paints a solid colour that breaks up and
 * clears (p = 0 solid, p = 1 gone). The grain is a fixed field, so a frame depends only on p.
 */

export type Grain = { draw: (p: number) => void; resize: () => void };

type Options = { mode: "image"; image: HTMLImageElement } | { mode: "cover"; color: string };

const CELL = 2; // CSS pixels per grain cell

// A small value-noise field, seeded, so the grain has soft clusters rather than pure static.
function field(w: number, h: number) {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const gw = Math.ceil(w / 24) + 2;
  const gh = Math.ceil(h / 24) + 2;
  const grid = new Float32Array(gw * gh).map(() => rnd());
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const gy = y / 24, y0 = Math.floor(gy), fy = gy - y0, sy = fy * fy * (3 - 2 * fy);
    for (let x = 0; x < w; x++) {
      const gx = x / 24, x0 = Math.floor(gx), fx = gx - x0, sx = fx * fx * (3 - 2 * fx);
      const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1], c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
      const smooth = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
      out[y * w + x] = 0.42 * smooth + 0.58 * rnd();
    }
  }
  return out;
}

export function createGrain(canvas: HTMLCanvasElement, opts: Options): Grain {
  const ctx = canvas.getContext("2d");
  const mask = document.createElement("canvas");
  let noise = new Float32Array(0);
  let nw = 0, nh = 0;
  let last = -1;

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    nw = Math.max(1, Math.ceil(r.width / CELL));
    nh = Math.max(1, Math.ceil(r.height / CELL));
    noise = field(nw, nh);
    mask.width = nw;
    mask.height = nh;
    last = -1;
  };

  const draw = (p: number) => {
    if (!ctx || !nw) return;
    if (Math.abs(p - last) < 0.003 && p > 0 && p < 1) return;
    last = p;
    const W = canvas.width, H = canvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, W, H);
    const shown = opts.mode === "image" ? p : 1 - p; // how much of the canvas is painted
    if (shown <= 0) return;
    if (opts.mode === "image") {
      const img = opts.image;
      if (!img.complete || !img.naturalWidth) return;
      const s = Math.max(W / img.naturalWidth, H / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      ctx.fillStyle = opts.color;
      ctx.fillRect(0, 0, W, H);
    }
    if (p >= 1 && opts.mode === "image") return;
    if (p <= 0 && opts.mode === "cover") return;
    // The grain front: cells below the edge (plus noise) have arrived.
    const mctx = mask.getContext("2d");
    if (!mctx) return;
    const data = mctx.createImageData(nw, nh);
    const edge = p * 1.5 - 0.25;
    for (let y = 0; y < nh; y++) {
      const fromBottom = 1 - y / nh;
      for (let x = 0; x < nw; x++) {
        const arrived = fromBottom + (noise[y * nw + x] - 0.5) * 0.5 < edge;
        // Image mode keeps arrived cells; cover mode keeps the cells the grain has not reached.
        data.data[(y * nw + x) * 4 + 3] = (opts.mode === "image") === arrived ? 255 : 0;
      }
    }
    mctx.putImageData(data, 0, 0);
    ctx.globalCompositeOperation = "destination-in";
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mask, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.globalCompositeOperation = "source-over";
  };

  resize();
  return { draw, resize };
}
