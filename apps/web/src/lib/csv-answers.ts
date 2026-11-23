import type { CsvProfile, CsvUnsure } from "@gousset/import";

/** What the user answered about a CSV file, on the import screen; `null` where nothing was. */
export type CsvAnswers = {
  readonly dates: "day" | "month" | null;
  readonly decimal: "," | "." | null;
  /** The amount's column, or the debit's when `credit` is given too. */
  readonly amount: number | null;
  readonly credit: number | null;
};

/** Whether a date format reads the day before the month (year first counts as day first). */
export function readsDayFirst(dateFormat: string): boolean {
  return dateFormat.startsWith("DD") || dateFormat.startsWith("Y");
}

/** The date format read the other way round: `DD/MM/YYYY` and `MM/DD/YYYY`. */
function swapped(dateFormat: string): string {
  return dateFormat.replace(/^(DD|MM)(.?)(DD|MM)/, "$3$2$1");
}

/**
 * The profile detection proposed, with the user's answers to what it left open (`unsure`), and
 * only those: what detection was sure of stays as it is, whatever the form sent.
 */
export function answeredProfile(
  profile: CsvProfile,
  unsure: ReadonlyArray<CsvUnsure>,
  answers: CsvAnswers,
): CsvProfile {
  const { dates, decimal, amount, credit } = answers;
  const dayFirst = readsDayFirst(profile.dateFormat);

  const dateFormat =
    unsure.includes("dateFormat") && dates !== null && (dates === "day") !== dayFirst
      ? swapped(profile.dateFormat)
      : profile.dateFormat;

  const decimalMark =
    unsure.includes("decimalMark") && decimal !== null ? decimal : profile.decimalMark;

  const amountColumns: CsvProfile["columns"]["amount"] =
    unsure.includes("amount") && amount !== null
      ? credit === null
        ? { kind: "signed", column: amount }
        : { kind: "debit-credit", debit: amount, credit }
      : profile.columns.amount;

  return {
    ...profile,
    dateFormat,
    decimalMark,
    columns: { ...profile.columns, amount: amountColumns },
  };
}
