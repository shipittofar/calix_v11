# Scrollbar: localhost vs production — investigation report

**Date:** 2026-10-24
**Repository state:** branch `claude/quirky-cannon-o525ld`, commit `7b8e554`. The working tree was clean before this report.
**Scope:** investigation only. No source, configuration, dependency or environment file was changed. This report is the only file added.

**Evidence labels:**

| Label | Meaning |
|---|---|
| Code | Read in the repository |
| Runtime | Measured in headless Chromium (Playwright 1.56.1) against a development server and a production server, both run from a **copy** of the repository in the session scratchpad |
| Inference | Reasoning from the code, not measured |

---

## 1. Executive summary

**The page scrollbar itself is not broken in either environment.**
- Nothing in the project hides, styles or locks the scrollbar:
  - no `overflow` rule on `html` or `body`;
  - no `scrollbar-*` or `::-webkit-scrollbar` rules;
  - no script that sets `overflow` on the document.
- At runtime, `html` and `body` compute to `overflow: visible` in both environments, and a mouse-wheel scroll moves the page in every case tested (§7).

**What does differ between localhost and production is the home page's scroll-driven "olive story"** (Code + Runtime):
- **What it is:** a pinned, scroll-scrubbed section. A drawing on a canvas advances as you scroll.
- **Where it appears:** included automatically in `next dev`, deliberately removed from every production build unless the build sets `STORY_PREVIEW=true` and `NOINDEX=true`.
- **Where that's decided:** `next.config.ts:40` and `next.config.ts:65–74`, which swap `components/home/story/StorySlot.tsx` for `StorySlot.off.tsx` (renders `null`).
- **Why it's removed:** it uses generated imagery of a person not cleared for the public site (`docs/olive-story.md`).
- **Measured effect** at 1440×900:

  | Environment | Home page height | Story section |
  |---|---|---|
  | `next dev` | 29,060 px | ≈ 19,400 px of pinned scroll track |
  | Production build | 8,691 px | absent |

**Conclusion:**
- If "scrollbar mode" means the scroll-driven story experience on the home page, the cause is **confirmed**. It is a **deliberate build-time gate, not a bug**.
- If it means something else, such as the native scrollbar not being visible on a particular device, **no code cause exists**, and the remaining candidates are device or browser settings (§6). The live site couldn't be reached from this session to check.

---

## 2. What "scrollbar mode" can mean in this project

The project has **no feature named "scrollbar mode"** (Code: search for `scrollbar` in `app/`, `components/`, `lib/`, `public/` finds nothing). Three scroll-related behaviours exist:

| Behaviour | What it does | Enabled by |
|---|---|---|
| **Native page scrollbar** | The document scrolls normally | Always. No custom styling or hiding |
| **Scroll sequence S1** (`components/home/Sequence.tsx`, `SequenceController.tsx`) | A sticky illustration plate whose stage changes as the visitor scrolls through five steps | `html[data-motion="on"]`, set when `SEQUENCE_MOTION_QUERY` matches: `(min-width: 1200px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)` (`lib/motion.ts:6–7`) |
| **Olive story** (`components/home/story/*`) | A long pinned stage, scrubbed by scroll position | (a) the section is in the build: `next dev`, or a preview build; **and** (b) `html[data-story="on"]`, set when `STORY_MOTION_QUERY` matches: `(min-height: 480px) and (prefers-reduced-motion: no-preference)` (`lib/motion.ts:14`) |

Both motion modes are chosen before first paint by the inline `MOTION_BOOT_SCRIPT` (`lib/motion.ts:20`, rendered at `app/layout.tsx:89`).

The motion code says that "scrolling is never intercepted" (`components/home/story/Story.tsx:24`): both modes follow the native scroll position and never replace it.

---

## 3. Architecture and scroll ownership

| Question | Answer | Evidence |
|---|---|---|
| Which element scrolls? | The **document** (viewport). There is no nested scroll container for page content | Runtime: `scrollHeight` of `document.documentElement` ≫ `clientHeight`; `scrollY` changes on wheel (§7) |
| Which component owns it? | None; it is the browser default. `app/layout.tsx` renders `<html>` and `<body>` without overflow or height constraints | Code: `app/layout.tsx:86–87`; `app/globals.css:71–94` (only `scroll-padding-top`, `scroll-behavior: smooth`, typography) |
| Is scrolling disabled anywhere? | **No.** No `overflow: hidden` on `html`, `body` or `main`; no JavaScript sets `document.body.style.overflow` or the like | Code: `grep` over `app/`, `components/`, `lib/` |
| Does a parent clip content? | Only local, decorative clipping inside sections (plates, image frames, the sticky story stage), none on an ancestor of the page | §4.1 |
| Is the scrollbar hidden visually? | Not by the project. Whether it is visible depends on the OS and browser (overlay scrollbars) | Code: no scrollbar CSS. Runtime: headless Chromium uses overlay scrollbars (`innerWidth − clientWidth = 0`) |
| Which routes are affected? | The story and the S1 sequence exist **only on `/`** (`app/page.tsx:21–22`). Every other route uses plain document scrolling | Code |
| Which viewports? | S1: desktop ≥ 1200 × 700 only. Story: any viewport ≥ 480 px tall. Both off with reduced motion | `lib/motion.ts:6–14`; Runtime §7 |

---

## 4. CSS and JavaScript findings

### 4.1 CSS (all rules found)

There are only two stylesheets: `app/globals.css` (imports Tailwind at line 1) and `app/components.css`. There are no CSS modules.

| Location | Rule | Affects | Explains the difference? |
|---|---|---|---|
| `app/globals.css:72` | `html { scroll-padding-top: calc(var(--header-h) + 16px) }` | Anchor-jump offset | No: same in both builds |
| `app/globals.css:77–79` | `scroll-behavior: smooth` (only without reduced motion) | Anchor and skip-link scrolling | No: same in both |
| `app/globals.css:384` | `.visually-hidden { overflow: hidden }` | Screen-reader-only text | No |
| `app/components.css:6–11` | `.site-header { position: sticky; top: 0 }` | Header | No |
| `app/components.css:33–40` | `.mobile-menu__panel { position: absolute }` | Mobile menu panel; no scroll lock | No |
| `app/components.css:68, 231, 324, 651, 991, 1211, 1393, 1426, 1491, 1542` | `overflow: hidden` on decorative containers (plates, frames, the sequence field, story frames and captions) | Clipping inside those boxes only | No |
| `app/components.css:781` | `overflow-x: auto` | `.admin-scroll` (admin tables) | No (admin only) |
| `app/components.css:909–960` | `html[data-motion="on"] …`: grid layout and `.sequence__plate { position: sticky; height: min(calc(100svh − header − 64px), 760px) }` | S1 sequence on desktop | **Viewport- and setting-dependent**, not environment-dependent (§6, C3) |
| `app/components.css:1339–1360` | `html[data-story="on"] .story__track { height: calc(100svh + var(--story-length) * var(--unit)) }` (`--unit` 64/70/72svh); `.story__stage { position: sticky; height: calc(100svh − header); overflow: hidden }` | The long pinned story | **Yes**: these rules only match when the story markup exists, which is `next dev` only by default (C1) |
| — | `scrollbar-width`, `scrollbar-gutter`, `::-webkit-scrollbar` | — | **None anywhere** |

### 4.2 JavaScript

| Location | Code | Effect | Cleanup |
|---|---|---|---|
| `lib/motion.ts:20`, run at `app/layout.tsx:89` | `matchMedia(...)` → `d.dataset.motion="on"`, `d.dataset.story="on"` | Chooses the layouts before paint | n/a (one-shot) |
| `components/home/SequenceController.tsx:73, 100, 106` | Sets or removes `html.dataset.motion`; an IntersectionObserver changes the plate stage | S1 stage changes on scroll | Yes: removed when the media query stops matching or on unmount |
| `components/home/story/StoryPlayer.tsx:31–52, 361, 401` | Sets or removes `html.dataset.story`; a passive `scroll` listener redraws the canvas | Story scrubbing | Yes: removes the listener and `data-story` |
| `components/layout/MobileMenu.tsx` | A native `<details>`; Escape and link clicks close it | No scroll lock | Yes |
| — | `document.body.style.overflow`, `documentElement.style.overflow`, `wheel`/`touchmove` handlers with `preventDefault` | **None found** | — |

**Observation (Code + Runtime; harmless):** in production builds, the boot script still sets `data-story="on"` on `<html>`, because the story is absent and so `StoryPlayer` never runs to remove it. It is measured as `story=on`, `storyRoot=false` in prod. The `html[data-story="on"]` rules then match nothing, as `docs/olive-story.md` notes, so this has **no effect on scrolling**.

### 4.3 Code that branches on environment

| Location | Branch | Relevant to scrolling? |
|---|---|---|
| `next.config.ts:39–41` | `storyPreviewEnabled`: in `PHASE_DEVELOPMENT_SERVER` the story is on unless `STORY_PREVIEW=false` | **Yes (C1)** |
| `next.config.ts:28–37` | `isPreview`: production builds include the story only with `STORY_PREVIEW=true` and `NOINDEX=true` (otherwise the build throws) | **Yes (C1)** |
| `next.config.ts:65–74` | Otherwise `resolveAlias` maps `StorySlot` → `StorySlot.off.tsx` (`return null`) | **Yes (C1)** |
| `lib/display.ts:11` | Content placeholders shown when `NODE_ENV !== "production"` | No (text markers only) |
| `lib/site-url.ts:9` | `localhost` origin in development | No |
| `proxy.ts:19` | `'unsafe-eval'` in the admin CSP in development | No (admin routes only) |
| `lib/analytics.ts:43` | Debug logging in development | No |

**No code checks `window.location.hostname` or `localhost` at runtime.**

---

## 5. Localhost vs production comparison

| Aspect | `next dev` (typical "localhost") | `next build` + `next start` (production) | Evidence |
|---|---|---|---|
| Olive story section | **Present** | **Absent** (null stand-in) | Code §4.3; Runtime: `data-story-root` true/false |
| Home page height, 1440×900 | 29,060 px | 8,691 px | Runtime |
| Home page height, 390×844 | 31,407 px | 13,582 px | Runtime |
| Pinned, scroll-scrubbed stage | Yes: `.story__stage` stays at `top: 80px` (sticky) at +2,000, +6,000 and +12,000 px into the track, with a canvas drawn | No | Runtime |
| S1 sequence (sticky plate, stages change on scroll) | Works at 1440×900: stages 0→5 | **Works identically**: stages 0→5 | Runtime |
| `html`/`body` overflow | `visible` / `visible` | `visible` / `visible` | Runtime |
| Wheel scrolling | Moves the page (0 → 1200 px) | Moves the page (0 → 1200 px) | Runtime |
| Console / page errors | None | None. Two aborted `?_rsc` prefetch requests for `/contact` when the test closed the page (navigation prefetch cancellation, not an error) | Runtime |
| CSS loading | Same two stylesheets (dev: style tags; prod: extracted CSS links) | Same rules; the story rules match nothing | Code + Runtime |
| Note | If "localhost" meant a **local `next start`**, localhost and production are the **same**, and C1 doesn't apply | | Inference |

---

## 6. Ranked root-cause candidates

### C1. The olive story exists only in `next dev` — CONFIRMED (most likely)

- **Code:**
  - `next.config.ts:40`: `if (phase === PHASE_DEVELOPMENT_SERVER) return process.env.STORY_PREVIEW !== "false";`
  - `next.config.ts:72`: `resolveAlias: { "@/components/home/story/StorySlot": "./components/home/story/StorySlot.off.tsx" }`
  - `components/home/story/StorySlot.off.tsx:2–4` returns `null`.
  - `app/page.tsx:21` renders `<StorySlot />`.
- **Mechanism:**
  - In development, the home page contains a ≈ 19,400 px pinned track (`app/components.css:1339–1360`) whose drawing advances with scroll.
  - In a production build the module is replaced at build time, so the section, its images and `StoryPlayer` are not in the output.
  - The page is therefore much shorter, and the scroll-driven experience is gone.
- **Why only on localhost:** the decision is made from the Next.js *phase* (dev server vs production build/server), not from the host. `README.md:48` and `docs/olive-story.md` document it as intended policy.
- **Evidence:** Runtime §5 (story present in dev, absent in prod, at three viewport sizes).
- **Still needed:** confirmation that this is the behaviour the user means, and the live site's HTML (§8).

### C2. Reduced-motion OS setting on the production-testing device — POSSIBLE

- **Code:** `lib/motion.ts:6–7, 14`; both queries require `prefers-reduced-motion: no-preference`.
- **Mechanism:** with reduced motion, neither motion mode starts. The page scrolls normally with static layouts.
- **Why it can look environment-specific:** it depends on the device or browser used to view each environment, not on the server.
- **Evidence:** Runtime: with `reducedMotion: "reduce"` in production, `data-motion` and `data-story` are both absent and the S1 plate is `static`.
- **Confirm by:** checking `matchMedia('(prefers-reduced-motion: reduce)').matches` on the device that sees the problem.

### C3. Viewport below the S1 threshold (≥ 1200 × 700) — POSSIBLE

- **Code:** `lib/motion.ts:6–7`; `SequenceController.tsx:106`.
- **Mechanism:** on a laptop whose browser viewport is under 700 px tall (for example 1366×657 after browser chrome), the sticky sequence is replaced by the static layout. This happens in **both** environments.
- **Evidence:** Runtime: at 1366×657, `data-motion` is absent and the plate is `static` in both dev and prod.
- **Confirm by:** `innerWidth` / `innerHeight` on the affected device.

### C4. Deployed build differs from the repository (stale build or different flags) — POSSIBLE

- **Mechanism:** the live server could run an older build, or one built with different environment flags. For example, a preview build with `STORY_PREVIEW=true` and `NOINDEX=true` would include the story and noindex every page.
- **Evidence:** none. The live site wasn't reachable from this session (§8).
- **Confirm by:** checking the live HTML for `data-story-root`, and the server's `.next/BUILD_ID` against a fresh build.

### C5. OS or browser overlay scrollbars — POSSIBLE (only if "scrollbar" means the visible bar)

- **Mechanism:** macOS ("Show scroll bars: when scrolling"), mobile browsers and some Linux setups hide the bar until scrolling. Developers often view localhost on a different machine or browser setting than production.
- **Code:** the project sets no scrollbar styling at all.
- **Evidence:** headless Chromium here uses overlay scrollbars (`innerWidth − clientWidth = 0`) in both environments.
- **Confirm by:** the DevTools check `innerWidth - document.documentElement.clientWidth` on both sites on the same device.

### C6. Leftover `data-story="on"` in production — RULED OUT

- **Code:** `lib/motion.ts:20`.
- **Why ruled out:** the matching CSS targets only `.story__*` elements, which aren't in production markup.
- **Evidence:** Runtime: `data-story="on"` with no story root, and normal scrolling.

### C7. CSS missing, reordered or failing to load in production — RULED OUT for the local production build

- **Evidence:** Runtime shows the production build applies the S1 sticky layout (it needs `components.css`) and logs no stylesheet failures.
- **Note:** this is not verified on the live server.

### C8. Nginx or proxy behaviour — RULED OUT as a code-level cause; not observed live

- **Code:** `deploy/nginx/calix-proxy.conf` adds no CSP or content rewriting, and `proxy_cache off`.
- **Why it's irrelevant here:** the public CSP from `next.config.ts` has no `script-src`, so the inline boot script runs. Runtime confirms `data-motion="on"` is set in production at 1440×900.
- **Possible exception:** a different live Nginx configuration that injects a strict CSP would block the boot script. That is unverified (C4-type evidence).

### C9. Scroll locking by JavaScript (menus, modals) — RULED OUT

- **Code:** no such code (§4.2).

---

## 7. Evidence collected and tests performed

1. **Source search** across `app/`, `components/`, `lib/`, `next.config.ts`, `proxy.ts`, `instrumentation.ts` for:
   - overflow, scrollbar and viewport-height rules, and sticky or fixed positioning;
   - `style.overflow`, `classList`, scroll, wheel and touch listeners;
   - `NODE_ENV`, `localhost`, `hostname`.
2. **Runtime comparison** in a scratchpad copy of the repository (the project tree was not touched):
   - **Production:** the existing build, `.next/BUILD_ID` = `5uFy2jykNE6hIjw3ScwPr`, built from the current source. Server: `next start -p 3101`, with `STORY_PREVIEW` and `NOINDEX` unset.
   - **Development:** `next dev -p 3102`, with the same variables unset.
   - **Matrix:** 1440×900, 1366×657, 390×844, and 1440×900 with reduced motion.
   - **Measured** for each case:
     - `data-motion` and `data-story`;
     - story root presence and track height;
     - S1 plate `position`;
     - computed overflow on `html`, `body` and `main`;
     - `scrollHeight` and `clientHeight`, and scrollbar width;
     - `scrollY` before and after a 1,200 px wheel;
     - console errors and failed requests.
   - **Results** (summarised in §5):
     - wheel scrolling worked in all 8 cases;
     - overflow was `visible` everywhere;
     - the story was present only in dev;
     - S1 stages advanced 0→5 in both environments;
     - in dev, the story stage stayed sticky at `top: 80px` across the track.
   - The servers were stopped afterwards. `git status` in the project is clean apart from this report.
3. **Live site:** `curl https://www.calixeden.com/` was refused by this session's egress proxy (`CONNECT tunnel failed, response 403`). **No live evidence was collected.**

---

## 8. Missing information and limitations

- **The live production site was not reachable** from this session, so I couldn't see whether it serves the story markup, its CSP headers, or its build ID.
- **The exact symptom wasn't specified.** "Scrollbar works on localhost but not in production" could mean:
  - the scroll-driven story (C1);
  - the S1 sticky sequence (C2, C3);
  - the visible scrollbar (C5).
- **Device details are unknown:** OS, browser, viewport and reduced-motion setting on each device.
- **"Localhost" is ambiguous:** whether it meant `npm run dev` or a local `next start`.
- **Headless Chromium only:** no Safari or Firefox, and no real touch scrolling.

---

## 9. Diagnostic plan (in order)

Run on **both** localhost and the live site, **on the same device and browser**, on the home page `/`. Paste into the DevTools console:

```js
// 1. Which build and which modes are active?
({
  storyInPage: !!document.querySelector('[data-story-root]'),   // true only where the story is built in (C1)
  motion: document.documentElement.dataset.motion ?? null,      // "on" = S1 sticky sequence active
  story: document.documentElement.dataset.story ?? null,
  reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,   // C2
  viewport: [innerWidth, innerHeight],                          // C3: S1 needs >= 1200 x 700
  scrollbarWidth: innerWidth - document.documentElement.clientWidth,       // C5: 0 = overlay scrollbar
  pageHeight: document.documentElement.scrollHeight,
  overflow: [getComputedStyle(document.documentElement).overflowY, getComputedStyle(document.body).overflowY],
})
```

```js
// 2. Does the page actually scroll?
const y0 = scrollY; scrollBy(0, 1000); setTimeout(() => console.log('scrolled', scrollY - y0), 500);
```

Then, in order:
1. Compare `storyInPage`. If it's `true` on localhost and `false` live, **C1 is the explanation**.
2. If both are `false`, compare `motion`, `reducedMotion` and `viewport` (C2, C3).
3. If the visible bar is the concern, compare `scrollbarWidth` and the OS scrollbar setting (C5).
4. On the server, compare `cat .next/BUILD_ID` with a fresh build of the deployed commit (C4).
5. Check the response headers:
   - `curl -sI https://www.calixeden.com/ | grep -i content-security-policy`
   - if a `script-src` appears that isn't in `next.config.ts`, the boot script may be blocked (C8).
6. Check the console for CSP violations or failed `/_next/static/*.css` requests (C7).

---

## 10. Recommended fix direction (not implemented)

| Cause | Direction |
|---|---|
| C1 (confirmed) | **Don't remove the gate.** It enforces an imagery policy (`docs/olive-story.md`, `docs/imagery-direction.md` §5). For the story to appear in production, CALIX must first record the imagery decision or replace the photographs with commissioned ones; then the gate is changed deliberately. **Until then:** to make localhost match production, run `STORY_PREVIEW=false npm run dev`, or test with `npm run build && npm start`. To review the story on a server, use a separate preview build (`STORY_PREVIEW=true NOINDEX=true`, output in `.next-preview`), never the public site. |
| C2, C3 | Intended progressive enhancement (`docs/scroll-narrative.md` §6.4). Change only by a design decision (for example lowering the 700 px height threshold), then test with `calix-visual-qa` at 1440/768/390 |
| C4 | Rebuild and redeploy the intended commit with the production environment (no `STORY_PREVIEW`); verify the build ID |
| C5 | Nothing to fix in code unless a design decision asks for an always-visible scrollbar (for example `scrollbar-gutter: stable`). Check the OS setting first |

---

## 11. Conclusion

- **Confirmed (code and runtime):** scrolling works in both development and production builds. The **only localhost-versus-production difference in scroll behaviour** is that the scroll-driven olive story section is built into `next dev` and deliberately left out of production builds (`next.config.ts:40` and `:72`; `components/home/story/StorySlot.off.tsx`). It is policy, not a defect.
- **Undetermined:** whether this is the symptom being reported, and whether the live server matches the repository. That needs the checks in §9 on the live site, which this session couldn't reach.

---

# Part 2: Request to enable the olive story in production (2026-10-24)

**Outcome: not enabled.** Public use of the story's imagery is **not approved** anywhere in the repository, and the project's imagery policy, as written, forbids part of it. As the request instructs, the restriction was not bypassed. **No application file was changed:** this section is the only edit.

## 12. How production disables the story (confirmed)

| Step | File and lines | What happens |
|---|---|---|
| 1 | `app/page.tsx:5, 21` | The home page renders `<StorySlot />` |
| 2 | `next.config.ts:39–42` (`storyPreviewEnabled`) | In `next dev`, the story is on unless `STORY_PREVIEW=false`. In `next build`/`next start`, it is on only when `isPreview()` is true |
| 3 | `next.config.ts:28–37` (`isPreview`) | Production includes it only with `STORY_PREVIEW=true` **and** `NOINDEX=true`; `STORY_PREVIEW=true` alone throws, naming the imagery policy (line 33). Such a build is written to `.next-preview` (line 26), never to `.next`, and every page is noindex |
| 4 | `next.config.ts:65–74` | Otherwise `resolveAlias` maps `@/components/home/story/StorySlot` to `StorySlot.off.tsx` (line 72) |
| 5 | `components/home/story/StorySlot.off.tsx:2–4` | `return null`: no markup, images or `StoryPlayer` code in the public output |
| 6 | `scripts/check-story.mjs`; `package.json:22` (`verify:builds`); `.github/workflows/validate.yml` | CI **enforces** this: the public build must contain no story (`output .next off`); the preview build must contain it and be noindex (`output .next-preview on`) |
| 7 | `docs/olive-story.md` §6 (lines 239–240, 251) | The deployment runbook expects `grep -c data-story-root` = 0 on the production host |

So this is **not only a development-mode preview gate**. It is a **policy gate**, deliberately built and enforced in code, CI and the deployment runbook, because of the imagery.

## 13. Is the imagery approved for public use? No

| Source | What it says |
|---|---|
| `docs/olive-story.md:3` | "**Preview builds only** (§7): the photographs are generated and show a person" |
| `docs/olive-story.md:17` | Policy gate: "Before it can ship, CALIX records that decision or replaces the photographs with commissioned photography" |
| `docs/imagery-direction.md` §5 | AI generation "is not used by default. If CALIX chooses to use it for class 5 atmosphere, it **must not depict identifiable people**, real places presented as real, or client work, and the decision is recorded `[decision needed]`" — still unresolved |
| `docs/imagery-direction.md` §5 | "AI-generated images are never used as evidence: not as … **people** …" |
| Git history (`git log --all` on `docs/imagery-direction.md`, `assets/story`, and commit messages mentioning imagery or approval) | No commit records an approval. Every story commit says "preview builds only" |

**Why a sign-off alone isn't enough:** the photographs present one consistent generated woman as **"the founder"** (alt text in `components/home/story/stages.ts:45–147`). Shown on the public CALIX site, that reads as a depiction of a real, identifiable person connected to the studio. That is exactly what §5 rules out even *with* a recorded decision. Enabling the story as it stands would therefore need the **policy itself** changed by CALIX, not just the `[decision needed]` filled in.

### Assets affected

All are in `assets/story/` and referenced from `components/home/story/stages.ts`:

| File | Shows | Policy issue |
|---|---|---|
| `stage-01-plaza.jpg` | The founder at a laptop in a plaza | Generated, identifiable person |
| `stage-02-hand.jpg` | The founder looking at a pit in her palm | Same |
| `stage-03-planting.jpg` | The founder pressing the pit into soil | Same |
| `stage-04-soil.jpg` | A sprout; the founder out of focus behind | Same (lower prominence) |
| `stage-05-tending.jpg` | The founder beside a sapling | Same |
| `stage-06-fruit.jpg` | The founder beside a young tree | Same |
| `stage-07-harvest.jpg` | People harvesting; the founder holding olives | Same, and several generated people |
| `stage-08-terrace.jpg` | The founder at her table, from above | Same |
| `stage-08-grove.jpg` | Aerial grove; people harvesting | Generated people (small) and a generated place |
| `stage-04-sprout.png` | A sprout cut-out | Generated; no person (class 5 atmosphere, needs the §5 decision) |

The **drawing** (`plate.ts`) is original vector-style illustration. Its people are deliberately faceless silhouettes (`docs/olive-story.md` §3) and are not affected.

## 14. Decision required (owner: CALIX)

Pick one and record it in `docs/imagery-direction.md` §5, replacing `[decision needed]`. The wording is CALIX's; this report doesn't draft policy text.

| Option | What CALIX decides | Code work afterwards |
|---|---|---|
| **A. Amend the policy** | Generated photographs, including a fictional "founder", may appear on the public site in this story. Record how they are labelled (for example an "Illustrative imagery" note), and that they are not presented as real people or evidence | §15 steps 1–6 |
| **B. Commissioned photography** | Replace the nine photographs with a real shoot (model releases, location permission). `docs/olive-story.md` §4 lists the shots | Swap files in `assets/story/` (via `scripts/prepare_story_assets.py`), update the alt text in `stages.ts`, then §15 steps 1–6 |
| **C. Drawing only** | Publish the story without the photographs (the illustration carries every beat) | A design change to `Story.tsx`, `StoryPlayer.tsx` and the CSS (the photo window and the final aerial reveal). Needs design approval and visual QA. **Not** the minimal change |

## 15. Minimal implementation plan, once A or B is recorded (not applied)

1. **`next.config.ts`:**
   - include the story in public production builds: `storyPreviewEnabled()` (lines 39–42) returns `process.env.STORY_PREVIEW !== "false"` for every phase;
   - drop the `NOINDEX` requirement and the `.next-preview` switch in `isPreview()` (lines 28–37) and `config()` (lines 65–74);
   - keep the `resolveAlias` path for an explicit `STORY_PREVIEW=false` (a kill switch);
   - update the comment at lines 13–25.

   No hostname checks; `lib/motion.ts` is unchanged, so the reduced-motion and short-viewport fallbacks (`STORY_MOTION_QUERY`) stay exactly as they are.
2. **`scripts/check-story.mjs` and `package.json:22`:**
   - the public build must now **contain** the story (`output .next on`) and stay indexable;
   - update the `config` cases (line 51 onwards) to expect "on" for production;
   - keep the `STORY_PREVIEW=false` → off case.
3. **`components/home/story/StorySlot.off.tsx`:** keep it as the kill-switch stand-in.
4. **Docs:**
   - `docs/olive-story.md`: status line, policy gate, the §5 table, and the §6 deploy checks (`data-story-root` count = 1);
   - `README.md:48` (the `STORY_PREVIEW` row);
   - `docs/content-gaps.md`, if a labelling note is required.
5. **Performance budget:**
   - the photographs total about 8.9 MB on disk. They are served through `next/image`, and only fetched when near (`is-near`, `app/components.css:1404`). The aerial image is preloaded two chapters ahead;
   - re-measure LCP and total transfer on `/`, because the story sits directly after the hero.
6. **Validation:**
   - commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run verify:builds` (updated), `CALIX_REQUIRE_BROWSER=1 npm run test:integration`;
   - a production `next start` in Chromium at 1440×900, 768×1024 and 390×844: story present; stage sticky at `top: 80px` / `64px`; canvas redraws as `scrollY` changes;
   - reduced motion: static stages, no canvas. JavaScript off: static stages. A 900×440 viewport: static;
   - no console errors or failed image requests; the S1 sequence unchanged (stages 0→5);
   - before and after screenshots of `/` at 1440/768/390; the `calix-brand` palette check on the built CSS; `calix-visual-qa`;
   - Effort: S (config, checks, docs), plus validation.

## 16. Validation performed for this request

| Check | Result |
|---|---|
| Source and documentation trace | Done (§12, §13) |
| Approval search (docs, git history) | No approval found |
| Code change, build and browser validation | **Not performed:** no change was authorised. The production site is **not** fixed and must not be described as fixed |
| Earlier runtime evidence (§5, §7) | Still valid: the story works in `next dev` (pinned stage, canvas, scroll-scrubbed) and is absent from the production build |

## 17. Remaining blockers

1. **CALIX's imagery decision:** A or B in §14. Option A means changing the "no identifiable people" rule.
2. If option B: a photo shoot with model releases.
3. After the decision: the §15 change, and its validation.

Previewing the story privately is possible today without any code change: `npm run build:preview && npm run start:preview` on a separate, access-protected host (`docs/olive-story.md` §6, "Reviewing the preview").

---

# Part 3: Olive story enabled in public production builds (2026-11-13)

**Authorisation:** the project owner instructed "اجراش کن" ("do it") after reading Part 2. That was taken as the decision to proceed with option A (§14): publish the story with its generated photographs. The decision is recorded in `docs/imagery-direction.md` §5 for this section only. The general rule, and its `[decision needed]` for any other use, are unchanged.

## 18. Files changed

| File | Change |
|---|---|
| `next.config.ts` | `storyPreviewEnabled(phase)` replaced by `storyEnabled()`: the story is on unless `STORY_PREVIEW=false`, in every phase. The noindex review build (`STORY_PREVIEW=true` + `NOINDEX=true` → `.next-preview`) is kept, with an updated message. Header comment updated; unused `PHASE_DEVELOPMENT_SERVER` import removed. No hostname logic |
| `scripts/check-story.mjs` | Config cases: public builds must include the story; `STORY_PREVIEW=false` must leave it out. Output modes `public` / `preview` / `off` (was `on` / `off`) |
| `package.json` | `verify:builds` checks `.next` as `public` and `.next-preview` as `preview` |
| `app/page.tsx`, `components/home/story/StorySlot.tsx`, `StorySlot.off.tsx` | Comments only |
| `docs/imagery-direction.md` | The dated, olive-story-only decision record |
| `docs/olive-story.md` | Status, imagery note, run table, check and deploy instructions (`data-story-root` count is now 1), new §8 validation |
| `README.md` | `STORY_PREVIEW` row |

**Unchanged:**
- the story's code, CSS and assets;
- `lib/motion.ts` (the reduced-motion and short-viewport safeguards);
- the S1 sequence, other sections, admin, APIs, environment, Nginx and deployment configuration.

## 19. Validation

Every check passed; the details are in `docs/olive-story.md` §8.
- **Commands:** lint, typecheck, unit tests (126), `check:story`, the audit gate, `verify:builds`, integration (65, Chromium required) and production-like (12). None skipped.
- **Browser, on the public production build:**
  - the story is present and pinned, the canvas changes with scroll, and the chapters progress;
  - static fallbacks appear with reduced motion and on a short viewport;
  - S1 is unchanged; no site console errors, missing assets or overflow;
  - the first screen is identical before and after, except where the story now begins.

## 20. Remaining items

1. **The live site is not changed.** www.calixeden.com shows the story only after this change is committed, rebuilt and deployed (`docs/olive-story.md` §6). None of that has been done.
2. **Owner's choice, not done:**
   - the photographs present a generated woman as "the founder" (alt text in `stages.ts`), with no "illustrative imagery" label;
   - adding a label, or rewording the alt text, is a copy decision.
3. **Privacy:** no new data collection (the story runs entirely client-side). The privacy notice was not touched.
4. **Separate from this change:** `npm audit` now reports a **moderate** advisory (minimatch, reached through the dev-only `eslint-config-next` / `typescript-eslint` chain). It is below the `high` gate, and no dependency was changed.
5. The before/after page-weight comparison has only the "after" figure, because the earlier build was replaced.
