/** One keyboard shortcut: what it does and the keys, both already written for the user. */
export interface Shortcut {
  readonly id: string;
  /** What it does, from the messages. */
  readonly label: string;
  /** The keys as the user's platform writes them (`⌘ K` on a Mac, `Ctrl+K` elsewhere). */
  readonly keys: string;
}

/**
 * The list of the app's keyboard shortcuts, as the `?` dialog shows it. The page builds it from
 * the declared shortcuts, so that it never drifts from them. No motion of its own.
 */
export function ShortcutList({ shortcuts }: { readonly shortcuts: ReadonlyArray<Shortcut> }) {
  return (
    <dl className="flex flex-col divide-y divide-border">
      {shortcuts.map(({ id, label, keys }) => (
        <div key={id} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-sm">{label}</dt>
          <dd>
            <kbd className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {keys}
            </kbd>
          </dd>
        </div>
      ))}
    </dl>
  );
}
