import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ReactNode } from "react";

import { InFrench } from "../stories/in-french";
import { LineSubjects, SubjectChips, SubjectsField } from "./subject-chips";
import type { SubjectChipView } from "./subject-chips";

// Every subject here is invented.

/** The user's subjects in use, in tree order, by their paths. */
const CHOICES: ReadonlyArray<SubjectChipView> = [
  { id: "house", name: "House" },
  { id: "shed", name: "House > Garden shed" },
  { id: "van", name: "Van" },
  { id: "alps", name: "Alps 2026" },
];

const VAN = { id: "van", name: "Van" };
const ALPS = { id: "alps", name: "Alps 2026" };

/** A narrow column, 340 px: about what the detail's sheet gives its blocks on a phone. */
function Column({ children }: { children: ReactNode }) {
  return <div className="flex w-85 max-w-full flex-col">{children}</div>;
}

/** An expense's subjects as the page keeps them: a chip added or removed at once. */
function Choosing({ start, error }: { start: ReadonlyArray<SubjectChipView>; error?: string }) {
  const [chosen, setChosen] = useState(start);

  return (
    <Column>
      <LineSubjects
        chosen={chosen}
        choices={CHOICES}
        onAdd={(id) => {
          const added = CHOICES.find((choice) => choice.id === id);

          if (added !== undefined) {
            setChosen([...chosen, added]);
          }
        }}
        onRemove={(id) => setChosen(chosen.filter((each) => each.id !== id))}
        error={error}
      />
    </Column>
  );
}

/**
 * What an expense is for (#37; docs/wireframes, screen 2): its subjects as chips. `SubjectChips`
 * reads them in a row of a list (two and "+N" with `limit`); `SubjectsField` chooses them, each
 * chip with its remove button and "+ Add", which shows a picker of the subjects in use, found by
 * typing, with the focus; `LineSubjects` is that field in a line's detail, under its category.
 * Only an expense has subjects: the page gives none to an income, a transfer or a held line.
 *
 * Motion: a chip that comes fades in, one that goes fades out, in 150 ms (ease-out); those drawn
 * with the page are there at once. A remove button's background in 150 ms on hover. Cut under
 * reduced motion.
 *
 * Don't: offer an archived subject in the picker, give an income subjects, or share an expense
 * between subjects by giving it several (it counts whole in each): split it.
 */
const meta = {
  title: "Subjects/SubjectChips",
  component: SubjectChips,
  args: { subjects: [VAN, ALPS] },
} satisfies Meta<typeof SubjectChips>;

export default meta;

type Story = StoryObj<typeof meta>;

/** A row's chips. */
export const Default: Story = {};

/** Past the row's room: two chips and "+1". */
export const Limited: Story = {
  args: {
    subjects: [{ id: "house", name: "House" }, { id: "shed", name: "Garden shed" }, VAN],
    limit: 2,
  },
};

/** In a line's detail: its chips, each removable, and "+ Add". */
export const InDetail: Story = { render: () => <Choosing start={[VAN, ALPS]} /> };

/** None yet: "None yet" and "+ Add". */
export const NoneYet: Story = { render: () => <Choosing start={[]} /> };

/** A refusal, said under the field: the chips are back as they were. */
export const Refused: Story = {
  render: () => (
    <Choosing
      start={[VAN]}
      error="This subject is archived: it gets no new expense nor merchant. Restore it first."
    />
  ),
};

/** A share's field in a split's sheet, labelled with its number. */
export const InAShare: Story = {
  render: () => (
    <Column>
      <SubjectsField
        label="Subjects 2"
        chosen={[ALPS]}
        choices={CHOICES}
        onAdd={() => undefined}
        onRemove={() => undefined}
        addLabel="Add a subject to share 2"
        pickerLabel="Subject for share 2"
      />
    </Column>
  ),
};

export const French: Story = {
  render: () => (
    <InFrench>
      <Choosing start={[VAN]} />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
  render: () => <Choosing start={[VAN, ALPS]} />,
};
