"""Build the website versions of the home page images from their untouched sources.

Every image slot is sized from the measured website layout (docs/image-spec.md), not from the
source file. For each slot this script:
  1. reads the source (never modified);
  2. crops it to the slot's aspect ratio around a focus point (object-fit: cover on the page does
     the final framing, so nothing is ever stretched);
  3. scales it DOWN to the slot's master size if the source is larger, and never enlarges it;
  4. writes a high-quality WebP master to public/cinema/. Next.js then serves responsive AVIF/WebP
     variants at the widths each `sizes` hint asks for, and never above the master's width.
It reports every slot whose source is smaller than its master size, so the images that still need
higher-resolution sources are listed rather than silently upscaled.

Protected files are never written: public/cinema/awakening-veins.webp (the owner's reference image)
stays exactly as it is.

Usage: python scripts/build_web_images.py [--only scene-01,scene-02]
Requires Pillow.
"""
import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/cinema"
PROTECTED = {"awakening-veins"}

# Portrait plate (storyboard scenes): largest measured container is 539×900 CSS px (sticky frame at
# ≥1920×1080), so a 2× master is 1080×1805; phones at 3× need at most 1050 px wide.
PLATE = (1080, 1805)

# Storyboard panels: the native panels (assets/storyboard/scene-NN.png, ~304x508) upscaled 4x with
# Real-ESRGAN (realesrgan-x4plus, ncnn-vulkan v0.2.5.0) into assets/storyboard/x4/ on 14 November 2026,
# with the owner's approval. The native panels stay untouched as the originals.
# slot: (source, master width, master height, focus x, focus y)
SLOTS = {
    **{
        f"scene-{n:02d}": (ROOT / f"assets/storyboard/x4/scene-{n:02d}.png", *PLATE, 0.5, 0.5)
        for n in range(1, 11)
    },
    # Full-screen Awakening chapter of the scroll story (owner approval, 14 November 2026): a new,
    # separately named file made from the untouched 2048 px source. The protected awakening-veins
    # files themselves are never written.
    "awakening-veins-full": (ROOT / "assets/cinema-src/awakening-veins.png", 2048, 2048, 0.5, 0.5),
    # Foundation chapter ground (owner supplied, 15 November 2026): soil and luminous strata with the
    # olive sapling, used full-bleed behind the roots. Native 1671x941, never enlarged.
    "foundation-ground": (ROOT / "assets/cinema-src/foundation-ground.webp", 1671, 941, 0.5, 0.5),
    # Services 01 Brand window (owner supplied, 15 November 2026): travertine form, olive branch and
    # a gold letterform construction. Native 1086x1448, never enlarged.
    "service-brand-stone": (ROOT / "assets/cinema-src/service-brand-stone.webp", 1086, 1448, 0.5, 0.5),
    # Services 02 Web window (owner supplied, 15 November 2026): a glass browser window over gold
    # mesh waves. Native size, never enlarged.
    "service-web-glass": (ROOT / "assets/cinema-src/service-web-glass.webp", 1086, 1448, 0.5, 0.5),
    # Services 03 Marketing window (owner supplied, 15 November 2026): a dotted gold globe with
    # orbiting channel cards. Native size, never enlarged.
    "service-marketing-globe": (ROOT / "assets/cinema-src/service-marketing-globe.webp", 1086, 1448, 0.5, 0.5),
    # Services 04 SEO & GEO window (owner supplied, 15 November 2026): a search bar above a stone
    # summit marked by a gold location pin. Native size, never enlarged.
    "service-seo-summit": (ROOT / "assets/cinema-src/service-seo-summit.webp", 1086, 1448, 0.5, 0.5),
    # Services 05 Growth window (owner supplied, 15 November 2026): glass bars rising beside an olive
    # tree under a travertine arch. Native size, never enlarged.
    "service-growth-arch": (ROOT / "assets/cinema-src/service-growth-arch.webp", 1086, 1448, 0.5, 0.5),
}


def crop_to_aspect(img: Image.Image, w: int, h: int, fx: float, fy: float) -> Image.Image:
    sw, sh = img.size
    target = w / h
    if abs(sw / sh - target) < 0.005:
        return img
    if sw / sh > target:
        cw, ch = round(sh * target), sh
    else:
        cw, ch = sw, round(sw / target)
    left = min(max(round(fx * sw - cw / 2), 0), sw - cw)
    top = min(max(round(fy * sh - ch / 2), 0), sh - ch)
    return img.crop((left, top, left + cw, top + ch))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated slot names")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    OUT.mkdir(parents=True, exist_ok=True)
    short = []
    for slot, (src, w, h, fx, fy) in SLOTS.items():
        if only and slot not in only:
            continue
        if slot in PROTECTED:
            print(f"{slot}: protected, left unchanged")
            continue
        img = Image.open(src)
        alpha = img.mode in ("RGBA", "LA")
        img = img.convert("RGBA" if alpha else "RGB")
        img = crop_to_aspect(img, w, h, fx, fy)
        if img.width > w:  # scale down only, never up
            img = img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)
        out = OUT / f"{slot}.webp"
        img.save(out, "WEBP", quality=90, method=6)
        status = "ok" if img.width >= w else f"BELOW MASTER (needs a {w}x{h} source)"
        if img.width < w:
            short.append(slot)
        print(f"{slot}: {Image.open(src).size[0]}x{Image.open(src).size[1]} source -> {img.width}x{img.height} master, {out.stat().st_size // 1024} KB, {status}")
    if short:
        print(f"\n{len(short)} slot(s) are served at their source size because the source is smaller than the layout needs: {', '.join(short)}")


if __name__ == "__main__":
    main()
