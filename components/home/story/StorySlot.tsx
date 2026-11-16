import { Story } from "./Story";

/**
 * Where the olive story sits on the home page. Included in every build; with STORY_PREVIEW=false,
 * next.config.ts resolves this module to StorySlot.off.tsx, so the section, its generated
 * imagery and its motion code are left out of the build entirely.
 */
export function StorySlot() {
  return <Story />;
}
