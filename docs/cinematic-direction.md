# CALIX — Cinematic direction (revised brief, 13 November 2026)

**Superseded on 14 November 2026 by the storyboard build (`docs/storyboard-direction.md`).** Earlier status:  **Direction C, Nocturne, approved by the owner (13 November 2026) and built (Step 5).** The home page now runs the seven stages as described below. Imagery: AI-generated set installed 13 November 2026 (`docs/cinema-image-prompts.md`, "Generated set").
**Files:** `prototypes/cinematic/index.html` (direction board), `prototypes/cinematic/prototype.html` (working prototype, built from `prototype.src.html` by `python prototypes/cinematic/build.py`, which inlines the live shader from `components/home/story/mineral.ts`). Run the `prototypes` server in `.claude/launch.json` and open `/cinematic/`. Also published as a private claude.ai page.

## 1. Reference analysis

Source: nine distinct frames from a phone recording of the reference site (six TikTok end cards and twelve duplicates discarded). Motion itself was not visible; pacing and scroll coupling are inferred from frames caught mid-transition.

Techniques read: full-bleed image compositions with small type; an **object-led wipe** (a drape in the picture becomes the transition mask); **grain dissolves** (stippled edges, not fades); **push-ins** that change drawing style on the way in (engraving to colour photograph); hard editorial crops with large negative space; a colour field rising through a grainy edge; macro detail shots; and, most important, **one recurring object** carried through every scene.

## 2. Motion system

| Transition | Technique | Use | Scroll |
|---|---|---|---|
| T1 Diagonal wipe | Slanted clip-path edge across the screen | Light to light; a change of idea | 60–80vh |
| T2 Object-led wipe | An element of the image becomes the mask | Signature cut, at most twice per page | 80–100vh |
| T3 Grain dissolve | Stippled threshold mask from an edge (2px grain) | Light to dark and back | 70–90vh |
| T4 Push-in match cut | Image scales past its frame; next scene starts at that scale | Moving closer to the same subject | 80–120vh |
| T5 Layered panels | Slanted panels at different speeds, contracting or expanding to full bleed | One idea becoming facets | 100–140vh |
| T6 Plate contraction | Full bleed contracts into a framed plate | Ending an act | 60–70vh |

Rules: scroll drives scene changes; headline reveals are triggered once (masked lines, 0.9–1.1 s, power3.out); text leaves before an image transition and arrives after it; CTAs and the header never animate; ambient zoom 1.12 → 1.0, pans ≤ 4%, three parallax speeds; scrub smoothing 0.8 s. Reduced motion and no JavaScript: every scene a full-height still, all text visible.

**Stages across the page:** Act I (pinned) Origin = hero, Awakening = positioning, Foundation = how we work; Act II (pinned) Expansion = five services, Differentiation = selected work; Identity = credibility (calm editorial section); Act III Ecosystem = final CTA.

## 3. Directions

- **A · Gallery** (recommended, prototyped): sculpture, stone, plaster and gold on ivory, with a dark strata room for Foundation. Mineral renders as exhibited pieces.
- **B · Archive:** specimen plates, engravings pushing into colour macro photography, catalogue numbering; olive, sage, clay.
- **C · Nocturne:** dark espresso chapters in raking light with gold veins, alternating with ivory pauses; light-slit reveals.

## 4. Prototype (Direction A)

One pinned act: Origin (seed on travertine, masked headline, push-in) → diagonal wipe → Awakening (slanted triptych at three speeds, word-masked headline, expansion to full bleed) → grain dissolve → Foundation (dark strata, roots, labels along drawn lines) → plate contraction with the "04 Expansion" mark. GSAP 3.12.5 and ScrollTrigger from cdnjs. Images are placeholders (Mineral renders and generated textures), labelled.

Checked in Chromium at about 800 px and 390 × 844: no horizontal overflow, correct state when scrolling back. Fixed during testing: scroll exit capturing the load animation's start value (explicit `fromTo`), scene text escaping its layer (`isolation: isolate`), root curves looping. Not tested: Safari, Firefox, real phones, reduced motion (static path reviewed in code only), frame rate under throttling.

## 5. Decisions before Step 5

1. Direction: A, B, C, or a mix.
2. Imagery source: AI-generated, licensed stock, commissioned shoot, the owner's photographs, or mainly renders and textures.
3. Add GSAP + ScrollTrigger as a dependency (~70 KB compressed). No Lenis.
4. Page order: process moves before services (Foundation before Expansion).
5. The Mineral story becomes a supporting element instead of a long pinned sequence.
6. Brand rules: the motion skill's limits on pins and 3D, and the palette additions, are owner-approved exceptions to record in `docs/design-system.md` when the build starts.

## 6. Build record (Step 5, Nocturne)

**Page order** (`app/page.tsx`): Act I (Origin = hero, Awakening = positioning, Foundation = process steps), an ivory pause (how we work together), Act II opening (blade wipe into the services index), five services, Differentiation (selected work, approved projects only), Identity (credibility), Ecosystem, then the unchanged olive enquiry band (`FinalCta`).

**Code:**
- `components/home/cinema/Acts.tsx`: server-rendered scenes, all content readable without motion. Stage words come from `components/home/story/stages.ts`; services, process, work and credibility copy are unchanged.
- `components/home/story/StoryPlayer.tsx`: the GSAP 3.12.5 + ScrollTrigger controller (pinned Act I and blade wipe; scrubbed reveals elsewhere; word-mask headlines). `grain.ts`: the stippled dissolve. `Story.tsx`: the story marker and player. `StorySlot` keeps the off switch: with `STORY_PREVIEW=false` there is no marker and the page is fully static.
- `app/cinema.css`: static layout first; motion rules only under `html[data-cinema="on"]:has([data-story-root])`.
- `lib/motion.ts`: `CINEMA_MOTION_QUERY` and the pre-paint flag, which drops itself after six seconds if the controller never starts.
- Retired from the home page: the pinned Mineral story (previous `Story.tsx` and `StoryPlayer.tsx` kept at `prototypes/archive/story-mineral/`), the S1 services sequence (`Sequence.tsx`, still in the repository) and the old hero (`Hero.tsx`, still in the repository). The `.story__*` rules in `app/components.css` are now unused.

**Motion as built:** slit-of-light opening on load (the headline is never gated); push-in; diagonal line splitting open (T1); slanted panels at three speeds (T5); grain dissolve into Foundation (T3); blade-led wipe into Act II (T2); diagonal reveals and parallax for each service; a single-image triptych for Differentiation; grain clearing from dark to ivory for Identity; push-out for Ecosystem. CTAs and the header never animate. No Lenis.

**Fallbacks:** reduced motion, viewports shorter than 520px, no JavaScript, a controller that fails to start within six seconds, and `STORY_PREVIEW=false` all give the static layout (every scene a full-height still, all text visible).

**Imagery (placeholders):** `public/cinema/*.webp`, 14 files (about 740 KB), rendered from the Mineral shader and generated textures by `prototypes/cinematic/render-assets.html` (built by `build.py`; saving needs a small local upload server, see the file). Each file is a photography slot: replace it with an approved photograph or render of the same name and similar proportions, no code change needed. **Imagery source chosen: AI-generated** (13 November 2026): prompts per slot in `docs/cinema-image-prompts.md`; save picks to `assets/cinema-src/<slot>.png` and run `python scripts/prepare_cinema_images.py` (crops to each slot's focus point, resizes, colour-matches the set, keys out a flat background for the blade, writes WebP).

**Checked (13 November 2026):** Chromium in the built-in browser at about 800 × 720, 1440 × 900 and 390 × 844: all Act I frames, the blade wipe, services, work, identity, ecosystem and the enquiry band; no horizontal overflow; scrolling back restores earlier scenes; static fallback at 1200 × 500 shows every scene. `npm run typecheck`, `npm run lint`, `npm run check:story`, `npm run build` and `check-story output .next public` pass; the palette checker reports only the two approved page gradients. Fixed in testing: Foundation's rule and the closed Awakening line showing through earlier scenes, the hero seed under the headline at narrow widths, Awakening copy centring over the panels, steps overflowing short screens, oversized service images on tablets, repeated work panels.

**Not yet tested:** Safari, Firefox, real phones, frame rate under CPU throttling, screen readers, a `STORY_PREVIEW=false` build. The unit-test failures noted earlier (Windows environment) are unchanged.
