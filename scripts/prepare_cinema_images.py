"""Prepare the cinematic home page images (docs/cinema-image-prompts.md).

Reads source images named after each slot from <src> (default assets/cinema-src), crops each to
its slot's proportions around a focus point, resizes to the slot's size, partially matches the set's
colour statistics so the images read as one shoot, and writes WebP files to <out> (default
public/cinema). Slots without a source are left as they are.

Usage:
  python scripts/prepare_cinema_images.py [--src DIR] [--out DIR] [--no-grade] [--strength 0.4]

Requires Pillow and numpy.
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]

# slot: (width, height, focus x, focus y, alpha, ground) — focus is the point kept in frame when
# cropping (0–1); ground is "dark" or "light" and only steers colour matching into the right group.
SLOTS = {
    "origin-seed": (1920, 1200, 0.62, 0.45, False, "dark"),
    "awakening-rings": (1000, 1300, 0.5, 0.5, False, "light"),
    "awakening-veins": (1000, 1300, 0.5, 0.5, False, "light"),
    "awakening-blades": (1000, 1300, 0.5, 0.45, False, "light"),
    "foundation-strata": (1920, 1200, 0.5, 0.64, False, "dark"),
    "expansion-blade": (1600, 1800, 0.5, 0.5, True, "none"),
    "service-brand": (1200, 1500, 0.5, 0.5, False, "dark"),
    "service-web": (1200, 1500, 0.5, 0.5, False, "dark"),
    "service-marketing": (1200, 1500, 0.5, 0.5, False, "dark"),
    "service-seo": (1200, 1500, 0.5, 0.45, False, "dark"),
    "service-growth": (1200, 1500, 0.5, 0.5, False, "dark"),
    "differentiation": (1920, 1100, 0.5, 0.56, False, "dark"),
    "identity-crown": (1600, 1600, 0.5, 0.45, False, "light"),
    "ecosystem": (1920, 1200, 0.5, 0.45, False, "dark"),
}
EXTS = (".png", ".jpg", ".jpeg", ".webp")
# Never written by this script: the owner's reference image stays exactly as it is.
PROTECTED = {"awakening-veins"}


def find_source(src: Path, slot: str):
    for ext in EXTS:
        p = src / f"{slot}{ext}"
        if p.exists():
            return p
    return None


def crop_to(img: Image.Image, w: int, h: int, fx: float, fy: float) -> Image.Image:
    """Crops to w:h around the focus point, then resizes to w×h."""
    sw, sh = img.size
    target = w / h
    if sw / sh > target:
        cw, ch = round(sh * target), sh
    else:
        cw, ch = sw, round(sw / target)
    left = min(max(round(fx * sw - cw / 2), 0), sw - cw)
    top = min(max(round(fy * sh - ch / 2), 0), sh - ch)
    out = img.crop((left, top, left + cw, top + ch))
    if cw < w or ch < h:
        print(f"    note: source is smaller than {w}×{h} after cropping ({cw}×{ch}); it will be upscaled")
    return out.resize((w, h), Image.LANCZOS)


def key_background(img: Image.Image, tolerance: float = 38.0, feather: float = 22.0) -> Image.Image:
    """Removes a flat background sampled from the four corners (for slots that need transparency)."""
    rgba = img.convert("RGBA")
    a = np.asarray(rgba).astype(np.float32)
    if (a[..., 3] < 250).mean() > 0.02:
        return rgba  # already has transparency
    h, w = a.shape[:2]
    k = max(4, min(h, w) // 40)
    corners = np.concatenate([a[:k, :k, :3].reshape(-1, 3), a[:k, -k:, :3].reshape(-1, 3), a[-k:, :k, :3].reshape(-1, 3), a[-k:, -k:, :3].reshape(-1, 3)])
    bg = np.median(corners, axis=0)
    dist = np.sqrt(((a[..., :3] - bg) ** 2).sum(axis=-1))
    # Only background connected to the border is removed, so light highlights inside the subject
    # (which can be close to the background colour) stay opaque.
    candidate = Image.fromarray(((dist < tolerance + feather) * 255).astype(np.uint8), "L").copy()  # own its pixels, or the fill does not stick
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if candidate.getpixel((x, y)) == 255:
            ImageDraw.floodfill(candidate, (x, y), 128)
    connected = np.asarray(candidate) == 128
    alpha = np.where(connected, np.clip((dist - tolerance) / feather, 0, 1) * 255, 255)
    a[..., 3] = np.minimum(a[..., 3], alpha)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def grade(images: dict, strength: float):
    """Partially matches each image's per-channel mean and spread to its group's average."""
    for group in ("dark", "light"):
        names = [n for n in images if SLOTS[n][5] == group]
        if len(names) < 2:
            continue
        arrays = {n: np.asarray(images[n].convert("RGB")).astype(np.float32) for n in names}
        means = np.mean([a.reshape(-1, 3).mean(0) for a in arrays.values()], axis=0)
        stds = np.mean([a.reshape(-1, 3).std(0) for a in arrays.values()], axis=0)
        for n, a in arrays.items():
            m, s = a.reshape(-1, 3).mean(0), a.reshape(-1, 3).std(0) + 1e-3
            matched = (a - m) / s * stds + means
            out = a + (matched - a) * strength
            images[n] = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", type=Path, default=ROOT / "assets/cinema-src")
    ap.add_argument("--out", type=Path, default=ROOT / "public/cinema")
    ap.add_argument("--no-grade", action="store_true", help="skip colour matching")
    ap.add_argument("--strength", type=float, default=0.4, help="colour matching strength, 0–1 (default 0.4)")
    args = ap.parse_args()

    if not args.src.is_dir():
        sys.exit(f"No source folder at {args.src}. Save generated images there named after each slot (see docs/cinema-image-prompts.md).")
    args.out.mkdir(parents=True, exist_ok=True)

    prepared = {}
    for slot, (w, h, fx, fy, alpha, _) in SLOTS.items():
        if slot in PROTECTED:
            print(f"{slot}: protected, left unchanged")
            continue
        src = find_source(args.src, slot)
        if not src:
            continue
        print(f"{slot}: {src.name}")
        img = Image.open(src)
        img = key_background(img) if alpha else img.convert("RGB")
        prepared[slot] = crop_to(img, w, h, fx, fy)

    if not prepared:
        sys.exit(f"No images found in {args.src}. Expected names: {', '.join(SLOTS)}")
    if not args.no_grade:
        grade(prepared, max(0.0, min(1.0, args.strength)))

    for slot, img in prepared.items():
        path = args.out / f"{slot}.webp"
        img.save(path, "WEBP", quality=84, method=6)
        print(f"  wrote {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path} ({path.stat().st_size // 1024} KB)")

    missing = [s for s in SLOTS if s not in prepared]
    print(f"\n{len(prepared)} of {len(SLOTS)} slots updated." + (f" Still placeholders: {', '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
