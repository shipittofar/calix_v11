export type Stage = {
  id: string;
  label: string;
  title: string;
  body: string;
  /** Stage 4: the dimensions of a brand, highlighted one by one as the branches extend (beat ids in DISCIPLINE_BEATS). */
  disciplines?: string[];
};

/**
 * The seven stages of "From one idea to a living brand": their words. The growth that shows each
 * step is drawn in mineral.ts, and the steps themselves are in beats.ts.
 */
export const stages: Stage[] = [
  {
    id: "origin",
    label: "Origin",
    title: "It begins as one possibility.",
    body: "Every brand starts as a single idea: small, unformed, and full of what it could become.",
  },
  {
    id: "awakening",
    label: "Awakening",
    title: "The idea starts to move.",
    body: "Questions open it up. What it could be begins to take shape from the inside.",
  },
  {
    id: "foundation",
    label: "Foundation",
    title: "Roots before branches.",
    body: "Research, understanding and strategy: the work underneath that holds everything else up.",
  },
  {
    id: "expansion",
    label: "Expansion",
    title: "It grows in every direction.",
    body: "Each dimension of the brand develops from the same core:",
    disciplines: ["Strategy", "Creativity", "Design", "Communication", "Positioning"],
  },
  {
    id: "differentiation",
    label: "Differentiation",
    title: "Each part finds its character.",
    body: "Shapes, surfaces and tones become distinct. This is where personality appears.",
  },
  {
    id: "identity",
    label: "Identity",
    title: "Many parts, one language.",
    body: "The pieces align into a coherent identity, recognisable wherever it appears.",
  },
  {
    id: "ecosystem",
    label: "Ecosystem",
    title: "A brand keeps growing.",
    body: "Not a logo or a finished file, but a living system of relationships, experiences and possibilities.",
  },
];

/** The beat at which each of stage 4's disciplines becomes active, in the same order. */
export const DISCIPLINE_BEATS = ["e1", "e2", "e2", "e3", "e3"] as const;
