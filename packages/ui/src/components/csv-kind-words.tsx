import { cn } from "../lib/utils";
import { Select } from "./select";

/** A word of the file's kind column, and the kind of operation it was given, if any. */
export type CsvKindWord = { readonly word: string; readonly kind: string | null };

export type CsvKindWordsProps = {
  /** What the list shows, for screen readers ("What each word of What says"). */
  label: string;
  /** The words the file writes in its kind column, each as written, in the order met. */
  words: ReadonlyArray<CsvKindWord>;
  /** The kinds a word can name, in the page's words ("Purchase", "Dividend"). */
  kinds: ReadonlyArray<{ readonly value: string; readonly label: string }>;
  /** The choice of a word left unmapped ("Not mapped"): a row with it is refused at its line. */
  unmapped: string;
  /** A word now names `kind`, or nothing. */
  onKindChange: (word: string, kind: string | null) => void;
  /** The accessible name of a word's list, from the word ("What Buy means"). */
  chooseLabel: (word: string) => string;
  /** Shown when the file's kind column holds no word yet. */
  empty?: string;
};

/** The value of the unmapped choice among the kinds', which no kind takes. */
const UNMAPPED = "unmapped";

/**
 * The words of a broker's kind column, each beside the kind of operation it names (v0.6, a profile
 * mapped by hand): a list per word, the kinds offered and "not mapped". A row whose word names no
 * kind is refused at its line by the import, never guessed. It draws no block: the page puts it
 * under the column mapping.
 *
 * Motion: a word lights up once it names a kind, and goes back when unmapped again: its row takes
 * the primary tint in 200 ms, ease-out; cut under reduced motion, where the tint changes at once.
 */
export function CsvKindWords({
  label,
  words,
  kinds,
  unmapped,
  onKindChange,
  chooseLabel,
  empty,
}: CsvKindWordsProps) {
  const items = [{ value: UNMAPPED, label: unmapped }, ...kinds];

  if (words.length === 0) {
    return empty === undefined ? null : (
      <p data-slot="csv-kind-words" className="text-sm text-muted-foreground">
        {empty}
      </p>
    );
  }

  return (
    <ul data-slot="csv-kind-words" aria-label={label} className="flex w-full flex-col gap-1">
      {words.map(({ word, kind }) => (
        <li
          key={word}
          data-mapped={kind === null ? undefined : true}
          className={cn(
            "flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm",
            "transition-colors duration-200 ease-out data-mapped:bg-primary/10",
          )}
        >
          <span className="truncate font-medium">{word}</span>
          <Select
            label={chooseLabel(word)}
            hideLabel
            size="sm"
            items={items}
            value={kind ?? UNMAPPED}
            onValueChange={(next) => {
              const chosen = kinds.find((each) => each.value === next);

              onKindChange(word, chosen === undefined ? null : chosen.value);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
