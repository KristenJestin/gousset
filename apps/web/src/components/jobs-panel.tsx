import { Card } from "@gousset/ui/components/card";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { List, ListItem } from "@gousset/ui/components/list";
import { useQuery } from "@tanstack/react-query";

import { listJobs } from "@/functions/jobs";
import { useMessages } from "@/i18n/use-messages";
import type { JobView } from "@/jobs/view";
import { jobKeys } from "@/queries/jobs";

/** How often the panel reads the jobs again. */
const REFRESH_MS = 1000;

/** A job's step and counts, as ids and numbers: the panel is for whoever writes the jobs. */
function whereItIs(view: JobView): string {
  const counts = view.done === null ? "" : ` ${view.done}/${view.total ?? "?"}`;

  return `${view.step ?? "-"}${counts}`;
}

/**
 * Gousset's own panel in TanStack Devtools, in development only (`src/devtools.tsx`): the
 * signed-in user's last jobs, each with its state, its step and counts, and its attempt, read
 * again every second.
 */
export function JobsPanel() {
  const messages = useMessages().jobs.panel;

  const { data = [] } = useQuery({
    queryKey: [...jobKeys.all, "list"],
    queryFn: () => listJobs(),
    refetchInterval: REFRESH_MS,
  });

  return (
    <Card title={messages.title} description={messages.description}>
      {data.length === 0 ? (
        <EmptyState title={messages.empty} size="compact" />
      ) : (
        <List label={messages.title}>
          {data.map((view) => (
            <ListItem
              key={view.id}
              title={`${view.job} ${view.id}`}
              description={whereItIs(view)}
              tags={[view.phase, messages.attempt(view.attempt, view.attempts)]}
            />
          ))}
        </List>
      )}
    </Card>
  );
}
