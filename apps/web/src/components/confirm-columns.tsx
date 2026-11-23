import { MAX_PROFILE_FILE, MAX_PROFILE_NAME } from "@gousset/core/imports";
import type {
  CsvPreview as Preview,
  ImportProfileEntry,
  ImportSummary as Import,
  ProfileChoice,
} from "@gousset/core/imports";
import { m } from "@gousset/i18n/messages";
import { getLocale } from "@gousset/i18n/runtime";
import { Button } from "@gousset/ui/components/button";
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
import { csvFieldNames, csvRefusalMessage, missingMessage } from "@/i18n/csv-preview";
import { profileRefusalMessage } from "@/i18n/imports";
import {
  DATE_FORMATS,
  dateExample,
  mappingOf,
  profileOf,
  remap,
  settingsOf,
  splittingProfile,
  withSettings,
} from "@/lib/csv-mapping";
import type { CsvFileSettings } from "@/lib/csv-mapping";
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

  // Shown only, never summed: a float is exact enough for four decimals of a statement's amount.
  return new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(minor / 10_000);
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
      label: line.label,
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
      startSettings={proposal === undefined ? BLANK : settingsOf(proposal)}
      startMapping={proposal === undefined ? [] : mappingOf(proposal, 0)}
    />
  );
}

function ColumnsPreview({
  summary,
  startSettings,
  startMapping,
}: {
  summary: Import;
  startSettings: CsvFileSettings;
  startMapping: ReadonlyArray<CsvField>;
}) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(startSettings);
  const [mapping, setMapping] = useState(startMapping);
  // The profile chosen from the list, until the user changes a column or a setting.
  const [chosen, setChosen] = useState<ProfileChoice | null>(null);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string>();
  const [profileRefused, setProfileRefused] = useState<string>();
  const { resume, refused } = useResume(summary);

  const draft = profileOf(settings, mapping);
  const read = "profile" in draft ? draft.profile : splittingProfile(settings);
  const { data: preview } = useQuery(importQueries.preview(summary.id, read));
  const { data: fitting } = useQuery(importQueries.profilesFor(summary.id));
  const { data: profiles = [] } = useQuery(importQueries.profiles());

  const rows = preview?.rows ?? [];
  const width = Math.max(0, ...rows.map((row) => row.length));
  const [first, ...rest] = rows;

  const columns = Array.from({ length: width }, (_, index) => {
    const named = settings.headerRow ? (first?.[index]?.trim() ?? "") : "";

    return named === "" ? m.importCsvColumn({ number: index + 1 }) : named;
  });

  const lines = settings.headerRow ? rest : rows;

  // Those that read the file first, then the other profiles that still read.
  const fits = (fitting?.fitting ?? []).map((fit) => fit.profile);
  const fitValues = new Set(fits.map((entry) => valueOf(choiceOf(entry))));

  const others = profiles.filter(
    (entry) => entry.definition !== null && !fitValues.has(valueOf(choiceOf(entry))),
  );

  const listed = [...fits, ...others];

  const startFrom = (entry: ImportProfileEntry) => {
    if (entry.definition !== null) {
      setSettings(settingsOf(entry.definition));
      setMapping(mappingOf(entry.definition, width));
    }

    setChosen(choiceOf(entry));
  };

  const refreshProfiles = () => queryClient.invalidateQueries({ queryKey: importKeys.profiles() });

  const save = async () => {
    if (!("profile" in draft)) {
      return;
    }

    const answer = await saveImportProfile({
      data: {
        name: name.slice(0, MAX_PROFILE_NAME),
        institution: null,
        definition: draft.profile,
        header: preview?.header ?? null,
      },
    });

    if ("refused" in answer) {
      setProfileRefused(profileRefusalMessage(answer));

      return;
    }

    setProfileRefused(undefined);
    setChosen(choiceOf(answer.saved));
    setNotice(m.importCsvSaved({ name: answer.saved.name }));
    await refreshProfiles();
  };

  const exportProfile = async () => {
    if (chosen === null) {
      return;
    }

    const answer = await exportImportProfile({ data: { profile: chosen } });

    if ("refused" in answer) {
      setProfileRefused(profileRefusalMessage(answer));

      return;
    }

    setProfileRefused(undefined);
    downloadText(answer.file.fileName, answer.file.content, "application/json");
  };

  const importFile = async (file: File) => {
    const content = await file.text();

    if (content.length > MAX_PROFILE_FILE) {
      setProfileRefused(m.importRefusedProfileTooLong({ limit: MAX_PROFILE_FILE }));

      return;
    }

    const answer = await importImportProfile({
      data: { name: profileNameOf(file.name), institution: null, content },
    });

    if ("refused" in answer) {
      setProfileRefused(profileRefusalMessage(answer));

      return;
    }

    setProfileRefused(undefined);
    startFrom(answer.saved);
    setNotice(m.importCsvImported({ name: answer.saved.name }));
    await refreshProfiles();
  };

  const result = "profile" in draft ? testResult(preview) : null;
  const readable = result !== null && result.kind === "lines";
  const offered = DATE_FORMATS.some((format) => format === settings.dateFormat);
  const dateFormats = offered ? [...DATE_FORMATS] : [...DATE_FORMATS, settings.dateFormat];

  return (
    <CsvPreview
      intro={<StatusMessage message={m.importCsvIntro()} />}
      profile={
        <>
          <Select
            label={m.importCsvProfile()}
            size="sm"
            value={chosen === null ? BY_HAND : valueOf(chosen)}
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
                setChosen(null);
              } else {
                startFrom(entry);
              }
            }}
          />
          <Button variant="secondary" size="sm" disabled={chosen === null} onClick={exportProfile}>
            {m.importCsvExport()}
          </Button>
          <FileButton size="sm" icon="import" accept=".json,application/json" onFile={importFile}>
            {m.importCsvImportFile()}
          </FileButton>
        </>
      }
      mapping={
        preview !== undefined && width === 0 ? (
          <StatusMessage message={m.importCsvNoRows()} />
        ) : (
          <CsvMapping
            label={m.importCsvPreviewLabel({ file: summary.fileName })}
            columns={columns}
            rows={lines}
            fields={csvFieldNames()}
            mapping={mapping}
            onMappingChange={(column, field) => {
              setMapping(remap(mapping, column, field));
              setChosen(null);
            }}
            chooseLabel={(column) => m.importCsvColumnHolds({ column })}
          />
        )
      }
      settings={
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
          onChange={(value) => {
            setSettings(withSettings(settings, value));
            setChosen(null);
          }}
        />
      }
      testReadTitle={m.importCsvTestRead()}
      testRead={
        "missing" in draft ? (
          <StatusMessage message={missingMessage(draft.missing)} />
        ) : (
          <CsvTestRead label={m.importCsvTestRead()} result={result} />
        )
      }
      save={
        <>
          <TextField
            label={m.importCsvSaveName()}
            size="sm"
            maxLength={MAX_PROFILE_NAME}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
          <Button variant="secondary" size="sm" disabled={!readable} onClick={save}>
            {m.importCsvSave()}
          </Button>
        </>
      }
      messages={
        <>
          <StatusMessage message={notice} />
          <FormMessage message={profileRefused ?? refused} />
        </>
      }
      actions={
        <Button
          disabled={!readable}
          onClick={async () => {
            if ("profile" in draft) {
              await resume(null, chosen === null ? draft.profile : null, chosen);
            }
          }}
        >
          {m.importCsvGo()}
        </Button>
      }
    />
  );
}
