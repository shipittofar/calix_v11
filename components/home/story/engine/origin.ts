import { clamp, ei, eio, eo, lerp, rng, seg } from "./math";
import { mkPath, type Path } from "./paths";
import { filament, glow } from "./light";
import { palette } from "@/lib/palette";
import { resetCtx, type World } from "./world";

/**
 * 01 Origin (scroll 0–1.2): storyboard panel 01 lit outward from the seed, tendrils of light
 * sprouting from it, and the camera's dive into the seed until the screen turns to gold light.
 */

type Sprout = { path: Path; delay: number; w: number };
let sprouts: Sprout[] = [];

export function layoutOrigin(w: World) {
  const r = rng(7);
  sprouts = [];
  for (let i = 0; i < (w.mobile ? 4 : 6); i++) {
    let a = -Math.PI / 2 + (r() - 0.5) * 2.2, x = 0, y = 0, av = (r() - 0.5) * 0.06;
    const pts: [number, number][] = [[0, 0]], step = 0.006 + r() * 0.004;
    for (let k = 0; k < 60; k++) {
      av = av * 0.92 + (r() - 0.5) * 0.03;
      a += av;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      pts.push([x, y]);
    }
    sprouts.push({ path: mkPath(pts), delay: r() * 0.35, w: 0.5 + r() * 0.6 });
  }
}

function originCam(w: World, u: number) {
  const d = seg(u, 0.72, 1.2);
  const z = (1 + 0.12 * eio(seg(u, 0, 0.7))) * Math.pow(9, ei(d));
  return { z, d, ax: lerp(w.seed[0], w.W / 2, eio(d)), ay: lerp(w.seed[1], w.H / 2, eio(d)) };
}

export function drawOrigin(w: World, u: number) {
  const { cx, lx, W, H } = w;
  const cam = originCam(w, u), im = w.imgs.origin;
  if (im) {
    const s = (w.heroH / im.height) * cam.z, dw = im.width * s, dh = im.height * s, px = cam.ax - 0.51 * dw;
    resetCtx(w, lx);
    lx.clearRect(0, 0, W, H);
    const py = cam.ay - 0.48 * dh;
    lx.drawImage(im, px, py, dw, dh);
    // Lift the photograph's darkest tones to exactly the page colour ("lighten" keeps the brighter of
    // the two per channel), so its shadows become the page and no edge shows.
    lx.globalCompositeOperation = "lighten";
    lx.fillStyle = palette.espresso;
    lx.fillRect(px, py, dw, dh);
    lx.globalCompositeOperation = "source-over";
    // The plate is lit outward from the seed: a pool of light that widens with the scroll.
    const R = (H * (0.2 + 0.32 * w.intro) + H * 1.3 * eo(seg(u, 0.04, 0.65))) * Math.sqrt(cam.z);
    const g = lx.createRadialGradient(cam.ax, cam.ay, 0, cam.ax, cam.ay, R);
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.6, "rgba(0,0,0,0.92)");
    g.addColorStop(1, "rgba(0,0,0,0.35)");
    lx.globalCompositeOperation = "destination-in";
    lx.fillStyle = g;
    lx.fillRect(0, 0, W, H);
    // Where the photograph ends it falls off in a soft oval around the stone and the seed, so the
    // stone fades out along a natural curve instead of a straight edge.
    lx.save();
    lx.translate(px + dw * 0.5, py + dh * 0.52);
    lx.scale(1, 1.45);
    // The oval reaches zero exactly at the photograph's sides and before its top and bottom.
    const v = lx.createRadialGradient(0, 0, 0, 0, 0, dw * 0.5);
    v.addColorStop(0, "rgba(0,0,0,1)");
    v.addColorStop(0.42, "rgba(0,0,0,1)");
    v.addColorStop(0.72, "rgba(0,0,0,0.55)");
    v.addColorStop(1, "rgba(0,0,0,0)");
    lx.fillStyle = v;
    lx.fillRect(-W * 2, -H * 2, W * 4, H * 4);
    lx.restore();
    cx.globalAlpha = w.intro;
    cx.drawImage(w.layer, 0, 0, W, H);
    cx.globalAlpha = 1;
  }
  const g = seg(u, 0.28, 0.95), zz = cam.z;
  const map = (x: number, y: number): [number, number] => [cam.ax + x * H * zz, cam.ay + y * H * zz];
  const lw = Math.min(H * 0.0012 * Math.sqrt(zz), 7);
  for (const sp of sprouts) {
    const f = eo(clamp((g - sp.delay) / 0.7));
    if (f > 0) filament(cx, sp.path, 0, sp.path.len * f, map, lw * sp.w, 0.8, f < 1 ? H * 0.009 : 0);
  }
  if (w.mobile) {
    // Phone composition: the headline sits over the top of the plate. The text scrim goes over the
    // plate and the tendrils (so no light crosses the text), and under the seed, which sits below it.
    const fade = 1 - seg(u, 0.3, 0.55);
    const band = Math.min(w.bands.heroBottom + 0.03, 0.7), end = band + 0.1;
    const s = cx.createLinearGradient(0, 0, 0, H * end);
    s.addColorStop(0, "rgba(46,30,20,0.9)");
    s.addColorStop(band / end, "rgba(46,30,20,0.82)");
    s.addColorStop(1, "rgba(46,30,20,0)");
    cx.globalCompositeOperation = "source-over";
    cx.globalAlpha = fade;
    cx.fillStyle = s;
    cx.fillRect(0, 0, W, H);
    cx.globalAlpha = 1;
  }
  const r = H * 0.05 * (0.55 + 0.45 * w.intro) * (1 + 0.3 * seg(u, 0, 0.5)) * (1 + 46 * ei(cam.d));
  glow(cx, cam.ax, cam.ay, r, w.intro * (0.8 + 0.2 * seg(u, 0, 0.3)));
}
