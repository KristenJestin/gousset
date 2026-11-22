import { useState } from "react";

import { cn } from "../lib/utils";

/**
 * A form's error, which fades in when it appears and fades out when it leaves (200 ms, cut under
 * reduced motion). Its line is always there, so that nothing below it jumps.
 */
export function FormMessage({ message }: { message: string | undefined }) {
  // The last message stays rendered while it fades out.
  const [shown, setShown] = useState(message);

  if (message !== undefined && message !== shown) {
    setShown(message);
  }

  const visible = message !== undefined;

  return (
    <p
      role="alert"
      aria-hidden={!visible}
      data-visible={visible}
      className={cn(
        "text-destructive min-h-5 text-sm transition-opacity duration-200 ease-out motion-reduce:transition-none",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      {visible ? message : shown}
    </p>
  );
}
