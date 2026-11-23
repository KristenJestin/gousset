import { Amount } from "@gousset/ui/components/amount";
import { Button } from "@gousset/ui/components/button";
import { Card } from "@gousset/ui/components/card";
import { JobProgress } from "@gousset/ui/components/job-progress";
import { Actions, Form, Screen } from "@gousset/ui/components/screen";
import { TextField } from "@gousset/ui/components/text-field";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { Schema } from "effect";
import { useState } from "react";
import type { FormEvent } from "react";

import { e2eJobsEnabled, startTestJob } from "@/functions/jobs";
import { jobFailureMessage } from "@/i18n/messages";
import { useMessages } from "@/i18n/use-messages";
import { TEST_JOB_STEPS } from "@/jobs/test-job";
import { formText } from "@/lib/form";
import { whileBusy } from "@/lib/while-busy";
import { useJob } from "@/queries/jobs";
import { monthQueries } from "@/queries/month";

/** The month the test job says it touched, which this page shows. */
const MONTH = "2026-10";

/** What the test job is sent: the form's numbers, and a key of its own. */
type TestRun = { count: number; itemMs: number; failures: number };

// The end-to-end harness's page for background jobs (apps/e2e/tests/jobs.spec.ts): it sends the
// test job and follows it. Not found unless the harness started the app.
export const Route = createFileRoute("/_authed/e2e/jobs")({
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ job: Schema.optional(Schema.String) })),
  loader: async () => {
    if (!(await e2eJobsEnabled())) {
      // oxlint-disable-next-line typescript/only-throw-error -- TanStack Router's not-found signal is a plain object it catches by design.
      throw notFound();
    }
  },
  component: TestJobs,
});

/** The month the job touches: read again once the job ends. */
function TouchedMonth() {
  const messages = useMessages();
  const { data } = useQuery(monthQueries.summary(MONTH));

  return (
    <Card title={messages.jobs.test.month}>
      {data === undefined ? null : (
        <p className="flex items-center gap-2 text-sm">
          {messages.jobs.test.received} <Amount value={data.received} />
        </p>
      )}
    </Card>
  );
}

function TestJobs() {
  const messages = useMessages();
  const { job } = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = useJob(job);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<TestRun>();

  async function send(run: TestRun) {
    setLast(run);

    const { id } = await whileBusy(setBusy, () =>
      startTestJob({ data: { ...run, month: MONTH, key: crypto.randomUUID() } }),
    );

    await navigate({ search: { job: id } });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const form = new FormData(event.currentTarget);

    void send({
      count: Number(formText(form, "count")),
      itemMs: Number(formText(form, "itemMs")),
      failures: Number(formText(form, "failures")),
    });
  }

  const steps = TEST_JOB_STEPS.map((id) => ({ id, label: messages.jobs.test.steps[id] }));

  return (
    <Screen>
      <Card title={messages.jobs.test.title} description={messages.jobs.test.description}>
        <Form onSubmit={submit}>
          <TextField
            label={messages.jobs.test.count}
            name="count"
            type="number"
            min={0}
            defaultValue="3"
            required
          />
          <TextField
            label={messages.jobs.test.itemMs}
            name="itemMs"
            type="number"
            min={0}
            defaultValue="200"
            required
          />
          <TextField
            label={messages.jobs.test.failures}
            name="failures"
            type="number"
            min={0}
            defaultValue="0"
            required
          />
          <Actions>
            <Button type="submit" loading={busy}>
              {messages.jobs.test.start}
            </Button>
          </Actions>
        </Form>
      </Card>
      {view === undefined ? null : (
        <Card title={messages.jobs.test.job}>
          <JobProgress
            title={messages.jobs.test.job}
            steps={steps}
            phase={view.phase}
            step={view.step}
            done={view.done}
            total={view.total}
            attempt={view.attempt}
            attempts={view.attempts}
            failure={jobFailureMessage(messages, view.failure)}
            result={messages.jobs.test.done}
            onRetry={last === undefined ? undefined : async () => send(last)}
          />
        </Card>
      )}
      <TouchedMonth />
    </Screen>
  );
}
