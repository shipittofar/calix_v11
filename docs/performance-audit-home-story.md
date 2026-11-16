# Performance audit: home page scroll story (14 November 2026)

**Method:** a production build (`next build`, served by `next start` on port 3100), measured in the built-in browser with the browser's own performance APIs, plus bundle sizes from the build output. These are **desktop lab measurements with no CPU or network throttling**; Lighthouse is not installed in the project and was not downloaded. The built-in browser pane was hidden, so it recorded no paint timings (LCP and FCP could not be measured directly). Frame costs were timed on the development server, which is unminified and so not faster than production.

## Results

| Metric | Measured | Target | Note |
|---|---|---|---|
| TTFB | 10–16 ms | ≤ 0.8 s | Local; the page is prerendered static HTML, 14 KB compressed |
| LCP | not measured (pane hidden) | ≤ 2.5 s | The LCP element is the hero headline: server-rendered text, visible on first paint, never animated in |
| CLS | 0.000 | ≤ 0.1 | Measured over load and engine start |
| Long tasks on load | none | — | |
| Initial JS (home page) | 180 KB gzip, 10 files | — | Site-wide (framework and layout); the story engine is not part of it |
| Story engine chunk | 57 KB gzip (166 KB raw) | — | GSAP, ScrollTrigger, engine and vein data; loaded only when motion is allowed, after first paint |
| Story images | about 510 KB in total | — | AVIF/WebP from the optimizer at the needed width; now staged (see below) |
| Frame cost while scrolling | 0.7–10.1 ms per frame | < 16.7 ms | Heaviest: Ecosystem network 10.1 ms, Awakening dissolve 7.4 ms (1440 × 900, DPR 1.25) |

## Fixed

- **[P2] Images for chapters 4–7 downloaded on every visit.** All the story images loaded within 2 s, even for visitors who never scroll past the hero. Now: the hero image first; Awakening and Foundation right after; chapters 4–7's seven panels only when the visitor scrolls past the start of Foundation (u > 2.8) or jumps there. This cuts about 220 KB from a visit that stops at the hero, and moves bandwidth away from first load on phones (`engine/stage.ts`, `loadLate`).
- **[P2] Frame budget on slower devices.** The heaviest frames (10 ms on this machine) could miss the 16.7 ms budget on a phone CPU about 4× slower. Now: if rendering averages over 14 ms, the engine switches once to 1× pixel density and drops the filaments' faint outer haze. Fast devices keep full quality (`engine/stage.ts`, adaptive quality; `engine/light.ts`, `setLite`).

## Checked, no change needed

- The story code loads as a separate chunk after first paint, only when motion is allowed. The static layout ships no story JavaScript beyond the small player.
- Canvas redraws happen only when the scroll position changes (plus the 1.6 s ignition), not on a continuous loop. Only transforms and opacity change on DOM text.
- Static stills use `next/image` with explicit sizes and `sizes`, loaded lazily; in motion mode they are not displayed and so not downloaded.
- Fonts: `next/font`, self-hosted, `font-display: swap`, metric-matched fallback.
- No third-party scripts on the page.

## Needs your decision

- None for the story.

## Can't verify from here

- Real mobile numbers. Run on a mid-range Android phone, or with Lighthouse in Chrome DevTools (Mobile, 4× CPU throttling), three times, median. Check LCP (the headline), TBT, and scroll smoothness through Awakening and Ecosystem.

## Next opportunities

- **[P3] Header wordmarks (outside the story):** the site header preloads both wordmark variants (espresso and ivory) on every page; only one is shown at a time.
