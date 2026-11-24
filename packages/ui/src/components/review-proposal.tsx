import { useState } from "react";

import { useUiMessages } from "../hooks/use-ui-messages";
import { Button } from "./button";
import { CategoryPicker } from "./category-picker";
import type { CategoryChoice } from "./category-picker";
import { Dialog } from "./dialog";
import { FormMessage } from "./form-message";

/** What accepting does: discard a held repeat, pair a transfer, link a refund, keep a category. */
export type ReviewProposalKind = "duplicate" | "transfer" | "refund" | "category";

export type ReviewProposalProps = {
  kind: ReviewProposalKind;
  /**
   * What Gousset proposes, in one sentence worded by the page: "Discard it: it repeats the line of
   * Oct. 21, CB GREENMARKET, −€52.00."
   */
  proposal: string;
  /** The line's label, which the buttons' names and the dialog say. */
  label: string;
  /** False when there is nothing to accept (a line with no category to keep): Correct alone. */
  acceptable?: boolean;
  onAccept: () => void;
  /** Accepting is on its way: Accept busy, Correct off. */
  accepting?: boolean;
  /**
   * Corrects the line: in the category chosen in the dialog, or, for a held repeat (`duplicate`),
   * `null`: kept as it is, with no dialog.
   */
  onCorrect: (categoryId: string | null) => void;
  /** The correction is on its way: the dialog's submit busy, the dialog held open. */
  correctingSent?: boolean;
  /** Whether the dialog is open: the page's, so that a shortcut opens it too. */
  correcting: boolean;
  onCorrectingChange: (open: boolean) => void;
  /** The categories the dialog offers: the line's kind's, in use. */
  categories: ReadonlyArray<CategoryChoice>;
  /** The category the dialog starts on (the line's own); `null` for none. */
  category: string | null;
  /** A refusal of the correction, worded by the page, under the dialog's field. */
  error?: string;
  /** What the page says under the buttons: a refusal of accepting, a proposal changed meanwhile. */
  notice?: string;
};

/**
 * What Gousset proposes for a line to review (#35), at the top of its detail (`LineDetail`'s
 * `review`): "Gousset proposes", the proposal in one sentence, and two buttons, Accept and Correct,
 * each named with the action and the line ("Accept the proposal for CB GREENMARKET"). Correct opens
 * a `Dialog` holding a `CategoryPicker` of the line's kind, Cancel then "Correct the line"; a
 * refusal stays in it, under the field. For a held repeat, Correct is "Keep it": the line is kept
 * as it is, with no dialog. The page says what happened under the buttons (`notice`).
 *
 * Motion: none of its own; it opens with its detail. The dialog is `Dialog`'s: it fades and grows
 * in 200 ms, ease-out (on a phone it rises from the bottom edge in 300 ms). The line accepted folds
 * away from the list (`OperationsList`'s `foldingId`). Cut under reduced motion.
 */
export function ReviewProposal({
  kind,
  proposal,
  label,
  acceptable = true,
  onAccept,
  accepting = false,
  onCorrect,
  correctingSent = false,
  correcting,
  onCorrectingChange,
  categories,
  category,
  error,
  notice,
}: ReviewProposalProps) {
  const words = useUiMessages().review;
  const [chosen, setChosen] = useState(category);
  const [wasOpen, setWasOpen] = useState(correcting);

  // Each opening of the dialog starts from the line's own category.
  if (correcting !== wasOpen) {
    setWasOpen(correcting);

    if (correcting) {
      setChosen(category);
    }
  }

  const keeps = kind === "duplicate";

  return (
    <div
      data-slot="review-proposal"
      data-kind={kind}
      className="flex flex-col gap-3 rounded-md border border-primary bg-muted px-3 py-3 text-sm"
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">{words.proposes}</p>
        <p className="font-medium break-words text-foreground">{proposal}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {acceptable ? (
          <Button
            size="sm"
            aria-label={words.acceptLabel(label)}
            loading={accepting}
            disabled={correctingSent}
            onClick={onAccept}
          >
            {words.accept}
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          aria-label={keeps ? words.keepLabel(label) : words.correctLabel(label)}
          loading={keeps && correctingSent}
          disabled={accepting}
          onClick={() => {
            if (keeps) {
              onCorrect(null);
            } else {
              onCorrectingChange(true);
            }
          }}
        >
          {keeps ? words.keep : words.correct}
        </Button>
      </div>
      <FormMessage message={notice} />
      {keeps ? null : (
        <Dialog
          title={words.correctTitle}
          description={words.correctDescription(label)}
          open={correcting}
          onOpenChange={onCorrectingChange}
          sending={correctingSent}
          onSubmit={(event) => {
            event.preventDefault();

            if (chosen !== null) {
              onCorrect(chosen);
            }
          }}
          actions={
            <Button type="submit" loading={correctingSent}>
              {words.correctSubmit}
            </Button>
          }
        >
          <CategoryPicker
            label={words.category}
            placeholder={words.categorySearch}
            categories={categories}
            value={chosen}
            onValueChange={setChosen}
            error={error}
            required
          />
        </Dialog>
      )}
    </div>
  );
}

/**
 * Said to screen readers when a line opens in review mode: the line and what Gousset proposes. Its
 * live region (polite) is always there, unseen, and only its text changes: a region inserted with
 * its text is often not announced.
 */
export function ReviewAnnouncer({ message }: { message: string | undefined }) {
  return (
    <p data-slot="review-announcer" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
