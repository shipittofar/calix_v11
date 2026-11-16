"""Extract the ten approved storyboard scenes from the owner's storyboard sheet, as sources.

The sheet (assets/storyboard/storyboard-source.webp, 1536×1024, supplied by the owner on
14 November 2026) is a 5×2 grid of portrait panels, each with its stage caption burned into the top
left. For each panel this script:
  1. cuts the panel out at its native resolution (about 304×508 px), with no resizing;
  2. removes the caption: only thin bright letter strokes inside the caption box are detected
     (morphological top-hat) and filled from the surrounding image (OpenCV inpainting), so the
     composition is kept whole rather than cropped.
It writes assets/storyboard/scene-NN.png. It never enlarges anything and never writes to public/:
the website versions are made by scripts/build_web_images.py from these sources.

Usage: python scripts/extract_storyboard.py [--preview DIR]
Requires opencv-python and numpy.
"""
import argparse
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets/storyboard/storyboard-source.webp"
OUT = ROOT / "assets/storyboard"

# Panel boxes on the sheet: columns split by the ivory gutters at x≈305, 614, 923, 1231; rows at y≈508.
COLS = [(0, 304), (306, 613), (615, 922), (924, 1231), (1233, 1536)]
ROWS = [(0, 508), (510, 1024)]
# Caption box inside each panel (title, rule and up to three lines of text), with a small margin.
CAPTION = (22, 28, 290, 148)  # x0, y0, x1, y1


def remove_caption(panel: np.ndarray) -> np.ndarray:
    x0, y0, x1, y1 = CAPTION
    gray = cv2.cvtColor(panel, cv2.COLOR_BGR2GRAY)
    box = gray[y0:y1, x0:x1]
    # Thin bright strokes stand out against their surroundings after a top-hat.
    tophat = cv2.morphologyEx(box, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
    _, strokes = cv2.threshold(tophat, 22, 255, cv2.THRESH_BINARY)
    strokes = cv2.dilate(strokes, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)), iterations=1)
    mask = np.zeros(gray.shape, np.uint8)
    mask[y0:y1, x0:x1] = strokes
    return cv2.inpaint(panel, mask, 4, cv2.INPAINT_TELEA)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", type=Path, help="also write before/after previews here")
    args = ap.parse_args()
    sheet = cv2.imread(str(SRC), cv2.IMREAD_COLOR)
    if sheet is None:
        raise SystemExit(f"Cannot read {SRC}")
    n = 0
    for (ry0, ry1) in ROWS:
        for (cx0, cx1) in COLS:
            n += 1
            panel = sheet[ry0:ry1, cx0:cx1].copy()
            clean = remove_caption(panel)
            cv2.imwrite(str(OUT / f"scene-{n:02d}.png"), clean)
            if args.preview:
                args.preview.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(args.preview / f"scene-{n:02d}-compare.png"), np.hstack([panel, clean]))
            print(f"scene-{n:02d}: {panel.shape[1]}x{panel.shape[0]} (native, not resized)")


if __name__ == "__main__":
    main()
