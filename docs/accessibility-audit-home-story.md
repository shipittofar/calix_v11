# Accessibility audit: home page scroll story (14 November 2026)

Standard: WCAG 2.2 AA · Page audited: `/` (the seven-chapter story, `components/home/cinema/Chapters.tsx`, `components/home/story/engine/*`, `app/cinema.css`), in motion and static modes · Method: the skill's static scanner on the built HTML, computed contrast (palette pairs and worst-case text over the canvas imagery), measured layout in the built-in browser at 1440 × 900, 1280 × 620, 1024 × 768, 768 × 1024, 390 × 844 and 375 × 667, and code review. Shared header, footer and enquiry band were not re-audited.

## Summary

The story's structure is sound: all text is server-rendered in reading order, there is one h1 and a clean h2/h3 outline, the canvas is hidden from assistive technology, reduced motion and short screens get the static layout, and hidden text stays readable to screen readers while keyboard focus scrolls to its chapter. The real barriers were contrast where text sits over the photographs (Awakening, Ecosystem and the phone hero) and the chapter rail losing its names on smaller screens. All are fixed.

| Area | Status | Issues |
|---|---|---|
| Keyboard navigation | ✅ Passes | 0 (focus entering a hidden chapter scrolls to it; rail is native buttons) |
| Focus states | ✅ Passes | 0 (global `:focus-visible`, ivory ring on espresso; scanner note was a false positive) |
| Semantic HTML | ✅ Passes | 0 |
| Color contrast | ❌ → ✅ | 4 fixed |
| Reduced motion | ✅ Passes | 0 (CINEMA_MOTION_QUERY gives the static layout) |
| Screen reader semantics | ⚠️ → ✅ | 1 fixed |
| Form labels | n/a | (no forms in the story) |
| Error states | n/a | |
| Touch targets | ✅ (improved) | rail raised to 44 × 44 px |

## Findings

### [P1] Text over the Awakening photograph below 4.5:1
- **Where:** `engine/awakening.ts`, the text scrim.
- **WCAG:** 1.4.3 Contrast (Minimum) (AA).
- **Who it affects:** low-vision readers.
- **Problem:** the scrim faded to near zero before the end of the text column. Worst case over the brightest pixel: ivory body text 2.7:1, travertine caption 1.9:1.
- **Fix:** an even espresso band at 0.93–0.95 under the whole text column, then a fade. Worst case now ivory 10.6:1, travertine 8.5:1, gold chapter number 4.51:1. On phones the band reaches the measured top of the text.

### [P1] Text over the Ecosystem photograph below 4.5:1
- **Where:** `engine/ecosystem.ts`.
- **WCAG:** 1.4.3.
- **Problem:** worst case travertine caption 3.8:1.
- **Fix:** the same band treatment (0.86–0.92). Worst case now ivory 12.4:1, travertine 8.5:1, gold 4.5:1.

### [P1] Phone hero text over storyboard panel 01
- **Where:** `engine/origin.ts` (phone composition).
- **WCAG:** 1.4.3.
- **Problem:** in the phone composition the headline, lead and outlined button sit over the plate, with no scrim.
- **Fix:** a scrim band that covers the measured text column (0.82–0.9). The seed moved to 72 % of the height, below the band. Worst case now ivory 10.4:1, travertine 7.1:1, gold 4.9:1. The scrim fades as the hero text leaves.

### [P1] Light drawn over the text scrim (found in visual QA)
- **Where:** `engine/awakening.ts` and `engine/origin.ts`.
- **WCAG:** 1.4.3.
- **Who it affects:** everyone reading on phones, low-vision readers most.
- **Problem:** the glowing vein filaments (Awakening) and the hero tendrils were drawn after the scrim, so bright lines crossed the heading and body text on phones. The contrast figures above assumed the scrim was the top layer.
- **Fix:** the scrims are now drawn over the light as well as the photograph (the seed glow, which sits below the hero text, stays on top). The Ecosystem scrim was already the last layer.

### [P2] Chapter rail buttons lost their names on smaller screens
- **Where:** `app/cinema.css`, `.cx-rail button span` (below 1100 px).
- **WCAG:** 4.1.2 Name, Role, Value (A); 2.5.3 Label in Name.
- **Problem:** the chapter names were hidden with `display: none`, so the buttons were announced as "01", "02" and so on.
- **Fix:** the names are hidden visually only (clip), so each button keeps its full name ("02 Awakening").

## Design changes you will notice

1. Awakening (desktop): the left side of the photograph, behind the text, is darker (espresso band at 93–95 %). The vein centre on the right is unchanged.
2. Ecosystem (desktop): the same, behind the text on the left.
3. Phones: the hero's upper part is darker behind the headline, and the seed sits slightly lower (72 % of the height, was 64 %). Awakening and Ecosystem are darker behind the text at the bottom.
4. The chapter rail sits a little lower and its buttons are larger tap areas (44 × 44 px); the labels look the same.

## Checked, no change needed

- Keyboard: all story links are native links and buttons in reading order. Focus on a link whose chapter is off screen scrolls to that chapter's resting point. Links in faded text take no pointer clicks. The rail is skipped by the focus scroll.
- Headings: h1 "Make Your Brand Impossible to Ignore.", then an h2 per chapter, h3 for the process steps and services. There is one `<main>`.
- The process step cards that fold to their titles on desktop keep their full text for screen readers (visually hidden, not removed).
- Reduced motion, screens under 520 px high, 200–400 % zoom (which drops the height under 520 px) and no JavaScript: the static layout, with all text visible.
- Nothing moves on its own for more than 5 seconds (2.2.2): the seed's ignition lasts 1.6 s; everything else moves only with the scroll.

## Needs manual verification

- **Screen readers:** VoiceOver (Safari, iOS) and NVDA (Firefox). Read the story start to end with the virtual cursor; tab through the links and confirm each focus lands on visible text after the scroll; confirm the rail buttons announce "02 Awakening" and so on.
- **Real devices:** confirm the phone scrims on an actual iPhone and Android phone, with the browser toolbar shown and hidden.

## Recommended (beyond AA)

- Consider a visible "Skip the story" link before the stage for keyboard users who want to go straight to the enquiry band. The global skip link goes to `#main`, which starts at the story.
