import { palette } from "@/lib/palette";

/**
 * The hero's architectural figure: a blank ground in axonometric projection with one Gold point
 * and its direction: one idea on an open ground, which the brand story below (components/home/story)
 * grows into a living system. Decorative only.
 */
const COS = Math.cos(Math.PI / 6);
const EXTENT = 300;
const STEP = 100;
const p = (x: number, y: number, z = 0) => `${((x - y) * COS).toFixed(1)},${((x + y) * 0.5 - z).toFixed(1)}`;

export function HeroGround({ className }: { className?: string }) {
  const lines: string[] = [];
  for (let i = -EXTENT + STEP; i < EXTENT; i += STEP) {
    lines.push(`M${p(i, -EXTENT)}L${p(i, EXTENT)}`, `M${p(-EXTENT, i)}L${p(EXTENT, i)}`);
  }
  const edge = `M${p(-EXTENT, -EXTENT)}L${p(EXTENT, -EXTENT)}L${p(EXTENT, EXTENT)}L${p(-EXTENT, EXTENT)}Z`;
  const w = EXTENT * 2 * COS + 8;
  return (
    <div className={className} aria-hidden="true">
      <svg viewBox={`${-w} ${-EXTENT - 150} ${w * 2} ${EXTENT * 2 + 160}`} className="hero-ground" role="presentation">
        <path d={lines.join("")} fill="none" stroke={palette.travertine} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={edge} fill="none" stroke={palette.espresso} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={`M${p(0, 0)}L${p(0, 0, 140)}`} fill="none" stroke={palette.gold} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <circle cx={0} cy={0} r={7} fill={palette.gold} />
      </svg>
    </div>
  );
}
