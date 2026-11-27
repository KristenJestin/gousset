import type { ReactNode } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { Icon } from "./icon";

/**
 * A line that pays a subject back (#217), in its detail (`LineDetail`'s `transfer`, in place of a
 * transfer: such a line is classified by its subject, as a transfer's side is by its transfer):
 * "Pays back" and the subject, a link to its page (`subject`, the app's), and that it is not
 * income. It is detached on the subject's page.
 *
 * Motion: none of its own.
 */
export function LinePayback({ subject }: { subject: ReactNode }) {
  const messages = useUiMessages().subjects;

  return (
    <div data-slot="line-payback" className="flex flex-col gap-2 border-t pt-4">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
        <Icon name="subjects" size="sm" />
        <span>{messages.paysBack}</span>
        {subject}
      </p>
      <p className="text-xs text-muted-foreground">{messages.paybackNote}</p>
    </div>
  );
}
