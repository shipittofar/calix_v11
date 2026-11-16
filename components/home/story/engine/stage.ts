import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { clamp, ei, eo, rng, seg } from "./math";
import { glow, setLite } from "./light";
import { createWorld, optimized, resetCtx, sizeWorld, type World } from "./world";
import { drawOrigin, layoutOrigin } from "./origin";
import { drawAwakening, drawWhiteout, layoutAwakening } from "./awakening";
import { drawFoundation, drawGround, groundPoints, layoutFoundation, nodes } from "./foundation";
import { drawServices, layoutServices, serviceK, SV_ILLUSTRATION, SV_PANEL, win, windowOpen } from "./services";
import { drawWork, formState, layoutWork, slotAnchor } from "./work";
import { drawEcosystem, layoutEcosystem } from "./ecosystem";
import { palette } from "@/lib/palette";

/**
 * The scroll story's controller (docs/scroll-story-build-plan.md). One pinned stage and one scrubbed
 * ScrollTrigger timeline: every visual and every line of text is a pure function of the scroll
 * position `u` (in screen heights), so scrolling back reverses everything exactly.
 *
 * It plays all seven chapters over u 0–11.3: Origin 0–1.2, Awakening 1.2–2.8, Foundation 2.8–4.4,
 * Services 4.4–7.4, Work 7.4–8.9, Identity 8.9–10.1, Ecosystem 10.1–11.3. The text it animates is the
 * server-rendered chapter content (components/home/cinema/Chapters.tsx), read from data attributes:
 * `.tl[data-in="a b"][data-out="c d"]` enters over u a–b and leaves over c–d. Text is faded, never
 * removed from the accessibility tree; focus moving into a chapter scrolls to that chapter.
 */

export const U_TOTAL = 11.3;
const CHAPTER_STARTS = [0, 1.2, 2.8, 4.4, 7.4, 8.9, 10.1];
const WIDTHS = [640, 750, 828, 1080, 1200, 1920, 2048];
const pickWidth = (need: number, cap: number) => Math.min(cap, WIDTHS.find((x) => x >= need) ?? cap);

type Line = { el: HTMLElement; inner: HTMLElement; inn: number[] | null; out: number[] | null; fade: boolean };
type Mote = { x: number; y: number; z: number; s: number; ph: number };

export function startStory(root: HTMLElement): () => void {
  gsap.registerPlugin(ScrollTrigger);
  const stage = root.querySelector<HTMLElement>("[data-cx-stage]");
  const canvas = root.querySelector<HTMLCanvasElement>("[data-cx-canvas]");
  if (!stage || !canvas) return () => {};
  const w: World = createWorld(canvas);

  /* ---------------------------------------------------------------- text */
  const num = (s?: string) => (s ? s.split(" ").map(Number) : null);
  const lines: Line[] = Array.from(stage.querySelectorAll<HTMLElement>(".tl")).flatMap((el) => {
    const inner = el.firstElementChild as HTMLElement | null;
    return inner ? [{ el, inner, inn: num(el.dataset.in), out: num(el.dataset.out), fade: el.classList.contains("tl--fade") }] : [];
  });
  const steps = Array.from(stage.querySelectorAll<HTMLElement>("[data-cx-step]"));
  // Containers with a background (the Foundation title card on phones) follow their text.
  const cards = Array.from(stage.querySelectorAll<HTMLElement>("[data-cx-card]")).map((el) => {
    const [a, b, c, d] = (el.dataset.cxCard ?? "").split(" ").map(Number);
    return { el, inn: [a, b], out: Number.isFinite(c) ? [c, d] : null };
  });
  const railBtns = Array.from(stage.querySelectorAll<HTMLButtonElement>("[data-cx-rail] button"));
  const railBar = stage.querySelector<HTMLElement>("[data-cx-rail-bar]");
  const railEl = stage.querySelector<HTMLElement>("[data-cx-rail]");
  let railBox = { top: 0, bottom: 0 };
  // Layers placed by the engine: the ground line's point labels, the illustration note beside the
  // service window, the work slot labels under their forms, and the real logo (never drawn on canvas).
  const ptEls = Array.from(stage.querySelectorAll<HTMLElement>("[data-cx-pts] > span"));
  const illus = stage.querySelector<HTMLElement>("[data-cx-illus]");
  const slots = Array.from(stage.querySelectorAll<HTMLElement>("[data-cx-slot]"));
  const logo = stage.querySelector<HTMLElement>("[data-cx-logo]");

  function updateText(u: number, stepState: number[], stepFade: number) {
    for (const t of lines) {
      const pi = t.inn ? eo(seg(u, t.inn[0], t.inn[1])) : 1;
      const po = t.out ? ei(seg(u, t.out[0], t.out[1])) : 0;
      const vis = pi * (1 - po);
      if (t.fade) {
        t.el.style.opacity = String(vis);
        t.inner.style.transform = `translate3d(0,${(1 - pi) * 16 - po * 16}px,0)`;
      } else {
        t.inner.style.transform = `translate3d(0,${(1 - pi) * 125 - po * 125}%,0)`;
        t.inner.style.opacity = String(clamp(vis * 1.6));
      }
      t.el.style.pointerEvents = vis > 0.5 ? "auto" : "none";
    }
    steps.forEach((el, i) => {
      // One card at a time below desktop width (chosen from how far each step is reached), then the
      // chapter's own fade on top, so earlier cards never reappear while the chapter leaves.
      const on = stepState[i] ?? 0, next = w.compact ? stepState[i + 1] ?? 0 : 0, v = on * (1 - next) * stepFade;
      el.style.opacity = String(v);
      // Desktop cards hang above-left of their node (bottom edge at the node), so they climb the slope
      // with the steps and stay clear of the sapling.
      el.style.transform = w.compact ? `translate3d(0,${(1 - on) * 12}px,0)` : `translate3d(-100%,calc(-100% + ${(1 - on) * 12}px),0)`;
      el.style.pointerEvents = v > 0.5 ? "auto" : "none";
      // On desktop the cards sit by their nodes: once the next step lights up, the previous one
      // folds to its title so the cards never overlap (the full text stays readable to screen readers).
      el.classList.toggle("is-past", !w.compact && (stepState[i + 1] ?? 0) > 0.5);
    });
    for (const c of cards) {
      const v = seg(u, c.inn[0], c.inn[1]) * (c.out ? 1 - seg(u, c.out[0], c.out[1]) : 1);
      c.el.style.opacity = String(v);
    }
    const ks = serviceK(u), ptOn = seg(u, 4.1, 4.3) * (1 - seg(u, 7.35, 7.5));
    ptEls.forEach((el, j) => {
      const act = (ks[j] ?? 0) > 0.1 && (ks[j] ?? 0) < 0.9;
      el.style.opacity = String(ptOn * (act ? 1 : 0.55));
      el.classList.toggle("is-on", act);
    });
    if (illus) illus.style.opacity = String(Math.max(0, ...ks.map((k, j) => (SV_ILLUSTRATION[j] ? windowOpen(k) : 0))));
    if (!w.compact) slots.forEach((el, k) => { el.style.transform = `translate3d(0,${formState(u, k).drift}px,0)`; });
    if (logo) {
      const lo = seg(u, 9.45, 9.65) * (1 - seg(u, 9.95, 10.1));
      logo.style.opacity = String(lo);
      logo.style.transform = `translate(-50%,-50%) scale(${0.97 + 0.03 * eo(seg(u, 9.45, 9.7))})`;
      logo.style.pointerEvents = "none";
    }
    let idx = 0;
    CHAPTER_STARTS.forEach((c, i) => { if (u >= c) idx = i; });
    railBtns.forEach((b, i) => (i === idx ? b.setAttribute("aria-current", "step") : b.removeAttribute("aria-current")));
    if (railBar) railBar.style.setProperty("--p", String(u / U_TOTAL));
  }

  /* ---------------------------------------------------------------- atmosphere */
  let motes: Mote[] = [];
  function drawDust(u: number, dim: number) {
    const k = 1 - dim;
    if (k <= 0) return;
    for (const p of motes) {
      const span = w.H * 1.3, y = ((((p.y * span - u * w.H * 0.3 * p.z) % span) + span) % span) - w.H * 0.15;
      glow(w.cx, p.x * w.W + Math.sin(p.ph + u * 0.9) * 14 * p.z, y, p.s * p.z * 3, 0.22 * p.z * k);
    }
  }
  const grain = stage.querySelector<HTMLElement>("[data-cx-grain]");
  if (grain) {
    const g = document.createElement("canvas");
    g.width = g.height = 160;
    const c = g.getContext("2d")!, d = c.createImageData(160, 160), r = rng(21);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = r() * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
      d.data[i + 3] = 255;
    }
    c.putImageData(d, 0, 0);
    grain.style.backgroundImage = `url(${g.toDataURL()})`;
  }

  /* ---------------------------------------------------------------- frame */
  const state = { u: 0 };
  let dirty = true;
  const t0 = performance.now();
  function render(u: number) {
    if (!lateRequested && u > 2.8) loadLate();
    w.intro = eo(clamp((performance.now() - t0 - 150) / 1600));
    resetCtx(w, w.cx);
    w.cx.fillStyle = palette.espresso;
    w.cx.fillRect(0, 0, w.W, w.H);
    let stepState: number[] = [];
    const ks = serviceK(u);
    if (u < 1.26) drawOrigin(w, u);
    if (u > 1.17 && u < 3.22) drawAwakening(w, u - 1.2);
    const stepFade = 1 - seg(u, 4.36, 4.5);
    if (u > 2.7 && u < 4.72) stepState = drawFoundation(w, u - 2.8, 1 - seg(u, 4.4, 4.7));
    if (u > 3.7 && u < 7.75) drawGround(w, u, ks.map(windowOpen));
    if (u > 4.55 && u < 7.45) drawServices(w, ks);
    if (u > 7.35 && u < 9.7) drawWork(w, u);
    if (u > 9.98) drawEcosystem(w, u);
    // A soft darkening at the right edge behind the chapter index where a bright photograph fills
    // the screen (Awakening, Ecosystem), so the index stays legible without a box.
    const edge = w.mobile ? 0 : Math.max(seg(u, 1.25, 1.5) * (1 - seg(u, 2.55, 2.8)), seg(u, 2.8, 3.1) * (1 - seg(u, 4.2, 4.5)), seg(u, 10.15, 10.45));
    if (edge > 0) {
      // An oval shade around the index only, so the rest of the picture keeps its light.
      const ew = 240, ry = (railBox.bottom - railBox.top) / 2 + 70, cy = (railBox.top + railBox.bottom) / 2;
      w.cx.save();
      w.cx.translate(w.W, cy);
      w.cx.scale(1, ry / ew);
      const g = w.cx.createRadialGradient(0, 0, 0, 0, 0, ew);
      g.addColorStop(0, "rgba(46,30,20,0.94)");
      g.addColorStop(0.55, "rgba(46,30,20,0.82)");
      g.addColorStop(1, "rgba(46,30,20,0)");
      w.cx.globalAlpha = edge;
      w.cx.fillStyle = g;
      w.cx.fillRect(-ew, -ew, ew, ew * 2);
      w.cx.restore();
      w.cx.globalAlpha = 1;
    }
    const wo = drawWhiteout(w, u);
    // The logo appears on calm ground: the dust settles while it is shown.
    drawDust(u, Math.max(wo, 0.6 * seg(u, 9.4, 9.6) * (1 - seg(u, 9.95, 10.1))));
    updateText(u, stepState, stepFade);
  }

  function loadImages() {
    const need = (cssW: number) => cssW * w.DPR;
    const load = (key: string, src: string) =>
      new Promise<void>((res) => {
        if (w.imgs[key]?.dataset.src === src) return res();
        const i = new Image();
        i.decoding = "async";
        i.dataset.src = src;
        i.onload = () => { w.imgs[key] = i; dirty = true; res(); };
        i.onerror = () => res();
        i.src = src;
      });
    const heroW = w.heroH * 0.598;
    load("origin", optimized("/cinema/scene-01.webp", pickWidth(need(heroW), 1080))).then(() =>
      Promise.all([
        load("veins", optimized("/cinema/awakening-veins-full.webp", pickWidth(need(Math.max(w.W, w.H) * 1.75), 2048))),
        load("foundation", optimized("/cinema/foundation-ground.webp", pickWidth(need(w.mobile ? w.W * 2.2 : Math.max(w.W, w.H * 1.78)), 1920))),
      ]),
    );
    if (lateRequested) loadLate();
  }

  // Chapters 4–7's images load only when the visitor gets near them (or jumps there), so a visit
  // that stops at the hero does not download them.
  let lateRequested = false;
  function loadLate() {
    lateRequested = true;
    const need = (cssW: number) => cssW * w.DPR;
    const load = (key: string, src: string) => {
      if (w.imgs[key]?.dataset.src === src) return;
      const i = new Image();
      i.decoding = "async";
      i.dataset.src = src;
      i.onload = () => { w.imgs[key] = i; dirty = true; };
      i.src = src;
    };
    SV_PANEL.forEach((n) => load(`p${n}`, optimized(`/cinema/${n}.webp`, pickWidth(need(win.w * 1.1), 1080))));
    load("p05", optimized("/cinema/scene-05.webp", pickWidth(need(w.W), 1080)));
    load("p10", optimized("/cinema/scene-10.webp", pickWidth(need(w.W), 1080)));
  }

  function resize() {
    const rect = stage!.getBoundingClientRect();
    sizeWorld(w, rect.width, rect.height);
    layoutOrigin(w);
    layoutAwakening(w);
    const frac = (sel: string, edge: "top" | "bottom", fallback: number) => {
      const el = stage!.querySelector<HTMLElement>(sel);
      return el && rect.height ? (el.getBoundingClientRect()[edge] - rect.top) / rect.height : fallback;
    };
    w.bands = {
      heroBottom: frac(".cx-ch1 .cx-copy", "bottom", 0.6),
      awakeningTop: frac(".cx-ch2 .cx-copy", "top", 0.45),
      ecosystemTop: frac(".cx-ch7 .cx-copy", "top", 0.5),
    };
    if (railEl) {
      const rr = railEl.getBoundingClientRect();
      railBox = { top: rr.top - rect.top, bottom: rr.bottom - rect.top };
    }
    layoutFoundation(w);
    layoutServices(w);
    layoutWork(w);
    layoutEcosystem(w);
    groundPoints(w).forEach((p, j) => {
      if (!ptEls[j]) return;
      ptEls[j].style.left = `${p[0]}px`;
      ptEls[j].style.top = `${p[1] + 16}px`;
    });
    if (illus) { illus.style.left = `${win.x}px`; illus.style.top = `${win.y - 34}px`; }
    // Below desktop width the slot labels would collide; approved projects then list under the copy.
    slots.forEach((el, k) => {
      const a = slotAnchor(k);
      el.style.left = w.compact ? "" : `${a[0] - 95}px`;
      el.style.top = w.compact ? "" : `${a[1]}px`;
    });
    const r = rng(5);
    motes = Array.from({ length: w.mobile ? 28 : 60 }, () => ({ x: r(), y: r(), z: 0.3 + r() * 1.2, s: 1 + r() * 2.2, ph: r() * 6.28 }));
    if (!w.compact)
      nodes.forEach((n, i) => {
        if (!steps[i]) return;
        steps[i].style.left = `${n.x - 16}px`;
        steps[i].style.top = `${n.y - 12}px`;
      });
    else steps.forEach((el) => { el.style.left = ""; el.style.top = ""; });
    loadImages();
    dirty = true;
  }

  /* ---------------------------------------------------------------- scroll engine */
  let pendingHash = location.hash;
  const clearPending = () => { pendingHash = ""; };
  const userInput = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
  userInput.forEach((ev) => window.addEventListener(ev, clearPending, { once: true, passive: true }));
  const pendingTimer = window.setTimeout(clearPending, 4000);
  resize();
  const headerH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 0;
  const tween = gsap.to(state, {
    u: U_TOTAL,
    ease: "none",
    scrollTrigger: {
      trigger: stage,
      start: () => `top top+=${headerH()}`,
      end: () => `+=${U_TOTAL * stage.offsetHeight}`,
      pin: true,
      scrub: 1,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onRefresh: () => { resize(); },
    },
    onUpdate: () => { dirty = true; },
  });
  const st = tween.scrollTrigger!;
  // Adaptive quality: if frames take too long on this device, drop to 1x pixel density and lighter
  // filaments once, rather than dropping frames for the rest of the visit.
  let frameAvg = 0, degraded = false;
  const tick = () => {
    if (w.intro < 1) dirty = true;
    if (!dirty) return;
    dirty = false;
    const t = performance.now();
    render(state.u);
    frameAvg = frameAvg * 0.9 + (performance.now() - t) * 0.1;
    if (!degraded && frameAvg > 14) {
      degraded = true;
      setLite(true);
      w.dprCap = 1;
      resize();
    }
  };
  gsap.ticker.add(tick);

  /** Scrolls to the moment `u` of the story. */
  const scrollToU = (u: number) => window.scrollTo({ top: st.start + (u / U_TOTAL) * (st.end - st.start) + 1, behavior: "auto" });
  const restOf = (el: Element | null) => {
    const ch = el?.closest<HTMLElement>("[data-cx-rest]");
    return ch ? Number(ch.dataset.cxRest) : null;
  };

  // The chapter rail jumps to each chapter's resting point.
  const onRail = (e: Event) => scrollToU(Number((e.currentTarget as HTMLElement).dataset.u));
  railBtns.forEach((b) => b.addEventListener("click", onRail));

  // Keyboard focus entering a chapter whose text is not on screen scrolls to that chapter.
  const shown = (el: HTMLElement) => {
    const line = el.closest<HTMLElement>(".tl, [data-cx-step]");
    if (!line) return true;
    const masked = line.classList.contains("tl") && !line.classList.contains("tl--fade");
    const o = masked ? (line.firstElementChild as HTMLElement | null)?.style.opacity : line.style.opacity;
    return !o || Number(o) >= 0.5;
  };
  const onFocus = (e: FocusEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest("[data-cx-rail]") || shown(target)) return;
    const rest = restOf(target);
    if (rest !== null) scrollToU(rest);
  };
  stage.addEventListener("focusin", onFocus);

  // In-page links to a chapter (for example /#process) land on its resting point, not the pin's top.
  const jumpToHash = (hash: string) => {
    if (!hash || hash.length < 2) return false;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el || !stage.contains(el)) return false;
    const rest = restOf(el);
    if (rest === null) return false;
    scrollToU(rest);
    return true;
  };
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[href*='#']");
    if (!a || a.origin !== location.origin || a.pathname !== location.pathname) return;
    if (jumpToHash(a.hash)) {
      e.preventDefault();
      history.pushState(null, "", a.hash);
    }
  };
  document.addEventListener("click", onClick);
  const onHash = () => jumpToHash(location.hash);
  window.addEventListener("hashchange", onHash);
  // A page opened at a chapter's hash lands on it after every layout refresh (fonts, viewport
  // changes) until the visitor scrolls themselves; the "refresh" event fires once all triggers
  // are measured.
  const land = () => { if (pendingHash) jumpToHash(pendingHash); };
  // The jump is repeated on the frame after each refresh (when the pin's start and end are final),
  // and once fonts and the page's own load have settled, since none of those scrolls the page and
  // so the scroll correction below would never run.
  const onRefreshed = () => { land(); requestAnimationFrame(land); };
  ScrollTrigger.addEventListener("refresh", onRefreshed);
  const landTimers = [150, 600, 1500, 3000].map((ms) => window.setTimeout(land, ms));
  document.fonts?.ready.then(() => requestAnimationFrame(land));
  window.addEventListener("load", land, { once: true });
  // Next.js also scrolls to the hash's element after hydration, which inside the pinned stage
  // means the wrong moment: while the landing is pending, scrolls the visitor did not make are
  // corrected back to the chapter's resting point.
  let fixQueued = false;
  const onPendingScroll = () => {
    if (!pendingHash || fixQueued) return;
    fixQueued = true;
    requestAnimationFrame(() => { fixQueued = false; if (pendingHash) jumpToHash(pendingHash); });
  };
  window.addEventListener("scroll", onPendingScroll, { passive: true });
  requestAnimationFrame(() => ScrollTrigger.refresh());

  // Debug hook in development: __seek(u) renders any moment of the story.
  if (process.env.NODE_ENV !== "production") (window as unknown as { __seek: (u: number) => void }).__seek = (u) => { state.u = u; render(u); };

  return () => {
    window.clearTimeout(pendingTimer);
    clearPending();
    landTimers.forEach((t) => window.clearTimeout(t));
    window.removeEventListener("load", land);
    setLite(false);
    ScrollTrigger.removeEventListener("refresh", onRefreshed);
    window.removeEventListener("scroll", onPendingScroll);
    userInput.forEach((ev) => window.removeEventListener(ev, clearPending));
    gsap.ticker.remove(tick);
    tween.scrollTrigger?.kill(true);
    tween.kill();
    railBtns.forEach((b) => b.removeEventListener("click", onRail));
    stage.removeEventListener("focusin", onFocus);
    document.removeEventListener("click", onClick);
    window.removeEventListener("hashchange", onHash);
    for (const t of lines) { t.el.removeAttribute("style"); t.inner.removeAttribute("style"); }
    steps.forEach((el) => { el.removeAttribute("style"); el.classList.remove("is-past"); });
    cards.forEach((c) => c.el.removeAttribute("style"));
    [...ptEls, ...slots, illus, logo].forEach((el) => el?.removeAttribute("style"));
    ptEls.forEach((el) => el.classList.remove("is-on"));
    if (grain) grain.removeAttribute("style");
  };
}
