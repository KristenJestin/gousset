import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { CsvKindWords } from "./csv-kind-words";
import type { CsvKindWordsProps } from "./csv-kind-words";

const KINDS = [
  { value: "purchase", label: "Purchase" },
  { value: "sale", label: "Sale" },
  { value: "dividend", label: "Dividend" },
  { value: "fee", label: "Fee" },
  { value: "deposit", label: "Deposit" },
  { value: "withdrawal", label: "Withdrawal" },
];

/** The block a page puts it in: the component itself draws no surface. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-md rounded-lg border bg-card p-6">{children}</div>;
}

/** The words kept by the story, as a page keeps them: each choice lights its word up. */
function Words(props: CsvKindWordsProps) {
  const [words, setWords] = useState(props.words);

  return (
    <InBlock>
      <CsvKindWords
        {...props}
        words={words}
        onKindChange={(word, kind) =>
          setWords(words.map((each) => (each.word === word ? { word, kind } : each)))
        }
      />
    </InBlock>
  );
}

/**
 * The words of a broker's kind column, mapped by hand (v0.6): beside each word the file writes,
 * the kind of operation it names, or "Not mapped", whose rows the import refuses at their line.
 * The page finds the words in the file's first lines and in a test read's refusal, gives every
 * word of the interface, and keeps the mapping.
 *
 * Accessibility: a labelled list; each word's list is named after the word ("What Buy means") and
 * opens from the keyboard like any `Select`.
 *
 * Motion: a word that names a kind lights up (its row takes the primary tint, 200 ms, ease-out),
 * and goes back when unmapped; cut under reduced motion.
 *
 * Don't: guess a word's kind for the user, or restyle it in a page.
 */
const meta = {
  title: "Import/CSV kind words",
  component: CsvKindWords,
  args: {
    label: "What each word of What says",
    words: [
      { word: "Buy", kind: "purchase" },
      { word: "Sell", kind: "sale" },
      { word: "Cash in", kind: "deposit" },
      { word: "Coupon", kind: null },
    ],
    kinds: KINDS,
    unmapped: "Not mapped",
    onKindChange: () => undefined,
    chooseLabel: (word) => `What ${word} means`,
  },
  render: (args) => <Words {...args} />,
} satisfies Meta<typeof CsvKindWords>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Three words mapped, one not yet. */
export const Default: Story = {};

/** No word mapped yet: none lit. Choose a kind to see its word light up. */
export const Unmapped: Story = {
  args: {
    words: [
      { word: "Buy", kind: null },
      { word: "Sell", kind: null },
    ],
  },
};

/** The kind column holds no word yet: the page says so. */
export const Empty: Story = {
  args: { words: [], empty: "Choose the column that says what each row is." },
};

/** On a French page: the page gives the kinds' names in French. */
export const French: Story = {
  args: {
    label: "Ce que dit chaque mot de Opération",
    words: [
      { word: "Achat Comptant", kind: "purchase" },
      { word: "Encaissement dividende", kind: null },
    ],
    kinds: [
      { value: "purchase", label: "Achat" },
      { value: "sale", label: "Vente" },
      { value: "dividend", label: "Dividende" },
      { value: "fee", label: "Frais" },
      { value: "deposit", label: "Versement" },
      { value: "withdrawal", label: "Retrait" },
    ],
    unmapped: "Non associé",
    chooseLabel: (word) => `Ce que signifie ${word}`,
  },
  render: (args) => (
    <InFrench>
      <Words {...args} />
    </InFrench>
  ),
};

/** On a phone the words and their lists share the narrow width. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
