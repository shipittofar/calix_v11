import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { StorySlot } from "@/components/home/story/StorySlot";
import { Chapters } from "@/components/home/cinema/Chapters";
import { FinalCta } from "@/components/home/HomeSections";

export const metadata: Metadata = pageMetadata({
  title: "CALIX — Brand identity, web design and growth studio",
  absoluteTitle: true,
  description:
    "CALIX connects brand strategy and identity, website design and development, digital marketing, SEO and GEO, and conversion optimisation for growing brands.",
  path: "/",
});

/**
 * The home page as the seven-chapter scroll story (docs/scroll-story-build-plan.md):
 * 01 Origin (hero) · 02 Awakening · 03 Foundation (process) · 04 Services · 05 Work ·
 * 06 Identity (credibility) · 07 Ecosystem (the enquiry band).
 */
export default function HomePage() {
  return (
    <>
      {/* The motion layer: on in every build unless STORY_PREVIEW=false (next.config.ts). */}
      <StorySlot />
      <Chapters />
      <FinalCta />
    </>
  );
}
