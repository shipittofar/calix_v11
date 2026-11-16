# CALIX — Plan: building the scroll story into the website (14 November 2026)

**Status:** approved by the owner on 14 November 2026 ("Approve, start phase 1"), with all four decisions below. All five phases built; done gate passed on 14 November 2026 (see "Phase 5 record"). Source: the approved prototype (`prototypes/cinematic-scroll/`, record in `docs/scroll-story-prototype.md`). No new images, no spend, no deployment.

## Goal

Replace the current home-page story (storyboard plates in a sticky frame, `components/home/cinema/Scenes.tsx`) with the seven-chapter scroll story: Origin, Awakening, Foundation, Services, Work, Identity, Ecosystem. It should look and move exactly as the prototype does, and meet the site's standards: server-rendered content, accessibility, performance, security policy and content rules.

## What carries over unchanged

- One pinned stage and one scrubbed GSAP ScrollTrigger timeline. Every visual is a pure function of scroll position, so it reverses naturally. GSAP 3.12.5 is already a dependency; no new packages.
- The timeline and its numbers (11.3 screen heights), the light engine (filaments, glow, roots, forms, network), the cameras and the chapter choreography.
- The site's existing safety switches: the pre-paint motion flag with its 6-second fallback (`lib/motion.ts`), the `STORY_PREVIEW` off switch (`StorySlot`), and static layout first, with motion only under `html[data-cinema="on"]`.

## What changes from the prototype

| Prototype | Website |
|---|---|
| One HTML file, plain JS | TypeScript modules plus a client component, loaded lazily so the home page's first paint doesn't wait for it |
| Copy written into the HTML | Copy from the content files: `content/services.ts`, `content/process.ts`, `content/site.ts` (`primaryCta`), settings (`replyTime`); work shown only through the existing approval gate (`workGateMet`, `featuredProjects`) |
| Images from `img/` | Website masters in `public/cinema/` (scene-NN.webp, already 1080 × 1805), requested through the Next.js image optimizer at the size the canvas needs (AVIF/WebP, quality 85) |
| Text hidden with `visibility: hidden` between chapters | Text stays in the accessibility tree (opacity only). When keyboard focus enters a chapter, the page scrolls to that chapter's resting point, so a focused link is never invisible |
| `?u=` debug hook | Dev builds only |
| Canvas font "Jost" by name | The font family read from the `next/font` CSS variable |
| Tablet (768–1099 px) untested | Its own layout pass: desktop composition with narrower text columns |

## File plan

- `components/home/story/engine/`: `math.ts` (easing, seg, rng), `paths.ts` (paths, filament, glow), `cameras.ts`, plus one module per chapter: `origin.ts`, `awakening.ts`, `foundation.ts`, `services.ts`, `work.ts`, `identity.ts`, `ecosystem.ts`. Each draws from `(u, ctx, layout)` only.
- `components/home/story/StoryStage.tsx` (client): canvas, resize handling, ScrollTrigger pin and scrub, the text controller, the chapter rail, the focus handling.
- `components/home/story/StoryPlayer.tsx`: lazily loads `StoryStage` when motion is allowed; renders nothing otherwise.
- `components/home/cinema/Chapters.tsx` (server, replaces `Scenes.tsx` on the home page): the seven chapters as semantic sections (h1 in Origin, h2 per chapter) with ids `services`, `process`, `work` and `credibility`. This is the static story and the text layer the stage animates; there is one copy of the content, not two.
- `app/cinema.css`: rewritten for the seven chapters: the static layout first, motion positions under the motion flag.
- `public/cinema/veins.json`: the traced vein paths. `scripts/build_web_images.py` gains a slot for the full-size awakening-veins web file (see decision 1).
- Archived (the project has no git): the current `Scenes.tsx` story and its CSS go to `prototypes/archive/story-storyboard/`; the ambient plate loops are removed.
- `scripts/check-story.mjs`: updated guardrails: the story marker is present, all seven chapter ids exist, the copy is in the server HTML, no images outside the approved set, and awakening-veins checksums are unchanged.

## Anchors and navigation

`/#services`, `/#process` and `/#work` (used by the 404 page, the thank-you page and others) and `#credibility` land on the matching chapter's resting point inside the pinned story, not at the top of the pin. The chapter rail and the header stay usable throughout; the header and CTAs never animate in.

## Accessibility, SEO and performance

- **Server-rendered:** all text, links and headings are in the server HTML in reading order. The h1 is visible on first paint and never gated.
- **Fallbacks:** reduced motion, screens under 520 px high, no JavaScript, a controller that fails to start and `STORY_PREVIEW=false` all give the static seven-chapter layout with every word visible.
- **Images:** the canvas has `aria-hidden`; meaningful images keep alt text (the logo as `alt="CALIX"`).
- **Load cost:** the story code (about 25 KB plus GSAP) loads after first paint. Images load one chapter ahead; the canvas pauses when off screen and caps pixel density at 1.5× on desktop and 1.25× on phones.
- **Targets:** LCP under 2.5 s, CLS 0, no long tasks over 50 ms while scrolling at 4× CPU slowdown. Measured with Lighthouse and a performance trace, not assumed.
- **Security policy:** fits the current CSP (images and data from 'self'; style changes from script are allowed). No inline style attributes in the server HTML.

## Content rules kept

No invented clients, projects, results or testimonials. Work forms show approved projects only, otherwise "awaiting an approved project". The "MINERAL" panels carry "Illustration, not client work". The logo is the real file, with no effects, inside its clear space. awakening-veins files are never written.

## Phases

1. **Engine port:** TypeScript modules, StoryStage and lazy loading; chapters 1–3 on the real page behind `STORY_PREVIEW`. Check: renders match the prototype at 1440 and 390.
2. **Chapters 4–7:** content from the content files, the work gate, anchors, the rail, focus handling.
3. **Layouts:** tablet pass; short screens; the static fallback styled for all seven chapters.
4. **Quality pass:** the `calix-visual-qa`, `accessibility-audit`, `web-performance`, `technical-seo` and `calix-geo` skills; fixes.
5. **Done gate** (per CLAUDE.md): `npm run typecheck`, `npm run lint`, `npm run check:story`, `npm run build` (dev server stopped), the output check, screenshots at 1440, 768 and 390, the palette checker on the built CSS, docs updated (`storyboard-direction.md` superseded, `image-spec.md`, `design-system.md`).

Real-browser testing that still needs a person: Safari, Firefox, a real iPhone and Android phone, and watching the scroll smoothness, because the built-in browser pane pauses animation while hidden.

## Decisions needed before building

1. **A full-size awakening-veins web file.** A new, separately named file (`public/cinema/awakening-veins-full.webp`, 2048 px) made from the untouched source, for the full-screen Awakening chapter. The existing awakening-veins files stay exactly as they are.
2. **Brand exception for the canvas light.** The light falloffs use palette colours at partial transparency and soft gradients drawn on the canvas, which the palette checker flags. Approve them as a light-only exception (recorded in `design-system.md`); CSS stays pure palette.
3. **Scroll length:** 11.3 screen heights as in the prototype, or shorter.
4. **Retire the current storyboard home page** (archived, not deleted) once the new story passes the done gate.

## Decisions (approved 14 November 2026)

1. `public/cinema/awakening-veins-full.webp` made from the untouched source (`docs/image-spec.md`).
2. Canvas light exception recorded in `docs/design-system.md` §5.
3. Scroll length 11.3 screen heights.
4. The storyboard home page is retired once the new story passes the done gate. Its files were copied to `prototypes/archive/story-storyboard/` at the start of phase 1; `components/home/cinema/Scenes.tsx` is no longer rendered and is removed from the source tree at the done gate.

## Phase 1 record (14 November 2026)

**Built:**
- `components/home/story/engine/`: `math.ts`, `paths.ts`, `light.ts`, `world.ts`, `origin.ts`, `awakening.ts`, `foundation.ts`, `stage.ts`, `veins.json`. A TypeScript port of the prototype's chapters 1–3, unchanged in look and timing.
- `components/home/story/StoryPlayer.tsx`: loads the engine as a separate chunk only when CINEMA_MOTION_QUERY matches; stops it and restores the static layout when the query stops matching.
- `components/home/cinema/Chapters.tsx`: server-rendered chapters 1–3 inside the stage (h1 in Origin, process steps in Foundation with `id="process"`), the "How we work together" band, and chapters 4–6 as static sections (`#services`, `#work`, `#credibility`) until phase 2. `app/page.tsx` renders `StorySlot`, `Chapters` and `FinalCta`.
- `app/cinema.css`: rewritten for the new story (static first, motion under the flag).
- Behaviour: one pinned stage below the sticky header (its height is the screen minus the header), scrubbed over 4.4 screen heights. Text fades but stays in the accessibility tree; links in hidden text do not take clicks; keyboard focus entering a hidden chapter scrolls to it; the chapter rail jumps to each chapter; `/#process` and in-page links land on the chapter's resting point (including after Next.js's own hash scroll); `__seek(u)` in development only.

**Checked:**
- `npm run typecheck`, `npm run lint`, `npm run check:story` (24 checks), `npm run build` and `check-story output .next public` pass. The 7 build warnings come from `lib/admin/audit.ts` (existing code), not the story.
- The palette checker reports 0 issues in `app/cinema.css`. The built CSS's remaining flags are Tailwind's base reset and the two page gradients approved earlier.
- The server HTML contains the hero and Foundation copy. awakening-veins checksums are unchanged.
- In the built-in browser at 1440 × 900, 768 × 1024 and 390 × 844: the story renders as in the prototype, with no horizontal overflow and no story errors in the console. With a viewport under 520 px high (as with reduced motion), the engine stops and the static chapters show with their stills and no leftover inline styles. `/#process` lands at u = 3.951 of 3.95 on desktop.

**Known issues for later phases:**
- On the emulated phone, `/#process` landed at u = 4.15, still inside Foundation, because the emulator resized the page during load. To retest on a real phone.
- Scroll smoothness is not watched yet (the built-in browser pauses animation while hidden).
- Chapters 4–7 are static sections until phase 2. The static chapter layout is functional but not yet design-polished (phase 3).

## Phase 2 record (14 November 2026)

**Built:** all seven chapters now play in the one pinned stage over 11.3 screen heights.
- Engine: `services.ts` (climbing filaments, windows of light, panels 06/07/08/09/03), `work.ts` (three forms, their convergence and the flash), `ecosystem.ts` (the network, chapter labels in Jost from the `next/font` variable, panel 10). `stage.ts` extends the timeline and places the DOM layers: the ground line's point labels, the "Illustration, not client work" note beside the window (panels 07–09), the work slot labels, and the real logo.
- `Chapters.tsx`: chapters 4–7 moved into the stage. Services: five blocks with their own resting points and anchors (`#brand`, `#digital`, `#marketing`, `#discoverability`, `#growth`). Work (`#work`): with no approved projects it uses the site's gap notice copy and "Ask about relevant work"; approved projects (gate G1) would appear as links under the forms. Identity (`#credibility`): the real logo file `public/brand/calix-primary-reversed.png` (copied from the calix-logo assets), shown as an image with no effects; the canvas dust settles while it shows. Ecosystem: "Everything connects." with Start a Project. The enquiry band (FinalCta, "Tell us what you are building.") follows the story unchanged, so the chapter uses a different heading to avoid repeating it. "How we work together" moved after the story.
- Development-only content placeholders (`.cx-static-only`) show in the static layout only; motion-only layers (`.cx-motion-only`) only in motion.
- Chapter rail with all seven chapters.

**Checked:**
- `npm run typecheck`, `npm run lint`, `npm run check:story`, `npm run build` and the output check pass. The palette checker reports 0 issues in `app/cinema.css`.
- The server HTML contains every chapter's copy, the logo and the illustration label. awakening-veins checksums are unchanged.
- In the built-in browser at 1440 × 900: all seven chapters render as in the prototype. The anchors land on their resting points: `#process` 3.951, `#services` 4.852, `#work` 8.252, `#credibility` 9.802. The first load after a recompile in development landed early once; it was exact on reload.
- At 390 × 844 and 768 × 1024: Services and Ecosystem render with no horizontal overflow.
- Static layout (viewport under 520 px high): motion-only layers hidden, placeholders and stills shown, logo visible, no leftover inline styles, no overflow.

**Found during the build:** a "Can't resolve '@vercel/turbopack-next/internal/font/google/font'" error (HTTP 500 in development, failed builds). Corrected in phase 4: it also happened with the dev server stopped and `.next` fully cleared, and a plain retry passed. It is an intermittent failure of `next/font`'s build-time download of the Google fonts, not a corrupted cache. Safe routine: stop the dev server before `npm run typecheck` or a build (it does disturb the dev cache), `rm -rf .next`, build, and retry the build once if this error appears.

**Open for phase 3 and later:**
- Tablet polish (Identity at 768 not reviewed).
- The static layout's design.
- Real-phone anchor test.
- Watching scroll smoothness.
- Removing `components/home/cinema/Scenes.tsx` and `Acts.tsx` at the done gate.

## Phase 3 record (14 November 2026)

**Layouts:**
- **Portrait tablets** use the phone composition (visual above, text below or at the top), as phones do. The engine (`STACK_QUERY` in `engine/world.ts`) and `app/cinema.css` share one media query: `(max-width: 759px), (max-width: 1099px) and (orientation: portrait)`.
- **Below 1100 px:** one process step at a time in a bottom card; the work slot labels (which would collide) are hidden, and approved projects would list under the copy instead. The Awakening, Foundation and Work text columns are widened.
- **Desktop:** in Foundation, once the next step lights up the previous card folds to its title, so the four cards never overlap; the full text stays available to screen readers (visually hidden, not removed).
- **Short screens (520–760 px tall):** display and title sizes scale with the height; the hero caption is hidden and the hero copy lifted so nothing touches the chapter rail. Below 520 px the static layout applies, as before.

**Static layout design:**
- Chapters read as editorial spreads, with a hairline between chapters and spacing that scales from 64 to 120 px.
- On desktop the still stays in view (sticky) beside long chapters; Identity uses a logo column.
- On phones each chapter shows its image first, then its text.
- The hairline is removed inside the motion stage.

**Development aid:** `?motion=off` previews the static layout at any size (development builds only; absent from the production output).

**Checked:**
- `npm run typecheck`, `npm run lint`, `npm run check:story`, `npm run build` (clean `.next`, dev server stopped first) and the output check pass. The palette checker reports 0 issues in `app/cinema.css`. awakening-veins checksums are unchanged.
- A measured fit test at every chapter's resting point (0, 1.78, 3.95, 4.85, 5.95, 8.25, 9.8, 11.1): every visible line inside the stage, clear of the chapter rail, no horizontal overflow. Passed at 1440 × 900, 1280 × 620, 1024 × 768, 768 × 1024 and 390 × 844. A pairwise overlap test passed at 1440 × 900 (after the step-card fix), 768 × 1024 and 390 × 844.
- Static layout at 390: image above text in each chapter, chapter hairlines present, no overflow.

**Not verified:** scroll smoothness (the built-in browser pauses animation while hidden), Safari, Firefox, real devices. Phase 4 (quality pass) and phase 5 (done gate) remain.

## Phase 4 record: quality pass (14 November 2026)

Reports: `docs/accessibility-audit-home-story.md` and `docs/performance-audit-home-story.md`.

**Accessibility (WCAG 2.2 AA).** Four contrast fixes where text sits over the canvas:
- Awakening, Ecosystem and phone hero scrims became even bands under the whole text column.
- The phone scrims follow the measured text position, so they cover the text on any phone height.
- The scrims are now drawn over the light as well as the photograph; visual QA found the vein filaments crossing the text on phones.
- Worst case now: ivory at least 10.4:1, travertine at least 7.1:1, gold chapter numbers at least 4.5:1.

Two smaller fixes:
- The chapter rail keeps full accessible names on small screens (visually hidden, not removed).
- The rail's buttons are now 44 × 44 px.

Keyboard, focus, headings, reduced motion and landmarks passed.

**Performance** (production build, desktop lab, no throttling):
- TTFB 10–16 ms, CLS 0, no long tasks on load.
- The story engine (57 KB gzip) loads after first paint, only when motion is allowed.
- Chapters 4–7's images now load only once the visitor nears Foundation's end, about 220 KB saved for visits that stop at the hero.
- Adaptive quality: 1× pixel density and lighter filaments if frames average over 14 ms.
- Frame cost measured at 0.7–10.1 ms.

**Technical SEO:** passed with no changes:
- Title 52 characters, description 155.
- Canonical to `https://www.calixeden.com`, no noindex.
- Organization and WebSite JSON-LD parse.
- All chapter copy and internal links in the server HTML.
- Decorative stills with `alt=""`, the logo with `alt="CALIX"`.
- `robots.txt` allows crawling and lists the sitemap.

**GEO light check:**
- The entity is defined in the metadata and schema; services are named consistently; nothing fabricated.
- Proposals for the owner (copy changes, not applied): a one-line definition in the hero ("CALIX builds memorable brands and digital systems designed to grow."), and descriptive lines under the decorative chapter headings.
- The evidence gap (case studies, a named practitioner) remains for CALIX to close.

**Visual QA:** Awakening, Ecosystem and the hero reviewed at 1440 × 900 and 390 × 844 after the scrim changes. Fit and overlap were measured at five sizes in phase 3.

**Checks:** typecheck, lint, check:story, a clean build, the output check and the palette check (0 issues in `app/cinema.css`) pass. awakening-veins checksums are unchanged.

**Not verified:**
- Real-device performance (Lighthouse mobile with 4× CPU throttling, a mid-range Android phone).
- Screen readers (VoiceOver, NVDA).
- Safari and Firefox.
- Scroll smoothness, which the hidden built-in browser pane cannot show.

## Phase 5 record: done gate (14 November 2026)

**Retired:** `components/home/cinema/Scenes.tsx` (the storyboard home page) and `components/home/cinema/Acts.tsx` (the earlier Nocturne home page) are removed from the source tree. Their archived copies are byte-identical, kept as `.txt` so they are not type-checked: `prototypes/archive/story-storyboard/` (Scenes, its StoryPlayer, page, cinema.css) and `prototypes/archive/story-mineral/Acts.tsx.txt`.

**Guardrails extended** (`scripts/check-story.mjs`):
- Every file in `components/home/story/` and `engine/` is type-checked.
- `assets/cinema-src/awakening-veins.png` and `public/cinema/awakening-veins.webp` match their recorded SHA-256.
- The public build's HTML has the story stage, the `#process`, `#services`, `#work` and `#credibility` anchors, and the hero h1.

**Done gate (CLAUDE.md):**
- `npm run typecheck` ✓
- `npm run lint` ✓
- `npm run check:story` ✓: 12 config cases, 15 story files type-checked, wiring, 2 protected files unchanged.
- `npm run build` ✓, from a clean `.next` with the dev server stopped. The first attempt hit the intermittent Google Fonts download error and the retry passed.
- `check-story output .next public` ✓, 9 checks.
- Screenshots at 1440 × 900, 768 × 1024 and 390 × 844 ✓, no horizontal overflow.
- Palette checker: `app/cinema.css` 0 issues. The built CSS reports 10 flags, all outside the story: Tailwind's base reset (transparent, `color-mix`, `red` in a feature test) and the two page gradients approved on 13 November 2026.
- Docs updated: this plan, `storyboard-direction.md` (superseded), `image-spec.md`, `content-gaps.md`, `design-system.md` §5 (canvas light exception), and the accessibility and performance audit reports.

**Left for later (not part of this build):**
- **Unused older story code:** `components/home/story/mineral.ts`, `beats.ts`, `grain.ts` and `stages.ts`, plus the mineral and Nocturne images in `public/cinema/`. `prototypes/cinematic/build.py` still reads `mineral.ts`.
- **Header:** preloads both wordmark variants.
- **GEO copy proposals:** a hero definition line and descriptive lines under decorative headings; the owner's decision.

**Needs a person or real devices:**
- Scroll smoothness.
- Safari and Firefox.
- A real iPhone and an Android phone, including `/#process` landing on a phone.
- Lighthouse mobile with 4× CPU throttling.
- VoiceOver and NVDA.

## Owner review: 01 Origin (14 November 2026)

The owner's notes and what changed:

1. **"The lead paragraph covers the g in Ignore."** Measured: each headline line's mask clipped 4 px off the descender, and only 16 px separated the glyph from the paragraph.
   - The masks on headline and title lines now leave room below the glyphs (0.24 em, offset so the layout doesn't move), and the reveal travel grew to match.
   - The paragraph sits 34 px below the headline.
   - Result: 12 px of clear mask below every glyph and a 30 px gap to the paragraph.
2. **"The chapter bar overlaps the image, same colour as the background."** The boxed bar at the bottom is gone.
   - Desktop and tablet: a slim index at the right edge, with the numbers, the current chapter's name, and a gold progress hairline on an olive line. The other chapters' names are hidden visually only, so every button keeps its full accessible name.
   - Where a bright photograph fills the screen (Awakening, Ecosystem), a soft darkening fades in at the right edge behind the index.
   - Phones: only a 2 px progress hairline along the bottom edge.
   - Foundation's roots moved slightly left on desktop so the last step card clears the index, and Ecosystem's labels flip away from it.
3. **"The image edges look blurred and faded, not blended."**
   - The photograph's darkest tones are lifted to exactly the page colour, so its shadows become the page.
   - Where it ends, it falls off in a soft oval that reaches zero inside its edges, replacing the straight side fades that read as a blurred band.

Checked at 1440 × 900 (by measurement), 1200 × 760 (screenshots), 1024 × 768 and 390 × 844: no glyph clipped, no text over the index, no horizontal overflow. Typecheck, lint, check:story, a clean build, the output check and the palette check pass.

## Owner review: 03 Foundation and the transition into it (14 November 2026)

The owner's notes and what changed:

1. **"The roots look too linear, not neat."**
   - Roots now taper from thick at their start to fine at their tips (drawn in short pieces of decreasing width).
   - Trunks meander on their own slow curve with stronger wander away from the step nodes, and rootlets grow denser toward the ground (`engine/foundation.ts`, `taperedFilament` in `engine/light.ts`).
2. **"The background (stones) is low quality and not set cleanly."**
   - The panel's darkest tones are lifted to exactly the page colour, and it is darker overall.
   - It falls off in a soft oval that reaches zero inside its edges, with a slight softness (1.5 px blur, read as depth of field) that also hides the low resolution.
3. **"The step cards are the same colour as the background."**
   - The cards are now olive (a palette colour) with a 2 px gold edge.
   - Contrast: ivory titles 7.3:1, travertine text 5.0:1. The step numbers are travertine on the cards (gold would be 2.65:1).
4. **"'Five services rise from this line' overlaps '01 Brand'."**
   - On desktop the line now sits just above the ground line, clear of the point labels below it.
   - Below 1100 px it is hidden, because the step card occupies that place at the same moment.
   - The tablet step card now sits above the ground line; the phone card sits below it.
5. **"The transition from 2 to 3 looks pixelated and linear."**
   - The blocky stipple dissolve is replaced. The photograph now clears from the top down along a soft, smoke-like edge, as the camera follows the light down: two octaves of smooth noise plus a vertical bias, a feathered threshold, a coarse mask upscaled smoothly.

**Also fixed (found while checking):**
- Foundation's title and Services' title were half-visible on top of each other around u 4.5. Foundation now finishes leaving before Services enters.
- On tablets and phones, all four step cards reappeared faintly while the chapter faded out. The one-card-at-a-time choice now ignores the chapter fade.

**Checked:**
- An overlap test (text, step cards, ground labels, chapter index) at u 3.4–4.7 passes at 1440 × 900, 1024 × 768 and 390 × 844.
- Screenshots of the roots, cards and the new transition at 1200 × 760.
- Typecheck, lint, check:story, a clean build, the output check and the palette check pass.

## Foundation ground image (15 November 2026)

The owner supplied a new Foundation background: dark soil over luminous gold-threaded strata, with an olive sapling at the top right (`assets/cinema-src/foundation-ground.webp`, 1671 × 941, kept untouched; web master `public/cinema/foundation-ground.webp` from `scripts/build_web_images.py`, slot `foundation-ground`, never enlarged). It replaces storyboard panel 04 in the Foundation chapter and in the static layout.

- **Placement:** full-bleed on desktop and tablet, anchored right so the sapling stays in view; on phones, a wide crop of the slope across the lower half. It settles in (u 2.7–3.1) and recedes to about 40% as the roots gather into the ground line (u 3.95–4.2).
- **Blend:** the layer is composited with `lighten`. Wherever the image is darker than the page, the page shows, so its dark sky becomes the page itself: no veil and no edge. The roots drawn beneath stay visible and weave into the soil wherever the strata are darker than the light. Its top and bottom (and its left side on phones) fall off softly. The image's shaft of light is calmed behind the headline.
- **Roots meet the ground:** the soil surface was measured from the image (`SURFACE` in `foundation.ts`). Each step's node sits where its root enters the soil, so the steps climb the slope towards the sapling. Roots start one after another so the steps still light in order. A growth timeline lights them at chapter progress 0.25, 0.42, 0.59 and 0.76. Each root then runs on through the strata to the ground line.
- **Cards:** on desktop each card hangs above-left of its node (gold edge on the node side). Nodes on a gentle slope sink slightly into the soil, so a card never covers the next one.
- **Index:** an oval shade around the chapter index (not the full right edge) keeps it legible over the soil without dimming the sapling.
- **Checks:** at 1440 × 900, 1200 × 760, 1024 × 768 and 390 × 844, for u 3.1–4.42: no overlaps and no text outside the stage. Text over the picture is ≥ 4.5:1 against the 95th-percentile background (the phone kicker sits in its own espresso box). Typecheck, lint, check:story, a clean build, the output check and the palette check pass.
- **Resolution note:** the source is 1671 px wide, so on 2× screens wider than about 830 CSS px it is shown slightly below native sharpness. A larger render from the owner would be sharper.

## Services 01 Brand image (15 November 2026)

The owner supplied a new image for the Brand service window: a travertine form, an olive branch and a gold letterform construction (`assets/cinema-src/service-brand-stone.webp`, 1086 × 1448, untouched; web master `public/cinema/service-brand-stone.webp`, slot `service-brand-stone`). It replaces storyboard panel 06 in the Brand window and in the static layout's Services still. `SV_PANEL` in `services.ts` now lists image file names, so any window can take any image. The window crops the sides slightly (window ratio 0.6, image ratio 0.75). The letterform and branch stay in view at 1440 × 900 and 390 × 844. Typecheck, lint, check:story, a clean build, the output check and the palette check pass.

## Services 02 Web image (15 November 2026)

The owner supplied a new image for the Web window: a glass browser window with design tools over gold mesh waves (`assets/cinema-src/service-web-glass.webp`, 1086 × 1448, untouched; web master `public/cinema/service-web-glass.webp`). It replaces storyboard panel 07. Windows now take a horizontal focus per image (`SV_FOCUS` in `services.ts`). This one uses 0.52, so both the tool bar and the sitemap card stay inside the crop. The "Illustration, not client work" label stays on this window. Checks pass.

## Services 03 Marketing image (15 November 2026)

The owner supplied a new image for the Marketing window: a dotted gold globe with orbiting audience, analytics, campaign and video cards (`assets/cinema-src/service-marketing-globe.webp`, 1086 × 1448, untouched; web master `public/cinema/service-marketing-globe.webp`). It replaces storyboard panel 08. Focus 0.51 keeps the globe and all four cards in the window. The "Illustration, not client work" label stays. Checks pass.

## Services 04 SEO & GEO image, and a section-link fix (15 November 2026)

- **Image:** the owner supplied a new image for the SEO & GEO window: a search bar above a stone summit marked by a gold location pin (`assets/cinema-src/service-seo-summit.webp`, 1086 × 1448, untouched; web master `public/cinema/service-seo-summit.webp`). It replaces storyboard panel 09. Focus 0.53 keeps the whole search bar in the window. The "Illustration, not client work" label stays.
- **Bug found while checking:** opening the page at a section link (for example `/#marketing`, `/#process`) landed near the top instead of on the section, in both dev and production builds. The first jump ran before the pin's start and end were measured. The later corrections only ran on scroll events, and nothing scrolled the page afterwards. `stage.ts` now repeats the landing on the frame after each ScrollTrigger refresh, after fonts are ready, on the window's load event and at 150 / 600 / 1500 / 3000 ms, while the landing is still pending (until the visitor scrolls or 4 s pass). Verified on the production build: `#discoverability` lands at u 6.60, `#process` at 3.95 and `#work` at 8.25. Hash changes and in-page links were already correct.
- Typecheck, lint, check:story, a clean build, the output check and the palette check pass.

## Services 05 Growth image (15 November 2026)

The owner supplied a new image for the Growth window: glass bars rising along a lit curve beside an olive tree, under a travertine arch (`assets/cinema-src/service-growth-arch.webp`, 1086 × 1448, untouched; web master `public/cinema/service-growth-arch.webp`). It replaces storyboard panel 03. Focus 0.56 keeps the bars and the tree in the window. Because the image shows a chart, the window now carries the "Illustration, not client work" label (`SV_ILLUSTRATION[4]`), so it cannot be read as a client result. All five Services windows now use owner-supplied images, and storyboard panels 03 and 06–09 are no longer drawn in the story. Checks pass.
