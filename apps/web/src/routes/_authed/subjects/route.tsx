import type { SubjectHeadline, SubjectListed } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { PaybackWaiting } from "@gousset/ui/components/payback-waiting";
import {
  SUBJECT_TREE_ACTION,
  SubjectTree,
  SubjectsLayout,
} from "@gousset/ui/components/subject-tree";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { formatMoney } from "@gousset/ui/lib/money";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Outlet, createFileRoute, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { PaybackWaitingLink, SubjectTreeLink } from "@/components/app-link";
import { SubjectSheet } from "@/components/subject-sheet";
import { dayRange, shortDay } from "@/lib/account-day";
import { subjectQueries } from "@/queries/subjects";

/**
 * The subjects (#37; docs/wireframes, screen 5): their tree beside the subject shown, "New" opening
 * the sheet that makes one (screen 8); a user with none yet is shown what a subject is for, and the
 * same button. Under the tree, what the user still waits to be paid back for (#217), each leading
 * to its subject; left out when nothing is waited for.
 */
export const Route = createFileRoute("/_authed/subjects")({
  loader: async ({ context: { queryClient } }) => {
    await Promise.all([
      queryClient.ensureQueryData(subjectQueries.list()),
      queryClient.ensureQueryData(subjectQueries.waiting()),
    ]);
  },
  component: Subjects,
});

/** What a subject's row says at its end: its cost per month this year, or its dates. */
function figureOf(headline: SubjectHeadline, locale: string): string {
  switch (headline.kind) {
    case "monthly":
      return headline.perMonth === null
        ? m.subjectsNothingYet()
        : m.subjectsPerMonth({ amount: formatMoney(headline.perMonth, { locale, whole: true }) });
    case "dated":
      return headline.endsOn === null
        ? m.subjectsFromDay({ day: shortDay(headline.startsOn, locale) })
        : dayRange(headline.startsOn, headline.endsOn, locale);
  }
}

function Subjects() {
  const { data: list } = useSuspenseQuery(subjectQueries.list());
  const { data: waiting } = useSuspenseQuery(subjectQueries.waiting());
  const { currency } = Route.useRouteContext().user;
  const locale = usePageLanguage();
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  // A new sheet each time it opens; the last one stays drawn while it closes.
  const [sheet, setSheet] = useState({ key: 0, open: false });
  const openSheet = () => setSheet({ key: sheet.key + 1, open: true });

  const newSheet = (
    <SubjectSheet
      key={sheet.key}
      open={sheet.open}
      onOpenChange={(open) => setSheet({ ...sheet, open })}
      subject={null}
      subjects={list.subjects}
      currency={currency}
      // Back to the tree's "New": the button that opened it, or, from the empty state, the one that
      // takes its place once the first subject is made (docs/design.md, "Actions and forms").
      finalFocus={SUBJECT_TREE_ACTION}
      onSaved={(saved) => {
        // Shown at once when no subject was: the new one is in the tree otherwise.
        if (matchRoute({ to: "/subjects/$subjectId" }) === false) {
          void navigate({ to: "/subjects/$subjectId", params: { subjectId: saved.id } });
        }
      }}
    />
  );

  if (list.subjects.length === 0) {
    return (
      <Page title={m.subjectsTitle()}>
        <ScreenBlock>
          <EmptyState
            icon="subjects"
            title={m.subjectsEmptyTitle()}
            description={m.subjectsEmptyDescription()}
            action={{ label: m.subjectsNew(), icon: "add", onClick: openSheet }}
          />
        </ScreenBlock>
        {newSheet}
      </Page>
    );
  }

  return (
    <Page title={m.subjectsTitle()}>
      <SubjectsLayout
        tree={
          <>
            <SubjectTree
              label={m.subjectsTree()}
              action={
                <Button size="sm" variant="secondary" icon="add" onClick={openSheet}>
                  {m.subjectsNew()}
                </Button>
              }
            >
              {list.subjects.map((subject: SubjectListed) => (
                <SubjectTreeLink
                  key={subject.id}
                  to="/subjects/$subjectId"
                  params={{ subjectId: subject.id }}
                  name={subject.name}
                  depth={subject.depth}
                  figure={figureOf(subject.headline, locale)}
                  archived={subject.archived}
                />
              ))}
            </SubjectTree>
            {waiting.length === 0 ? null : (
              <PaybackWaiting label={m.subjectsWaitingTitle()}>
                {waiting.map((each) => (
                  <PaybackWaitingLink
                    key={each.subjectId}
                    to="/subjects/$subjectId"
                    params={{ subjectId: each.subjectId }}
                    name={each.path}
                    payer={each.from}
                    standing={each.state}
                    askedOn={each.askedOn === null ? undefined : shortDay(each.askedOn, locale)}
                    waiting={each.waiting}
                    locale={locale}
                  />
                ))}
              </PaybackWaiting>
            )}
          </>
        }
      >
        <Outlet />
      </SubjectsLayout>
      {newSheet}
    </Page>
  );
}
