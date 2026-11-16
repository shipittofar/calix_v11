import { palette } from "@/lib/palette";
import { clamp, eio, eo, lerp, rng, seg } from "./math";
import { cubicPts, mkPath, type Path, type Pt } from "./paths";
import { filament, glow } from "./light";
import { logoCentre } from "./work";
import { resetCtx, type World } from "./world";

/**
 * 07 Ecosystem (scroll 10.1–11.3): from the identity's place a living network opens as a burst of
 * tendrils and grows across the screen (S-curved connections, fine tendrils, the seven chapter
 * names on its nodes) while the camera pulls back; storyboard panel 10 opens behind it.
 */

type NetNode = { x: number; y: number; d: number; t: number; label?: boolean };
type Edge = { path: Path; ta: number; tb: number; w: number };
type Tendril = { path: Path; t: number; long: boolean };
let net: { nodes: NetNode[]; edges: Edge[]; tendrils: Tendril[]; labels: { n: NetNode; name: string }[]; c0: Pt } | null = null;
let labelFont = "500 11px sans-serif";

export function layoutEcosystem(w: World) {
  const { W, H } = w, r = rng(77), c0: Pt = [logoCentre[0] / W, logoCentre[1] / H];
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(((a.x - b.x) * W) / H, a.y - b.y);
  const nodes: NetNode[] = [{ x: c0[0], y: c0[1], d: 0, t: 0 }];
  const minD = w.mobile ? 0.15 : 0.12;
  for (let tries = 0; nodes.length < (w.mobile ? 16 : 24) && tries < 5000; tries++) {
    const n = { x: 0.04 + r() * 0.92, y: 0.12 + r() * 0.74, d: 0, t: 0 };
    if (nodes.every((m) => dist(m, n) > minD)) nodes.push(n);
  }
  nodes.forEach((n) => (n.d = dist(n, nodes[0])));
  nodes.sort((a, b) => a.d - b.d);
  const maxd = nodes[nodes.length - 1].d || 1;
  nodes.forEach((n) => (n.t = n.d / maxd));
  const edges: Edge[] = [], tendrils: Tendril[] = [];
  const edge = (a: NetNode, b: NetNode, wt = 1) => {
    const sp = a === nodes[0] ? 1.3 : 0.8, dx = b.x - a.x, dy = b.y - a.y;
    const o1 = (r() < 0.5 ? -1 : 1) * (0.15 + r() * 0.35) * sp, o2 = (r() - 0.5) * 0.7 * sp;
    const c1: Pt = [a.x + dx * 0.33 - dy * o1, a.y + dy * 0.33 + dx * o1], c2: Pt = [a.x + dx * 0.66 - dy * o2, a.y + dy * 0.66 + dx * o2];
    edges.push({ path: mkPath(cubicPts([a.x, a.y], c1, c2, [b.x, b.y], 28)), ta: a.t, tb: b.t, w: wt });
  };
  const tendril = (n: NetNode, long = false) => {
    let ang = r() * Math.PI * 2, av = (r() - 0.5) * 0.2, x = n.x, y = n.y;
    const pts: Pt[] = [[x, y]], st = 0.004 + r() * 0.003, len = long ? 26 + Math.floor(r() * 24) : 10 + Math.floor(r() * 16);
    for (let k = 0; k < len; k++) {
      av = av * 0.9 + (r() - 0.5) * 0.12;
      ang += av;
      x += (Math.cos(ang) * st * H) / W;
      y += Math.sin(ang) * st;
      pts.push([x, y]);
    }
    tendrils.push({ path: mkPath(pts), t: n.t, long });
  };
  for (let k = 0; k < (w.mobile ? 6 : 9); k++) tendril(nodes[0], true);
  for (let i = 1; i < nodes.length; i++) {
    const near = nodes.slice(0, i).map((m) => [m, dist(m, nodes[i])] as const).sort((a, b) => a[1] - b[1]);
    edge(near[0][0], nodes[i]);
    if (near[1] && r() < 0.4) edge(near[1][0], nodes[i], 0.6);
    for (let k = 0, m = 1 + Math.floor(r() * 3); k < m; k++) tendril(nodes[i]);
  }
  const names = ["01 Origin", "02 Awakening", "03 Foundation", "04 Services", "05 Work", "06 Identity", "07 Ecosystem"];
  const cands = nodes.slice(1).filter((n) => w.mobile || n.x > 0.5), labels: { n: NetNode; name: string }[] = [];
  names.forEach((nm, k) => {
    const ang = (k / 7) * Math.PI * 2 - Math.PI / 2;
    let best: NetNode | null = null, bs = 1e9;
    for (const n of cands) {
      if (n.label) continue;
      const a = Math.atan2(n.y - c0[1], ((n.x - c0[0]) * W) / H), sc = Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang))) + Math.abs(n.t - 0.55) * 2;
      if (sc < bs) { bs = sc; best = n; }
    }
    if (best) { best.label = true; labels.push({ n: best, name: w.mobile ? nm.slice(0, 2) : nm.toUpperCase() }); }
  });
  net = { nodes, edges, tendrils, labels, c0 };
  const jost = getComputedStyle(document.body).getPropertyValue("--font-jost").trim();
  labelFont = `500 ${w.mobile ? 10 : 11}px ${jost || "sans-serif"}`;
}

export function drawEcosystem(w: World, u: number) {
  if (!net) return;
  const { cx, lx, W, H } = w, e = u - 10.1, lw = Math.max(1, H * 0.0012), im = w.imgs.p10, pr = eo(seg(e, 0.35, 0.95));
  const [lxc, lyc] = logoCentre;
  if (im && pr > 0) {
    resetCtx(w, lx);
    lx.clearRect(0, 0, W, H);
    const sc = Math.max(W / im.width, H / im.height) * lerp(1.12, 1, pr), dw = im.width * sc, dh = im.height * sc;
    lx.drawImage(im, (W - dw) / 2, (H - dh) / 2, dw, dh);
    lx.globalAlpha = 0.35;
    lx.fillStyle = palette.espresso;
    lx.fillRect(0, 0, W, H);
    lx.globalAlpha = 1;
    const g = lx.createRadialGradient(lxc, lyc, 0, lxc, lyc, Math.max(1, pr * Math.hypot(W, H)));
    g.addColorStop(0, "rgba(0,0,0,1)");
    g.addColorStop(0.7, "rgba(0,0,0,0.8)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    lx.globalCompositeOperation = "destination-in";
    lx.fillStyle = g;
    lx.fillRect(0, 0, W, H);
    cx.globalAlpha = 0.55 * pr;
    cx.drawImage(w.layer, 0, 0, W, H);
    cx.globalAlpha = 1;
  }
  const z = lerp(1.6, 1, eo(seg(e, 0, 0.95))), c0 = net.c0;
  const map = (x: number, y: number): Pt => [lxc + (x - c0[0]) * W * z, lyc + (y - c0[1]) * H * z];
  const g = eio(seg(e, 0.08, 0.82)) * 1.04, fade = seg(u, 10.0, 10.15);
  for (const ed of net.edges) {
    const f = clamp((g - ed.ta) / Math.max(0.02, ed.tb - ed.ta));
    if (f > 0) filament(cx, ed.path, 0, ed.path.len * f, map, lw * ed.w, 0.8 * fade, f < 1 ? H * 0.008 : 0);
  }
  for (const td of net.tendrils) {
    const f = td.long ? eo(seg(e, 0, 0.35)) : eo(seg(g, td.t + 0.03, td.t + 0.2));
    if (f > 0) filament(cx, td.path, 0, td.path.len * f, map, lw * (td.long ? 0.7 : 0.45), 0.75 * fade, td.long && f < 1 ? H * 0.008 : 0);
  }
  for (const n of net.nodes) {
    const on = seg(g, n.t, n.t + 0.05);
    if (on > 0) { const m = map(n.x, n.y); glow(cx, m[0], m[1], H * (n.label ? 0.02 : 0.008), on * fade); }
  }
  const la = seg(e, 0.5, 0.78);
  if (la > 0) {
    cx.save();
    cx.font = labelFont;
    if ("letterSpacing" in cx) (cx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "2px";
    cx.fillStyle = palette.travertine;
    cx.globalAlpha = la;
    for (const l of net.labels) {
      const m = map(l.n.x, l.n.y), tw = cx.measureText(l.name).width;
      cx.fillText(l.name, m[0] + 12 + tw > W - (w.mobile ? 8 : 96) ? m[0] - 12 - tw : m[0] + 12, m[1] + 4);
    }
    cx.restore();
  }
  const sc = seg(e, 0.6, 0.88);
  if (sc > 0) {
    // Text scrim (WCAG 1.4.3): an even band under the whole text column, then a fade.
    const top = Math.max(0.05, w.bands.ecosystemTop - 0.03), end = Math.max(0, top - 0.15);
    const g2 = w.mobile ? cx.createLinearGradient(0, H, 0, H * end) : cx.createLinearGradient(0, 0, W * 0.75, 0);
    g2.addColorStop(0, "rgba(46,30,20,0.92)");
    g2.addColorStop(w.mobile ? (1 - top) / (1 - end) : 0.72, "rgba(46,30,20,0.86)");
    g2.addColorStop(1, "rgba(46,30,20,0)");
    cx.globalAlpha = sc;
    cx.fillStyle = g2;
    cx.fillRect(0, 0, W, H);
    cx.globalAlpha = 1;
  }
}
