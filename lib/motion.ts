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
 * When it falls back it also sets `data-cinema-fallback`, and StoryPlayer then keeps the static
 * layout for this page view instead of switching layout under the reader.
 *
 * On the home page it starts the logo loading screen once per tab session: `data-loader="show"`,
 * recorded in sessionStorage at once (so even a reload during loading does not show it again),
 * and lifted after 3.2 s at the latest. StoryPlayer lifts it earlier, once the story is ready.
 * The state only moves forward (show → leaving → done), so the loader can never restart.
 */
export const MOTION_BOOT_SCRIPT = `try{var d=document.documentElement;if(matchMedia(${JSON.stringify(SEQUENCE_MOTION_QUERY)}).matches)d.dataset.motion="on";if(matchMedia(${JSON.stringify(CINEMA_MOTION_QUERY)}).matches){d.dataset.cinema="on";if(location.pathname==="/"){try{if(!sessionStorage.getItem("cx-loaded")){sessionStorage.setItem("cx-loaded","1");d.dataset.loader="show";window.__cxLoaderAt=Date.now();setTimeout(function(){if(d.dataset.loader==="show"){d.dataset.loader="leaving";setTimeout(function(){d.dataset.loader="done"},900)}},3200)}}catch(e){}}setTimeout(function(){if(!d.dataset.cinemaReady){delete d.dataset.cinema;d.dataset.cinemaFallback="1";d.dataset.loader="done"}},6000)}}catch(e){}`;
