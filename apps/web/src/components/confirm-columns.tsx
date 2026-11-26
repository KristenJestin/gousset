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
import { fileCellOf } from "@gousset/ui/components/import-files";
import { ImportPrompt } from "@gousset/ui/components/import-prompt";
import { Select } from "@gousset/ui/components/select";
import { Sheet } from "@gousset/ui/components/sheet";
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
  byHand,
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
import { whileBusy } from "@/lib/while-busy";
import { importKeys, importQueries } from "@/queries/imports";

// A CSV file the app could not read on its own (#19, #20): its card says so, with an action that
// opens the side sheet (#210) where the user chooses a profile that reads it or maps each column,
// adjusts the file's settings, sees a test read, saves the mapping as a profile, and imports.

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
      label: line.label,
      amount: amountText(line.amountMinor, currency),
    })),
  };
}

/**
 * A CSV file detection could not read whole, on its card: what it waits for, and the action that
 * opens its columns in the side sheet (`ColumnsSheet`, which the page holds).
 */
export function ConfirmColumns({ summary, onOpen }: { summary: Import; onOpen: () => void }) {
  // Read now, so that the sheet opens filled.
  useQuery(importQueries.csv(summary.id));

  return (
    <ImportPrompt
      message={m.importCsvQuestion()}
      actions={
        <Button size="sm" onClick={onOpen}>
          {m.importCsvOpen()}
        </Button>
      }
    />
  );
}

export type ColumnsSheetProps = {
  /** The import waiting for its columns, as it was when the sheet opened. */
  summary: Import;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * A CSV file's columns in the shared side sheet (docs/design.md, "Actions and forms"; along the
 * bottom edge on a phone), wide enough for the file's columns side by side: its preview, from what
 * detection proposed, whose form is the sheet's. Confirming saves the profile when it is named,
 * closes the sheet and runs the import on, focus going to the file's row; Cancel, Escape or the
 * backdrop close it, the file still waiting, focus back on the card's action. It opens once the file's questions are read, so that it opens filled; closed, it reads
 * nothing more, the import having moved on.
 *
 * Motion: the shared `Sheet`'s: it slides in from the right edge (from the bottom on a phone) in
 * 300 ms and back out in 200 ms, over the backdrop fading in 200 ms; cut under reduced motion.
 */
export function ColumnsSheet({ summary, open, onOpenChange }: ColumnsSheetProps) {
  const { data: questions, isPending } = useQuery({
    ...importQueries.csv(summary.id),
    enabled: open,
  });

  if (isPending) {
    return null;
  }

  const proposal = questions?.profile;

  return (
    <ColumnsForm
      summary={summary}
      open={open}
      onOpenChange={onOpenChange}
      initialSettings={proposal === undefined ? BLANK : settingsOf(proposal)}
      initialMapping={proposal === undefined ? [] : mappingOf(proposal, 0)}
    />
  );
}

function ColumnsForm({
  summary,
  open,
  onOpenChange,
  initialSettings,
  initialMapping,
}: ColumnsSheetProps & {
  /** What detection proposed, kept as the start: the user changes it from there. */
  initialSettings: CsvFileSettings;
  initialMapping: ReadonlyArray<CsvField>;
}) {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState(initialSettings);
  const [mapping, setMapping] = useState(initialMapping);
  // The profile chosen from the list, until the user changes a column or a setting.
  const [chosen, setChosen] = useState<ProfileChoice | null>(null);
  // The profile last chosen from the list: while its layout still reads the file, the list names it.
  const [startedFrom, setStartedFrom] = useState<ProfileChoice | null>(null);
  const [name, setName] = useState("");
  const [notice, setNotice] = useState<string>();
  const [profileRefused, setProfileRefused] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  // Confirmed, the card's action is gone with the question: focus goes to the file's row.
  const [confirmed, setConfirmed] = useState(false);
  const { resume, refused } = useResume(summary);

  const draft = profileOf(settings, mapping);
  const read = "profile" in draft ? draft.profile : splittingProfile(settings);

  // Closed, it reads nothing more: the import may have moved on.
  const { data: preview } = useQuery({ ...importQueries.preview(summary.id, read), enabled: open });
  const { data: fitting } = useQuery({ ...importQueries.profilesFor(summary.id), enabled: open });
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
    setStartedFrom(choiceOf(entry));
  };

  const refreshProfiles = () => queryClient.invalidateQueries({ queryKey: importKeys.profiles() });

  /**
   * Saves the mapping under the name typed, and reads the file with it from then on: the profile
   * saved, or `null` when refused (said under the name). The name is cleared, so that it is not
   * saved twice.
   */
  const saveProfile = async (): Promise<ProfileChoice | null> => {
    if (!("profile" in draft)) {
      return null;
    }

    const answer = await saveImportProfile({
      data: {
        name,
        institution: null,
        definition: draft.profile,
        header: preview?.header ?? null,
      },
    });

    if ("refused" in answer) {
      setProfileRefused(profileRefusalMessage(answer));

      return null;
    }

    const saved = choiceOf(answer.saved);

    setProfileRefused(undefined);
    setChosen(saved);
    setName("");
    setNotice(m.importCsvSaved({ name: answer.saved.name }));
    await refreshProfiles();

    return saved;
  };

  /**
   * Imports the file read this way: with the profile chosen, or else the mapping, saved first as a
   * profile when it is named. Accepted, the sheet closes and the import goes on.
   */
  const confirm = async () => {
    if (!("profile" in draft)) {
      return;
    }

    const naming = chosen === null && name.trim() !== "";
    const saved = naming ? await saveProfile() : null;

    if (naming && saved === null) {
      return;
    }

    const profile = saved ?? chosen;

    if (await resume(null, profile === null ? draft.profile : null, profile)) {
      setConfirmed(true);
      onOpenChange(false);
    }
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

  const readWith = chosen ?? (settings.layout === undefined ? null : startedFrom);
  const result = "profile" in draft ? testResult(preview) : null;
  const readable = result !== null && result.kind === "lines";
  const offered = DATE_FORMATS.some((format) => format === settings.dateFormat);
  const dateFormats = offered ? [...DATE_FORMATS] : [...DATE_FORMATS, settings.dateFormat];

  return (
    <Sheet
      title={m.importCsvSheetTitle({ file: summary.fileName })}
      description={m.importCsvIntro()}
      size="xl"
      open={open}
      onOpenChange={onOpenChange}
      // While it is sent it stays open: its answer lands on the form that sent it.
      sending={busy || saving}
      finalFocus={confirmed ? () => fileCellOf(summary.id) : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        void whileBusy(setBusy, confirm);
      }}
      actions={
        <Button type="submit" disabled={!readable || saving} loading={busy}>
          {m.importCsvGo()}
        </Button>
      }
    >
      <CsvPreview
        profile={
          <>
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
                  setSettings(byHand(settings));
                  setChosen(null);
                } else {
                  startFrom(entry);
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={chosen === null}
              onClick={exportProfile}
            >
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
                setSettings(byHand(settings));
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
            <Button
              variant="secondary"
              size="sm"
              disabled={!readable || busy}
              loading={saving}
              onClick={() => void whileBusy(setSaving, saveProfile)}
            >
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
      />
    </Sheet>
  );
}
