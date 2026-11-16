import Image from "next/image";
import emblemGold from "@/public/brand/emblem-gold.png";
import wordmarkEspresso from "@/public/brand/wordmark-espresso.png";
import wordmarkIvory from "@/public/brand/wordmark-ivory.png";

/**
 * The CALIX wordmark, from the founder's artwork (calix-logo skill). Never set
 * "CALIX" in a web font as a stand-in. The PNG includes its own padding; at
 * these heights the letters stay above the 90 px minimum width.
 */
export function Wordmark({
  tone = "espresso",
  heightClass = "h-[34px] lg:h-[40px]",
}: {
  tone?: "espresso" | "ivory";
  heightClass?: string;
}) {
  return (
    <Image
      src={tone === "ivory" ? wordmarkIvory : wordmarkEspresso}
      alt="CALIX"
      sizes="140px"
      loading="eager"
      className={`w-auto ${heightClass}`}
    />
  );
}

/**
 * Header lockup: the gold chalice-and-star emblem beside the CALIX wordmark, both the founder's
 * real artwork, only scaled. This horizontal lockup was approved by the founder on 16 November
 * 2026 for the website header (docs/logo-header-lockup.md).
 *
 * Sizes: the emblem's visible height is 48 px on phones (its minimum) and 56 px from 1200 px,
 * with at least a fifth of that clear above and below inside the header. The visible gap between
 * emblem and CALIX is about the height of the letters (X): the files' own padding plus 4 px.
 *
 * Below 412 px wide the two parts at their minimum sizes no longer fit beside the header button,
 * so phones narrower than that show the emblem alone (an approved version). The link around this
 * lockup carries the name "CALIX" for screen readers, since both images may be hidden or empty.
 */
export function HeaderLogo() {
  return (
    <span className="flex items-center gap-1">
      <Image src={emblemGold} alt="" sizes="48px" loading="eager" className="h-[58px] w-auto min-[1200px]:h-[68px]" />
      <Wordmark heightClass="hidden min-[412px]:block h-[34px] lg:h-[40px]" />
    </span>
  );
}
