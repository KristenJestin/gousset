import { motion } from "motion/react";
import { useState } from "react";
import type { ReactNode } from "react";

import { useHydrated } from "../hooks/use-hydrated";
import { transition } from "../lib/motion";
import { Icon } from "./icon";

/** A line as the import would save it, each value written by the page. */
export type CsvTestLine = { date: string; label: string; amount: string };

/** A line read, with the line of the file it comes from, counted from 1. */
export type CsvTestReadLine = CsvTestLine & { line: number };

/** What a test read gave: the first lines it read, or why it refused the file. */
export type CsvTestResult =
  | {
      kind: "lines";
      /** The columns' headers, in the page's words. */
      headings: CsvTestLine;
      lines: ReadonlyArray<CsvTestReadLine>;
    }
  | {
      kind: "refused";
      /** Why, naming the line and the column ("Line 4, column 1: 31/02/2026 is no date"). */
      message: string;
    };

export type CsvTestReadProps = {
  /** What the region holds, for screen readers ("Test read"). */
  label: string;
  /** The last test read; `null` before the first. */
  result: CsvTestResult | null;
};

/** Each different result is a new one, which fades in; the same one again stays as it is. */
function resultKey(result: CsvTestResult) {
  return result.kind === "refused"
    ? `refused:${result.message}`
    : `lines:${result.lines.map((line) => `${line.line}|${line.date}|${line.label}|${line.amount}`).join("\n")}`;
}

/**
 * Fades in when it appears, in 200 ms (ease-out); cut under reduced motion, where it appears at
 * once. Content the server rendered is shown as it is, its markup without a `style` attribute.
 */
function FadeIn({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const [fades] = useState(hydrated);

  if (!fades) {
    return <div data-slot="csv-test-result">{children}</div>;
  }

  return (
    <motion.div
      data-slot="csv-test-result"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition.base}
    >
      {children}
    </motion.div>
  );
}

/**
 * The result of a test read of a CSV file with the profile being made (`CsvMapping`,
 * `CsvSettings`): the first lines as the import would save them (date, label, amount, written by
 * the page), or why the file cannot be read, naming the line and the column. A polite live region:
 * screen readers hear each new result. It draws no block: the page puts it in one.
 *
 * Motion: each new result fades in (200 ms, ease-out); cut under reduced motion, where it appears
 * at once.
 */
export function CsvTestRead({ label, result }: CsvTestReadProps) {
  return (
    <section aria-label={label} aria-live="polite" data-slot="csv-test-read">
      {result === null ? null : (
        <FadeIn key={resultKey(result)}>
          {result.kind === "refused" ? (
            <p className="flex items-start gap-2 text-sm font-medium text-destructive">
              <span className="flex shrink-0 pt-0.5">
                <Icon name="warning" size="sm" />
              </span>
              <span>{result.message}</span>
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    {result.headings.date}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-left font-medium">
                    {result.headings.label}
                  </th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">
                    {result.headings.amount}
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.lines.map((line) => (
                  <tr key={line.line} className="border-b">
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{line.date}</td>
                    <td className="max-w-80 truncate px-2 py-1.5">{line.label}</td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap tabular-nums">
                      {line.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </FadeIn>
      )}
    </section>
  );
}
