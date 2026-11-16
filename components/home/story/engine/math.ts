/** Small numeric helpers shared by the scroll story's chapters. */

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Progress of `u` through the range a..b, clamped to 0..1. */
export const seg = (u: number, a: number, b: number) => clamp((u - a) / (b - a));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Cubic ease out, ease in and ease in-out. */
export const eo = (t: number) => 1 - Math.pow(1 - t, 3);
export const ei = (t: number) => t * t * t;
export const eio = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Deterministic random numbers (mulberry32), so every visitor sees the same growth. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
