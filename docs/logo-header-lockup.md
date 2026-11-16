# Header logo lockup

**Approved by the founder on 16 November 2026**, for the website header only.

The logo specification (calix-logo skill, `references/logo-spec.md`) approves four versions: primary (emblem above CALIX and CREATIVE STUDIO), compact (emblem above CALIX), emblem only and wordmark only. For the header the founder approved one more arrangement: the chalice-and-star emblem **beside** the CALIX wordmark, in one row.

## How it is built

- **Artwork:** the real files, only scaled uniformly. `public/brand/emblem-gold.png` (copied unchanged from the skill's `assets/emblem-gold.png`) and `public/brand/wordmark-espresso.png`. Nothing is redrawn, recoloured or set in a web font.
- **Order:** emblem on the left, CALIX on the right, both centred vertically.
- **Sizes:**
  - Emblem: 48 px visible height on phones and tablets (its minimum), 56 px from 1200 px wide (image heights 58 px and 68 px, including the file's own padding).
  - CALIX: unchanged, at least 90 px wide (image heights 34 px, and 40 px from 1024 px wide).
- **Gap:** about the height of the CALIX letters (X), made of the two files' own padding plus 4 px.
- **Clear space:** the header is 68 px tall on phones and tablets (was 64 px) and 80 px from 1200 px wide, so the emblem keeps at least a fifth of its height clear above and below.
- **Colours:** gold emblem with espresso type on the ivory header, as in the primary logo.
- **Narrow phones:** below 412 px wide, the emblem and CALIX at their minimum sizes do not fit beside the header button ("Start a Project" and Menu). There the header shows the emblem alone, which is an approved version; the brand name is in the hero just below.
- **Accessibility:** the home link is labelled "CALIX" (`aria-label`), so it keeps its name when the wordmark is hidden on narrow phones. The emblem image is decorative (`alt=""`).

Code: `HeaderLogo` in `components/layout/Wordmark.tsx`, used by `components/layout/SiteHeader.tsx`. The footer still uses the wordmark alone.

Any other use of this horizontal arrangement (stationery, social media, signage) needs its own approval.
