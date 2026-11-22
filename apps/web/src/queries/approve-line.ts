import type { LinesToReview } from "@gousset/core";
import { notify } from "@gousset/ui/lib/notify-stand-in";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { approveLine } from "@/functions/month";
import { useMessages } from "@/i18n/use-messages";

import { invalidateTouched } from "./invalidate";
import { monthKeys } from "./month";

/**
 * Approves a line to review, optimistically: it leaves the list at once and comes back, with a
 * message, if the server refuses or cannot be reached (docs/architecture.md, "Actions are
 * optimistic").
 */
export function useApproveLine(month: string) {
  const queryClient = useQueryClient();
  const messages = useMessages();
  const key = monthKeys.toReview(month);

  const putBack = (before: LinesToReview | undefined) => {
    if (before !== undefined) {
      queryClient.setQueryData(key, before);
    }
  };

  const approval = useMutation({
    mutationFn: (lineId: string) => approveLine({ data: { lineId } }),

    onMutate: async (lineId) => {
      // A refetch landing now would put the line back before the server answers.
      await queryClient.cancelQueries({ queryKey: key });

      const before = queryClient.getQueryData<LinesToReview>(key);

      if (before !== undefined) {
        const lines = before.lines.filter((line) => line.id !== lineId);

        queryClient.setQueryData<LinesToReview>(key, { ...before, lines, count: lines.length });
      }

      return { before };
    },

    // The server answered, and refused.
    onSuccess: (result, _lineId, context) => {
      if (!result.approved) {
        putBack(context.before);
        notify.failed({
          description:
            result.code === "LINE_ALREADY_REVIEWED"
              ? messages.review.alreadyReviewed
              : messages.review.approveFailed,
        });
      }
    },

    // The server could not be reached, or failed: worth another try.
    onError: (_error, lineId, context) => {
      putBack(context?.before);
      notify.failed({
        description: messages.review.approveFailed,
        retry: () => approval.mutate(lineId),
      });
    },

    // Whatever the answer, the month is read again from the server, which has the last word.
    onSettled: () => invalidateTouched(queryClient, { months: [month] }),
  });

  return approval;
}
