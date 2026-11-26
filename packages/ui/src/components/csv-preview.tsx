import type { ReactNode } from "react";

export type CsvPreviewProps = {
  /** What the file left open, and what to do (a `StatusMessage`). */
  intro: ReactNode;
  /** The profile it is read with, and the profile files' actions. */
  profile: ReactNode;
  /** The file's first lines, each column mapped (`CsvMapping`). */
  mapping: ReactNode;
  /**
   * A broker's operations only: the words of the kind column and the kinds they name
   * (`CsvKindWords`), under the mapping, with their heading. Left out for a statement.
   */
  kinds?: { readonly title: string; readonly words: ReactNode };
  /** The file's settings (`CsvSettings`). */
  settings: ReactNode;
  /** The test read's heading, in the page's words ("Test read"). */
  testReadTitle: string;
  /** The test read's result (`CsvTestRead`), or why there is none yet. */
  testRead: ReactNode;
  /** Saving the mapping as a named profile: its name's field and its button, side by side. */
  save: ReactNode;
  /** What the last action said (`StatusMessage`, `FormMessage`), above the import's action. */
  messages?: ReactNode;
  /** The import's own action, last. */
  actions: ReactNode;
};

/**
 * The import screen's preview of a CSV file the app could not read on its own (wireframe, screen
 * 6, block 3), under its row: the profile it is read with, the first lines where each column is
 * mapped (and, for a broker's operations, the words of its kind column), the settings, the test
 * read, saving the profile, then importing. Layout only: every part
 * is the page's, built from the components named. It draws no block: the row's content is one.
 *
 * Motion: none of its own; the mapping lights a column as it is mapped, and the test read's result
 * fades in.
 */
export function CsvPreview({
  intro,
  profile,
  mapping,
  kinds,
  settings,
  testReadTitle,
  testRead,
  save,
  messages,
  actions,
}: CsvPreviewProps) {
  return (
    <div data-slot="csv-preview" className="flex w-full min-w-0 flex-col gap-6">
      {intro}
      <div className="flex flex-wrap items-end gap-3">{profile}</div>
      {mapping}
      {kinds === undefined ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium text-foreground">{kinds.title}</h3>
          {kinds.words}
        </div>
      )}
      {settings}
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">{testReadTitle}</h3>
        {testRead}
      </div>
      <div className="flex flex-wrap items-end gap-3">{save}</div>
      {messages}
      <div className="flex flex-wrap items-center gap-3">{actions}</div>
    </div>
  );
}
