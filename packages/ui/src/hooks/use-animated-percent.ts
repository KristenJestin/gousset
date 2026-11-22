import { animate, useMotionValue, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";
import { useEffect } from "react";

import { transition } from "../lib/motion";

/**
 * A percentage that moves to each new value (200 ms, ease-out), as `"37.5%"`, for an SVG
 * attribute (a bar's `width` or `x`): bound to the attribute, Motion writes it at each frame
 * without React rendering. It is SVG geometry, not a CSS layout property: nothing reflows. The
 * first value is drawn at once; Motion skips the move under reduced motion (`ThemeProvider`).
 */
export function useAnimatedPercent(target: number): MotionValue<string> {
  const value = useMotionValue(target);

  useEffect(() => {
    const controls = animate(value, target, transition.base);

    return () => controls.stop();
  }, [value, target]);

  return useTransform(value, (current) => `${String(current)}%`);
}
