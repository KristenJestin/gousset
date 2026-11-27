import type { RuleSummary } from "@gousset/core";
import { m } from "@gousset/i18n/messages";
import { Block, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Button } from "@gousset/ui/components/button";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { RulesList } from "@gousset/ui/components/rules-list";
import type { RulesListRow } from "@gousset/ui/components/rules-list";
import { usePageLanguage } from "@gousset/ui/hooks/use-page-language";
import { notify } from "@gousset/ui/lib/notify";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { RuleJobNotice } from "@/components/rule-job";
import { RuleSheet } from "@/components/rule-sheet";
import { moveRule } from "@/functions/rules";
import { ruleRefusalMessage } from "@/i18n/messages";
import { categoryPath } from "@/lib/categories";
import { drawnConditions } from "@/lib/rule-conditions";
import { categoryQueries } from "@/queries/categories";
import { ruleQueries } from "@/queries/rules";

/**
 * The rules (#25; docs/wireframes, screen 9): each as a sentence, "if… then…", in the order they
 * are tried, with how many lines it changed and the subject it attaches (#37); one opens in a side sheet to change it, see its
 * effect on the lines already there, apply it to the past, turn it off or delete it. "Add a rule"
 * opens the same sheet, empty; with no rule at all, the page says what rules are.
 *
 * Motion: the rows fade and slide up on first paint (200 ms, staggered), a rule moved slides in
 * from where it was (200 ms) (`RulesList`); the sheet slides in from the right in about 300 ms
 * (`RuleEditor`); a rule applied to the past says the lines it changed in a fade (200 ms), or in a
 * toast once its sheet is closed. Cut under reduced motion.
 */
export const Route = createFileRoute("/_authed/settings/rules")({
  loader: async ({ context: { queryClient } }) => {
    await queryClient.ensureQueryData(ruleQueries.list());
    // A rule's category is chosen among them as soon as its sheet opens.
    void queryClient.prefetchQuery(categoryQueries.list());
  },
  component: Rules,
});

/** The sheet opened, on which rule (none for a new one), and its opening's count. */
type Opening = { key: number; ruleId: string | null };

/** The rule moved last, and which way: it slides in from there. */
type Moved = { id: string; direction: "up" | "down"; turn: number };

function Rules() {
  const { data } = useSuspenseQuery(ruleQueries.list());
  const { currency } = Route.useRouteContext().user;
  const queryClient = useQueryClient();
  const locale = usePageLanguage();
  // The last sheet opened stays drawn while it closes, so that it leaves as it came.
  const [opening, setOpening] = useState<Opening>();
  const [open, setOpen] = useState(false);
  const [moved, setMoved] = useState<Moved>();
  // Rules applied to the past from a sheet now closed: a toast follows each one's job.
  const [jobs, setJobs] = useState<ReadonlyArray<string>>([]);

  const accounts = data.accounts.map((account) => ({ id: account.id, name: account.name }));

  const show = (ruleId: string | null) => {
    setOpening({ key: (opening?.key ?? 0) + 1, ruleId });
    setOpen(true);
  };

  async function move(ruleId: string, place: number) {
    const from = data.rules.findIndex((rule) => rule.id === ruleId) + 1;

    const answer = await moveRule({ data: { ruleId, place } }).catch(() => ({
      ok: false as const,
      code: "UNKNOWN",
    }));

    if (!answer.ok) {
      notify.failed({ description: ruleRefusalMessage(answer.code) });

      return;
    }

    queryClient.setQueryData(ruleQueries.list().queryKey, answer.list);
    setMoved({
      id: ruleId,
      direction: place < from ? "up" : "down",
      turn: (moved?.turn ?? 0) + 1,
    });
  }

  const sheet =
    opening === undefined ? null : (
      <RuleSheet
        key={opening.key}
        ruleId={opening.ruleId}
        open={open}
        onOpenChange={setOpen}
        accounts={accounts}
        subjects={data.subjects}
        currency={currency}
        onApplied={(jobId) => setJobs([...jobs, jobId])}
      />
    );

  const notices = jobs.map((jobId) => <RuleJobNotice key={jobId} jobId={jobId} />);

  if (data.rules.length === 0) {
    return (
      <>
        <ScreenBlock>
          <EmptyState
            icon="rules"
            title={m.rulesEmptyTitle()}
            description={m.rulesEmptyDescription()}
            action={{ label: m.rulesAdd(), icon: "add", onClick: () => show(null) }}
          />
        </ScreenBlock>
        {sheet}
        {notices}
      </>
    );
  }

  return (
    <>
      <Block
        title={m.settingsNavRules()}
        description={m.rulesDescription()}
        actions={
          <Button icon="add" onClick={() => show(null)}>
            {m.rulesAdd()}
          </Button>
        }
      >
        <RulesList
          label={m.rulesList()}
          rules={data.rules.map((rule) => rowOf(rule, moved))}
          accounts={accounts}
          merchants={data.merchants}
          onOpen={show}
          onMove={move}
          openId={open ? (opening?.ruleId ?? undefined) : undefined}
          locale={locale}
        />
      </Block>
      {sheet}
      {notices}
    </>
  );
}

function rowOf(rule: RuleSummary, moved: Moved | undefined): RulesListRow {
  return {
    id: rule.id,
    conditions: drawnConditions(rule.conditions),
    merchant: rule.merchant?.name ?? null,
    category: rule.category === null ? null : categoryPath(rule.category),
    categoryArchived: rule.category?.archived ?? false,
    subject: rule.subject?.path ?? null,
    subjectArchived: rule.subject?.archived ?? false,
    enabled: rule.enabled,
    used: rule.appliedCount,
    moved: moved?.id === rule.id ? { direction: moved.direction, turn: moved.turn } : undefined,
  };
}
