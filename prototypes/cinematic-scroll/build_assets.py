"""Prepare the assets for the cinematic scroll prototype (chapters 1-3).

Reads untouched sources and writes prototype-only copies into prototypes/cinematic-scroll/img/:
  origin.webp      from assets/storyboard/x4/scene-01.png (storyboard panel 01, AI-upscaled)
  veins.webp       from assets/cinema-src/awakening-veins.png (2048 px original; read only, never changed)
  foundation.webp  from assets/storyboard/x4/scene-04.png
  panel-NN.webp    from assets/storyboard/x4/scene-NN.png for 03, 05-10 (chapters 4-7)
(img/wordmark-ivory.png and img/calix-primary-reversed.png are copies of the real logo files.)
and traces the real gold veins of awakening-veins into vein paths (veins.json): the light pulses in
chapter 2 run along these paths, so they sit on the veins in the photograph.

Usage: python prototypes/cinematic-scroll/build_assets.py
Requires Pillow, numpy and opencv-python.
"""
import hashlib
import json
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
IMG = HERE / "img"
VEINS_SRC = ROOT / "assets/cinema-src/awakening-veins.png"
VEINS_SHA = "e9a790c3c81dfcdd8a8a7f53a58f7c976b2b51e2d145b2f3018e0a4b9cbe3121"
WORK = 1024  # tracing resolution


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def copy_webp(src: Path, out: Path, q: int = 88):
    Image.open(src).convert("RGB").save(out, "WEBP", quality=q, method=6)
    w, h = Image.open(out).size
    print(f"{out.name}: {w}x{h}, {out.stat().st_size // 1024} KB")


def thin(mask: np.ndarray) -> np.ndarray:
    """Zhang-Suen thinning (vectorised)."""
    img = (mask > 0).astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(img, 1)
            P2, P3, P4 = p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:]
            P5, P6, P7 = p[2:, 2:], p[2:, 1:-1], p[2:, :-2]
            P8, P9 = p[1:-1, :-2], p[:-2, :-2]
            nb = [P2, P3, P4, P5, P6, P7, P8, P9]
            B = sum(n.astype(np.int32) for n in nb)
            seq = nb + [P2]
            A = sum(((seq[i] == 0) & (seq[i + 1] == 1)).astype(np.int32) for i in range(8))
            if step == 0:
                c = (P2 * P4 * P6 == 0) & (P4 * P6 * P8 == 0)
            else:
                c = (P2 * P4 * P8 == 0) & (P2 * P6 * P8 == 0)
            rem = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c
            if rem.any():
                img[rem] = 0
                changed = True
        if not changed:
            return img


def trace_veins():
    before = sha(VEINS_SRC)
    assert before == VEINS_SHA, "awakening-veins source differs from the recorded original"
    rgb = cv2.cvtColor(cv2.imread(str(VEINS_SRC)), cv2.COLOR_BGR2RGB)
    small = cv2.resize(rgb, (WORK, WORK), interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(small, cv2.COLOR_RGB2HSV)
    v = hsv[..., 2].astype(np.float32)
    # The veins are thin, bright and warm: a top-hat isolates thin bright lines from the pale stone.
    th = cv2.morphologyEx(v, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
    warm = (small[..., 0].astype(np.int32) - small[..., 2].astype(np.int32)) > 8
    mask = ((th > np.percentile(th, 93)) & warm).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    keep = np.zeros_like(mask)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 60:
            keep[lab == i] = 1
    sk = thin(keep)
    ys, xs = np.nonzero(sk)
    pts = set(zip(ys.tolist(), xs.tolist()))
    centre = (int(WORK * 0.515), int(WORK * 0.52))
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]

    # Shortest-path tree from the point of each component nearest the centre, so every path runs
    # outward from the heart of the veins.
    parent, dist, comp_root = {}, {}, {}
    remaining = set(pts)
    while remaining:
        root = min(remaining, key=lambda p: (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2)
        q = deque([root])
        parent[root], dist[root] = None, 0
        remaining.discard(root)
        while q:
            p = q.popleft()
            comp_root[p] = root
            for dy, dx in nbrs:
                nb = (p[0] + dy, p[1] + dx)
                if nb in remaining:
                    remaining.discard(nb)
                    parent[nb], dist[nb] = p, dist[p] + 1
                    q.append(nb)

    def degree(p):
        return sum(((p[0] + dy, p[1] + dx) in pts) for dy, dx in nbrs)

    ends = [p for p in pts if degree(p) == 1 and dist[p] > 40]
    ends.sort(key=lambda p: -dist[p])
    paths, used = [], set()
    for e in ends:
        chain, p = [], e
        while p is not None:
            chain.append(p)
            p = parent[p]
        chain.reverse()
        fresh = sum(1 for c in chain if c not in used)
        if fresh < 25:
            continue
        used.update(chain)
        root = chain[0]
        rd = ((root[0] - centre[0]) ** 2 + (root[1] - centre[1]) ** 2) ** 0.5
        approx = cv2.approxPolyDP(np.array([[c[1], c[0]] for c in chain], np.int32), 1.2, False)[:, 0, :]
        paths.append({
            "fromCentre": rd < WORK * 0.12,
            "p": [[round(x / WORK, 4), round(y / WORK, 4)] for x, y in approx.tolist()],
        })
        if len(paths) >= 90:
            break
    out = HERE / "veins.json"
    out.write_text(json.dumps({"centre": [centre[1] / WORK, centre[0] / WORK], "paths": paths}, separators=(",", ":")))
    print(f"veins.json: {len(paths)} paths ({sum(p['fromCentre'] for p in paths)} from the centre), {out.stat().st_size // 1024} KB")
    preview = small.copy()
    for pth in paths:
        cv2.polylines(preview, [np.array([[x * WORK, y * WORK] for x, y in pth["p"]], np.int32)], False, (255, 0, 0), 1)
    cv2.imwrite(str(HERE / "veins-trace-preview.jpg"), cv2.cvtColor(preview, cv2.COLOR_RGB2BGR))
    assert sha(VEINS_SRC) == before


def main():
    IMG.mkdir(exist_ok=True)
    copy_webp(ROOT / "assets/storyboard/x4/scene-01.png", IMG / "origin.webp")
    copy_webp(VEINS_SRC, IMG / "veins.webp", 86)
    copy_webp(ROOT / "assets/storyboard/x4/scene-04.png", IMG / "foundation.webp")
    # Chapters 4-7: services windows (panels 06, 07, 08, 09, 03), work backdrop (05), ecosystem (10).
    for n in ("03", "05", "06", "07", "08", "09", "10"):
        copy_webp(ROOT / f"assets/storyboard/x4/scene-{n}.png", IMG / f"panel-{n}.webp", 84)
    trace_veins()
    print("awakening-veins source unchanged:", sha(VEINS_SRC) == VEINS_SHA)


if __name__ == "__main__":
    main()
