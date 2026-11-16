import { StoryPlayer } from "./StoryPlayer";

/**
 * The home page's motion layer: a marker that switches the story chapters
 * (components/home/cinema/Chapters.tsx) into their pinned, scroll-driven layout (app/cinema.css),
 * and the player that loads the story engine. With STORY_PREVIEW=false the build swaps StorySlot
 * for an empty stand-in: no marker, no player, and every chapter stays a static section.
 * See docs/scroll-story-build-plan.md.
 */
export function Story() {
  return (
    <>
      <div data-story-root hidden />
      <StoryPlayer />
    </>
  );
}
