# CALIX — Motion art direction (brand story revision 3)

**Status:** **Direction B, Mineral, approved by the owner (13 November 2026) and built** (Step 4): see `docs/olive-story.md`, "Revision 3". The owner's choice also approves Mineral's added colours; the brand exceptions are recorded in `docs/design-system.md` §5. Technology: raw WebGL, no library.
**Prototype:** `prototypes/origin-studies/index.html` (run the `prototypes` entry in `.claude/launch.json`, then open `/origin-studies/index.html`). Also published as a private claude.ai page.
**Supersedes, once approved:** the construction-drawing story in `docs/olive-story.md`.

## 1. The brief, in one line

Keep the seed-to-tree meaning; drop the olive narrative and the rigid geometric 3D. Show a brand growing like a living system, through abstract, nature-inspired, sculptural 3D on the existing site background, in seven continuous stages: Origin, Awakening, Foundation, Expansion, Differentiation, Identity, Ecosystem.

## 2. Analysis of the current implementation

| Keep | Why |
|---|---|
| `StoryPlayer.tsx` scroll engine: sticky stage, scroll position → timeline, 90 ms follow, renders only while visible | Never intercepts scrolling; already proven in QA |
| Stateless frame contract (`draw(t)`) | Scrubbing back, deep links and stills keep working when the renderer changes |
| Captions as HTML, Gold progress rule, skip link | Meaning never depends on the animation |
| Reduced-motion and short-screen stills, no-JS text | Accessibility fallbacks stay as they are |
| `STORY_PREVIEW` switch and `scripts/check-story.mjs` | The story can still be turned off and verified |
| Page ground (Ivory → Travertine) | The brief says keep the background |

| Redesign | Change |
|---|---|
| `plate.ts` (2D axonometric canvas) | Replaced by an organic 3D renderer |
| `beats.ts` (44 beats, 8 chapters) | 7 stages, fewer and longer transformations |
| `stages.ts` copy | Rewritten around the seven growth stages |
| Story length (~10 viewports) | ~6–7 viewports |

## 3. The three directions

All three tell the same story; only the visual execution differs. Full notes, colours, references and stage-by-stage evolution are in the prototype page.

| | A · Kiln | B · Mineral | C · Filament |
|---|---|---|---|
| Idea | A made object: matte ceramic seed opening along gold seams | Accretion: frosted translucent stone with inner gold veins, growing in rings and blades | A living thread: a cocoon of filaments unwinding into roots and shoots |
| Materials | Stoneware, satin clay glaze, burnished gold, waxy olive | Frosted mineral, translucent blades, gold veins | Satin threads, gold spores |
| Added colours (artwork only) | Muted clay #B07A62, moss #6B7448 | Muted sage #9AA58A, deep forest #2F3A2A, mineral grey #8E877C | Moss #6B7448, muted bronze #8C6A43 |
| Rendering | WebGL signed-distance shader, opaque | WebGL shader with translucency (heaviest) | 2D canvas, projected 3D lines (lightest) |

**Recommendation:** A · Kiln, borrowing Mineral's inner gold veins for Stage 05 (Differentiation).

## 4. Decisions needed before Step 4

1. **Direction:** A, B, C, or a named mix.
2. **Added colours:** approve the additions for the chosen direction. They appear only inside the artwork, never in text, controls or layout (`calix-brand` allows off-palette colours only on explicit request).
3. **Brand rule exception:** the design system and the `calix-brand` / `scroll-storytelling` skills rule out gradients, shadows, heavy 3D and particles. The owner's brief overrides these for the story artwork; record it in `docs/design-system.md` §5 when the build starts.
4. **Technology:** raw WebGL with a signed-distance shader (about 10–15 KB, no dependency) is recommended over three.js (about 150 KB compressed).

## 5. Risks for the full build

- **GPU cost on phones.** Mitigation: adaptive resolution (already in the prototype), rendering only while visible, a simplified mobile shader, stills on low-power devices.
- **Pin length.** The skill recommends short pins; seven stages at ~6–7 viewports is the owner's signature moment and keeps the skip link.
- **Prototype limits.** Prototypes cover Stages 01–02 only and were checked in Chromium at desktop and 390px width. Not yet checked: Safari, Firefox, real phones, frame rate under CPU/GPU throttling.
