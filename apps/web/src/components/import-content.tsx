import { IMPORT_STEPS } from "@gousset/core/imports";
import type { ImportSummary as Import } from "@gousset/core/imports";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import type { CsvProfile } from "@gousset/import";
import { Button } from "@gousset/ui/components/button";
import { FormMessage } from "@gousset/ui/components/form-message";
import { ImportSummary } from "@gousset/ui/components/import-summary";
import { JobProgress } from "@gousset/ui/components/job-progress";
import { Actions, Form } from "@gousset/ui/components/screen";
import { Select } from "@gousset/ui/components/select";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { notify } from "@gousset/ui/lib/notify";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { AppLink } from "@/components/app-link";
import { resumeImport, undoImport } from "@/functions/imports";
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

/** The imports' rows are read again: an import moved on. */
function useRefreshImports() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: importKeys.all });
}

/** The import's job, followed live: its steps move with its real progress. */
function Running({ summary }: { summary: Import }) {
  const { view } = useJob(summary.jobId ?? undefined);
  const queryClient = useQueryClient();
  const over = view !== undefined && isOver(view);

  // Once the job is over the import's own row says how it ended (written with its last lines,
  // before the job's end is pushed): read it again.
  useEffect(() => {
    if (over) {
      void queryClient.invalidateQueries({ queryKey: importKeys.all });
    }
  }, [over, queryClient]);

  return (
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
    />
  );
}

/** Runs the import again with the user's answers. */
function useResume(summary: Import) {
  const refresh = useRefreshImports();
  const [refused, setRefused] = useState<string>();

  const resume = async (accountId: string | null, csvProfile: CsvProfile | null) => {
    const answer = await resumeImport({ data: { importId: summary.id, accountId, csvProfile } });

    if ("refused" in answer) {
      setRefused(importFailureMessage(answer.refused));
    } else {
      setRefused(undefined);
    }

    await refresh();
  };

  return { resume, refused };
}

/** The file names no account the user has: they choose one. */
function ChooseAccount({ summary }: { summary: Import }) {
  const { data: accounts = [] } = useQuery(importQueries.accounts());
  const { resume, refused } = useResume(summary);
  const [busy, setBusy] = useState(false);

  if (accounts.length === 0) {
    return <StatusMessage message={m.importAccountNone()} />;
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
      <StatusMessage message={m.importAccountQuestion()} />
      <Select
        label={m.importAccountLabel({ file: summary.fileName })}
        name="account"
        placeholder={m.importAccountPlaceholder()}
        items={accounts.map((account) => ({ value: account.id, label: account.name }))}
        required
      />
      <FormMessage message={refused} />
      <Actions>
        <Button type="submit" loading={busy}>
          {m.importAccountGo()}
        </Button>
      </Actions>
    </Form>
  );
}

/** The date format read the other way round: `DD/MM/YYYY` and `MM/DD/YYYY`. */
function swapped(dateFormat: string): string {
  return dateFormat.replace(/^(DD|MM)(.?)(DD|MM)/, "$3$2$1");
}

/** A CSV file detection could not read whole: the user says what it could not. */
function ConfirmColumns({ summary }: { summary: Import }) {
  const { data: questions } = useQuery(importQueries.csv(summary.id));
  const { resume, refused } = useResume(summary);
  const [busy, setBusy] = useState(false);

  if (questions === undefined || questions === null) {
    return null;
  }

  const { profile, header, unsure } = questions;
  const columns = Math.max(header.length, 1);

  const columnItems = Array.from({ length: columns }, (_, index) => ({
    value: String(index + 1),
    label: header[index] ?? m.importCsvColumn({ number: index + 1 }),
  }));

  const amount = profile.columns.amount;
  const firstAmount = amount.kind === "signed" ? amount.column : amount.debit;
  const credit = amount.kind === "signed" ? null : amount.credit;
  const dayFirst = profile.dateFormat.startsWith("DD") || profile.dateFormat.startsWith("Y");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);
    const order = formText(form, "dates");
    const mark = formText(form, "decimal");
    const amountColumn = Number(formText(form, "amount") || String(firstAmount));
    const creditColumn = Number(formText(form, "credit") || "0");

    const answered: CsvProfile = {
      ...profile,
      dateFormat:
        order === "" || order === (dayFirst ? "day" : "month")
          ? profile.dateFormat
          : swapped(profile.dateFormat),
      decimalMark: mark === "," || mark === "." ? mark : profile.decimalMark,
      columns: {
        ...profile.columns,
        amount:
          creditColumn > 0
            ? { kind: "debit-credit", debit: amountColumn, credit: creditColumn }
            : { kind: "signed", column: amountColumn },
      },
    };

    void whileBusy(setBusy, async () => resume(null, answered));
  }

  return (
    <Form onSubmit={submit}>
      <StatusMessage message={m.importCsvQuestion()} />
      {unsure.includes("dateFormat") ? (
        <Select
          label={m.importCsvDates()}
          name="dates"
          defaultValue={dayFirst ? "day" : "month"}
          items={[
            { value: "day", label: m.importCsvDayFirst() },
            { value: "month", label: m.importCsvMonthFirst() },
          ]}
        />
      ) : null}
      {unsure.includes("decimalMark") ? (
        <Select
          label={m.importCsvDecimal()}
          name="decimal"
          defaultValue={profile.decimalMark}
          items={[
            { value: ",", label: m.importCsvComma() },
            { value: ".", label: m.importCsvPoint() },
          ]}
        />
      ) : null}
      {unsure.includes("amount") ? (
        <>
          <Select
            label={m.importCsvAmount()}
            name="amount"
            defaultValue={String(firstAmount)}
            items={columnItems}
          />
          <Select
            label={m.importCsvCredit()}
            name="credit"
            defaultValue={credit === null ? "0" : String(credit)}
            items={[{ value: "0", label: m.importCsvNoCredit() }, ...columnItems]}
          />
        </>
      ) : null}
      <FormMessage message={refused} />
      <Actions>
        <Button type="submit" loading={busy}>
          {m.importCsvGo()}
        </Button>
      </Actions>
    </Form>
  );
}

/** The import's summary, before moving on to the review; it can be undone from here. */
function Done({ summary }: { summary: Import }) {
  const queryClient = useQueryClient();
  const refresh = useRefreshImports();
  const [busy, setBusy] = useState(false);
  const month = (summary.periodTo ?? summary.createdAt).slice(0, 7);

  async function undo() {
    const answer = await undoImport({ data: { importId: summary.id } });

    if ("refused" in answer) {
      notify.failed({ description: importFailureMessage(answer.refused) });
    } else {
      const description = m.importUndoneDescription({
        removed: answer.linesRemoved,
        givenBack: answer.linesGivenBack,
      });

      notify.progress(`undo-${summary.id}`).succeed({
        title: m.importUndoneTitle(),
        description:
          answer.laterOverlapping > 0 ? `${description} ${m.importUndoneOverlap()}` : description,
      });

      await invalidateTouched(queryClient, { months: answer.months });
    }

    await refresh();
  }

  return (
    <ImportSummary
      label={m.importSummaryTitle({ file: summary.fileName })}
      read={{ label: m.importLinesRead(), count: summary.linesRead }}
      added={{ label: m.importLinesAdded(), count: summary.linesAdded }}
      known={{ label: m.importLinesKnown(), count: summary.linesDuplicate }}
      review={{ label: m.importLinesReview(), count: summary.linesHeld }}
      locale={getLocale()}
      actions={
        <>
          <Button
            variant="secondary"
            icon="undo"
            loading={busy}
            onClick={() => void whileBusy(setBusy, undo)}
          >
            {m.importUndo()}
          </Button>
          <AppLink to="/" search={{ month }}>
            {m.importContinue()}
          </AppLink>
        </>
      }
    />
  );
}

/** Why the import failed, and a second try. */
function Failed({ summary }: { summary: Import }) {
  const { resume, refused } = useResume(summary);
  const [busy, setBusy] = useState(false);

  return (
    <Form
      onSubmit={(event) => {
        event.preventDefault();
        void whileBusy(setBusy, async () => resume(null, null));
      }}
    >
      <FormMessage message={refused ?? importFailureMessage(summary.errorCode)} />
      <Actions>
        <Button type="submit" variant="secondary" icon="retry" loading={busy}>
          {m.importTryAgain()}
        </Button>
      </Actions>
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
