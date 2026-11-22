import { Tooltip as TooltipRoot, TooltipContent, TooltipTrigger } from "@ui-sdk/react/tooltip";
import type { ReactElement } from "react";

import { tooltipClasses } from "../lib/overlay-classes";

export type TooltipProps = {
  /** A few words of plain text: a tooltip cannot hold a link or a button. */
  text: string;
  /**
   * The control it describes, as one element that forwards its props and ref (a `Button`, a
   * native element). It opens on hover after a short rest and at once on keyboard focus.
   */
  children: ReactElement;
  /** Where it opens; it flips when there is no room. */
  side?: "top" | "bottom" | "left" | "right";
};

/**
 * A short hint on a control, on ui-sdk's `Tooltip`. It describes a control that already has a
 * name; an icon-only button is `IconButton`, whose label is its tooltip.
 *
 * Motion: it fades and grows from its trigger in 150 ms, ease-out, and leaves the same way; the
 * next tooltip along a toolbar opens at once, without the animation. Cut under reduced motion.
 */
export function Tooltip({ text, children, side = "top" }: TooltipProps) {
  return (
    <TooltipRoot>
      <TooltipTrigger render={children} />
      <TooltipContent side={side} className={tooltipClasses}>
        {text}
      </TooltipContent>
    </TooltipRoot>
  );
}
