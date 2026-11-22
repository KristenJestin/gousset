import { MotionGlobalConfig } from "motion/react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Skips every Motion animation while the system asks for reduced motion, and follows a change
 * while the page is open. Motion reads `MotionGlobalConfig.skipAnimations` each time an animation
 * starts, so elements already on screen follow too; `MotionConfig` and `useReducedMotion` are
 * read once, when an element mounts. The state also shows on `<html data-motion>` ("reduced" or
 * "full"). Returns the function that stops following.
 */
export function followReducedMotion(root: HTMLElement): () => void {
  const media = window.matchMedia(QUERY);

  const apply = () => {
    MotionGlobalConfig.skipAnimations = media.matches;
    root.dataset.motion = media.matches ? "reduced" : "full";
  };

  apply();
  media.addEventListener("change", apply);

  return () => {
    media.removeEventListener("change", apply);
    MotionGlobalConfig.skipAnimations = false;
    delete root.dataset.motion;
  };
}
