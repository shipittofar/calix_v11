"""Builds prototype.html and render-assets.html from their .src.html templates, inlining the live story shader from
components/home/story/mineral.ts so the prototype's renders match the site.

Run from the repository root:  python prototypes/cinematic/build.py
"""
from pathlib import Path

root = Path(__file__).resolve().parents[2]
here = Path(__file__).resolve().parent
ts = (root / "components/home/story/mineral.ts").read_text(encoding="utf-8")
start = ts.index("const FRAG = `") + len("const FRAG = `")
end = ts.index("`;", start)
frag = ts[start:end]
for name in ("prototype", "render-assets"):
    src = (here / f"{name}.src.html").read_text(encoding="utf-8")
    assert "__MINERAL_FRAG__" in src
    (here / f"{name}.html").write_text(src.replace("__MINERAL_FRAG__", frag), encoding="utf-8", newline="\n")
    print("wrote", here / f"{name}.html")
