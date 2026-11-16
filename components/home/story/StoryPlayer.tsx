"use client";

import { useEffect } from "react";
import { CINEMA_MOTION_QUERY } from "@/lib/motion";

/**
 * Plays the home page's scroll story (docs/scroll-story-build-plan.md). When motion is allowed
 * (CINEMA_MOTION_QUERY: tall enough screen, no reduced-motion preference) it loads the story
 * engine as a separate chunk after first paint and starts it on the server-rendered chapters
 * (components/home/cinema/Chapters.tsx). When motion is not allowed, or stops being allowed, the
 * engine is stopped and the static chapters show. Scrolling is never intercepted.
 */
export function StoryPlayer() {
  useEffect(() => {
    const html = document.documentElement;
    const root = document.querySelector<HTMLElement>("[data-cx]");
    const mq = window.matchMedia(CINEMA_MOTION_QUERY);
    let stop: (() => void) | null = null;
    let cancelled = false;

    // Development only: ?motion=off previews the static chapters at any screen size.
    const forcedOff = process.env.NODE_ENV !== "production" && new URLSearchParams(location.search).get("motion") === "off";

    const apply = async () => {
      if (!root || !mq.matches || forcedOff) {
        stop?.();
        stop = null;
        delete html.dataset.cinema;
        return;
      }
      if (stop) return;
      html.dataset.cinema = "on";
      try {
        const { startStory } = await import("./engine/stage");
        if (cancelled || !mq.matches) return;
        stop = startStory(root);
        html.dataset.cinemaReady = "1";
      } catch {
        delete html.dataset.cinema; // the static chapters show if the engine cannot load
      }
    };

    apply();
    mq.addEventListener("change", apply);
    return () => {
      cancelled = true;
      mq.removeEventListener("change", apply);
      stop?.();
      delete html.dataset.cinemaReady;
    };
  }, []);
  return null;
}
