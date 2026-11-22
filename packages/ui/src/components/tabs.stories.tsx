import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { CATEGORIES, MERCHANTS } from "../stories/made-up";
import { Tab, Tabs, TabsList, TabsPanel } from "./tabs";

function Names({ names }: { names: ReadonlyArray<string> }) {
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {names.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
  );
}

/** The "Where the money goes" block's switch, its panels made-up lists. */
function WhereTheMoneyGoes({ disabledSubjects = false }: { disabledSubjects?: boolean }) {
  return (
    <Tabs defaultValue="categories">
      <TabsList label="Where the money goes">
        <Tab value="categories">Categories</Tab>
        <Tab value="merchants">Merchants</Tab>
        <Tab value="subjects" disabled={disabledSubjects}>
          Subjects
        </Tab>
      </TabsList>
      <TabsPanel value="categories">
        <Names names={CATEGORIES.map((category) => category.name)} />
      </TabsPanel>
      <TabsPanel value="merchants">
        <Names names={MERCHANTS.map((merchant) => merchant.name)} />
      </TabsPanel>
      <TabsPanel value="subjects">
        <Names names={["Summer holiday", "New bike"]} />
      </TabsPanel>
    </Tabs>
  );
}

function Controlled() {
  const [value, setValue] = useState("merchants");

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Showing: {value}</p>
      <Tabs value={value} onValueChange={setValue}>
        <TabsList label="Where the money goes">
          <Tab value="categories" icon="other">
            Categories
          </Tab>
          <Tab value="merchants" icon="merchant">
            Merchants
          </Tab>
        </TabsList>
        <TabsPanel value="categories">
          <Names names={CATEGORIES.map((category) => category.name)} />
        </TabsPanel>
        <TabsPanel value="merchants">
          <Names names={MERCHANTS.map((merchant) => merchant.name)} />
        </TabsPanel>
      </Tabs>
    </div>
  );
}

/**
 * Views that share one place, one at a time: the "Where the money goes" block switches between
 * Categories, Merchants and Subjects. A compact segmented control (`TabsList` of `Tab`s), then a
 * `TabsPanel` per tab. Arrow keys move between the tabs and show their panel; a disabled tab is
 * still reached, never selected.
 *
 * Motion: the selected tab's background slides to the chosen one in 200 ms, ease-out; the first
 * placement does not move. Cut under reduced motion.
 *
 * Don't: use tabs to navigate between pages (that is a link), for a choice that sets a value in a
 * form (that is a select or radios), or with more than about five tabs.
 */
const meta = {
  title: "Navigation/Tabs",
  component: WhereTheMoneyGoes,
} satisfies Meta<typeof WhereTheMoneyGoes>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Subjects disabled: the arrow keys still reach it, it is never selected. */
export const DisabledTab: Story = { args: { disabledSubjects: true } };

/** Controlled from outside, with icons. */
export const WithIcons: Story = { render: () => <Controlled /> };

export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
