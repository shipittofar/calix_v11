# CALIX — Scroll story prototype, all seven chapters (14 November 2026)

**Status:** prototype for review. Chapters 1–3 approved for building ("Yes, prototype 1–3"), tuned ("Tune 1–3 first"), then chapters 4–7 built ("Build 4–7"). Nothing on the website was changed. No images were generated, nothing was spent, nothing was deployed.

**Open:** run the `prototypes` server (`.claude/launch.json`) and go to `http://localhost:4173/cinematic-scroll/`. `?u=5.5` opens any moment of the story (in screen heights, 0–11.3).

## What it is

The 7-stage direction built as one pinned stage with a single scrubbed GSAP ScrollTrigger timeline (GSAP 3.12.5 from cdnjs, `scrub: 1`). Every visual and every line of text is a pure function of scroll position, so scrolling back reverses everything exactly. One golden light thread runs through the whole story: seed, sprouts, vein pulses, falling strands, roots, the ground line and its five points, the climbing service filaments, three forms, their convergence, and the final network.

Total scroll: **11.3 screen heights** (the proposal estimated about 10.8; Services was lengthened from 2.5 to 3.0 so each service's text holds for about a third of a screen).

| Chapter | Scroll | What happens |
|---|---|---|
| 01 Origin (hero) | 0–1.2 | On load the seed ignites; headline readable at once (never gated). Scrolling widens a pool of light across storyboard panel 01 and pushes the camera in; tendrils sprout from the seed; the text leaves through word masks; the camera dives into the seed until the screen turns to gold light. |
| 02 Awakening | 1.2–2.8 | awakening-veins arrives from that light (match cut on the vein centre), settles, pans; light grows along the real veins and pulses run along them with the scroll; the positioning text enters, holds and leaves; strands pour downward, the camera follows them and the image dissolves through grain. |
| 03 Foundation (process) | 2.8–4.4 | The strands become roots growing down from the same points; each of the four process steps appears as its root reaches its node; panel 04 rises beneath as the ground; the roots settle into a ground line where five points ignite. |
| 04 Services | 4.4–7.4 | The Foundation fades; "Five services, planned together." enters. For each service in turn, a filament climbs from its point on the ground line, traces a window of light and opens it onto a storyboard panel (06, 07, 08, 09, 03); the service's number, name, line, descriptor and link enter beside it, hold, and leave as the window folds back. The five points stay labelled along the line as a progress index; the active one brightens. Windows showing panels 07–09 carry "Illustration, not client work". |
| 05 Work | 7.4–8.9 | The five points rise off the line and flow into **three distinct luminous forms**: a lens of nested loops, an orb that turns with the scroll, a spiral vortex; each at its own depth and parallax speed, over a faint panel 05. "Selected work" states the approval rule; each form carries "Project 0N · awaiting an approved project". No client work is shown. |
| 06 Identity | 8.9–10.1 | The three forms spiral inward to one point, flash, and the light recedes; the **real CALIX logo file** (`calix-primary-reversed.png`) appears on calm espresso ground, with no glow or effect on it and nothing drawn in its clear space; the credibility rules enter beside it. |
| 07 Ecosystem | 10.1–11.3 | From the logo's place a living network grows across the screen (S-curved connections, fine tendrils, the seven chapter names on its nodes) while the camera pulls back; panel 10 (the figure over the landscape) opens behind it; "Tell us what you are building." and Start a Project arrive and stay; the page then releases. |

Chapter rail at the bottom with all seven chapters (click to jump; numbers only below 1100 px). Header and CTAs never animate in.

## Files

- `prototypes/cinematic-scroll/index.html`: the prototype (Canvas 2D for the world and light, DOM for text and the logo).
- `prototypes/cinematic-scroll/build_assets.py`: makes the prototype's own image copies in `img/` and traces the gold veins of awakening-veins into `veins.json` (preview in `veins-trace-preview.jpg`). It checks the source's SHA-256 before and after: the original is read only.
- Images in `img/`: `origin.webp` (panel 01), `foundation.webp` (panel 04), `panel-03/05/06/07/08/09/10.webp` (AI-upscaled storyboard panels), `veins.webp` (2048 px copy of the untouched awakening-veins source, prototype only), and copies of the real logo files `wordmark-ivory.png` and `calix-primary-reversed.png` (from the calix-logo assets).

## Behaviour

- **Phones (< 760 px):** same timeline; fewer filaments and network nodes; text stacked at the bottom; one process step at a time in a card; services show number, name and line; work slot labels hidden (the approval rule stays in the body text); logo above the credibility rules; canvas capped at 1.25× pixel density (1.5× on desktop).
- **Reduced motion, screens under 520 px high, no JavaScript:** no pin and no canvas; a static story of all seven chapters with images, the logo and all text.
- **awakening-veins:** shown only with camera movement, a light grade, a text scrim and light drawn on top. Files unchanged (SHA-256 `e9a790c3…` source, `a64fff6e…` web).
- **Content rules kept:** no invented clients, projects, results or testimonials; the "MINERAL" panels are labelled as illustration; copy is the site's existing copy.

## Checked

In the built-in browser at 1440 × 900 and 390 × 844, by rendering fixed moments across all seven chapters (including the hand-offs at 4.25, 4.72, 7.55 and 9.42): no console errors, no horizontal overflow, text legible at every resting point. With real scrolling the scrubbed timeline followed the scroll forward and back (checked on chapters 1–3). Static fallback shown when motion is off.

Fixed during the build: the third work form read as a flower (replaced by a spiral vortex; all forms given an irregular, living wobble); the ecosystem network read as a constellation diagram (S-curved connections and tendrils added, fewer nodes); the Foundation title card stayed visible as an empty box on phones in later chapters; the identity flash was oversized.

**Not verified:** smoothness and frame rate. The browser pane was hidden, which pauses animation frames, so the scrub smoothing could not be watched. Also not tested: tablet width, Safari, Firefox, real phones, CPU throttling.

## Tuning pass on chapters 1–3 (owner: "Tune 1–3 first")

- Roots, sprouts and strands grow with smooth, continuous curvature at a finer step, with tapering side rootlets; trunks ease into their step nodes. They no longer read as lightning.
- Origin sprouts: fewer, finer, longer tendrils. The dive zooms 9× instead of 16× and the light takes over earlier.
- Grain dissolve out of Awakening: a clear front with a grainy fringe.
- Phones: the Foundation title sits on its own card.

## Tuning pass on chapters 4–7 (owner: "Tune 4–7")

Checked the hand-off moments between scenes and fixed what they showed:
- **Identity:** the three forms no longer shrink to a dot. They overlap into one composite form (lens, orb and vortex turning faster as they merge) at the logo's place; a smaller, briefer flash then gives way to the logo.
- **Ecosystem:** the first connections from the centre formed a plus sign that read as a cross symbol. The network now opens as an organic burst of long tendrils from the identity's place, and the connections leaving the centre curve strongly; edges start just after the burst.
- **Phones:** network labels flip to the left of their node near the right edge, so none are cut off.
- Re-checked at 1440 × 900 and 390 × 844 (moments 5.13, 9.05, 9.3, 10.25, 10.45, 11.3): no console errors, no horizontal overflow.

## Known issues

- Smoothness while scrolling is not verified (see above).
- The palette checker flags the canvas light falloffs and masks (palette colours and black at partial alpha); they are light, not UI fills, and need the owner's sign-off as an exception if kept.
