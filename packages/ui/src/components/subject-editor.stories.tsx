import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { InFrench } from "../stories/in-french";
import { Button } from "./button";
import { SubjectEditor } from "./subject-editor";
import type { SubjectDraft, SubjectEditorErrors, SubjectPastView } from "./subject-editor";

const PARENTS = [
  { id: "house", name: "House" },
  { id: "shed", name: "House > Garden shed" },
  { id: "van", name: "Van" },
];

const LOANS = [{ id: "harbor", name: "Harbor Savings loan" }];

const ACCOUNTS = [
  { id: "current", name: "Current account" },
  { id: "harbor", name: "Harbor Savings loan" },
  { id: "livret", name: "Livret A" },
];

const MERCHANTS = [
  { id: "cyclehub", name: "Cycle Hub" },
  { id: "pedal", name: "Pedal Cover insurance" },
  { id: "fuelstop", name: "Fuelstop" },
  { id: "greenmarket", name: "Greenmarket" },
];

const EMPTY: SubjectDraft = {
  name: "",
  parentId: null,
  hasValue: false,
  valueMinor: null,
  valueCurrency: "EUR",
  loanAccountId: null,
  hasDates: false,
  startsOn: null,
  endsOn: null,
  accountIds: [],
  merchantIds: [],
  attachPast: true,
  archived: false,
};

/** The wireframe's bicycle: a value, two merchants, their past expenses found. */
const BICYCLE: SubjectDraft = {
  ...EMPTY,
  name: "Bicycle",
  hasValue: true,
  valueMinor: 120_000,
  merchantIds: ["cyclehub", "pedal"],
};

type EditingProps = {
  editing: string | null;
  initial: SubjectDraft;
  errors?: SubjectEditorErrors;
};

/**
 * The sheet as a page holds it, open at first: the past expenses are read again as the merchants
 * change (9 for €486 once there is one), and Save says what was sent.
 */
function Editing({ editing, initial, errors }: EditingProps) {
  const [open, setOpen] = useState(true);
  const [opened, setOpened] = useState(0);
  const [saved, setSaved] = useState<SubjectDraft>();
  const [merchants, setMerchants] = useState(initial.merchantIds.length);

  const past: SubjectPastView =
    merchants === 0 ? { state: "none" } : { state: "known", expenses: 9, total: "€486" };

  return (
    <div className="flex flex-col items-start gap-3">
      <Button
        variant="secondary"
        onClick={() => {
          setOpened(opened + 1);
          setOpen(true);
        }}
      >
        Open the subject
      </Button>
      <p data-testid="saved" className="text-sm text-muted-foreground">
        {saved === undefined ? "Not saved" : `Saved: ${JSON.stringify(saved)}`}
      </p>
      <SubjectEditor
        key={opened}
        open={open}
        onOpenChange={setOpen}
        editing={editing}
        initial={initial}
        parents={PARENTS}
        loans={LOANS}
        accounts={ACCOUNTS}
        merchants={MERCHANTS}
        past={past}
        errors={errors}
        onDraftChange={(draft) => setMerchants(draft.merchantIds.length)}
        onSave={async (draft) => {
          await new Promise((resolve) => {
            setTimeout(resolve, 400);
          });
          setSaved(draft);
          setOpen(false);
        }}
      />
    </div>
  );
}

/**
 * A subject in a side sheet (docs/wireframes, screen 8; docs/design.md, "A long form"): its name and
 * the subject it is inside, the only things it needs; "Has a value" (its estimated value in a
 * currency, the loan it is bought with) and "Has dates" (its start, its end); the accounts linked to
 * it; the merchants whose expenses it gets automatically, each becoming a rule; and their past
 * expenses, attached at once when "Attach them" is ticked. A saved subject may be archived.
 *
 * It opens on its name. While sent it stays open, its button busy; a refusal is said under the
 * field at fault.
 *
 * Motion: it slides in from the right in 300 ms, ease-out, and out in 200 ms; from the bottom on a
 * phone; its backdrop fades in 200 ms. Cut under reduced motion.
 *
 * Don't: save as the fields change, or attach the past expenses without the box ticked.
 */
const meta = {
  title: "Subjects/SubjectEditor",
  component: Editing,
  args: { editing: null, initial: BICYCLE },
} satisfies Meta<typeof Editing>;

export default meta;

type Story = StoryObj<typeof meta>;

/** Creating the wireframe's bicycle. */
export const Default: Story = {};

/** A new subject, nothing filled in yet. */
export const Empty: Story = { args: { initial: EMPTY } };

/** Editing a trip, its dates set, the archive box offered. */
export const Saved: Story = {
  args: {
    editing: "Alps 2028",
    initial: {
      ...EMPTY,
      name: "Alps 2028",
      hasDates: true,
      startsOn: "2028-07-03",
      endsOn: "2028-07-17",
      accountIds: ["current"],
    },
  },
};

/** A move refused: a subject cannot go inside one of its own. */
export const Refused: Story = {
  args: {
    editing: "House",
    initial: { ...EMPTY, name: "House", parentId: "shed" },
    errors: { parent: "A subject cannot go inside itself, nor inside one of its own." },
  },
};

export const French: Story = {
  render: (args) => (
    <InFrench>
      <Editing {...args} />
    </InFrench>
  ),
};

/** A phone: the sheet rises from the bottom, its whole width. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
