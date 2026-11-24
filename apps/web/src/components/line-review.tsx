import type {
  LineAccount,
  LineCategory,
  LineDetail as Line,
  QueuedLine,
  ReviewProposal as Proposal,
} from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { ReviewProposal } from "@gousset/ui/components/review-proposal";
import { formatMoney } from "@gousset/ui/lib/money";
import { notify } from "@gousset/ui/lib/notify";
import { uiLocaleOf } from "@gousset/ui/lib/messages";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { acceptLine, correctLine } from "@/functions/review";
import type { ReviewRefusalCode } from "@/functions/review";
import { reviewRefusalMessage } from "@/i18n/messages";
import { shortDay } from "@/lib/account-day";
import { categoryPath, choicesOf } from "@/lib/categories";
import { aDialogIsOpen } from "@/lib/dialog-open";
import { categoryQueries } from "@/queries/categories";
import { invalidateTouched } from "@/queries/invalidate";
import { appHotkeys } from "@/shortcuts";

/** Which plural form a count takes, in each language: built once. */
const PLURALS = {
  en: new Intl.PluralRules("en"),
  fr: new Intl.PluralRules("fr"),
};

/** "1 other is shown below.", after a proposal that has more candidates; nothing for none. */
function othersText(count: number, locale: string): string {
  if (count === 0) {
    return "";
  }

  return ` ${
    PLURALS[uiLocaleOf(locale)].select(count) === "one"
      ? m.reviewProposalOthersOne({ count })
      : m.reviewProposalOthersOther({ count })
  }`;
}

/** What Gousset proposes for a line to review, in one sentence. */
export function proposalText(
  proposal: Proposal,
  locale: string,
  nameOf: (account: LineAccount) => string,
): string {
  switch (proposal.kind) {
    case "duplicate": {
      const { of } = proposal;

      return of === null
        ? m.reviewProposalDuplicateGone()
        : m.reviewProposalDuplicate({
            day: shortDay(of.bookedOn, locale),
            label: of.label,
            amount: formatMoney(of.amount, { locale }),
          });
    }

    case "transfer": {
      const { candidate } = proposal;

      return `${m.reviewProposalTransfer({
        day: shortDay(candidate.bookedOn, locale),
        account: nameOf(candidate.account),
        amount: formatMoney(candidate.amount, { locale }),
      })}${othersText(proposal.others, locale)}`;
    }

    case "refund": {
      const { line, category, net } = proposal.expense;

      return `${m.reviewProposalRefund({
        day: shortDay(line.bookedOn, locale),
        label: line.label,
        category: categoryPath(category),
        amount: formatMoney(net, { locale }),
      })}${othersText(proposal.others, locale)}`;
    }

    case "category": {
      const { category, merchant } = proposal;

      if (category === null) {
        return m.reviewProposalNoCategory();
      }

      return merchant === null
        ? m.reviewProposalCategory({ category: categoryPath(category) })
        : m.reviewProposalCategoryMerchant({
            category: categoryPath(category),
            merchant: merchant.name,
          });
    }
  }
}

/** Refusals after which what the page shows of the line is read again: it changed meanwhile. */
const STALE: ReadonlySet<ReviewRefusalCode | "FAILED"> = new Set([
  "LINE_NOT_FOUND",
  "ALREADY_REVIEWED",
  "PROPOSAL_CHANGED",
  "NOT_HELD",
  "CANNOT_PAIR",
  "CANNOT_LINK",
]);

const FAILED = { ok: false as const, code: "FAILED" as const };

type LineReviewProps = {
  line: Line;
  queued: QueuedLine;
  /** The key of the proposal shown, which accepting gives back (`proposalKey`). */
  seen: string;
  /** The line's label, as the page names it. */
  label: string;
  nameOf: (account: LineAccount) => string;
  locale: string;
  /** The line's review is done (accepted, or corrected into `category`): it leaves the list. */
  onReviewed: (lineId: string, category: LineCategory | null) => Promise<void>;
};

/**
 * The open line's review (#35), at the top of its detail: what Gousset proposes, accepted or
 * corrected. Accepted, or corrected into a category, the line's review is done (`onReviewed`); a
 * held repeat kept stays to review, its category now Gousset's guess, and is read again. A refusal
 * of accepting shows under the buttons, of a correction under the dialog's field; one that says the
 * line changed meanwhile reads it again. A and C do the same as the buttons.
 */
export function LineReview({
  line,
  queued,
  seen,
  label,
  nameOf,
  locale,
  onReviewed,
}: LineReviewProps) {
  const queryClient = useQueryClient();
  const { data: tree } = useQuery(categoryQueries.list());
  const [pending, setPending] = useState<"accept" | "correct">();
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const { proposal } = queued;
  const keeps = proposal.kind === "duplicate";
  const acceptable = proposal.kind !== "category" || proposal.category !== null;
  const kind = line.amount.minor < 0 ? "expense" : "income";

  /** Says a refusal where it belongs, and reads the line again when it changed meanwhile. */
  const refused = async (code: ReviewRefusalCode | "FAILED", inDialog: boolean) => {
    if (inDialog) {
      setError(reviewRefusalMessage(code));
    } else {
      setNotice(reviewRefusalMessage(code));
    }

    if (STALE.has(code)) {
      await invalidateTouched(queryClient, { months: [] });
    }
  };

  const accept = async () => {
    if (pending !== undefined || !acceptable) {
      return;
    }

    setPending("accept");
    setNotice(undefined);

    const answer = await acceptLine({ data: { lineId: line.id, seen } }).catch(() => FAILED);

    if (!answer.ok) {
      setPending(undefined);
      await refused(answer.code, false);

      return;
    }

    // Busy until the next line opens: a second press must not reach this one again.
    await onReviewed(line.id, null);
    setPending(undefined);
  };

  const correct = async (categoryId: string | null) => {
    if (pending !== undefined) {
      return;
    }

    setPending("correct");

    const answer = await correctLine({
      data: { lineId: line.id, categoryId: categoryId ?? undefined },
    }).catch(() => FAILED);

    if (!answer.ok) {
      setPending(undefined);
      await refused(answer.code, categoryId !== null);

      return;
    }

    setError(undefined);
    setCorrecting(false);

    if (answer.category === null) {
      // A held repeat kept: it counts now, and its category is still to review.
      setPending(undefined);
      notify.saved({ description: m.reviewKept() });
      await invalidateTouched(queryClient, { everyMonth: true });

      return;
    }

    await onReviewed(line.id, answer.category);
    setPending(undefined);
  };

  // A and C act on this line while it is open, never while a dialog is open; a field that has the
  // focus keeps its keys (TanStack Hotkeys leaves typing alone).
  useHotkey(appHotkeys["review.accept"], () => {
    if (!aDialogIsOpen()) {
      void accept();
    }
  });

  useHotkey(appHotkeys["review.correct"], () => {
    if (aDialogIsOpen()) {
      return;
    }

    if (keeps) {
      void correct(null);
    } else if (pending === undefined) {
      setCorrecting(true);
    }
  });

  return (
    <ReviewProposal
      kind={proposal.kind}
      proposal={proposalText(proposal, locale, nameOf)}
      label={label}
      acceptable={acceptable}
      onAccept={() => void accept()}
      accepting={pending === "accept"}
      onCorrect={(categoryId) => void correct(categoryId)}
      correctingSent={pending === "correct"}
      correcting={correcting}
      onCorrectingChange={(open) => {
        setError(undefined);
        setCorrecting(open);
      }}
      categories={tree === undefined ? [] : choicesOf(tree, kind)}
      category={line.category?.id ?? null}
      error={error}
      notice={notice}
    />
  );
}
