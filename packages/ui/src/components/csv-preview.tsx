import type { ReactNode } from "react";

export type CsvPreviewProps = {
  /** The profile it is read with, and the profile files' actions. */
  profile: ReactNode;
  /** The file's first lines, each column mapped (`CsvMapping`). */
  mapping: ReactNode;
  /** The file's settings (`CsvSettings`). */
  settings: ReactNode;
  /** The test read's heading, in the page's words ("Test read"). */
  testReadTitle: string;
  /** The test read's result (`CsvTestRead`), or why there is none yet. */
  testRead: ReactNode;
  /** Saving the mapping as a named profile: its name's field and its button, side by side. */
  save: ReactNode;
  /** What the last action said (`StatusMessage`, `FormMessage`), last. */
  messages?: ReactNode;
};

/**
 * The body of the side sheet where a CSV file the app could not read on its own is mapped, opened
 * from its card on the import screen (wireframe, screen 6, block 3; #210): the profile it is read
 * with, the first lines where each column is mapped, the settings, the test read, then saving the
 * profile. Layout only: every part is the page's, built from the components named. The sheet gives
 * the title, what the file left open (its description) and the import's action (its actions).
 *
 * Motion: none of its own; the mapping lights a column as it is mapped, and the test read's result
 * fades in.
 */
export function CsvPreview({
  profile,
  mapping,
  settings,
  testReadTitle,
  testRead,
  save,
  messages,
}: CsvPreviewProps) {
  return (
    <div data-slot="csv-preview" className="flex w-full min-w-0 flex-col gap-6">
      <div className="flex flex-wrap items-end gap-3">{profile}</div>
      {mapping}
      {settings}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">{testReadTitle}</h3>
        {testRead}
      </div>
      <div className="flex flex-wrap items-end gap-3">{save}</div>
      {messages}
    </div>
  );
}
