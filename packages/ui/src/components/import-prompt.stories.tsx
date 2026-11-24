import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { ACCOUNTS } from "../stories/made-up";
import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { ImportPrompt } from "./import-prompt";
import { Select } from "./select";

const ACCOUNT_ITEMS = ACCOUNTS.map(({ id, name }) => ({ value: id, label: name }));

/** The block a page puts it in, under a file's row. */
function InBlock({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-5xl rounded-lg border bg-card p-4 md:p-6">{children}</div>;
}

/**
 * What an import asks before it goes on, or why it failed, under its file's row: the message,
 * the control that answers and the buttons on one inset line on a wide screen, with no gap under
 * them; on a phone, stacked, the main button first and full width. The message is the control's
 * visible label; the control keeps its own label for screen readers ("Account of <file>"). A
 * refusal shows under the line and is announced.
 *
 * Motion: none of its own; it unfolds with its row's content (250 ms), cut under reduced motion.
 *
 * Don't: put more than one question in it, or a long form (a CSV's columns have their own).
 */
const meta = {
  title: "Import/Import prompt",
  component: ImportPrompt,
  args: {
    message: "This file does not say which account it belongs to.",
    control: (
      <Select
        label="Account of statement_october.ofx"
        hideLabel
        size="sm"
        items={ACCOUNT_ITEMS}
        placeholder="Choose the account"
      />
    ),
    actions: <Button size="sm">Import into this account</Button>,
  },
  render: (args) => (
    <InBlock>
      <ImportPrompt {...args} />
    </InBlock>
  ),
} satisfies Meta<typeof ImportPrompt>;

export default meta;

type Story = StoryObj<typeof meta>;

/** The account to choose, on one line. */
export const Default: Story = {};

/** The answer was refused: why, under the line. */
export const Refused: Story = {
  args: { error: "This account no longer exists: choose another one." },
};

/** A failure: its mark, why, and what to do. */
export const Failed: Story = {
  args: {
    tone: "error",
    message: "The file is damaged or was cut short: download it again from the bank.",
    control: undefined,
    actions: (
      <>
        <Button variant="quiet" size="sm" icon="undo">
          Undo this import
        </Button>
        <Button variant="secondary" size="sm" icon="retry">
          Try again
        </Button>
      </>
    ),
  },
};

/** On a French page: the longer words still hold on one line. */
export const French: Story = {
  args: {
    message: "Ce fichier ne dit pas à quel compte il appartient.",
    control: (
      <Select
        label="Compte de releve_octobre.ofx"
        hideLabel
        size="sm"
        items={ACCOUNT_ITEMS}
        placeholder="Choisir le compte"
      />
    ),
    actions: <Button size="sm">Importer dans ce compte</Button>,
  },
  render: (args) => (
    <InFrench>
      <InBlock>
        <ImportPrompt {...args} />
      </InBlock>
    </InFrench>
  ),
};

/** On a phone: stacked, the button full width. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
