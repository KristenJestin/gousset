/**
 * The cell of `ImportFiles` that names a file, by its row's `id`: where focus goes once what the
 * file asked is answered over the page (its columns, in a sheet), the action that asked it gone
 * with the question, so that the keyboard and screen readers stay on the file whose import goes
 * on. Kept out of the component's file, which exports components only.
 */
export function fileCellOf(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    `[role="cell"][data-column="file"][data-file="${CSS.escape(id)}"]`,
  );
}
