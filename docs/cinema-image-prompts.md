# CALIX — Image prompts for the cinematic home page

**Decision (13 November 2026):** the owner chose AI-generated imagery for the home page's 14 image slots (direction C, Nocturne; `docs/cinematic-direction.md` §6). The rules in `docs/imagery-direction.md` §5 apply: atmosphere only, never evidence, no people, no client work, no real places.

**How to use this file**
1. Generate the images in any tool (Midjourney, Firefly, DALL·E, Ideogram, Flux…). Make **Origin first**, then use it as the style or image reference for every other slot, so the set looks like one shoot.
2. Generate at the aspect ratio given, as large as the tool allows (at least the target size).
3. Save each pick into `assets/cinema-src/` with the slot's file name (any of `.png`, `.jpg`, `.jpeg`, `.webp`), for example `assets/cinema-src/origin-seed.png`.
4. Run `python scripts/prepare_cinema_images.py`. It crops to the right shape around each slot's focus point, resizes, colour-matches the set, and writes `public/cinema/<slot>.webp`. Reload the site.

---

## The shared style (add to every prompt)

> Fine-art still life photography, low-key, a single soft raking light from the upper left, deep warm espresso-brown darkness, warm travertine-coloured highlights. Abstract organic sculpture of frosted, translucent sage-green mineral with fine antique-gold veins inside, matte stone and satin surfaces, sculptural, biomorphic, asymmetric. Museum gallery photograph, shallow depth of field, subtle film grain, quiet and premium. No text.

**Avoid (negative prompt, or "without …"):** people, hands, faces, figures, text, letters, logos, watermarks, signatures, olives, olive trees, fruit, leaves that look like real plants, flowers, bottles, packaging, products, food, cartoon, illustration, flat vector, 3D render look, plastic, chrome, glass marbles, neon, glowing sci-fi, futuristic AI aesthetic, cubes, spheres, symmetry, busy background, saturated colours, blue, purple.

**Palette to steer towards:** espresso #2E1E14, ivory #F6F1E8, travertine #D9C9A8, antique gold #B08D57, olive #4B5236, muted sage #9AA58A, deep forest #2F3A2A.

---

## The 14 slots

Sizes are the final file sizes; generate at the same proportions or larger. "Keep clear" marks where text sits on top, so that area must stay calm and dark (or calm and light on ivory slots).

### Act I

| File | Ratio | Prompt (add the shared style) | Composition |
|---|---|---|---|
| `origin-seed` | 16:10 (1920×1200) | A single small seed-like sculpture of frosted sage mineral resting on a dark stone plinth in a vast dark room, a narrow beam of light falling across it, faint gold veins just visible inside | Subject right of centre (about 62% across, middle height). **Keep clear:** the left half and the lower left. On phones only the top half shows, so keep the subject above the middle |
| `awakening-rings` | 10:13 (1000×1300) | Extreme close-up of a frosted mineral surface with soft concentric growth rings, like agate or travertine, lit from the side, sage and ivory tones | Fills the frame; abstract texture, no horizon |
| `awakening-veins` | 10:13 (1000×1300) | Macro photograph inside a translucent sage-green stone: fine glowing antique-gold veins branching like a nervous system, soft focus fall-off | Fills the frame; brightest veins in the centre |
| `awakening-blades` | 10:13 (1000×1300) | Thin translucent sage blades unfolding from the top of a frosted mineral form, like a stone beginning to open, on a pale travertine ground | Blades in the upper half, form at the bottom edge |
| `foundation-strata` | 16:10 (1920×1200) | Dark cross-section of layered earth and stone strata in espresso and olive tones, fine pale-gold root-like filaments descending from the top and spreading, lit from one side | Roots enter from the top. **Keep clear:** the lower half (headline and four process steps sit there) |

### Act II

| File | Ratio | Prompt (add the shared style) | Composition |
|---|---|---|---|
| `expansion-blade` | 8:9 (1600×1800), **transparent background** | A single large translucent sage blade or petal sculpture, gently curved, gold veins inside, isolated | Subject fills the frame, nothing else. Export with a transparent background (or on a flat, even background: the script can key it out, see below) |
| `service-brand` | 4:5 (1200×1500) | Brand Strategy & Identity: a rosette of rounded mineral petals opening from a single core, the most defined form in the set | Subject centred; calm dark edges |
| `service-web` | 4:5 (1200×1500) | Web Design & Development: branches of the mineral form built from soft, connected lobes, a structure growing outward in clear stages | Subject centred |
| `service-marketing` | 4:5 (1200×1500) | Digital Marketing: translucent fans spreading wide from the form, light passing through several layers | Subject centred, fans reaching to the sides |
| `service-seo` | 4:5 (1200×1500) | SEO & GEO: flat translucent mineral roots spreading across a dark stone floor in every direction, seen from low | Form at the top third, roots across the lower two thirds |
| `service-growth` | 4:5 (1200×1500) | Growth & Conversion: the mineral form seen from above with smaller stones gathering around it, joined by fine gold lines on the floor | Seen from above; subject centred |

### Differentiation, Identity, Ecosystem

| File | Ratio | Prompt (add the shared style) | Composition |
|---|---|---|---|
| `differentiation` | 16:9 (1920×1100) | Three related mineral sculptures in a row, each with its own character: one smooth sage, one deep forest-green and ribbed, one warm with a burnished gold surface | The image is split into three vertical panels on the page, so put **one sculpture in each third** |
| `identity-crown` | 1:1 (1600×1600) | The mineral form complete: a single coherent crown of petals in sage, forest green, warm grey, smoky rose and gold, united by a fine gold rim, on a pale ivory ground with soft daylight (the one bright image in the set) | Subject centre-right; on phones only the top half shows, so keep the subject high. Light, calm background |
| `ecosystem` | 16:10 (1920×1200) | Wide view from above: the mineral form in the centre with several smaller stones around it on a dark floor, connected by thin glowing gold lines, the room fading into darkness | Subject in the centre. **Keep clear:** the lower left (headline) |

---

## Tool notes

- **Midjourney:** add `--ar 16:10` (or the slot's ratio) and `--style raw`; use the Origin image as a style reference (`--sref <origin image URL>`) for every other slot; keep `--no` for the avoid list.
- **Firefly / DALL·E / Ideogram:** paste the shared style after the slot prompt; choose the closest aspect ratio; use "reference image" with Origin where available.
- **Transparent blade:** generate on a plain, even background (ivory or black). Either remove the background in the tool, or leave it: the script removes a flat background colour sampled from the corners (`--key` is on by default for `expansion-blade`).

## Before publishing

- Check every image for stray text, letters, logos, hands or faces, and for anything that reads as a real plant, fruit or product.
- Keep the generator's terms in mind: some tools restrict commercial use on free plans.
- The images stay decorative (empty alt text): they illustrate the idea, they are not evidence of client work.

---

## Generated set (13 November 2026)

- **Model:** Nano Banana 2 through fal.ai (Composio instant account), 2048×2048 PNG, $0.12 per image. Square only on that account, so every slot was composed for its crop and cut by the script.
- **Spend:** 16 images, **$1.92** in total (14 slots plus two redos).
- **Redone:** `identity-crown` (the first read as jewellery on a plinth) and `expansion-blade` (the first read as a vase). First versions kept in `assets/cinema-src-rejected/`.
- **Prompts used:** the slot prompts above, each with the shared style and avoid list written in, plus composition notes for the square-to-slot crop.
- **Sources:** `assets/cinema-src/<slot>.png`; installed with `python scripts/prepare_cinema_images.py` (focus points tuned for this set: Foundation at 0.64 to keep text on calm strata, Differentiation at 0.56).
- **Checked:** every image reviewed for text, letters, logos, hands, faces, real plants, fruit and products; none found. Crops reviewed on the page at about 800 px wide and 390 px wide.
- **Terms:** generated under fal.ai's terms for the Composio instant account; keep this record with the files.
