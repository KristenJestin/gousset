import { useState } from "react";
import type { ReactNode } from "react";

import { Icon } from "./icon";
import { Sheet } from "./sheet";

export type FoldedProps = {
  /** The block's title, on the folded line and at the top of the sheet. */
  title: string;
  /** What the folded line says of the content: a count, a total. */
  summary: ReactNode;
  children: ReactNode;
};

/**
 * A secondary block of a page, folded on a phone (docs/wireframes, screen 11): one line with its
 * title, a summary and a chevron, that opens the content in a sheet; from a tablet up, the
 * content as it is. Goes inside a `Block` with `foldOnPhone`, which leaves it the title.
 *
 * Motion: the sheet's own (it slides up from the bottom, about 300 ms; it fades under reduced
 * motion).
 */
export function Folded({ title, summary, children }: FoldedProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="max-md:hidden">{children}</div>
      <button
        type="button"
        data-slot="folded"
        className="flex h-12 w-full cursor-pointer items-center gap-2 rounded-xl px-4 text-left transition-colors duration-150 hover:bg-muted md:hidden"
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</span>
        <span className="shrink-0 text-sm text-muted-foreground">{summary}</span>
        <span className="flex shrink-0 text-muted-foreground">
          <Icon name="next" size="sm" />
        </span>
      </button>
      <Sheet title={title} open={open} onOpenChange={setOpen}>
        {children}
      </Sheet>
    </>
  );
}
