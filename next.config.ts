import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // A full nonce-based Content-Security-Policy is planned (docs/implementation-plan.md §14.1).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
];

/**
 * The olive story on the home page is included in every build, public production builds too
 * (owner decision of 2026-11-13, recorded in docs/imagery-direction.md §5). STORY_PREVIEW=false
 * is the off switch: components/home/story/StorySlot then resolves to an empty stand-in, so neither
 * the section nor its images and motion code are in the build output. See docs/olive-story.md.
 *
 * STORY_PREVIEW=true still selects a separate noindex review build, written to PREVIEW_DIST_DIR,
 * not .next, and requires NOINDEX=true. The pages are prerendered, so a build's noindex setting is
 * fixed in its output: if a preview build replaced .next, a plain `next start` (the production
 * process) would serve noindex on every page. `next start` with STORY_PREVIEW=true serves the
 * preview output, and also requires NOINDEX=true.
 */
const PREVIEW_DIST_DIR = ".next-preview";

function isPreview(phase: string) {
  if (phase !== PHASE_PRODUCTION_BUILD && phase !== PHASE_PRODUCTION_SERVER) return false;
  if (process.env.STORY_PREVIEW !== "true") return false;
  if (process.env.NOINDEX !== "true") {
    throw new Error(
      "STORY_PREVIEW=true selects the noindex review build (written to .next-preview) and requires NOINDEX=true. Public builds include the olive story without it (docs/olive-story.md).",
    );
  }
  return true;
}

/** The story is on unless STORY_PREVIEW=false, in development and production alike. */
function storyEnabled() {
  return process.env.STORY_PREVIEW !== "false";
}

const nextConfig: NextConfig = {
  // Cache Components is deliberately off: with it enabled, a no-JavaScript submission of
  // the enquiry form loses its validation state on re-render (verified on 16.4.0).
  // The form must work without JavaScript (docs/conversion-strategy.md §4.3).
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    // 85 for the storyboard plates (fine texture and gradients); 75 stays the default elsewhere.
    qualities: [75, 85],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default function config(phase: string): NextConfig {
  if (isPreview(phase)) return { ...nextConfig, distDir: PREVIEW_DIST_DIR };
  if (storyEnabled()) return nextConfig;
  return {
    ...nextConfig,
    turbopack: {
      ...nextConfig.turbopack,
      resolveAlias: { "@/components/home/story/StorySlot": "./components/home/story/StorySlot.off.tsx" },
    },
  };
}
