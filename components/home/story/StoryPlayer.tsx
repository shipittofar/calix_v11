"use client";

import { useEffect } from "react";
import { CINEMA_MOTION_QUERY } from "@/lib/motion";

/** How long the logo loading screen stays at least, so its opening motion can finish (ms). */
const LOADER_MIN_MS = 1500;
/** How long the loading screen takes to leave (matches cx-loader-out in app/cinema.css, ms). */
const LOADER_OUT_MS = 900;

/**
 * Plays the home page's scroll story (docs/scroll-story-build-plan.md). When motion is allowed
 * (CINEMA_MOTION_QUERY: tall enough screen, no reduced-motion preference) it loads the story
 * engine as a separate chunk after first paint and starts it on the server-rendered chapters
 * (components/home/cinema/Chapters.tsx). When motion is not allowed, or stops being allowed, the
 * engine is stopped and the static chapters show. Scrolling is never intercepted.
 *
 * It also lifts the logo loading screen (started by the pre-paint script in lib/motion.ts) once
 * the story is ready. The loader's state only moves forward, so it never shows twice.
 */
export function StoryPlayer() {
  useEffect(() => {
    const html = document.documentElement;
    const root = document.querySelector<HTMLElement>("[data-cx]");
    const mq = window.matchMedia(CINEMA_MOTION_QUERY);
    let stop: (() => void) | null = null;
    let cancelled = false;
    const timers: number[] = [];

    // Development only: ?motion=off previews the static chapters at any screen size.
    const forcedOff = process.env.NODE_ENV !== "production" && new URLSearchParams(location.search).get("motion") === "off";

    const liftLoader = () => {
      if (html.dataset.loader !== "show") return;
      html.dataset.loader = "leaving";
      timers.push(window.setTimeout(() => { if (html.dataset.loader === "leaving") html.dataset.loader = "done"; }, LOADER_OUT_MS));
    };

    const apply = async () => {
      // The pre-paint script fell back to the static chapters (the engine was not ready within
      // 6 s): keep them for this page view rather than switch layout under the reader.
      if (!root || !mq.matches || forcedOff || html.dataset.cinemaFallback) {
        stop?.();
        stop = null;
        delete html.dataset.cinema;
        liftLoader();
        return;
      }
      if (stop) return;
      html.dataset.cinema = "on";
      try {
        const { startStory } = await import("./engine/stage");
        if (cancelled || !mq.matches || html.dataset.cinemaFallback) return;
        stop = startStory(root);
        html.dataset.cinemaReady = "1";
        const shownAt = (window as Window & { __cxLoaderAt?: number }).__cxLoaderAt ?? 0;
        timers.push(window.setTimeout(liftLoader, Math.max(0, LOADER_MIN_MS - (Date.now() - shownAt))));
      } catch {
        delete html.dataset.cinema; // the static chapters show if the engine cannot load
        liftLoader();
      }
    };

    apply();
    mq.addEventListener("change", apply);
    return () => {
      cancelled = true;
      mq.removeEventListener("change", apply);
      timers.forEach((t) => window.clearTimeout(t));
      stop?.();
      delete html.dataset.cinemaReady;
    };
  }, []);
  return null;
}
