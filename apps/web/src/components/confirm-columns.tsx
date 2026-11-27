import { MAX_PROFILE_FILE, MAX_PROFILE_NAME } from "@gousset/core/imports";
import type {
  CsvPreview as Preview,
  ImportProfileEntry,
  ImportSummary as Import,
  ProfileChoice,
} from "@gousset/core/imports";
import type { OperationKind, OperationsProfile } from "@gousset/import";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Button } from "@gousset/ui/components/button";
import { Checkbox } from "@gousset/ui/components/checkbox";
import { CsvKindWords } from "@gousset/ui/components/csv-kind-words";
import { CsvMapping } from "@gousset/ui/components/csv-mapping";
import { CsvPreview } from "@gousset/ui/components/csv-preview";
import { CsvSettings } from "@gousset/ui/components/csv-settings";
import { CsvTestRead } from "@gousset/ui/components/csv-test-read";
import type { CsvTestResult } from "@gousset/ui/components/csv-test-read";
import { FileButton } from "@gousset/ui/components/file-button";
import { FormMessage } from "@gousset/ui/components/form-message";
import { Select } from "@gousset/ui/components/select";
import { StatusMessage } from "@gousset/ui/components/status-message";
import { TextField } from "@gousset/ui/components/text-field";
import { CSV_FIELDS, OPERATION_FIELDS } from "@gousset/ui/lib/csv-fields";
import type { CsvField } from "@gousset/ui/lib/csv-fields";
import { formatMoney } from "@gousset/ui/lib/money";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useResume } from "@/components/import-resume";
import {
  exportImportProfile,
  importImportProfile,
  saveImportProfile,
} from "@/functions/import-profiles";
import {
  csvFieldNames,
  csvRefusalMessage,
  missingMessage,
  operationFieldNames,
  operationKindName,
} from "@/i18n/csv-preview";
import { profileRefusalMessage } from "@/i18n/imports";
import {
  byHand,
  DATE_FORMATS,
  dateExample,
  kindWordsOf,
  labelWithNameOf,
  mappingOf,
  operationsMappingOf,
  operationsProfileOf,
  operationsSettingsOf,
  profileOf,
  remap,
  settingsOf,
  splittingProfile,
  startedOperations,
  withSettings,
} from "@/lib/csv-mapping";
import type { CsvFileSettings, CsvSettingsForm, KindWord } from "@/lib/csv-mapping";
import { downloadText } from "@/lib/download";
import { importKeys, importQueries } from "@/queries/imports";

// A CSV file the app could not read on its own (#19, #20): under its row, a preview of its first
// lines where the user chooses a profile that reads it or maps each column, adjusts the file's
// settings, sees a test read, saves the mapping as a profile, and imports. One flow with the import.

/** Where a file detection could not read at all starts: the usual settings, nothing mapped. */
const BLANK: CsvFileSettings = {
  separator: ";",
  encoding: "utf8",
  skipRows: 0,
  headerRow: true,
  dateFormat: "DD/MM/YYYY",
  decimalMark: ",",
};

/** The `Select` value of the profile mapped by hand, beside the profiles' own. */
const BY_HAND = "hand";

/** What a file holds: an account's lines, or a broker's operations (v0.6). */
type Holds = "statement" | "operations";

const OFFERED = { statement: CSV_FIELDS, operations: OPERATION_FIELDS } satisfies {
  readonly [holds in Holds]: ReadonlyArray<CsvField>;
};

/** The same fields, for the lookup of each column when the kind of file changes. */
const OFFERED_SETS = {
  statement: new Set<CsvField>(CSV_FIELDS),
  operations: new Set<CsvField>(OPERATION_FIELDS),
} satisfies { readonly [holds in Holds]: ReadonlySet<CsvField> };

/** The kinds a word of a broker's kind column can name, in the order the list offers them. */
const KINDS: ReadonlyArray<OperationKind> = [
  "purchase",
  "sale",
  "dividend",
  "fee",
  "deposit",
  "withdrawal",
];

function choiceOf(entry: ImportProfileEntry): ProfileChoice {
  return entry.source === "stored"
    ? { kind: "stored", id: entry.id }
    : { kind: "shipped", key: entry.key };
}

/** A profile as the list of profiles names it: its source and its id or key. */
function valueOf(choice: ProfileChoice): string {
  return choice.kind === "stored" ? `stored:${choice.id}` : `shipped:${choice.key}`;
}

/** A profile file's name as the profile's: `my-bank.gousset-profile.json` is `my-bank`. */
function profileNameOf(fileName: string): string {
  const name = fileName.replace(/(?:\.gousset-profile)?\.json$/i, "").trim();

  return (name === "" ? fileName : name).slice(0, MAX_PROFILE_NAME);
}

const days = new Map<string, Intl.DateTimeFormat>();

const plainAmounts = new Map<string, Intl.NumberFormat>();

function dayText(day: string): string {
  const locale = getLocale();

  const format =
    days.get(locale) ?? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });

  days.set(locale, format);

  return format.format(new Date(`${day}T00:00:00Z`));
}

/**
 * An amount read by the test read: in the account's currency, or, before an account is chosen, as
 * the reader gives it then, in ten-thousandths (`CLF`), written as a plain number.
 */
function amountText(minor: number, currency: string | null): string {
  if (currency !== null) {
    return formatMoney({ minor, currency }, { locale: getLocale() });
  }

  const locale = getLocale();

  const format =
    plainAmounts.get(locale) ??
    new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  plainAmounts.set(locale, format);

  // Shown only, never summed: a float is exact enough for four decimals of a statement's amount.
  return format.format(minor / 10_000);
}

/** What the test read shows: the lines read, why the file is refused, or nothing yet. */
function testResult(preview: Preview | null | undefined): CsvTestResult | null {
  if (preview === undefined || preview === null) {
    return null;
  }

  const { read, currency } = preview;

  if ("refused" in read) {
    return { kind: "refused", message: csvRefusalMessage(read.refused) };
  }

  return {
    kind: "lines",
    headings: {
      date: m.importCsvTestDate(),
      label: m.importCsvTestLabel(),
      amount: m.importCsvTestAmount(),
    },
    lines: read.lines.map((line) => ({
      line: line.position,
      date: dayText(line.bookedOn),
      // A broker's operation says what it is before its text.
      label: line.kind === null ? line.label : `${operationKindName(line.kind)} · ${line.label}`,
      amount: amountText(line.amountMinor, currency),
    })),
  };
}

/** A CSV file detection could not read whole: its preview, from what detection proposed. */
export function ConfirmColumns({ summary }: { summary: Import }) {
  const { data: questions, isPending } = useQuery(importQueries.csv(summary.id));

  if (isPending) {
    return null;
  }

  const proposal = questions?.profile;

  return (
    <ColumnsPreview
      key={summary.id}
      summary={summary}
      initialSettings={proposal === undefined ? BLANK : settingsOf(proposal)}
      initialMapping={proposal === undefined ? [] : mappingOf(proposal, 0)}
    />
  );
}

/** The file's first rows as the preview shows them: its columns' names, and its lines. */
type Table = {
  readonly width: number;
  /** The header row's cells as the file writes them; empty without a header row. */
  readonly header: ReadonlyArray<string>;
  readonly columns: ReadonlyArray<string>;
  readonly lines: ReadonlyArray<ReadonlyArray<string>>;
};

function tableOf(rows: ReadonlyArray<ReadonlyArray<string>>, headerRow: boolean): Table {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const [first = [], ...rest] = rows;
  const header = headerRow ? first : [];

  const columns = Array.from({ length: width }, (_, index) => {
    const named = header[index]?.trim() ?? "";

    return named === "" ? m.importCsvColumn({ number: index + 1 }) : named;
  });

  return { width, header, columns, lines: headerRow ? rest : rows };
}

/**
 * What the user makes of the file on the preview: its settings, what each column holds, the words
 * of a broker's kind column, and the profile chosen from the list. A broker's operations profile
 * chosen is read as it is (its columns at their places or found by their names) until the user
 * changes a column or a word; a setting changed keeps it.
 */
function useColumns(initialSettings: CsvFileSettings, initialMapping: ReadonlyArray<CsvField>) {
  const [settings, setSettings] = useState(initialSettings);
  const [mapping, setMapping] = useState(initialMapping);
  const [holds, setHolds] = useState<Holds>("statement");
  const [words, setWords] = useState<ReadonlyArray<KindWord>>([]);
  // The profile chosen from the list, until the user changes a column or a setting.
  const [chosen, setChosen] = useState<ProfileChoice | null>(null);
  // The profile last chosen from the list: while it still reads the file its way, the list names it.
  const [startedFrom, setStartedFrom] = useState<ProfileChoice | null>(null);
  const [started, setStarted] = useState<OperationsProfile | null>(null);
  // Whether the user says each row's broker's reference is unique: the import then keys by it.
  const [referenceUnique, setReferenceUnique] = useState(false);
  // Whether the label is read from the security's name column, as the profile mapped by hand from
  // says: the preview shows that column as the name alone.
  const [labelWithName, setLabelWithName] = useState(false);

  const draft =
    holds === "statement"
      ? profileOf(settings, mapping)
      : started === null
        ? operationsProfileOf(settings, mapping, words, referenceUnique, labelWithName)
        : { profile: startedOperations(started, settings) };

  /**
   * Mapped by hand from now on: `shown`, the mapping as the preview shows it under the file's
   * `header`, is the user's.
   */
  const byHandNow = (shown: ReadonlyArray<CsvField>, header: ReadonlyArray<string>) => {
    setMapping(shown);
    setSettings(byHand(settings));

    if (started !== null) {
      setLabelWithName(labelWithNameOf(started, header));
    }

    setStarted(null);
    setChosen(null);
  };

  return {
    settings,
    holds,
    words,
    chosen,
    draft,
    referenceUnique,
    /** The profile the list names: the one chosen, or the one still read its own way. */
    readWith: chosen ?? (settings.layout === undefined && started === null ? null : startedFrom),
    /** What each column holds, as the preview shows it under the file's header. */
    shownMapping: (table: Table): ReadonlyArray<CsvField> =>
      started === null ? mapping : operationsMappingOf(started, table.width, table.header),
    byHandNow,
    changeHolds: (next: Holds, shown: ReadonlyArray<CsvField>, header: ReadonlyArray<string>) => {
      const offered = OFFERED_SETS[next];

      setHolds(next);
      // The fields both read (the days, the label, the amount) stay where they were.
      byHandNow(
        shown.map((field) => (offered.has(field) ? field : "ignored")),
        header,
      );
    },
    changeWords: (
      next: ReadonlyArray<KindWord>,
      shown: ReadonlyArray<CsvField>,
      header: ReadonlyArray<string>,
    ) => {
      setWords(next);
      byHandNow(shown, header);
    },
    changeSettings: (form: CsvSettingsForm) => {
      setSettings(withSettings(settings, form));
      setChosen(null);
    },
    /** A profile chosen from the list keeps its columns, as a setting changed does. */
    changeReferenceUnique: (next: boolean) => {
      setReferenceUnique(next);
      setStarted(started === null ? null : { ...started, referenceUnique: next });
      setChosen(null);
    },
    saved: (choice: ProfileChoice) => setChosen(choice),
    startFrom: (entry: ImportProfileEntry, width: number) => {
      const { definition } = entry;

      if (definition !== null && "reads" in definition) {
        setHolds("operations");
        setSettings(operationsSettingsOf(definition));
        setWords(definition.kinds.map(({ word, kind }) => ({ word, kind })));
        setReferenceUnique(definition.referenceUnique);
        setStarted(definition);
      } else if (definition !== null) {
        setHolds("statement");
        setSettings(settingsOf(definition));
        setMapping(mappingOf(definition, width));
        setStarted(null);
        setLabelWithName(false);
      }

      setChosen(choiceOf(entry));
      setStartedFrom(choiceOf(entry));
    },
  };
}

type Columns = ReturnType<typeof useColumns>;

/**
 * Saving the mapping as a profile, exporting the profile chosen, importing a profile file: what
 * each said, or why it was refused.
 */
function useProfileFiles(columns: Columns, header: string | null) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const [refused, setRefused] = useState<string>();

  const refreshProfiles = () => queryClient.invalidateQueries({ queryKey: importKeys.profiles() });

  return {
    notice,
    refused,
    save: async (name: string) => {
      if (!("profile" in columns.draft)) {
        return;
      }

      const answer = await saveImportProfile({
        data: { name, institution: null, definition: columns.draft.profile, header },
      });

      if ("refused" in answer) {
        setRefused(profileRefusalMessage(answer));

        return;
      }

      setRefused(undefined);
      columns.saved(choiceOf(answer.saved));
      setNotice(m.importCsvSaved({ name: answer.saved.name }));
      await refreshProfiles();
    },
    exportChosen: async () => {
      if (columns.chosen === null) {
        return;
      }

      const answer = await exportImportProfile({ data: { profile: columns.chosen } });

      if ("refused" in answer) {
        setRefused(profileRefusalMessage(answer));

        return;
      }

      setRefused(undefined);
      downloadText(answer.file.fileName, answer.file.content, "application/json");
    },
    importFile: async (file: File, width: number) => {
      const content = await file.text();

      if (content.length > MAX_PROFILE_FILE) {
        setRefused(m.importRefusedProfileTooLong({ limit: MAX_PROFILE_FILE }));

        return;
      }

      const answer = await importImportProfile({
        data: { name: profileNameOf(file.name), institution: null, content },
      });

      if ("refused" in answer) {
        setRefused(profileRefusalMessage(answer));

        return;
      }

      setRefused(undefined);
      columns.startFrom(answer.saved, width);
      setNotice(m.importCsvImported({ name: answer.saved.name }));
      await refreshProfiles();
    },
  };
}

/** Which kind of file it is, the profile it is read with, and the profile files' actions. */
function ProfileChoices({
  summary,
  columns,
  table,
  shown,
  onExport,
  onImportFile,
}: {
  summary: Import;
  columns: Columns;
  table: Table;
  shown: ReadonlyArray<CsvField>;
  onExport: () => Promise<void>;
  onImportFile: (file: File) => Promise<void>;
}) {
  const { data: fitting } = useQuery(importQueries.profilesFor(summary.id));
  const { data: profiles = [] } = useQuery(importQueries.profiles());

  // Those that read the file first, then the other profiles that still read.
  const fits = (fitting?.fitting ?? []).map((fit) => fit.profile);
  const fitValues = new Set(fits.map((entry) => valueOf(choiceOf(entry))));

  const others = profiles.filter(
    (entry) => entry.definition !== null && !fitValues.has(valueOf(choiceOf(entry))),
  );

  const listed = [...fits, ...others];
  const { readWith } = columns;

  return (
    <>
      <Select
        label={m.importCsvHolds()}
        size="sm"
        value={columns.holds}
        items={[
          { value: "statement", label: m.importCsvHoldsStatement() },
          { value: "operations", label: m.importCsvHoldsOperations() },
        ]}
        onValueChange={(value) =>
          columns.changeHolds(
            value === "operations" ? "operations" : "statement",
            shown,
            table.header,
          )
        }
      />
      <Select
        label={m.importCsvProfile()}
        size="sm"
        value={readWith === null ? BY_HAND : valueOf(readWith)}
        items={[
          { value: BY_HAND, label: m.importCsvProfileByHand() },
          ...fits.map((entry) => ({
            value: valueOf(choiceOf(entry)),
            label: m.importCsvProfileFits({ name: entry.name }),
          })),
          ...others.map((entry) => ({ value: valueOf(choiceOf(entry)), label: entry.name })),
        ]}
        onValueChange={(value) => {
          const entry = listed.find((each) => valueOf(choiceOf(each)) === value);

          if (entry === undefined) {
            columns.byHandNow(shown, table.header);
          } else {
            columns.startFrom(entry, table.width);
          }
        }}
      />
      <Button variant="secondary" size="sm" disabled={columns.chosen === null} onClick={onExport}>
        {m.importCsvExport()}
      </Button>
      <FileButton size="sm" icon="import" accept=".json,application/json" onFile={onImportFile}>
        {m.importCsvImportFile()}
      </FileButton>
    </>
  );
}

/**
 * The words of a broker's kind column the user maps: those mapped, those its first lines write,
 * and one a test read refused, so that a word further down the file is offered as soon as it is met.
 */
function KindWordsList({
  columns,
  table,
  shown,
  preview,
  title,
}: {
  columns: Columns;
  table: Table;
  shown: ReadonlyArray<CsvField>;
  preview: Preview | null | undefined;
  title: string;
}) {
  const kindAt = shown.indexOf("kind");

  const refusal =
    preview !== undefined && preview !== null && "refused" in preview.read
      ? preview.read.refused
      : null;

  const refusedWord =
    refusal?.error === "InvalidField" && refusal.field === "kind" && refusal.text !== null
      ? [refusal.text]
      : [];

  const shownWords = kindWordsOf(columns.words, [
    ...(kindAt === -1 ? [] : table.lines.map((row) => row[kindAt] ?? "")),
    ...refusedWord,
  ]);

  return (
    <CsvKindWords
      label={title}
      words={kindAt === -1 ? [] : shownWords}
      kinds={KINDS.map((kind) => ({ value: kind, label: operationKindName(kind) }))}
      unmapped={m.importCsvKindUnmapped()}
      empty={m.importCsvKindsEmpty()}
      onKindChange={(word, kind) =>
        columns.changeWords(
          shownWords.map((each) =>
            each.word === word ? { word, kind: KINDS.find((one) => one === kind) ?? null } : each,
          ),
          shown,
          table.header,
        )
      }
      chooseLabel={(word) => m.importCsvKindChoose({ word })}
    />
  );
}

/** The file's settings, each offered from its list; a profile's own date format beside them. */
function FileSettings({ columns }: { columns: Columns }) {
  const { settings } = columns;
  const offered = DATE_FORMATS.some((format) => format === settings.dateFormat);
  const dateFormats = offered ? [...DATE_FORMATS] : [...DATE_FORMATS, settings.dateFormat];

  return (
    <CsvSettings
      labels={{
        separator: m.importCsvSeparator(),
        encoding: m.importCsvEncoding(),
        skipRows: m.importCsvSkipRows(),
        headerRow: m.importCsvHeaderRow(),
        dateFormat: m.importCsvDateFormat(),
        decimalMark: m.importCsvDecimal(),
      }}
      choices={{
        separator: [
          { value: ";", label: m.importCsvSemicolon() },
          { value: ",", label: m.importCsvCommaSeparator() },
          { value: "\t", label: m.importCsvTab() },
          { value: "|", label: m.importCsvPipe() },
        ],
        encoding: [
          { value: "utf8", label: m.importCsvUnicode() },
          { value: "windows-1252", label: m.importCsvWestern() },
        ],
        dateFormat: dateFormats.map((format) => ({
          value: format,
          label: m.importCsvDateChoice({ format, example: dateExample(format) }),
        })),
        decimalMark: [
          { value: ",", label: m.importCsvComma() },
          { value: ".", label: m.importCsvPoint() },
        ],
      }}
      value={settings}
      onChange={columns.changeSettings}
    />
  );
}

/** Saving the mapping as a named profile, once the test read reads the file. */
function SaveProfile({
  readable,
  onSave,
}: {
  readable: boolean;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");

  return (
    <>
      <TextField
        label={m.importCsvSaveName()}
        size="sm"
        maxLength={MAX_PROFILE_NAME}
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <Button variant="secondary" size="sm" disabled={!readable} onClick={() => onSave(name)}>
        {m.importCsvSave()}
      </Button>
    </>
  );
}

function ColumnsPreview({
  summary,
  initialSettings,
  initialMapping,
}: {
  summary: Import;
  /** What detection proposed, kept as the start: the user changes it from there. */
  initialSettings: CsvFileSettings;
  initialMapping: ReadonlyArray<CsvField>;
}) {
  const columns = useColumns(initialSettings, initialMapping);
  const { settings, holds, draft } = columns;
  const read = "profile" in draft ? draft.profile : splittingProfile(settings);
  const { data: preview } = useQuery(importQueries.preview(summary.id, read));
  const table = tableOf(preview?.rows ?? [], settings.headerRow);
  const shown = columns.shownMapping(table);
  const files = useProfileFiles(columns, preview?.header ?? null);
  const { resume, refused } = useResume(summary);
  const result = "profile" in draft ? testResult(preview) : null;
  const readable = result !== null && result.kind === "lines";

  const kindsTitle = m.importCsvKindsTitle({
    column: table.columns[shown.indexOf("kind")] ?? m.importCsvFieldKind(),
  });

  return (
    <CsvPreview
      intro={<StatusMessage message={m.importCsvIntro()} />}
      profile={
        <ProfileChoices
          summary={summary}
          columns={columns}
          table={table}
          shown={shown}
          onExport={files.exportChosen}
          onImportFile={(file) => files.importFile(file, table.width)}
        />
      }
      mapping={
        preview !== undefined && table.width === 0 ? (
          <StatusMessage message={m.importCsvNoRows()} />
        ) : (
          <CsvMapping
            label={m.importCsvPreviewLabel({ file: summary.fileName })}
            columns={table.columns}
            rows={table.lines}
            fields={holds === "operations" ? operationFieldNames() : csvFieldNames()}
            offered={OFFERED[holds]}
            mapping={shown}
            onMappingChange={(column, field) =>
              columns.byHandNow(remap(shown, column, field), table.header)
            }
            chooseLabel={(column) => m.importCsvColumnHolds({ column })}
          />
        )
      }
      kinds={
        holds === "operations"
          ? {
              title: kindsTitle,
              words: (
                <KindWordsList
                  columns={columns}
                  table={table}
                  shown={shown}
                  preview={preview}
                  title={kindsTitle}
                />
              ),
            }
          : undefined
      }
      options={
        holds === "operations" && shown.includes("reference") ? (
          <Checkbox
            label={m.importCsvReferenceUnique()}
            description={m.importCsvReferenceUniqueHint()}
            checked={columns.referenceUnique}
            onCheckedChange={columns.changeReferenceUnique}
          />
        ) : undefined
      }
      settings={<FileSettings columns={columns} />}
      testReadTitle={m.importCsvTestRead()}
      testRead={
        "missing" in draft ? (
          <StatusMessage message={missingMessage(draft.missing)} />
        ) : (
          <CsvTestRead label={m.importCsvTestRead()} result={result} />
        )
      }
      save={<SaveProfile readable={readable} onSave={files.save} />}
      messages={
        <>
          <StatusMessage message={files.notice} />
          <FormMessage message={files.refused ?? refused} />
        </>
      }
      actions={
        <Button
          disabled={!readable}
          onClick={async () => {
            if ("profile" in draft) {
              await resume(null, columns.chosen === null ? draft.profile : null, columns.chosen);
            }
          }}
        >
          {m.importCsvGo()}
        </Button>
      }
    />
  );
}
