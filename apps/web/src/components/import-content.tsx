import { IMPORT_STEPS } from "@gousset/core/imports";
import type { ImportSummary as Import } from "@gousset/core/imports";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Button } from "@gousset/ui/components/button";
import { FormMessage } from "@gousset/ui/components/form-message";
import { ImportPrompt } from "@gousset/ui/components/import-prompt";
import { ImportSummary } from "@gousset/ui/components/import-summary";
import { JobProgress } from "@gousset/ui/components/job-progress";
import { Form } from "@gousset/ui/components/screen";
import { Select } from "@gousset/ui/components/select";
import { notify } from "@gousset/ui/lib/notify";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { AppButtonLink } from "@/components/app-link";
import { ConfirmColumns } from "@/components/confirm-columns";
import { useRefreshImports, useResume } from "@/components/import-resume";
import { undoImport } from "@/functions/imports";
import { IMPORT_STEP_LABELS, importFailureMessage } from "@/i18n/imports";
import { jobFailureMessage } from "@/i18n/messages";
import { isOver } from "@/jobs/view";
import { formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";
import { importKeys, importQueries } from "@/queries/imports";
import { invalidateTouched } from "@/queries/invalidate";
import { useJob } from "@/queries/jobs";

// What shows under an import's row on the import screen (#20): its job's steps while it runs, the
// question it waits on, its summary once done, why it failed.

const STEPS = IMPORT_STEPS.map((id) => ({ id, label: IMPORT_STEP_LABELS[id]() }));

/**
 * The import's job, followed live: its steps move with its real progress. A job over for good
 * whose import still says it runs (its last attempt could not say how it ended) can be run again;
 * one the queue no longer has is shown as a failure, to run again or undo.
 */
function Running({ summary }: { summary: Import }) {
  const { view, gone } = useJob(summary.jobId ?? undefined);
  const queryClient = useQueryClient();
  const { resume, refused } = useResume(summary);
  const over = view !== undefined && isOver(view);

  // Once the job is over the import's own row says how it ended (written with its last lines,
  // before the job's end is pushed): read it again.
  useEffect(() => {
    if (over) {
      void queryClient.invalidateQueries({ queryKey: importKeys.all });
    }
  }, [over, queryClient]);

  if (gone) {
    return <Failed summary={summary} />;
  }

  return (
    <>
      <JobProgress
        title={m.importJobTitle({ file: summary.fileName })}
        steps={STEPS}
        phase={view?.phase ?? "waiting"}
        step={view?.step ?? null}
        done={view?.done ?? null}
        total={view?.total ?? null}
        attempt={view?.attempt ?? 1}
        attempts={view?.attempts ?? 1}
        failure={jobFailureMessage(view?.failure ?? null)}
        result={m.importJobDone()}
        locale={getLocale()}
        onRetry={view?.phase === "failed" ? async () => resume(null, null) : undefined}
      />
      <FormMessage message={refused} />
    </>
  );
}

/** The file names no account the user has: they choose one. */
function ChooseAccount({ summary }: { summary: Import }) {
  const { data: accounts = [] } = useQuery(importQueries.accounts());
  const { resume, refused } = useResume(summary);
  const [busy, setBusy] = useState(false);

  if (accounts.length === 0) {
    return <ImportPrompt message={m.importAccountNone()} />;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const accountId = formText(new FormData(event.currentTarget), "account");

    if (accountId !== "") {
      void whileBusy(setBusy, async () => resume(accountId, null));
    }
  }

  return (
    <Form onSubmit={submit}>
      <ImportPrompt
        message={m.importAccountQuestion()}
        control={
          <Select
            label={m.importAccountLabel({ file: summary.fileName })}
            hideLabel
            size="sm"
            name="account"
            placeholder={m.importAccountPlaceholder()}
            items={accounts.map((account) => ({ value: account.id, label: account.name }))}
            required
          />
        }
        actions={
          <Button type="submit" size="sm" loading={busy}>
            {m.importAccountGo()}
          </Button>
        }
        error={refused}
      />
    </Form>
  );
}

/** Undoes the import, saying what it removed, or why it could not. */
function useUndo(summary: Import) {
  const queryClient = useQueryClient();
  const refresh = useRefreshImports();

  return async () => {
    const answer = await undoImport({ data: { importId: summary.id } });

    if ("refused" in answer) {
      notify.failed({ description: importFailureMessage(answer.refused) });
    } else {
      const said = [
        m.importUndoneDescription({
          removed: answer.linesRemoved,
          givenBack: answer.linesGivenBack,
        }),
        answer.transfersRemoved > 0
          ? m.importUndoneTransfers({ count: answer.transfersRemoved })
          : undefined,
        answer.laterOverlapping > 0 ? m.importUndoneOverlap() : undefined,
      ];

      notify.progress(`undo-${summary.id}`).succeed({
        title: m.importUndoneTitle(),
        description: said.filter((text) => text !== undefined).join(" "),
      });

      await invalidateTouched(queryClient, { months: answer.months });
    }

    await refresh();
  };
}

/** The import's summary, before moving on to the review; it can be undone from here. */
function Done({ summary }: { summary: Import }) {
  const undo = useUndo(summary);
  const [busy, setBusy] = useState(false);
  const month = (summary.periodTo ?? summary.createdAt).slice(0, 7);

  return (
    <ImportSummary
      label={m.importSummaryTitle({ file: summary.fileName })}
      read={{ label: m.importLinesRead(), count: summary.linesRead }}
      added={{ label: m.importLinesAdded(), count: summary.linesAdded }}
      known={{ label: m.importLinesKnown(), count: summary.linesDuplicate }}
      review={{ label: m.importLinesReview(), count: summary.linesHeld }}
      note={summary.balanceIgnored ? m.importBalanceIgnored() : undefined}
      locale={getLocale()}
      actions={
        <>
          <Button
            variant="quiet"
            size="sm"
            icon="undo"
            loading={busy}
            onClick={() => void whileBusy(setBusy, undo)}
          >
            {m.importUndo()}
          </Button>
          <AppButtonLink to="/" search={{ month }} size="sm" trailingIcon="next">
            {m.importContinue()}
          </AppButtonLink>
        </>
      }
    />
  );
}

/** Why the import failed, and a second try; or undo, to take back what it saved. */
function Failed({ summary }: { summary: Import }) {
  const { resume, refused } = useResume(summary);
  const undo = useUndo(summary);
  const [busy, setBusy] = useState(false);
  const [undoing, setUndoing] = useState(false);

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        void whileBusy(setBusy, async () => resume(null, null));
      }}
    >
      <ImportPrompt
        tone="error"
        message={importFailureMessage(summary.errorCode)}
        actions={
          <>
            <Button
              type="button"
              variant="quiet"
              size="sm"
              icon="undo"
              loading={undoing}
              onClick={() => void whileBusy(setUndoing, undo)}
            >
              {m.importUndo()}
            </Button>
            <Button type="submit" variant="secondary" size="sm" icon="retry" loading={busy}>
              {m.importTryAgain()}
            </Button>
          </>
        }
        error={refused}
      />
    </Form>
  );
}

/** What shows under an import's row, from where it stands. */
export function ImportContent({ summary }: { summary: Import }) {
  switch (summary.status) {
    case "queued":
    case "reading":
    case "saving":
      return <Running summary={summary} />;
    case "waiting":
      return summary.waitingFor === "profile" ? (
        <ConfirmColumns summary={summary} />
      ) : (
        <ChooseAccount summary={summary} />
      );
    case "done":
      return <Done summary={summary} />;
    case "failed":
      return <Failed summary={summary} />;
    case "undone":
      return null;
  }
}
