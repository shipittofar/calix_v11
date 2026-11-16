/**
 * The story's timeline: each beat is a distinct, visible state of the mineral growth in
 * mineral.ts, grouped into the seven stages of stages.ts. A beat's label is shown as the "now"
 * line in the caption during playback, and listed as the stage's steps in the static layout.
 *
 * The story is conceptual: a brand grows like a living system, from one possibility to an
 * ecosystem that keeps growing. Durations are in timeline units (about three quarters of a
 * viewport of scrolling each; see the CSS).
 */

type BeatSpec = readonly [id: string, label: string, duration: number];

const CHAPTERS: readonly (readonly BeatSpec[])[] = [
  // 1. Origin
  [
    ["o1", "Only the ground.", 0.35],
    ["o2", "A form condenses.", 0.5],
    ["o3", "One possibility, at rest.", 0.4],
  ],
  // 2. Awakening
  [
    ["w1", "Something stirs inside.", 0.4],
    ["w2", "Growth rings spread outward.", 0.4],
    ["w3", "The first blades unfold.", 0.5],
  ],
  // 3. Foundation
  [
    ["f1", "Roots reach down.", 0.45],
    ["f2", "They spread and branch.", 0.45],
    ["f3", "A foundation to build on.", 0.35],
  ],
  // 4. Expansion
  [
    ["e1", "Branches extend.", 0.45],
    ["e2", "In every direction.", 0.4],
    ["e3", "Each opens into its own fan.", 0.45],
  ],
  // 5. Differentiation
  [
    ["d1", "Shapes begin to differ.", 0.45],
    ["d2", "Surfaces and tones follow.", 0.45],
    ["d3", "Each part has a character.", 0.35],
  ],
  // 6. Identity
  [
    ["i1", "The parts turn towards each other.", 0.45],
    ["i2", "The veins meet at one point.", 0.4],
    ["i3", "One coherent form.", 0.4],
  ],
  // 7. Ecosystem
  [
    ["c1", "Stepping back.", 0.4],
    ["c2", "New growth around it.", 0.5],
    ["c3", "Connected, and still growing.", 0.6],
  ],
];

export type Beat = { id: string; label: string; chapter: number; start: number; end: number };

export const BEATS: readonly Beat[] = (() => {
  const out: Beat[] = [];
  let at = 0;
  CHAPTERS.forEach((beats, chapter) =>
    beats.forEach(([id, label, d]) => {
      out.push({ id, label, chapter, start: at, end: at + d });
      at += d;
    }),
  );
  return out;
})();

export const TOTAL = BEATS[BEATS.length - 1].end;

const byId = new Map(BEATS.map((b) => [b.id, b]));
export const beat = (id: string) => {
  const b = byId.get(id);
  if (!b) throw new Error(`Unknown beat ${id}`);
  return b;
};

/** Each chapter's span on the timeline. */
export const CHAPTER_SPANS: readonly [number, number][] = CHAPTERS.map((_, c) => {
  const own = BEATS.filter((b) => b.chapter === c);
  return [own[0].start, own[own.length - 1].end];
});

/** The beat on screen at t. */
export const beatAt = (t: number) => BEATS.find((b) => t < b.end) ?? BEATS[BEATS.length - 1];

/** Step labels per chapter, for the static layout. */
export const stepsFor = (chapter: number) => BEATS.filter((b) => b.chapter === chapter).map((b) => b.label);

/** Smooth step, clamped. */
export const smooth = (a: number, b: number, x: number) => {
  if (b <= a) return x >= b ? 1 : 0;
  const k = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return k * k * (3 - 2 * k);
};

/** Linear progress, clamped. */
export const linear = (a: number, b: number, x: number) => (b <= a ? (x >= b ? 1 : 0) : Math.min(Math.max((x - a) / (b - a), 0), 1));

/**
 * Progress (0–1) of a beat, or of a run of beats from `from` to `to`. Actions fill the middle of
 * their beat (10%–90%), so each beat begins and ends on a readable, still state.
 */
export const progress = (t: number, from: string, to = from, ease = true) => {
  const a = beat(from);
  const b = beat(to);
  const s = a.start + (a.end - a.start) * 0.1;
  const e = b.end - (b.end - b.start) * 0.1;
  return ease ? smooth(s, e, t) : linear(s, e, t);
};

/** Piecewise-linear value through [beatId, value] points, each at the end of its beat. */
export const through = (t: number, points: readonly (readonly [string, number])[]) => {
  const xs = points.map(([id]) => beat(id).end);
  if (t <= xs[0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (t <= xs[i]) {
      const k = smooth(xs[i - 1], xs[i], t);
      return points[i - 1][1] + (points[i][1] - points[i - 1][1]) * k;
    }
  }
  return points[points.length - 1][1];
};
