import type { ImportSummary } from "@gousset/core/imports";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Page, ScreenBlock } from "@gousset/ui/components/app-shell";
import { Block } from "@gousset/ui/components/data-block";
import { EmptyState } from "@gousset/ui/components/empty-state";
import { FileDrop } from "@gousset/ui/components/file-drop";
import { FormMessage } from "@gousset/ui/components/form-message";
import { ImportFiles } from "@gousset/ui/components/import-files";
import type { ImportFileRow } from "@gousset/ui/components/import-files";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { noop, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAsyncQueuer } from "@tanstack/react-pacer";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ImportContent } from "@/components/import-content";
import { formatName, importFailureMessage, stateName } from "@/i18n/imports";
import { loadBlocks } from "@/lib/load-blocks";
import { uploadStatement } from "@/lib/upload";
import { importKeys, importQueries } from "@/queries/imports";

/** The files a statement may be: the drop zone's picker offers these (a drop takes any file). */
const ACCEPT = ".ofx,.qfx,.qif,.xml,.sta,.mt940,.940,.txt,.csv";

/** How many files upload at once; the others wait their turn (TanStack Pacer). */
const UPLOADS_AT_ONCE = 2;

/** A file dropped whose upload has not answered yet. */
type Uploading = { readonly key: string; readonly file: File };

export const Route = createFileRoute("/_authed/import")({
  loader: async ({ context: { queryClient } }) => {
    await loadBlocks([
      queryClient.ensureQueryData(importQueries.list()).then(noop),
      queryClient.ensureQueryData(importQueries.accounts()).then(noop),
    ]);
  },
  component: Import,
});

/** One day formatter per language, built once: building one is slow. */
const dayFormats = new Map<string, Intl.DateTimeFormat>();

function dayFormat(): Intl.DateTimeFormat {
  const locale = getLocale();
  const known = dayFormats.get(locale);

  if (known !== undefined) {
    return known;
  }

  const made = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  dayFormats.set(locale, made);

  return made;
}

function period(summary: ImportSummary, days: Intl.DateTimeFormat): string | null {
  const { periodFrom, periodTo } = summary;

  if (periodFrom === null || periodTo === null) {
    return null;
  }

  const day = (text: string) => days.format(new Date(`${text}T00:00:00Z`));

  return m.importPeriod({ from: day(periodFrom), to: day(periodTo) });
}

function rowOf(summary: ImportSummary, days: Intl.DateTimeFormat): ImportFileRow {
  const done = summary.status === "done" || summary.status === "undone";

  return {
    id: summary.id,
    file: summary.fileName,
    format: formatName(summary.format),
    account: summary.account?.name ?? null,
    period: period(summary, days),
    added: done ? summary.linesAdded : null,
    known: done ? summary.linesDuplicate : null,
    state: stateName(summary),
    attention: summary.status === "waiting" || summary.status === "failed",
    content: <ImportContent summary={summary} />,
  };
}

function Import() {
  const queryClient = useQueryClient();
  const { data } = useQuery(importQueries.list());
  const [uploading, setUploading] = useState<ReadonlyArray<Uploading>>([]);
  const [notice, setNotice] = useState<string>();
  const [refusals, setRefusals] = useState<ReadonlyArray<string>>([]);
  const days = dayFormat();

  const upload = async (item: Uploading) => {
    const answer = await uploadStatement(item.file, null);

    if ("refused" in answer) {
      setRefusals((shown) => [
        ...shown,
        m.importFileRefused({ file: item.file.name, reason: importFailureMessage(answer.refused) }),
      ]);
    } else if (answer.sameFile !== null) {
      setNotice(
        m.importSameFile({
          file: answer.sameFile.fileName,
          date: days.format(new Date(answer.sameFile.importedAt)),
        }),
      );
    }

    await queryClient.invalidateQueries({ queryKey: importKeys.list() });
    setUploading((shown) => shown.filter((other) => other.key !== item.key));
  };

  const queue = useAsyncQueuer(upload, { concurrency: UPLOADS_AT_ONCE, started: true });

  function add(files: ReadonlyArray<File>) {
    setRefusals([]);
    setNotice(undefined);

    const items = files.map((file) => ({ key: crypto.randomUUID(), file }));

    setUploading((shown) => [...items, ...shown]);

    for (const item of items) {
      queue.addItem(item);
    }
  }

  const imports = data?.imports ?? [];

  const rows: ReadonlyArray<ImportFileRow> = [
    ...uploading.map((item) => ({
      id: item.key,
      file: item.file.name,
      format: null,
      account: null,
      period: null,
      added: null,
      known: null,
      state: m.importStateUploading(),
    })),
    ...imports.map((summary) => rowOf(summary, days)),
  ];

  return (
    <Page title={m.importTitle()}>
      <FileDrop
        label={m.importDropLabel()}
        description={m.importDropDescription()}
        accept={ACCEPT}
        onFiles={add}
      />
      <StatusMessage message={notice} />
      {refusals.map((refusal) => (
        <FormMessage key={refusal} message={refusal} />
      ))}
      {rows.length === 0 ? (
        <ScreenBlock>
          <EmptyState
            icon="import"
            title={m.importEmptyTitle()}
            description={m.importEmptyDescription()}
          />
        </ScreenBlock>
      ) : (
        <Block title={m.importFilesTitle()}>
          <ImportFiles
            label={m.importFilesTitle()}
            locale={getLocale()}
            columns={{
              file: m.importColumnFile(),
              format: m.importColumnFormat(),
              account: m.importColumnAccount(),
              period: m.importColumnPeriod(),
              added: m.importColumnAdded(),
              known: m.importColumnKnown(),
              state: m.importColumnState(),
            }}
            rows={rows}
          />
        </Block>
      )}
    </Page>
  );
}
