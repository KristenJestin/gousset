import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { Option, Schema } from "effect";
import { useEffect } from "react";

import { JobView, isOver } from "@/jobs/view";

import { invalidateTouched } from "./invalidate";

/**
 * The jobs domain's query keys (docs/architecture.md, "Data loading and skeletons"). A job's view
 * is never fetched: its stream writes it into the cache (`useJob`), where TanStack Query's
 * devtools show it beside the rest.
 */
export const jobKeys = {
  all: ["job"] as const,
  of: (id: string) => [...jobKeys.all, id] as const,
};

const decodeView = Schema.decodeUnknownOption(Schema.fromJsonString(JobView));

/** How long before connecting again to a stream the server refused: doubled each time. */
const RECONNECT_MS = { first: 1000, last: 30_000 };

/** The address of a job's stream (`routes/api/jobs/$jobId/events.ts`). */
const eventsOf = (id: string) => `/api/jobs/${encodeURIComponent(id)}/events`;

/**
 * Follows a job live, from its Server-Sent Events: where it stands now, then each change, until it
 * is over. Its end invalidates the queries of what it touched, once, so that what is on screen is
 * read again. The browser connects again by itself when the stream drops (an app restart); a
 * stream refused while the app starts is asked for again, waiting longer each time.
 */
export function useJob(id: string | undefined): JobView | undefined {
  const queryClient = useQueryClient();

  const { data } = useQuery<JobView>({
    queryKey: jobKeys.of(id ?? ""),
    queryFn: skipToken,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (id === undefined) {
      return;
    }

    let source: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let delay = RECONNECT_MS.first;
    let invalidated = false;
    let finished = false;

    const connect = () => {
      const opened = new EventSource(eventsOf(id));

      source = opened;

      opened.addEventListener("message", (event) => {
        const view = decodeView(event.data);

        if (Option.isNone(view)) {
          return;
        }

        delay = RECONNECT_MS.first;
        queryClient.setQueryData(jobKeys.of(id), view.value);

        if (view.value.touched !== null && !invalidated) {
          invalidated = true;
          void invalidateTouched(queryClient, view.value.touched);
        }

        if (isOver(view.value)) {
          finished = true;
          opened.close();
        }
      });

      opened.addEventListener("error", () => {
        if (finished || opened.readyState !== EventSource.CLOSED) {
          return;
        }

        retry = setTimeout(connect, delay);
        delay = Math.min(delay * 2, RECONNECT_MS.last);
      });
    };

    connect();

    return () => {
      finished = true;
      clearTimeout(retry);
      source?.close();
    };
  }, [id, queryClient]);

  return id === undefined ? undefined : data;
}
