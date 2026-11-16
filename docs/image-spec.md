# CALIX — Home page image spec (14 November 2026)

Image sizes come from the **measured website layout**, not from the source files. Sources are kept untouched; the website uses a master per slot, made by `python scripts/build_web_images.py`, which crops to the slot's aspect ratio, scales **down only** (never enlarges) and writes a quality-90 WebP to `public/cinema/`. Next.js then serves responsive AVIF (or WebP) variants at the widths each `sizes` hint asks for, at quality 85, and never above the master's own width.

> **Since the scroll story (14 November 2026):** the home page no longer shows the plates in fixed containers. The story canvas draws the same masters (`scene-NN.webp`, `awakening-veins-full.webp`) through the optimizer at the width each chapter needs, and the static layout shows them as `next/image` stills (`sizes="(min-width: 900px) 460px, calc(100vw - 40px)"`). The table below records the earlier storyboard layout; the master sizes still hold. Panel 02 is no longer shown on the home page.

## Measured containers (CSS px, built-in browser, 14 November 2026)

| Viewport | Hero plate (scene 01) | Sticky frame plate (02–10) | Inline plate (02–10) |
|---|---|---|---|
| 3840 × 2160 | 515 × 860 | 539 × 900 | hidden |
| 2560 × 1440 | 515 × 860 | 539 × 900 | hidden |
| 1920 × 1080 | 515 × 860 | 539 × 900 | hidden |
| 1440 × 900 | 431 × 720 | 452 × 756 | hidden |
| 1024 × 768 | 368 × 614 | 386 × 645 | hidden |
| 768 × 1024 | 420 × 702 | hidden | 460 × 769 |
| 390 × 844 | 350 × 585 | hidden | 350 × 585 |

Every image slot in the current layout is a **portrait plate** (aspect 1080:1805, the storyboard's own format). The largest container is the sticky frame at 539 × 900 (its height is capped at 900 px, so larger screens do not grow it). There is no full-screen background and no side-by-side or service image in the current layout.

## Slot spec

| Slot | Files | Master (2× the largest container) | `sizes` hint | Fit |
|---|---|---|---|---|
| Portrait plate | `scene-01` … `scene-10` | **1080 × 1805** | hero: `(min-width: 1000px) 515px, (min-width: 768px) 420px, calc(100vw - 40px)` · framed: `539px` · inline: `(min-width: 768px) 460px, calc(100vw - 40px)` | `object-fit: cover`, centred |

Phones at 3× need at most 1050 px wide (350 px × 3), inside the 1080 master. If a full-screen background is added later, its master is **3840 × 2160** (16:9), with `sizes="100vw"`.

## Current state

- **Sources (untouched):** `assets/storyboard/storyboard-source.webp` (the owner's sheet), `assets/storyboard/scene-NN.png` (the ten panels with captions removed, native size, about 304 × 508), `assets/cinema-src/*.png` (the earlier 2048 × 2048 generated set).
- **Upscaled sources (14 November 2026, owner approved):** `assets/storyboard/x4/scene-NN.png`, about 1216 × 2032, made from the native panels with Real-ESRGAN (`realesrgan-x4plus`, realesrgan-ncnn-vulkan v0.2.5.0 from the official xinntao/Real-ESRGAN GitHub release; the tool itself is not kept in the project). This is AI super-resolution, not plain enlargement: it restores texture and edges without changing the composition. Reviewed side by side against bicubic on scenes 01, 04 and 07.
- **All ten plates now meet their 1080 × 1805 master** (78–174 KB WebP q90); `build_web_images.py` reads the `x4` sources and reports no slot below master. On a 1440 px screen the plates request the 750 w AVIF variant (previously capped at 304 px). Real full-resolution renders of the storyboard would still be better than super-resolution and can replace the `x4` files directly.
- **Delivery checked:** the optimizer returns AVIF (scene 01: 6.7 KB) and caps at the master's size (a 1080 w request returns 304 × 508); unlisted qualities are refused. At 1920 × 1080 the hero requests the 640 w variant; on a 390 px phone at 2× it requests 750 w; the sticky-frame images are not downloaded on phones.
- **Protected:** `awakening-veins` (`public/cinema/awakening-veins.webp`, `assets/cinema-src/awakening-veins.png`) is never written by either image script. SHA-256 recorded on 14 November 2026: web `a64fff6e…a9113e5e5`, source `e9a790c3…cbe3121`, unchanged after this work.

## Scroll story (14 November 2026)

- **`awakening-veins-full`** (`public/cinema/awakening-veins-full.webp`, 2048 × 2048, owner approval): a new, separately named file made from the untouched `assets/cinema-src/awakening-veins.png` by `build_web_images.py`, for the full-screen Awakening chapter. The protected `awakening-veins` files are unchanged (SHA-256 checked before and after).
- The story canvas requests its images through the Next.js optimizer at the width it needs (AVIF/WebP, quality 85): scene-01 and scene-04 up to 1080, awakening-veins-full up to 2048 (1920 on phones). The static chapters use `next/image` with `sizes="(min-width: 900px) 460px, calc(100vw - 40px)"`, loaded lazily; in motion mode they are not displayed, so they are not downloaded.
- `components/home/story/engine/veins.json`: the vein paths traced from awakening-veins (read only).

## For the remaining image generation

Each new plate source should be at least **1080 × 1805** in the 1080:1805 portrait ratio. A 4096 × 4096 square source cropped to that ratio gives 2451 × 4096, which is enough. Save sources under `assets/`, add or point the slot in `SLOTS` in `scripts/build_web_images.py`, run the script, and confirm it reports no slot below its master.
