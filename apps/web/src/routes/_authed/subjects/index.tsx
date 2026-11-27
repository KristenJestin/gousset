import { createFileRoute, redirect } from "@tanstack/react-router";

import { subjectQueries } from "@/queries/subjects";

/**
 * The subjects' screen with none chosen: the first open subject of the tree is shown (the first
 * archived one when all are), so that the screen opens on a subject's page; with none at all, the
 * screen says what a subject is for.
 */
export const Route = createFileRoute("/_authed/subjects/")({
  loader: async ({ context: { queryClient } }) => {
    const list = await queryClient.ensureQueryData(subjectQueries.list());
    const first = list.subjects.find((subject) => !subject.archived) ?? list.subjects[0];

    if (first !== undefined) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's redirects are thrown by design.
      throw redirect({
        to: "/subjects/$subjectId",
        params: { subjectId: first.id },
        replace: true,
      });
    }
  },
  component: () => null,
});
