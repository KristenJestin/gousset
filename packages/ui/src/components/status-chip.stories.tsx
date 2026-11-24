import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { StatusChip } from "./status-chip";

/**
 * Where something stands, as a pill: an import's state in its row. Colour only where the user has
 * something to do (`action`, violet) or something failed (`error`, red); `done` is a quiet grey
 * pill with a green mark (a list of green pills is noise, and green already means income);
 * `busy` carries the loader; `undone` is outlined. The page gives the words.
 *
 * Motion: none of its own; a busy chip's loader falls, and pulses under reduced motion.
 *
 * Don't: put a sentence in it (it never wraps), or colour a state that asks nothing of the user.
 */
const meta = {
  title: "Data/StatusChip",
  component: StatusChip,
  args: { tone: "done", children: "Imported" },
} satisfies Meta<typeof StatusChip>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every tone, as the import screen uses them. */
export const Tones: Story = {
  render: () => (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip tone="action">Account to choose</StatusChip>
      <StatusChip tone="busy">Reading</StatusChip>
      <StatusChip tone="error">Failed</StatusChip>
      <StatusChip tone="done">Imported</StatusChip>
      <StatusChip tone="undone">Undone</StatusChip>
      <StatusChip>Waiting</StatusChip>
    </div>
  ),
};

/** On a French page: the longest states still hold on one line. */
export const French: Story = {
  render: () => (
    <InFrench>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone="action">Colonnes à confirmer</StatusChip>
        <StatusChip tone="busy">Enregistrement</StatusChip>
        <StatusChip tone="error">Échec</StatusChip>
        <StatusChip tone="done">Importé</StatusChip>
        <StatusChip tone="undone">Annulé</StatusChip>
      </div>
    </InFrench>
  ),
};
