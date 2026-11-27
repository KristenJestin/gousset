import type { Meta, StoryObj } from "@storybook/react-vite";

import { InFrench } from "../stories/in-french";
import { PaybackWaiting, PaybackWaitingItem } from "./payback-waiting";
import { SubjectTree, SubjectTreeItem, SubjectsLayout } from "./subject-tree";

const eur = (minor: number) => ({ minor, currency: "EUR" });

/** The made-up subjects still waited for: to ask first, then asked by their day, then partly. */
function Waiting() {
  return (
    <PaybackWaiting label="Waiting to be paid back">
      <PaybackWaitingItem
        href="#visit"
        name="Work > Client visit"
        payer="Example Corp"
        standing="to_ask"
        waiting={eur(4000)}
      />
      <PaybackWaitingItem
        href="#conference"
        name="Work > Conference"
        payer="Example Corp"
        standing="asked"
        askedOn="10 May"
        waiting={eur(30_000)}
      />
      <PaybackWaitingItem
        href="#holiday"
        name="Shared holiday"
        payer="Sam Example"
        standing="partly"
        waiting={eur(43_000)}
      />
    </PaybackWaiting>
  );
}

/**
 * What the user still waits for (#217): the paid-back subjects not paid back yet, under the
 * subjects' tree, each a link to its page with what is still waited for (spent less paid back), who
 * pays it back and where it stands; those to ask first, then those asked by their day, then those
 * partly paid back. The page leaves it out when nothing is waited for.
 *
 * Motion: a row's background shows on hover in 150 ms; its amount rolls in 200 ms when it changes.
 * Cut under reduced motion.
 *
 * Don't: list a subject paid back, or one archived.
 */
const meta = {
  title: "Subjects/PaybackWaiting",
  component: Waiting,
} satisfies Meta<typeof Waiting>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Under the tree, beside a subject's page, as the screen lays them out. */
export const InTheScreen: Story = {
  render: () => (
    <SubjectsLayout
      tree={
        <>
          <SubjectTree label="Your subjects">
            <SubjectTreeItem href="#work" name="Work" depth={0} figure="€240/month" />
            <SubjectTreeItem href="#visit" name="Client visit" depth={1} figure="€40/month" />
            <SubjectTreeItem href="#holiday" name="Shared holiday" depth={0} figure="3–9 Aug." />
          </SubjectTree>
          <Waiting />
        </>
      }
    >
      <section className="rounded-xl border bg-card p-6 text-sm">Client visit’s page</section>
    </SubjectsLayout>
  ),
};

export const French: Story = {
  render: () => (
    <InFrench>
      <Waiting />
    </InFrench>
  ),
};

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
