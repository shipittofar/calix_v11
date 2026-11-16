# CALIX — Home page built on the approved storyboard (14 November 2026)

**Superseded on 14 November 2026 by the seven-chapter scroll story (`docs/scroll-story-build-plan.md`, prototype record `docs/scroll-story-prototype.md`).** The storyboard panels remain in use as photographic material inside the new chapters. The code described below (`Scenes.tsx` and its player) was archived to `prototypes/archive/story-storyboard/` and removed from the source tree. Earlier status: built. The owner's ten-panel storyboard is the source of truth for the home page's art direction; the scenes, images and captions come from it directly. Supersedes the Nocturne build (`docs/cinematic-direction.md`), the mineral image set and the surreal concepts (`docs/surreal-direction.md`).

## Source and image quality

- **Source:** one image supplied by the owner in conversation, `assets/storyboard/storyboard-source.webp`, 1536×1024 px: a 5×2 grid of portrait panels with each stage caption printed on the panel.
- **Extraction:** `python scripts/extract_storyboard.py` cuts each panel at native size (about 304×508 px) and removes the printed caption by inpainting only the letter strokes; it writes `assets/storyboard/scene-NN.png` and nothing else. Website masters come from `python scripts/build_web_images.py` (`docs/image-spec.md`), which never enlarges.
- **Resolution:** the native panels are smaller than the layout's 1080×1805 master. On 14 November 2026, at the owner's request, they were upscaled 4× with Real-ESRGAN (AI super-resolution) into `assets/storyboard/x4/`, and the masters are now built from those at full size (`docs/image-spec.md`). An earlier plain 4× enlargement had been removed at the owner's request; this replaces it with real detail recovery. Original full-resolution renders would still be better.
- **No new images were generated** for this build (owner's instruction); no spend.

## Scenes and page mapping

| Scene | Storyboard caption | Page content |
|---|---|---|
| 01 Origin | An idea appears — a single point of light in a quiet space. | Hero: headline, lead, buttons, reply time |
| 02 Awakening | The idea creates movement, finding energy in unexpected places. | Positioning |
| 03 Discovery | New elements enter, revealing different possibilities. | Services index (`#services`) |
| 04 Foundation | The pieces begin to align, establishing a coherent structure. | Process steps and how we work (`#process`) |
| 05 Character | The identity develops its own personality and distinctive character. | Selected work (`#work`), approved projects only |
| 06 Identity | A recognizable signature emerges. | Brand Strategy & Identity |
| 07 Language | Typography, colors, materials and imagery come together in a unified visual language. | Web Design & Development |
| 08 Expression | The identity appears across different formats and experiences. | Digital Marketing |
| 09 Ecosystem | Different expressions connect and form a coherent world. | SEO & GEO, Growth & Conversion |
| 10 Beyond | A complete identity, always evolving. | Credibility (`#credibility`), then the enquiry band |

Scenes 07–09 show the storyboard's invented brand ("MINERAL") and carry the label "Illustration, not client work".

## Code

- `components/home/cinema/Scenes.tsx`: `Origin` (hero, scene 01) and `Scenes` (02–10). `app/page.tsx`: `StorySlot`, `Origin`, `Scenes`, `FinalCta`.
- `components/home/story/StoryPlayer.tsx`: GSAP ScrollTrigger. Hero plate opens through a slit of light on load; on screens 1000 px and wider, scenes 02–10 share a sticky portrait frame and each plate wipes in on a diagonal with a push-in as its text crosses the screen; on narrower screens each inline plate reveals on the same diagonal; titles rise out of a word mask.
- Ambient motion (14 November 2026, `app/cinema.css`): every plate drifts slowly like a camera (scale and translate on `.sb-plate__drift`, 22–26 s), a soft ivory band of light passes across every 11 s, and on scenes 01, 02 and 04 a gold glint pulses on the sphere. GSAP scales the outer `.sb-plate__media`, so the two never fight over one transform. Solid palette fills only (no gradients or rounded corners); all of it is off under `prefers-reduced-motion`.
- `app/cinema.css`: static layout first (every plate inline); motion rules only under `html[data-cinema="on"]:has([data-story-root])`. Smooth `scroll-behavior` is switched off while the story runs, because it made ScrollTrigger measure mid-scroll and mistime every plate.
- No longer used on the home page: `components/home/cinema/Acts.tsx`, `components/home/story/grain.ts`, and the earlier images in `public/cinema/` (mineral set and Nocturne placeholders). They can be removed in a separate change.

## Checked (14 November 2026)

`npm run typecheck`, `npm run lint`, `npm run check:story` (24 checks), `npm run build` and `check-story output .next public` pass; the palette checker reports 0 issues in `app/cinema.css`. In the built-in browser: at 1440 × 900 the sticky frame and nine plates are in place with no horizontal overflow; at 390 × 844 every plate shows inline at 350×585 with no overflow. Caption removal reviewed on all ten panels.

**Not verified:** the scroll animation's timing after the scroll-behavior fix. The browser pane was hidden, which pauses animation frames, so the plates could not be watched changing. Also untested: Safari, Firefox, real phones.
