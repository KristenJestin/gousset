import type { LineToReview, LinesToReview } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { notify } from "@gousset/ui/lib/notify";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { approveLine } from "@/functions/month";

import { invalidateApproval } from "./invalidate";
import { monthKeys } from "./month-keys";
import { withLineBack, withoutLine } from "./review-lines";

/** What an approval took out of the list, to put it back if it is refused. */
type Taken = { line: LineToReview | undefined; index: number };

/**
 * Approves a line to review, optimistically: it leaves the list at once and comes back, with a
 * message, if the server refuses or cannot be reached (docs/architecture.md, "Actions are
 * optimistic"). Approvals may overlap: a refused one puts back its own line only.
 */
export function useApproveLine(month: string) {
  const queryClient = useQueryClient();
  const key = monthKeys.toReview(month);
  const mutationKey = ["approve-line", month];

  const putBack = ({ line, index }: Taken) => {
    if (line !== undefined) {
      queryClient.setQueryData<LinesToReview>(key, (now) =>
        now === undefined ? now : withLineBack(now, line, index),
      );
    }
  };

  const approval = useMutation({
    mutationKey,
    mutationFn: (lineId: string) => approveLine({ data: { lineId } }),

    onMutate: async (lineId): Promise<Taken> => {
      // A refetch landing now would put the line back before the server answers.
      await queryClient.cancelQueries({ queryKey: key });

      const now = queryClient.getQueryData<LinesToReview>(key);

      if (now === undefined) {
        return { line: undefined, index: 0 };
      }

      const { list, line, index } = withoutLine(now, lineId);

      queryClient.setQueryData<LinesToReview>(key, list);

      return { line, index };
    },

    // The server answered, and refused. A line reviewed elsewhere stays away: the server says so.
    onSuccess: (result, _lineId, taken) => {
      if (result.approved) {
        return;
      }

      if (result.code === "LINE_ALREADY_REVIEWED") {
        notify.failed({ description: m.reviewAlreadyReviewed() });

        return;
      }

      putBack(taken);
      notify.failed({ description: m.reviewApproveFailed() });
    },

    // The server could not be reached, or failed: worth another try.
    onError: (_error, lineId, taken) => {
      if (taken !== undefined) {
        putBack(taken);
      }

      notify.failed({
        description: m.reviewApproveFailed(),
        retry: () => approval.mutate(lineId),
      });
    },

    // The month is read again from the server, which has the last word, once the last approval
    // under way has settled: an earlier answer would bring back a line still on its way.
    onSettled: async () => {
      if (queryClient.isMutating({ mutationKey }) === 1) {
        await invalidateApproval(queryClient, month);
      }
    },
  });

  return approval;
}
