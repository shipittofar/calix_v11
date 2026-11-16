/**
 * When the home-page scroll sequence (S1) runs as a sticky plate. Used by the
 * pre-paint script in app/layout.tsx and by SequenceController. Below this, or
 * with reduced motion, the static layout is shown (docs/scroll-narrative.md §6.4).
 */
export const SEQUENCE_MOTION_QUERY =
  "(min-width: 1200px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";

/**
 * When the cinematic home page (components/home/cinema, played by components/home/story/StoryPlayer)
 * runs its pinned, scroll-driven acts. Phones included; very short viewports and reduced motion get
 * the static layout, where every scene is a full-height still.
 */
export const CINEMA_MOTION_QUERY = "(min-height: 520px) and (prefers-reduced-motion: no-preference)";

/**
 * The pre-paint script in app/layout.tsx: chooses the scroll-sequence layouts before first paint.
 * Kept here so its exact text can be hashed for a script-src CSP (proxy.ts). If the cinematic
 * controller has not started within six seconds (a failed or blocked script), the flag is dropped
 * and the home page falls back to its static layout, so no scene stays hidden.
 */
export const MOTION_BOOT_SCRIPT = `try{var d=document.documentElement;if(matchMedia(${JSON.stringify(SEQUENCE_MOTION_QUERY)}).matches)d.dataset.motion="on";if(matchMedia(${JSON.stringify(CINEMA_MOTION_QUERY)}).matches){d.dataset.cinema="on";setTimeout(function(){if(!d.dataset.cinemaReady)delete d.dataset.cinema},6000)}}catch(e){}`;
